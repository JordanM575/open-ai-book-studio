import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { StudioApi } from "@ai-book-studio/core/ipc";
import { LibraryService } from "@ai-book-studio/core/library/service";
import type { ReviewRecordResult } from "@ai-book-studio/core/library/review-record-api";
import { createFileSystemEnvironment } from "../src/main/library/fs-port";
import { readerRun } from "../../../packages/core/tests/review/record-fixtures";
import { mockElectron } from "./support/mock-electron";

const scratch = "/private/var/folders/kn/662ks6rj58lchyyydr8kgc180000gn/T/opencode";
const roots: string[] = [];
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
let exposed!: StudioApi;
let current: object;
let Library!: typeof import("../src/main/library/store").Library;
let keychainCalls = 0;

beforeAll(async () => {
  // Bun fixes named exports on first resolution: provide the complete main + preload namespace once.
  const unavailable = () => { throw new Error("Unrequested native operation in synthetic review test"); };
  mock.module("electron", () => ({
    app: { getPath: () => scratch, getVersion: () => "0.0.0-checks", isPackaged: false },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    dialog: { showOpenDialog: unavailable, showSaveDialog: unavailable, showMessageBox: unavailable },
    ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler) },
    Menu: {}, nativeImage: { createFromBuffer: unavailable }, Notification: { isSupported: () => false }, session: {},
    shell: { showItemInFolder: unavailable, openExternal: unavailable },
    safeStorage: { isAsyncEncryptionAvailable: () => { keychainCalls++; return false; }, encryptString: unavailable, decryptString: unavailable },
    contextBridge: { exposeInMainWorld: (name: string, api: StudioApi) => { if (name === "studio") exposed = api; } },
    ipcRenderer: { on: () => {}, removeListener: () => {}, invoke: async (channel: string, payload: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error("Unregistered test IPC channel");
      return structuredClone(await handler({}, structuredClone(payload)));
    } }
  }));
  const { registerIpc } = await import("../src/main/ipc");
  ({ Library } = await import("../src/main/library/store"));
  registerIpc({ requireLibrary: () => current } as never, () => null, {} as never, {} as never,
    {} as never, {} as never, {} as never, { get: () => ({}) } as never, {} as never);
  await import("../src/preload/index");
});
afterAll(async () => {
  mockElectron(scratch);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
function value<T>(result: ReviewRecordResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
function api() {
  if (!exposed.reviewRecords) throw new Error("Missing preload review API");
  return exposed.reviewRecords;
}
async function fixture() {
  const root = await mkdtemp(join(scratch, "w10-review-host-"));
  roots.push(root);
  const library = await LibraryService.open(createFileSystemEnvironment(root));
  const book = await library.createBook({ title: "Synthetic saved review IPC" });
  const chapter = await library.createChapter(book.id, { title: "Synthetic untouched source", content: "Keep these exact manuscript bytes." });
  return { root, library, book, chapter };
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("registered saved-review IPC and actual preload over synthetic filesystem Library", () => {
  test("preload save/list/read/no-op roundtrip uses the one injected service and preserves chapter bytes", async () => {
    const { root, library, book, chapter } = await fixture();
    // The real desktop wrapper is tested separately below: this injection proves the owned transport seams.
    current = library;
    const reviews = api();
    const scope = value(await reviews.open(book.id, crypto.randomUUID()));
    const chapterPath = join(root, "books", book.id, "chapters", chapter.path);
    const before = hash(await readFile(chapterPath));
    const run = await readerRun(book.id);
    expect(value(await reviews.list(scope)).total).toBe(0);
    const saved = value(await reviews.save(scope, run));
    expect(saved.status).toBe("created");
    expect(value(await reviews.save(scope, run)).status).toBe("unchanged");
    expect(value(await reviews.read(scope, run.runId, saved.report.hash)).rawJson).toBe(saved.report.rawJson);
    expect(value(await reviews.list(scope)).reports[0]?.hash).toBe(saved.report.hash);
    expect(hash(await readFile(chapterPath))).toBe(before);
    expect(keychainCalls).toBe(0);
  });

  test("shipping desktop Library reports the missing forwarding seam rather than opening a second writer", async () => {
    const root = await mkdtemp(join(scratch, "w10-review-desktop-gap-"));
    roots.push(root);
    current = await Library.open(root);
    expect(await api().open("book_synthetic01", crypto.randomUUID())).toMatchObject({
      ok: false, error: { code: "unsupported", outcome: "refused" }
    });
    expect(keychainCalls).toBe(0);
  });

  test("preload refuses a former library token after the current Library changes", async () => {
    const first = await fixture();
    current = first.library;
    const scope = value(await api().open(first.book.id, crypto.randomUUID()));
    const second = await fixture();
    current = second.library;
    expect(await api().save(scope, await readerRun(first.book.id))).toMatchObject({
      ok: false, error: { code: "changed", outcome: "refused" }
    });
    expect((await first.library.reviewRecords.listReports(first.book.id)).total).toBe(0);
    expect((await second.library.reviewRecords.listReports(second.book.id)).total).toBe(0);
  });
});
