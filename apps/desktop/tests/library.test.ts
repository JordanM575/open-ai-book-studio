import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library, LibraryError } from "../src/main/library/store";
import { parseChapterFile, serializeChapter, slugify, chapterFileName } from "@ai-book-studio/core/markdown";
import { safeJoin, chaptersDir, bookFile } from "../src/main/library/paths";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ai-book-studio-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("library lifecycle", () => {
  it("creates the layout and keeps one device identity per folder", async () => {
    const library = await Library.open(root);
    expect(library.deviceId).toMatch(/^device_[a-f0-9]{16}$/);
    expect(library.deviceName.length).toBeGreaterThan(0);

    const reopened = await Library.open(root);
    expect(reopened.deviceId).toBe(library.deviceId);

    const entries = await readdir(root);
    expect(entries).toContain("books");
    expect(entries).toContain("library.json");
  });

  it("creates books, writes book.json, and reports summaries", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "The Salt Road", description: "A crossing." });

    const raw = JSON.parse(await readFile(bookFile(root, book.id), "utf8")) as { title: string; schemaVersion: number };
    expect(raw.title).toBe("The Salt Road");
    expect(raw.schemaVersion).toBe(1);

    const books = await library.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]?.chapterCount).toBe(0);

    const updated = await library.updateBook(book.id, { title: "The Salt Road, revised" });
    expect(updated.createdAt).toBe(book.createdAt);
    expect(updated.updatedAt >= book.updatedAt).toBe(true);
  });

  it("moves a deleted book to the library trash and keeps its files", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "The Salt Road" });
    await library.createChapter(book.id, { title: "The Door", content: "Salt on the floor.\n" });

    const trashed = await library.deleteBook(book.id);
    expect(trashed.trashedAt).toMatch(/^\.studio\/trash\/books\//);
    expect(await library.listBooks()).toHaveLength(0);

    const trashRoot = join(root, ".studio", "trash", "books");
    const folders = await readdir(trashRoot);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toContain(book.id);

    const trashedBook = JSON.parse(await readFile(join(trashRoot, folders[0]!, "book.json"), "utf8")) as { title: string };
    expect(trashedBook.title).toBe("The Salt Road");
    const chapterFiles = await readdir(join(trashRoot, folders[0]!, "chapters"));
    expect(chapterFiles).toHaveLength(1);
    expect(await readFile(join(trashRoot, folders[0]!, "chapters", chapterFiles[0]!), "utf8")).toContain("Salt on the floor.");

    await expect(library.deleteBook(book.id)).rejects.toThrow();
  });

  it("numbers chapters in order and keeps file names unique", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });

    const first = await library.createChapter(book.id, { title: "The Door" });
    const second = await library.createChapter(book.id, { title: "The Door" });

    expect(first.order).toBe(1);
    expect(second.order).toBe(2);
    expect(first.path).toBe("0001-the-door.md");
    expect(second.path).toBe("0002-the-door.md");
  });
});

