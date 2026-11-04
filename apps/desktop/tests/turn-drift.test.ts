import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { BookMeta, Chapter } from "@ai-book-studio/core/schema";
import type { DriftReport } from "@ai-book-studio/core/sync/types";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
import { Library } from "../src/main/library/store";

/*
 * A turn's own files are this device's writes (spec 016 FR-005). After a background turn the drift
 * review must not list the conversation, the chapter or the undo checkpoint the turn wrote, nor the
 * checkpoint undo removed; an edit made outside the studio must still be listed. The turn runs
 * through the real runtime against a scripted model, so every file it writes is the one the app
 * would write.
 */

let root = "";
let library: Library;
let book: BookMeta;
let chapter: Chapter;

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 12, text: 12, reasoning: undefined }
};

const credential: StoredCredential = {
  id: "conn_test0001",
  provider: "openrouter",
  label: "Test connection",
  kind: "api-key",
  createdAt: "2026-10-25T00:00:00.000Z",
  secret: "sk-test"
};

const deadlines = new Set<ReturnType<typeof setTimeout>>();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-turn-drift-"));
  library = await Library.open(root);
  book = await library.createBook({ title: "The Salt Road" });
  await library.updateBook(book.id, {
    defaultProvider: "openrouter",
    defaultConnectionId: credential.id,
    defaultModelId: "test-model"
  });
  chapter = await library.createChapter(book.id, { title: "The Light", content: "The keeper counted the gulls." });
  // The library open scan's first baseline; without one there is nothing to compare against.
  expect(await library.establishBaseline()).toBe(true);
});

afterEach(async () => {
  for (const timer of deadlines) clearTimeout(timer);
  deadlines.clear();
  await rm(root, { recursive: true, force: true });
});

function providers(): ProviderService {
  return {
    credential: async () => credential,
    models: async () => ({
      models: [
        {
          id: "test-model",
          name: "Test Model",
          contextLength: 1_000,
          supportsTools: true,
          supportsImages: false,
          inputPricePerMillion: null,
          outputPricePerMillion: null
        }
      ],
      fetchedAt: "2026-10-25T00:00:00.000Z"
    })
  } as unknown as ProviderService;
}

function stream(parts: StreamPart[], finish: "tool-calls" | "stop"): StreamResult {
  return {
    stream: simulateReadableStream<StreamPart>({
      chunks: [
        { type: "stream-start", warnings: [] },
        ...parts,
        { type: "finish", finishReason: { unified: finish, raw: undefined }, usage: USAGE }
      ]
    })
  };
}

/** A background turn that adds a sentence to the chapter and says so, run to its end. */
async function backgroundTurn(): Promise<AgentRuntime> {
  const steps = [
    stream(
      [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "append_to_chapter",
          input: JSON.stringify({ chapterId: chapter.id, text: "At midnight the lamp turned once." })
        }
      ],
      "tool-calls"
    ),
    stream(
      [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "I added one line about the lamp." },
        { type: "text-end", id: "text-1" }
      ],
      "stop"
    )
  ];
  const model = new MockLanguageModelV4({
    doStream: (async () => {
      const next = steps.shift();
      if (!next) throw new Error("The model has no step left.");
      return next;
    }) as MockLanguageModelV4["doStream"]
  });
  let finish!: (event: AgentEvent) => void;
  const finished = new Promise<AgentEvent>((resolve, reject) => {
    finish = resolve;
    deadlines.add(setTimeout(() => reject(new Error("The turn did not finish.")), 5_000));
  });
  const runtime = new AgentRuntime(
    { library, requireLibrary: () => library } as unknown as Studio,
    providers(),
    (event) => {
      if (event.type === "done" || event.type === "error" || event.type === "stopped") finish(event);
    },
    () => model
  );
  await runtime.start({ mode: "edit", bookId: book.id, prompt: "Add a line about the lamp.", background: true });
  const event = await finished;
  expect(event.type).toBe("done");
  return runtime;
}

/** Every entry the review would list, as kind and path. */
function listed(report: DriftReport): Array<[string, string]> {
  return report.entries.map((entry) => [entry.kind, entry.path]);
}

describe("the drift review after a background turn", () => {
  test("lists none of the turn's own files: the conversation, the chapter and its checkpoint", async () => {
    await backgroundTurn();
    const written = await readdir(join(root, "books", book.id, ".studio", "checkpoints"));
    expect(written.filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(await readdir(join(root, "books", book.id, "threads"))).toHaveLength(1);

    const report = await library.checkDrift();
    expect(listed(report)).toEqual([]);
    expect(report.clean).toBe(true);
  });

  test("undo's restore and the checkpoint it removes stay this device's own", async () => {
    const runtime = await backgroundTurn();
    // The window reopens and scans before the author undoes the turn.
    expect(listed(await library.checkDrift())).toEqual([]);
    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(1);
    expect(await readdir(join(root, "books", book.id, ".studio", "checkpoints"))).toEqual([]);

    const report = await library.checkDrift();
    expect(listed(report)).toEqual([]);
    expect(report.clean).toBe(true);
  });

  test("still lists an edit made outside the studio, beside the turn's files", async () => {
    await backgroundTurn();
    const chapterFile = join(root, "books", book.id, "chapters", chapter.path);
    await writeFile(chapterFile, `${(await Bun.file(chapterFile).text()).trimEnd()}\nAn editor elsewhere added this line.\n`);
    const checkpoints = join(root, "books", book.id, ".studio", "checkpoints");
    await mkdir(checkpoints, { recursive: true });
    await writeFile(join(checkpoints, "2026-11-04T00-00-00-000Z-turn_elsewhere01.json"), "{}\n");

    const report = await library.checkDrift();
    expect(report.clean).toBe(false);
    const outside: Array<[string, string]> = [
      ["new-remote", `books/${book.id}/.studio/checkpoints/2026-11-04T00-00-00-000Z-turn_elsewhere01.json`],
      ["remote-changed", `books/${book.id}/chapters/${chapter.path}`]
    ];
    expect(listed(report).sort()).toEqual(outside.sort());
  });
});
