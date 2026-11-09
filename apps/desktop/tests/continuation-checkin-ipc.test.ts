import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC, type Result, type StudioApi } from "@ai-book-studio/core/ipc";
import { normalizeBody, serializeChapter } from "@ai-book-studio/core/markdown";
import { countWords } from "@ai-book-studio/core/words";
import { buildCampaignContinuation } from "@ai-book-studio/core/review/campaign-continuation-build";
import { campaignInput, planned, withSynthesis } from "../../../packages/core/tests/review/campaign-fixtures";
import { Library } from "../src/main/library/store";
import type { CoordinatorIdentity } from "../src/main/continuation-checkin";
import { mockElectron } from "./support/mock-electron";

/*
 * The continuation check-in channel end to end: preload bridge, Zod boundary,
 * Library-backed handler and the Result envelope, on a synthetic temp library.
 * Bad ids must be refused as `invalid` before the Library is touched.
 */

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const roots: string[] = [];
let registerIpc!: typeof import("../src/main/ipc").registerIpc;
let exposed: StudioApi | null = null;

const time = "2026-11-08T12:00:00.000Z";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (n = 1) => n.toString(16).padStart(64, "0");

beforeAll(async () => {
  mockElectron(tmpdir(), {
    handle: (channel, handler) => { handlers.set(channel, handler); },
    exposeInMainWorld: (_name, api) => { exposed = api as StudioApi; },
    invoke: (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) return Promise.reject(new Error(`No handler for ${channel}`));
      return handler({}, args[0]) as Promise<never>;
    }
  });
  ({ registerIpc } = await import("../src/main/ipc"));
  // The preload module is cached process-wide and may already have been
  // evaluated under another file's hooks; the query re-evaluates it under
  // this file's hooks so the exposed bridge is the one captured here.
  const preloadEntry: string = "../src/preload/index.ts?continuation-checkin";
  await import(preloadEntry);
});

