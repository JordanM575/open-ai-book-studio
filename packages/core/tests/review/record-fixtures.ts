import { LibraryService } from "../../src/library/service";
import type { SaveChapterResult } from "../../src/schema";
import { buildReviewEnvelope, reviewToolNameSchema, type EnvelopeInput } from "../../src/review/envelope";
import { buildReaderRun, type ReaderRun } from "../../src/review/findings";
import { builtinReaderProfile, editReaderProfile, type ProfileContent } from "../../src/review/profiles";
import { captureChapterSource, type SavedBody } from "../../src/review/sources";
import { InMemoryLibraryPort } from "../support/in-memory-port";

/** Synthetic only: no real manuscript, profile, credential or library is touched. */

export const stamp = "2026-11-07T12:00:00.000Z";
export const afterRun = "2026-11-07T12:10:00.000Z";
export const body = "ADJACENT_BEFORE\nSelected 😀 exact.\nADJACENT_AFTER";
export const selectedStart = body.indexOf("Selected");
export const selectedEnd = body.indexOf("\nADJACENT_AFTER");

export interface Clock {
  value: string;
}

export function clockAt(value: string): Clock {
  return { value };
}

export function makeLibrary(clock: Clock = clockAt(afterRun)) {
  const port = new InMemoryLibraryPort(
    { id: "device_fixture01", name: "Fixture device", createdAt: stamp },
    () => clock.value
  );
  const open = LibraryService.open({ storage: port, runtime: port });
  return { port, open };
}

export async function makeBook(clock: Clock = clockAt(afterRun)) {
  const { port, open } = makeLibrary(clock);
  const library = await open;
  const book = await library.createBook({ title: "Synthetic review book" });
  await library.establishBaseline();
  return { port, library, book, clock };
}

export function savedFor(bookId: string): SavedBody {
  return { bookId, chapterId: "ch_123456", version: 3, hash: "a".repeat(64), body };
}

export function citationFor(bookId: string) {
  return {
    kind: "chapter" as const,
    sourceId: "source-1",
    identity: { bookId, chapterId: "ch_123456", version: 3, hash: "a".repeat(64) },
    start: selectedStart,
    end: selectedEnd,
    quote: body.slice(selectedStart, selectedEnd)
  };
}

export async function readerEnvelope(bookId: string, runId = "run_00000001", profileOverride?: EnvelopeInput["profile"]) {
  const profile = profileOverride ?? (await builtinReaderProfile("alpha"));
  return buildReviewEnvelope({
    contractVersion: 1,
    kind: "reader-review",
    requestId: runId,
    capturedAt: stamp,
    destination: {
      connectionId: "connection-1",
      provider: "Synthetic provider",
      model: "synthetic/model",
      endpointIdentity: "endpoint-revision-1"
    },
    environment: {
      hostId: "synthetic-host",
      hostSupported: true,
      connectionAvailable: true,
      modelSupported: true,
      capabilityRevision: "capability-1",
      estimatedCostUsd: null,
      priceAsOf: null,
      catalogContextTokens: null,
      catalogAsOf: null,
      contextFit: "unknown"
    },
    books: [
      {
        bookId,
        title: "Synthetic book",
        consentSatisfied: true,
        consentRevision: "consent-1",
        termsRevision: "terms-1",
        enabledTools: [...reviewToolNameSchema.options]
      }
    ],
    prompt: "Review the selected passage.",
    profile,
    priorFeedback: [],
    sources: [
      captureChapterSource({
        sourceId: "source-1",
        saved: savedFor(bookId),
        bookTitle: "Synthetic book",
        title: "Synthetic chapter",
        position: 1,
        capturedAt: stamp,
        ranges: [{ start: selectedStart, end: selectedEnd }]
      })
    ]
  });
}

export async function readerRun(bookId: string, runId = "run_00000001", profileOverride?: EnvelopeInput["profile"]): Promise<ReaderRun> {
  const envelope = await readerEnvelope(bookId, runId, profileOverride);
  const profile = envelope.profile;
  if (!profile) throw new Error("Fixture envelope has no reader lens");
  return buildReaderRun({
    runId,
    startedAt: stamp,
    completedAt: afterRun,
    envelope,
    output: JSON.stringify({
      runId,
      readerId: profile.id,
      readerVersion: profile.version,
      findings: [
        {
          findingId: "finding-1",
          category: "clarity",
          readerId: profile.id,
          readerVersion: profile.version,
          runId,
          interpretation: "This passage seems clear to this fictional lens.",
          claim: "observation",
          evidence: [citationFor(bookId)]
        }
      ]
    })
  });
}

export const authorContent: ProfileContent = {
  name: "Synthetic beta lens",
  purpose: "A fictional editorial lens for synthetic tests",
  focus: ["clarity", "pacing"],
  guidance: "Discuss clarity and pacing as subjective impressions."
};

export async function authorProfile(id = "author-lens-1") {
  return editReaderProfile(await builtinReaderProfile("alpha"), authorContent, id);
}

export async function seedChapter(library: LibraryService, bookId: string) {
  const created = await library.createChapter(bookId, { title: "Synthetic chapter" });
  const result: SaveChapterResult = await library.saveChapter(bookId, created.id, body, {
    baseVersion: 0,
    baseHash: ""
  });
  if (result.status !== "saved") throw new Error("Synthetic chapter did not save");
  return result.chapter;
}

export function item<T>(items: readonly T[], index = 0): T {
  const found = items[index];
  if (found === undefined) throw new Error("Missing synthetic fixture item");
  return found;
}