describe("saving a chapter", () => {
  it("bumps the version, rewrites the file, and keeps prose in the body", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });
    const chapter = await library.createChapter(book.id, { title: "One" });

    const result = await library.saveChapter(book.id, chapter.id, "First line.\n\nSecond paragraph.", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;

    expect(result.chapter.version).toBe(2);
    expect(result.chapter.wordCount).toBe(4);
    expect(result.chapter.hash).not.toBe(chapter.hash);

    const raw = await readFile(join(chaptersDir(root, book.id), chapter.path), "utf8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("First line.\n\nSecond paragraph.\n");
    expect(parseChapterFile(raw, chapter.path, chapter).content).toBe("First line.\n\nSecond paragraph.\n");
  });

  it("is a no-op when the text on disk already matches", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });
    const chapter = await library.createChapter(book.id, { title: "One", content: "Same text.\n" });

    const result = await library.saveChapter(book.id, chapter.id, "Same text.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(result.chapter.version).toBe(chapter.version);
  });

  it("keeps a copy instead of overwriting when another device wrote first", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });
    const chapter = await library.createChapter(book.id, { title: "One", content: "Original.\n" });

    // Simulate another device: same file, higher version on disk.
    const advanced = await library.saveChapter(book.id, chapter.id, "Second device text.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(advanced.status).toBe("saved");
    if (advanced.status !== "saved") return;

    const stale = await library.saveChapter(book.id, chapter.id, "This device text.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.conflict.reason).toBe("newer-version");

    const disk = await library.readChapter(book.id, chapter.id);
    expect(disk.content).toBe("Second device text.\n");

    const copy = await readFile(safeJoin(root, stale.conflict.savedAs), "utf8");
    expect(copy).toContain("This device text.");

    const conflicts = await library.listConflicts(book.id);
    expect(conflicts.some((entry) => entry.savedAs === stale.conflict.savedAs)).toBe(true);
  });

  it("notices a file edited outside the studio", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });
    const chapter = await library.createChapter(book.id, { title: "One", content: "Original.\n" });

    const path = join(chaptersDir(root, book.id), chapter.path);
    await writeFile(path, `${await readFile(path, "utf8")}An outside edit.\n`, "utf8");

    const result = await library.saveChapter(book.id, chapter.id, "Studio text.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    expect(result.conflict.reason).toBe("external-edit");
    expect(await readFile(path, "utf8")).toContain("An outside edit.");
  });

  it("moves a deleted chapter to the trash folder", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Book" });
    const chapter = await library.createChapter(book.id, { title: "One" });

    await library.deleteChapter(book.id, chapter.id);

    await expect(library.readChapter(book.id, chapter.id)).rejects.toBeInstanceOf(LibraryError);
    const files = await readdir(join(chaptersDir(root, book.id)));
    expect(files).toHaveLength(0);
  });
});

describe("robustness", () => {
  it("skips a damaged book instead of failing the whole library", async () => {
    const library = await Library.open(root);
    await library.createBook({ title: "Healthy" });

    const brokenDir = join(root, "books", "book_brokenbroken");
    await mkdir(join(brokenDir, "chapters"), { recursive: true });
    await writeFile(join(brokenDir, "book.json"), "{ not json", "utf8");

    const books = await library.listBooks();
    expect(books.map((book) => book.title)).toEqual(["Healthy"]);
  });

  it("refuses to read a book written by a newer schema", async () => {
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Future" });

    const raw = JSON.parse(await readFile(bookFile(root, book.id), "utf8")) as Record<string, unknown>;
    await writeFile(bookFile(root, book.id), JSON.stringify({ ...raw, schemaVersion: 99 }), "utf8");

    await expect(library.readBook(book.id)).rejects.toMatchObject({ code: "newer-schema" });
  });

  it("reads pasted prose that has no front matter", async () => {
    const fallback = {
      id: "ch_abcdef1234567890",
      title: "Loose",
      order: 3,
      arc: "middle" as const,
      purpose: "",
      synopsis: "",
      notes: "",
      isPrologue: false,
      color: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const parsed = parseChapterFile("Just prose.\r\n\r\nSecond line.\r\n", "0003-loose.md", fallback);
    expect(parsed.hadFrontMatter).toBe(false);
    expect(parsed.content).toBe("Just prose.\n\nSecond line.\n");
    expect(parsed.meta.title).toBe("Loose");
  });

  it("round-trips metadata through YAML front matter", () => {
    const meta = {
      id: "ch_abcdef1234567890",
      title: "A Title: With a Colon",
      order: 2,
      arc: "beginning" as const,
      purpose: "Set up",
      synopsis: "Line one\nline two",
      notes: "",
      isPrologue: false,
      color: null,
      version: 4,
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T11:00:00.000Z"
    };

    const file = serializeChapter(meta, "Body text.\n");
    const parsed = parseChapterFile(file, "0002-a-title.md", meta);
    expect(parsed.hadFrontMatter).toBe(true);
    expect(parsed.meta.title).toBe(meta.title);
    expect(parsed.meta.synopsis).toBe(meta.synopsis);
    expect(parsed.meta.version).toBe(4);
  });

  it("builds safe file names", () => {
    expect(slugify("Café — Déjà Vu!")).toBe("cafe-deja-vu");
    expect(slugify("   ")).toBe("chapter");
    expect(chapterFileName(7, "The End")).toBe("0007-the-end.md");
    expect(() => safeJoin(root, "../escape")).toThrow();
  });
});
