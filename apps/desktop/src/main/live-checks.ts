import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import { AgentRuntime } from "./agent/runtime";
import { ImageService } from "./images";
import { SegmentationService } from "./segmentation";
import { VoiceService } from "./voice";
import { Library } from "./library/store";
import type { ProviderService } from "./providers";
import type { Studio } from "./studio";

const run = promisify(execFile);

export type LiveOutcome = "ok" | "blocked" | "failed";

export interface LiveResult {
  name: string;
  outcome: LiveOutcome;
  detail: string;
}

/** The phrase the dictation check speaks, so the transcript has a ground truth. */
const PHRASE = "The lighthouse keeper counted the ships that never came.";

/**
 * What the studio can do with a real Meta key.
 *
 * Every one of these was a blocker until a key arrived, and each is worth proving rather than
 * asserting: the model catalogue, a real writing turn that changes a real file, dictation with a
 * recording whose words are known, an image from Muse Image, and a cutout from SAM 3.1.
 *
 * The library it writes to is a copy of the committed sample, in a temporary folder, deleted
 * afterwards. The author's own book is never touched.
 */
export async function runLiveChecks(
  providers: ProviderService,
  options: { sampleRoot: string }
): Promise<LiveResult[]> {
  const results: LiveResult[] = [];
  const record = (name: string, outcome: LiveOutcome, detail: string): void => {
    results.push({ name, outcome, detail });
  };

  /* ------------------------------------------------------------- the models */

  let contributorModelId: string | null = null;
  try {
    const connections = await providers.list();
    const meta = connections.find((entry: { provider: string }) => entry.provider === "meta");
    if (!meta) {
      record("the model catalogue", "blocked", "There is no Meta connection in the studio.");
    } else {
      const catalogue = await providers.models(meta.id);
      const ids = catalogue.models.map((model: { id: string }) => model.id);
      if (ids.length === 0) {
        record("the model catalogue", "failed", "Meta answered, but with no models in it.");
      } else {
        contributorModelId =
          ids.find((id: string) => id.includes("contributor")) ??
          ids.find((id: string) => /muse|spark/i.test(id)) ??
          ids[0]!;
        record(
          "the model catalogue",
          "ok",
          `${ids.length} model${ids.length === 1 ? "" : "s"}: ${ids.slice(0, 6).join(", ")}${
            ids.length > 6 ? ", …" : ""
          }`
        );
      }
    }
  } catch (error) {
    record("the model catalogue", "failed", message(error));
  }

  /* ------------------------------------------------------------- a real turn */

  if (contributorModelId) {
    const temp = await mkdtemp(join(tmpdir(), "studio-live-agent-"));
    try {
      const libraryRoot = join(temp, "library");
      await cp(options.sampleRoot, libraryRoot, { recursive: true });
      const library = await Library.open(libraryRoot);
      const books = await library.listBooks();
      const book = books[0];
      if (!book) {
        record("a real writing turn", "failed", "The sample library has no book.");
      } else {
        const connection = (await providers.list()).find(
          (entry: { provider: string }) => entry.provider === "meta"
        );
        await library.updateBook(book.id, {
          // The sample is the project's own synthetic work, so the Contributor consent is safe here.
          allowContributorTraining: true,
          defaultConnectionId: connection?.id ?? null,
          defaultModelId: contributorModelId
        });
        const chapters = (await library.readBook(book.id)).chapters;
        const before = chapters[0]?.content ?? "";
        const studio = { library, requireLibrary: () => library } as unknown as Studio;
        const runtime = new AgentRuntime(studio, providers, () => {}, undefined, () => {});

        const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The turn did not finish in time.")), 240_000);
          runtime.onEvent((event) => {
            if (event.type === "done") {
              clearTimeout(timer);
              resolve(event);
            } else if (event.type === "error") {
              clearTimeout(timer);
              reject(new Error(event.message));
            }
          });
        });

        await runtime.start({
          bookId: book.id,
          chapterId: chapters[0]?.id ?? null,
          prompt:
            "Read the first chapter, then add one short paragraph at the end of it in the same voice. Do not change anything else."
        });
        const result = await done;
        const after = (await library.readChapter(book.id, chapters[0]!.id)).content;
        const changed = after !== before;
        record(
          "a real writing turn",
          changed ? "ok" : "failed",
          changed
            ? `the agent replied (${result.text.length} characters) and the file on disk changed`
            : "the agent replied, but the file did not change."
        );
      }
    } catch (error) {
      record("a real writing turn", "failed", message(error));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  /* ------------------------------------------------------------- dictation */

  {
    const temp = await mkdtemp(join(tmpdir(), "studio-live-voice-"));
    try {
      const aiff = join(temp, "phrase.aiff");
      const wav = join(temp, "phrase.wav");
      // macOS speaks the phrase, and the converter puts it in the shape Meta accepts.
      await run("say", ["-o", aiff, "--data-format=LEF32@22050", PHRASE]);
      await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
      const audio = new Uint8Array(await readFile(wav));
      const transcript = await new VoiceService(providers).transcribe({ audio });
      const said = transcript.text.toLowerCase().replace(/[^a-z ]/g, "").trim();
      const words = PHRASE.toLowerCase().replace(/[^a-z ]/g, "").trim().split(" ");
      const heard = words.filter((word) => said.includes(word)).length;
      const score = Math.round((heard / words.length) * 100);
      record(
        "dictation",
        score >= 60 ? "ok" : "failed",
        `“${transcript.text}” — ${score}% of the words (${heard} of ${words.length}), ${transcript.durationMs}ms of audio`
      );
    } catch (error) {
      record("dictation", "failed", message(error));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  /* ------------------------------------------------------------- an image */

  try {
    const image = await new ImageService(providers).generate({
      prompt: "A black and white photograph of a lighthouse keeper's ledger on a wooden table.",
      size: "1024x1024"
    });
    const bytes = image.bytes?.length ?? 0;
    record(
      "Muse Image",
      bytes > 1000 ? "ok" : "failed",
      bytes > 1000
        ? `${bytes} bytes of ${image.inspection.mimeType}, model ${image.model}, ${image.size}`
        : "Meta answered, but with no image in it."
    );
  } catch (error) {
    record("Muse Image", "failed", message(error));
  }

  /* ------------------------------------------------------------- a cutout */

  {
    const temp = await mkdtemp(join(tmpdir(), "studio-live-sam-"));
    try {
      const images = join(options.sampleRoot, "books", "book_6788c2887dc3401e", "images");
      const files = (await readdir(images)).filter((name) => name.endsWith(".png"));
      if (files.length === 0) {
        record("SAM 3.1", "blocked", "The sample has no image to segment.");
      } else {
        const bytes = new Uint8Array(await readFile(join(images, files[0]!)));
        const result = await new SegmentationService(providers).segment({
          prompt: "the lighthouse keeper",
          bytes,
          mimeType: "image/png"
        });
        const matches = result.matches?.length ?? 0;
        record(
          "SAM 3.1",
          matches > 0 ? "ok" : "failed",
          matches > 0
            ? `${matches} match${matches === 1 ? "" : "es"}`
            : "Meta answered, but with no mask in it."
        );
      }
    } catch (error) {
      const text = message(error);
      // Access to a model is an account fact, not a defect in the studio.
      const blocked = /access|not.*found|forbidden|unauthor|permission|entitle/i.test(text);
      record("SAM 3.1", blocked ? "blocked" : "failed", text);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  return results;
}

function message(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
