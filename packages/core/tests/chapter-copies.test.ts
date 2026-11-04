import { describe, expect, test } from "bun:test";
import { chapterFileName, compareChapterFileNames, isConflictCopyName, serializeChapter } from "../src/markdown";
import { LibraryService } from "../src/library/service";
import { chapterPath } from "../src/library/paths";
import { chapterMetaSchema } from "../src/schema";
import { scanLibrary } from "../src/sync/scan";
import { detectDrift } from "../src/sync/detector";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * QA D1: which file names are a sync tool's copy, and which file is a chapter's own when several
 * carry its id (docs/FORMAT.md, "Copies of a chapter").
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("sync-tool copy names", () => {
  test("every sync tool's copy of a studio chapter is a copy", () => {
    for (const name of [
      "0002-the-door 2.md",
      "0002-the-door 3.md",
      "0002-the-door (1).md",
      "0002-the-door (2).md",
      "0002-the-door-2 2.md",
      "0002-the-door (conflicted copy).md",
      "0002-the-door (MacBook's conflicted copy 2026-11-04).md",
      "0002-the-door (conflicted copy 2026-11-04 093000).md",
      "0002-the-door (Case Conflict).md",
      "0002-the-door (Selective Sync Conflict).md",
      "0002-the-door.sync-conflict-20261104-093000-ABCDEF1.md",
      "0002-the-door.conflict-external-edit.device_0123456789abcdef.2026-11-04T09-00-00-000Z.md"
    ]) {
      expect({ name, copy: isConflictCopyName(name) }).toEqual({ name, copy: true });
    }
  });

  test("a chapter that only looks numbered or mentions conflict is still a chapter", () => {
    for (const name of [
      chapterFileName(2, "The Door"),
      chapterFileName(2, "Chapter 2"),
      chapterFileName(1, "Conflict"),
      chapterFileName(3, "The Conflicted Copy"),
      "0002-the-door-2.md",
      "Chapter 2.md",
      "Part (1).md",
      "Part Two (The Conflict).md",
      "notes 2.md"
    ]) {
      expect({ name, copy: isConflictCopyName(name) }).toEqual({ name, copy: false });
    }
  });

  test("ranks the studio's own name first, then the shorter name, then character order", () => {
    const names = ["0002-the-door copy.md", "0002-the-door-MacBook.md", "0002-the-door-2.md", "the-door.md", "0002-the-door.md"];
    expect([...names].sort(compareChapterFileNames)).toEqual([
      "0002-the-door.md",
      "0002-the-door-2.md",
      "the-door.md",
      "0002-the-door copy.md",
      "0002-the-door-MacBook.md"
    ]);
    // The order is a property of the names alone: shuffling the input never changes the winner.
    expect([...names].reverse().sort(compareChapterFileNames)[0]).toBe("0002-the-door.md");
  });
});

describe("copies over the in-memory port", () => {
  const meta = chapterMetaSchema.parse({
    id: "ch_copytest0001",
    title: "The Door",
    order: 1,
    version: 2,
    createdAt: "2026-11-04T08:00:00.000Z",
    updatedAt: "2026-11-04T08:00:00.000Z"
  });

  async function bookWithCopies() {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "Copies" });
    const original = serializeChapter(meta, "Kept here.\n");
    const newer = serializeChapter({ ...meta, version: 9 }, "Written on the other device.\n");
    await port.commitFile(chapterPath(book.id, "0001-the-door.md"), encoder.encode(original), { kind: "absent" });
    // A copy that ranks first in byte order, and one that is newer, must still lose.
    await port.commitFile(chapterPath(book.id, "0001-the-door 2.md"), encoder.encode(newer), { kind: "absent" });
    await port.commitFile(chapterPath(book.id, "0001-the-door-MacBook.md"), encoder.encode(newer), { kind: "absent" });
    return { port, service, book, original, newer };
  }

  test("only the chapter's own file is listed, read and saved", async () => {
    const { port, service, book, newer } = await bookWithCopies();

    const [chapter, ...others] = (await service.readBook(book.id)).chapters;
    expect(others).toEqual([]);
    if (!chapter) throw new Error("The chapter did not open.");
    expect(chapter.path).toBe("0001-the-door.md");
    expect(chapter.content).toBe("Kept here.\n");

    const saved = await service.saveChapter(book.id, meta.id, "Kept here, and more.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(saved.status).toBe("saved");
    const file = await port.readFile(chapterPath(book.id, "0001-the-door.md"));
    expect(decoder.decode(file?.bytes)).toContain("Kept here, and more.\n");
    for (const copy of ["0001-the-door 2.md", "0001-the-door-MacBook.md"]) {
      expect(decoder.decode((await port.readFile(chapterPath(book.id, copy)))?.bytes)).toBe(newer);
    }

    expect((await service.listConflicts(book.id)).map((conflict) => [conflict.savedAs, conflict.chapterId])).toEqual([
      [`books/${book.id}/chapters/0001-the-door-MacBook.md`, meta.id],
      [`books/${book.id}/chapters/0001-the-door 2.md`, ""]
    ]);
  });

  test("the drift review reports a sync-named copy as a conflict copy", async () => {
    const { port, book } = await bookWithCopies();

    const scan = await scanLibrary(port);
    const copy = scan.files.find((file) => file.path === `books/${book.id}/chapters/0001-the-door 2.md`);
    expect(copy?.conflict).toBe(true);
    expect(copy?.chapterId).toBeUndefined();

    const report = detectDrift({ journal: null, files: scan.files, now: "2026-11-04T09:00:00.000Z" });
    expect(report.entries.filter((entry) => entry.kind === "conflict-copy").map((entry) => entry.path)).toEqual([
      `books/${book.id}/chapters/0001-the-door 2.md`
    ]);
  });
});
