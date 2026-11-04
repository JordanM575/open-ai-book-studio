import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeChapter } from "@ai-book-studio/core/markdown";
import type { Chapter } from "@ai-book-studio/core/schema";
import { Library } from "../src/main/library/store";
import { chaptersDir } from "../src/main/library/paths";

/**
 * QA D1: a sync tool's duplicate of a chapter file carries the same front-matter id as the original.
 * Exactly one file is the chapter for an id; every other file is a copy that is listed as a conflict
 * copy, never as a chapter, and is never written, renamed or deleted by the studio.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ai-book-studio-copies-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ORIGINAL = "0001-the-door.md";

const SYNC_COPIES = [
  ["iCloud Drive", "0001-the-door 2.md"],
  ["Google Drive", "0001-the-door (1).md"],
  ["Dropbox", "0001-the-door (MacBook's conflicted copy 2026-11-04).md"],
  ["Syncthing", "0001-the-door.sync-conflict-20261104-093000-ABCDEF1.md"]
] as const;

async function bookWithChapter() {
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const chapter = await library.createChapter(book.id, { title: "The Door", content: "The door was shut.\n" });
  expect(chapter.path).toBe(ORIGINAL);
  const dir = chaptersDir(root, book.id);
  const original = await readFile(join(dir, ORIGINAL));
  return { library, book, chapter, dir, original };
}

/** The chapter's front matter with a later version and other text: what another device saved. */
function newerText(chapter: Chapter, content: string): string {
  const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...meta } = chapter;
  return serializeChapter({ ...meta, version: chapter.version + 3, updatedAt: "2026-11-04T09:00:00.000Z" }, content);
}

