import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryService } from "@ai-book-studio/core/library/service";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import type { CommitFileResult, FileExpectation, LibraryPath } from "@ai-book-studio/core/library/port";
import { DraftBuffer } from "../src/main/drafts";
import { createFileSystemEnvironment, FileSystemLibraryPort } from "../src/main/library/fs-port";
import { Library } from "../src/main/library/store";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "studio-history-synthetic-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("desktop saved-only history", () => {
  test("ordinary history files survive reopen and browse/compare leaves a pending draft available", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Synthetic history" });
    const chapter = await library.createChapter(book.id, { title: "Door", content: "Saved text" });
    const scope = { bookId: book.id, chapterId: chapter.id };
    const chapterFile = join(root, "books", book.id, "chapters", chapter.path);
    const before = await readFile(chapterFile);
    const captured = await library.captureChapterHistory({ ...scope, label: "Milestone",
      source: { status: "saved", version: chapter.version, hash: chapter.hash } });
    const historyFile = join(root, "books", book.id, "history", chapter.id, captured.fileName);
    expect(await readFile(chapterFile)).toEqual(before);
    expect(await readFile(historyFile, "utf8")).toContain("Saved text\n");

    const drafts = new DraftBuffer();
    drafts.set({ ...scope, content: "Unflushed draft", baseVersion: chapter.version, baseHash: chapter.hash });
    const reopened = await Library.open(root);
    const input = { ...scope, fileName: captured.fileName };
    expect(await reopened.readChapterHistory(input)).toEqual(captured);
    expect((await reopened.listChapterHistory(scope)).records).toHaveLength(1);
    expect((await reopened.compareChapterHistory(input)).current.content).toBe("Saved text\n");
    expect(drafts.dirtyChapterIds()).toEqual([chapter.id]);
    expect(await readFile(chapterFile)).toEqual(before);
    // Only the explicit normal editor action flushes; this proves browsing retained the full draft.
    const saved = await drafts.flushOne(reopened, book.id, chapter.id);
    expect(saved?.status).toBe("saved");
    expect((await reopened.readChapter(book.id, chapter.id)).content).toBe("Unflushed draft\n");
    expect((await reopened.listChapterHistory(scope)).records).toHaveLength(1);
  });

  test("an injected filesystem history write failure keeps the previous record and manuscript intact", async () => {
    class FailingHistoryPort extends FileSystemLibraryPort {
      failHistory = false;
      override async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
        if (this.failHistory && path.includes("history")) throw new LibraryPortError("storage-full", "Synthetic storage-full failure");
        return super.commitFile(path, bytes, expected);
      }
    }
    const environment = createFileSystemEnvironment(root);
    const storage = new FailingHistoryPort(root);
    const service = await LibraryService.open({ ...environment, storage });
    const book = await service.createBook({ title: "Synthetic failure" });
    const chapter = await service.createChapter(book.id, { title: "Door", content: "Keep all words" });
    const scope = { bookId: book.id, chapterId: chapter.id };
    const input = { ...scope, label: "Before", source: { status: "saved" as const, version: chapter.version, hash: chapter.hash } };
    const record = await service.captureChapterHistory(input);
    const file = join(root, "books", book.id, "chapters", chapter.path);
    const before = await readFile(file);
    storage.failHistory = true;
    await expect(service.captureChapterHistory({ ...input, label: "Fails" })).rejects.toMatchObject({ code: "storage-full" });
    expect(await readFile(file)).toEqual(before);
    expect(await service.readChapterHistory({ ...scope, fileName: record.fileName })).toEqual(record);
    expect(await readdir(join(root, "books", book.id, "history", chapter.id))).toEqual([record.fileName]);
  });
});