afterAll(() => { mockElectron(tmpdir()); });
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function checkedLibrary(chapterContents: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "continuation-checkin-ipc-"));
  roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Synthetic check-in book" });
  for (const [index, content] of chapterContents.entries()) {
    await library.createChapter(book.id, { title: `Counted chapter ${index + 1}`, content });
  }
  const body = normalizeBody("Synthetic chapter prose for check-in mapping.\n");
  const rawBytes = new TextEncoder().encode(serializeChapter({
    id: "ch_123456", title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version: 3,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
  const input = withSynthesis(await campaignInput(body));
  const source = input.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.saved = { ...source.saved, bookId: book.id, hash: sha256(rawBytes) };
  input.ownerBookId = book.id;
  if (input.request.books[0]) input.request.books[0].bookId = book.id;
  const plan = await planned(input);
  const built = await buildCampaignContinuation(plan, {
    operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint: null
  });
  await library.campaignContinuations.publishContinuation(book.id, plan.campaignId, {
    manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments
  });
  return { root, library, book, plan };
}

function register(library: Library, coordinator: CoordinatorIdentity | null) {
  const studio = {
    library,
    requireLibrary() {
      if (!this.library) throw new Error("No library is open. Choose a folder first.");
      return this.library;
    },
    current: () => null
  };
  registerIpc(
    studio as never, () => null, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, () => null,
    { status: null, start: async () => undefined, stop: async () => undefined } as never,
    () => false,
    () => coordinator
  );
}

const coordinatorFor = (bookId: string): CoordinatorIdentity => {
  const owner = { libraryRegistration: "lib_fixture", bookId, runId: "run_fixture" };
  return { owner, direction: { kind: "direction", owner, id: "direction_fixture", revision: 1, hash: hash(7) } };
};

async function call(payload?: unknown): Promise<Result<unknown>> {
  const handler = handlers.get(IPC.continuation.checkin);
  if (!handler) throw new Error("No continuation check-in handler registered.");
  return (await handler({}, payload)) as Result<unknown>;
}

describe("continuation check-in channel (039 T018 seam 6b)", () => {
  test("returns the counted check-in through the preload bridge and Result envelope", async () => {
    const { library, book, plan } = await checkedLibrary();
    register(library, coordinatorFor(book.id));
    if (!exposed?.continuation) throw new Error("Preload did not expose the continuation API");
    const result = await exposed.continuation.checkin({ bookId: book.id, campaignId: plan.campaignId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.campaignId).toBe(plan.campaignId);
    expect(result.data.ownerBookId).toBe(book.id);
    expect("targetWords" in result.data).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain(library.root);
  });

  test("bad ids are invalid before the Library is touched, and never reach the store", async () => {
    const { library, book, plan } = await checkedLibrary();
    register(library, coordinatorFor(book.id));
    const refused: unknown[] = [
      "../outside",
      { bookId: "../outside", campaignId: plan.campaignId },
      { bookId: book.id, campaignId: "bad/id" },
      { bookId: book.id, campaignId: "bad\\id" },
      { bookId: book.id, campaignId: plan.campaignId, path: "/etc/passwd" },
      { bookId: book.id, campaignId: plan.campaignId, expected: { revision: 0 } },
      { bookId: book.id, campaignId: plan.campaignId, expected: { manifestHash: "z".repeat(64) } },
      { bookId: book.id },
      null,
      42
    ];
    for (const payload of refused) {
      const result = await call(payload);
      expect({ payload: JSON.stringify(payload), ok: result.ok, code: result.ok ? null : result.error.code })
        .toEqual({ payload: JSON.stringify(payload), ok: false, code: "invalid" });
    }
    // The checked campaign is untouched and still maps afterwards.
    const after = await call({ bookId: book.id, campaignId: plan.campaignId });
    expect(after.ok).toBe(true);
  });

  test("stale and cross-book refusals surface as typed failures, not empty successes", async () => {
    const { library, book, plan } = await checkedLibrary();
    register(library, coordinatorFor(book.id));
    const stale = await call({ bookId: book.id, campaignId: plan.campaignId, expected: { revision: 99 } });
    expect(stale).toMatchObject({ ok: false, error: { code: "conflict" } });
    const missing = await call({ bookId: book.id, campaignId: "campaign-missing" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not-found" } });
    register(library, coordinatorFor("book_654321"));
    const foreign = await call({ bookId: book.id, campaignId: plan.campaignId });
    expect(foreign).toMatchObject({ ok: false, error: { code: "corrupt" } });
  });

  test("returns the host-counted cadence through the channel with a countWords oracle", async () => {
    const contents = ["Alpha beta gamma.", "Delta epsilon zeta eta."];
    const { library, book, plan } = await checkedLibrary(contents);
    register(library, coordinatorFor(book.id));
    const result = await call({ bookId: book.id, campaignId: plan.campaignId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { cadence?: { callerCountedProgress: { savedWordsSinceCheckin: number; adoptedChaptersSinceCheckin: number } } };
    const oracle = contents.reduce((total, content) => total + countWords(normalizeBody(content)), 0);
    expect(data.cadence?.callerCountedProgress.savedWordsSinceCheckin).toBe(oracle);
    expect(data.cadence?.callerCountedProgress.adoptedChaptersSinceCheckin).toBe(2);
  });

  test("malformed cadence input is invalid before the Library is touched", async () => {
    const { library, book, plan } = await checkedLibrary(["Alpha beta gamma."]);
    register(library, coordinatorFor(book.id));
    const basePolicy = {
      version: 1, adoptedChapterInterval: 3, savedWordInterval: 10_000,
      afterFirstChapter: true, onIrreversibleChoice: true
    };
    const refused: unknown[] = [
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, adoptedChapterInterval: 0 } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, adoptedChapterInterval: 1025 } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, savedWordInterval: 0 } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, savedWordInterval: 1_000_001 } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, version: 2 } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, afterFirstChapter: "yes" } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: { ...basePolicy, adoptedChapterInterval: "3" } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { callerCountedProgress: { adoptedChaptersSinceCheckin: 1, savedWordsSinceCheckin: 1, firstAdoptedChapterOccurred: true, irreversibleChoicePending: false } } },
      { bookId: book.id, campaignId: plan.campaignId, cadence: 42 },
      { bookId: book.id, campaignId: plan.campaignId, cadence: { policy: basePolicy, extra: true } }
    ];
    for (const payload of refused) {
      const result = await call(payload);
      expect({ payload: JSON.stringify(payload), ok: result.ok, code: result.ok ? null : result.error.code })
        .toEqual({ payload: JSON.stringify(payload), ok: false, code: "invalid" });
    }
    const after = await call({ bookId: book.id, campaignId: plan.campaignId });
    expect(after.ok).toBe(true);
  });

  test("with no coordinator identity in the host, the channel refuses truthfully", async () => {
    const { library, book, plan } = await checkedLibrary(["Alpha beta gamma."]);
    register(library, null);
    const result = await call({
      bookId: book.id, campaignId: plan.campaignId,
      cadence: {
        policy: {
          version: 1, adoptedChapterInterval: 3, savedWordInterval: 10_000,
          afterFirstChapter: true, onIrreversibleChoice: true
        }
      }
    });
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
    if (!result.ok) expect(result.error.message).toContain("037");
  });
});