async function makeNewer(path: string): Promise<void> {
  const later = new Date(Date.now() + 60 * 60 * 1000);
  await utimes(path, later, later);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("a sync tool's copy of a chapter", () => {
  for (const [tool, name] of SYNC_COPIES) {
    it(`lists a ${tool} copy as a conflict copy, never as a chapter`, async () => {
      const { library, book, chapter, dir, original } = await bookWithChapter();
      await writeFile(join(dir, name), original);

      const detail = await library.readBook(book.id);
      expect(detail.chapters.map((item) => item.path)).toEqual([ORIGINAL]);
      expect(detail.chapterReadIssues).toEqual([]);
      expect((await library.readChapter(book.id, chapter.id)).path).toBe(ORIGINAL);

      const conflicts = await library.listConflicts(book.id);
      expect(conflicts.map((conflict) => conflict.savedAs)).toEqual([`books/${book.id}/chapters/${name}`]);
      expect(conflicts[0]?.reason).toBe("provider-conflict-copy");

      // Listing never renames, moves or rewrites either file.
      expect((await readdir(dir)).sort()).toEqual([ORIGINAL, name].sort());
      expect(await readFile(join(dir, name))).toEqual(original);
      expect(await readFile(join(dir, ORIGINAL))).toEqual(original);
    });
  }

  it("keeps the original as the chapter when two files carry the same id", async () => {
    const { library, book, chapter, dir, original } = await bookWithChapter();
    // A Finder duplicate has no sync-tool mark; only its id says it is the same chapter.
    await writeFile(join(dir, "0001-the-door copy.md"), original);

    const detail = await library.readBook(book.id);
    expect(detail.chapters).toHaveLength(1);
    expect(detail.chapters[0]?.path).toBe(ORIGINAL);

    const conflicts = await library.listConflicts(book.id);
    expect(conflicts).toEqual([
      expect.objectContaining({
        chapterId: chapter.id,
        chapterTitle: "The Door",
        savedAs: `books/${book.id}/chapters/0001-the-door copy.md`,
        reason: "provider-conflict-copy"
      })
    ]);
  });

  it("never lets a newer copy take the original's place", async () => {
    const { library, book, chapter, dir, original } = await bookWithChapter();
    const icloud = "0001-the-door 2.md";
    const finder = "0001-the-door copy.md";
    await writeFile(join(dir, icloud), newerText(chapter, "The other device kept writing here.\n"));
    await writeFile(join(dir, finder), newerText(chapter, "A copy someone kept on the desk.\n"));
    await makeNewer(join(dir, icloud));
    await makeNewer(join(dir, finder));

    // The editor opens the original file's exact bytes, not the newer copy's.
    expect((await library.readBook(book.id)).chapters).toEqual([
      expect.objectContaining({
        path: ORIGINAL,
        content: "The door was shut.\n",
        version: chapter.version,
        hash: sha256(original)
      })
    ]);

    const read = await library.readChapter(book.id, chapter.id);
    expect(read.path).toBe(ORIGINAL);
    expect(read.hash).toBe(sha256(original));
    expect(await library.search(book.id, "other device")).toEqual([]);

    const saved = (await library.listConflicts(book.id)).map((conflict) => conflict.savedAs);
    expect(saved).toContain(`books/${book.id}/chapters/${icloud}`);
    expect(saved).toContain(`books/${book.id}/chapters/${finder}`);
  });

  it("saves to the original and leaves every copy byte for byte", async () => {
    const { library, book, chapter, dir, original } = await bookWithChapter();
    for (const [, name] of SYNC_COPIES) await writeFile(join(dir, name), original);
    await writeFile(join(dir, "0001-the-door copy.md"), original);

    const opened = (await library.readBook(book.id)).chapters.find((item) => item.id === chapter.id);
    if (!opened) throw new Error("The chapter did not open.");
    const result = await library.saveChapter(book.id, chapter.id, "The door was open.\n", {
      baseVersion: opened.version,
      baseHash: opened.hash
    });
    expect(result.status).toBe("saved");

    const renamed = await library.updateChapterMeta(
      book.id,
      chapter.id,
      { title: "The Open Door" },
      { baseVersion: chapter.version + 1, baseHash: result.status === "saved" ? result.chapter.hash : "" }
    );
    expect(renamed.status).toBe("saved");

    const written = await readFile(join(dir, ORIGINAL), "utf8");
    expect(written).toContain("The door was open.\n");
    expect(written).toContain("title: The Open Door");
    for (const [, name] of SYNC_COPIES) expect(await readFile(join(dir, name))).toEqual(original);
    expect(await readFile(join(dir, "0001-the-door copy.md"))).toEqual(original);
    expect(await readdir(join(root, "books", book.id, "conflicts"))).toEqual([]);
  });

  it("trashes only the original on delete, and the copy stays visible as a copy", async () => {
    const { library, book, chapter, dir, original } = await bookWithChapter();
    const icloud = "0001-the-door 2.md";
    const copy = newerText(chapter, "The other device kept writing here.\n");
    await writeFile(join(dir, icloud), copy);

    await library.deleteChapter(book.id, chapter.id);

    const trash = join(root, ".studio", "trash", book.id);
    const [trashed, ...more] = await readdir(trash);
    expect(more).toEqual([]);
    expect(trashed).toEndWith(`-${ORIGINAL}`);
    expect(await readFile(join(trash, trashed ?? ""))).toEqual(original);

    expect(await readdir(dir)).toEqual([icloud]);
    expect(await readFile(join(dir, icloud), "utf8")).toBe(copy);
    expect((await library.readBook(book.id)).chapters).toEqual([]);
    await expect(library.readChapter(book.id, chapter.id)).rejects.toMatchObject({ code: "not-found" });
    expect((await library.listConflicts(book.id)).map((conflict) => conflict.savedAs)).toEqual([
      `books/${book.id}/chapters/${icloud}`
    ]);
  });

  it("keeps a hand-made chapter whose name only ends in a number", async () => {
    const { library, book, dir } = await bookWithChapter();
    await writeFile(join(dir, "Chapter 2.md"), "Prose written in another editor.\n");

    const detail = await library.readBook(book.id);
    expect(detail.chapters.map((item) => item.path).sort()).toEqual([ORIGINAL, "Chapter 2.md"].sort());
    expect(await library.listConflicts(book.id)).toEqual([]);
  });
});
