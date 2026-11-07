import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyReference } from "@ai-book-studio/core/library/history-restore";
import { createLibraryArchive } from "@ai-book-studio/core/archive/export";
import { archiveSourceFromBytes, importLibraryArchive } from "@ai-book-studio/core/archive/import";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { LibraryService } from "@ai-book-studio/core/library/service";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import type { CommitFileResult, FileExpectation, LibraryPath } from "@ai-book-studio/core/library/port";
import { DraftBuffer } from "../src/main/drafts";
import { createFileSystemEnvironment, FileSystemLibraryPort } from "../src/main/library/fs-port";
import { Library } from "../src/main/library/store";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "studio-restore-synthetic-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const source = (chapter: { version: number; hash: string }) => ({ status: "saved" as const, version: chapter.version, hash: chapter.hash });

test("desktop facade reopens durable undo and a racing draft remains available for normal conflict handling", async () => {
  const library = await Library.open(join(root, "library"));
  const book = await library.createBook({ title: "Synthetic restore" });
  const first = await library.createChapter(book.id, { title: "Door", content: "Named text" });
  const scope = { bookId: book.id, chapterId: first.id };
  const selected = await library.captureChapterHistory({ ...scope, label: "Milestone", source: source(first) });
  const edited = await library.saveChapter(book.id, first.id, "Before restore", { baseVersion: first.version, baseHash: first.hash });
  if (edited.status !== "saved") throw new Error("Fixture save failed");
  const drafts = new DraftBuffer();
  const restoring = library.restoreChapterHistory({ ...scope, selected: historyReference(selected), source: source(edited.chapter) });
  drafts.set({ ...scope, content: "Draft typed while restore runs", baseVersion: edited.chapter.version, baseHash: edited.chapter.hash });
  const restored = await restoring;
  expect(restored.status).toBe("saved");
  if (restored.status !== "saved") throw new Error("Restore failed");
  const reopened = await Library.open(library.root);
  expect(drafts.dirtyChapterIds()).toEqual([first.id]);
  expect(await reopened.reconcileChapterHistory({ ...scope, fileName: restored.intent.fileName })).toMatchObject({ undoAvailable: true });
  const undone = await reopened.undoChapterHistory({ ...scope, intent: historyReference(restored.intent), source: source(restored.chapter) });
  expect(undone.status).toBe("saved");
  expect((await reopened.readChapter(book.id, first.id)).content).toBe("Before restore\n");
  expect(drafts.dirtyChapterIds()).toEqual([first.id]);
  const flushed = await drafts.flushOne(reopened, book.id, first.id);
  expect(flushed?.status).toBe("conflict");
  if (flushed?.status !== "conflict") throw new Error("Racing draft must conflict");
  expect(await readFile(join(reopened.root, flushed.conflict.savedAs), "utf8")).toContain("Draft typed while restore runs");
  expect(await reopened.readChapterHistory({ ...scope, fileName: selected.fileName })).toEqual(selected);
});

test("filesystem failed finalization retains exact intent bytes and archive carries safety/intent through live and trash", async () => {
  class FinalizationFailure extends FileSystemLibraryPort {
    fail = false;
    prepared: Uint8Array | undefined;
    override async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
      if (path.includes("history") && new TextDecoder().decode(bytes).includes("kind: intent")) {
        if (this.fail && expected.kind === "sha256") throw new LibraryPortError("io", "Synthetic finalization fault");
        if (expected.kind === "absent") this.prepared = bytes.slice();
      }
      return super.commitFile(path, bytes, expected);
    }
  }
  const folder = join(root, "library");
  const environment = createFileSystemEnvironment(folder);
  const storage = new FinalizationFailure(folder);
  const service = await LibraryService.open({ ...environment, storage });
  const book = await service.createBook({ title: "Synthetic recovery transport" });
  const chapter = await service.createChapter(book.id, { title: "Door", content: "Selected text" });
  const scope = { bookId: book.id, chapterId: chapter.id };
  const selected = await service.captureChapterHistory({ ...scope, label: "Milestone", source: source(chapter) });
  const changed = await service.saveChapter(book.id, chapter.id, "Safety text", { baseVersion: chapter.version, baseHash: chapter.hash });
  if (changed.status !== "saved") throw new Error("Fixture failed");
  storage.fail = true;
  const result = await service.restoreChapterHistory({ ...scope, selected: historyReference(selected), source: source(changed.chapter) });
  expect(result.status).toBe("saved");
  if (result.status !== "saved") throw new Error("Restore failed");
  expect(result.finalized).toBe(false);
  if (!storage.prepared) throw new Error("Missing prepared bytes");
  expect(Array.from(await readFile(join(folder, "books", book.id, "history", chapter.id, result.intent.fileName)))).toEqual(Array.from(storage.prepared));
  const reopened = await Library.open(folder);
  expect(await reopened.reconcileChapterHistory({ ...scope, fileName: result.intent.fileName })).toMatchObject({ status: "restore-matches", undoAvailable: true });
  for (const trashed of [false, true]) {
    if (trashed) await service.deleteBook(book.id);
    const archive = await createLibraryArchive({ ...environment, storage }, { appVersion: "synthetic" });
    const records = archive.manifest.entries.filter((entry) => entry.path.includes(`/history/${chapter.id}/`));
    expect(records).toHaveLength(3);
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.chunks) chunks.push(chunk);
    const target = createFileSystemEnvironment(join(root, trashed ? "import-trash" : "import-live"));
    await importLibraryArchive(archiveSourceFromBytes(new Uint8Array(Buffer.concat(chunks))), target.storage, target.runtime);
    for (const record of records) {
      const path = toLibraryPath(record.path.split("/"));
      expect((await target.storage.readFile(path))?.bytes).toEqual((await storage.readFile(path))?.bytes);
    }
  }
});
