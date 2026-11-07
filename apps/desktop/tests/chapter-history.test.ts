import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "studio-history-synthetic-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("desktop saved-only history", () => {
  test("ordinary history remains byte-exact through filesystem archive and whole-book trash", async () => {
    const environment = createFileSystemEnvironment(join(root, "library"));
    const service = await LibraryService.open(environment);
    const book = await service.createBook({ title: "Synthetic history transport" });
    const chapter = await service.createChapter(book.id, { title: "Door", content: "Saved synthetic source" });
    const record = await service.captureChapterHistory({ bookId: book.id, chapterId: chapter.id, label: "Snapshot",
      source: { status: "saved", version: chapter.version, hash: chapter.hash } });
    const original = await environment.storage.readFile(toLibraryPath(["books", book.id, "history", chapter.id, record.fileName]));
    if (!original) throw new Error("Missing synthetic history");
    for (const trashed of [false, true]) {
      if (trashed) await service.deleteBook(book.id);
      const archive = await createLibraryArchive(environment, { appVersion: "synthetic" });
      const entry = archive.manifest.entries.find((entry) => entry.path.endsWith(`/history/${chapter.id}/${record.fileName}`));
      if (!entry) throw new Error("History omitted from archive");
      expect(entry.sha256).toBe(record.hash);
      expect(entry.path.startsWith(".studio/trash/")).toBe(trashed);
      const chunks: Uint8Array[] = [];
      for await (const chunk of archive.chunks) chunks.push(chunk);
      const target = createFileSystemEnvironment(join(root, trashed ? "restored-trash" : "restored-live"));
      await importLibraryArchive(archiveSourceFromBytes(new Uint8Array(Buffer.concat(chunks))), target.storage, target.runtime);
      expect((await target.storage.readFile(toLibraryPath(entry.path.split("/"))))?.bytes).toEqual(original.bytes);
    }
  });

  for (const level of ["history", "chapter", "record"] as const) {
    test.each(["outside", "inside", "broken"] as const)(`${level} links to %s remain unavailable without following or writing their targets`, async (targetKind) => {
      const libraryRoot = join(root, "library");
      const environment = createFileSystemEnvironment(libraryRoot);
      environment.runtime.now = () => "2026-11-07T00:00:00.000Z";
      const service = await LibraryService.open(environment);
      const book = await service.createBook({ title: "Synthetic containment" });
      const chapter = await service.createChapter(book.id, { title: "Door", content: "Saved synthetic source" });
      const scope = { bookId: book.id, chapterId: chapter.id };
      const input = { ...scope, label: "Snapshot", source: { status: "saved" as const, version: chapter.version, hash: chapter.hash } };
      const record = await service.captureChapterHistory(input);
      const history = join(libraryRoot, "books", book.id, "history");
      const recordFile = join(history, chapter.id, record.fileName);
      const bytes = await readFile(recordFile);
      const sourceFile = join(libraryRoot, "books", book.id, "chapters", chapter.path);
      const sourceBytes = await readFile(sourceFile);
      const linked = level === "history" ? history : level === "chapter" ? dirname(recordFile) : recordFile;
      const target = targetKind === "inside" ? join(libraryRoot, ".studio", "cache", "linked") : join(root, targetKind);
      const targetRecord = level === "history" ? join(target, chapter.id, record.fileName)
        : level === "chapter" ? join(target, record.fileName) : target;
      if (targetKind !== "broken") {
        await mkdir(dirname(targetRecord), { recursive: true });
        await writeFile(targetRecord, bytes);
      }
      await rename(linked, join(root, "original-entry"));
      await symlink(target, linked);
      const address = { ...scope, fileName: record.fileName };
      await expect(service.captureChapterHistory(input)).rejects.toMatchObject({ code: "unsupported" });
      await expect(service.readChapterHistory(address)).rejects.toMatchObject({ code: "unsupported" });
      await expect(service.compareChapterHistory(address)).rejects.toMatchObject({ code: "unsupported" });
      if (level === "record") {
        expect(await service.listChapterHistory(scope)).toMatchObject({ records: [], issues: [{ fileName: record.fileName, code: "io" }] });
      } else await expect(service.listChapterHistory(scope)).rejects.toMatchObject({ code: "unsupported" });
      expect(await readFile(sourceFile)).toEqual(sourceBytes);
      expect(await readlink(linked)).toBe(target);
      if (targetKind !== "broken") expect(await readFile(targetRecord)).toEqual(bytes);
      else await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
      const archive = await createLibraryArchive(environment, { appVersion: "synthetic" });
      expect(archive.manifest.entries.some((entry) => entry.path.includes("/history/"))).toBe(false);
    });
  }

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
