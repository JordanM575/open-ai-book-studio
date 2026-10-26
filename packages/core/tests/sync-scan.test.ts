import { describe, expect, test } from "bun:test";
import { serializeChapter } from "../src/markdown";
import { chapterMetaSchema } from "../src/schema";
import { toLibraryPath, type LibraryPath } from "../src/library/path";
import { scanLibrary } from "../src/sync/scan";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const NOW = "2026-10-25T23:00:00.000Z";
const BOOK = "book_test000001";
const CHAPTER = `books/${BOOK}/chapters/0001-the-door.md`;
const encoder = new TextEncoder();

const meta = chapterMetaSchema.parse({
  id: "ch_test000001",
  title: "The Door",
  order: 1,
  version: 7,
  createdAt: NOW,
  updatedAt: NOW
});
const chapterText = serializeChapter(meta, "Salt on the floor.\n");

function path(value: string): LibraryPath {
  return toLibraryPath(value.split("/"));
}

async function put(port: InMemoryLibraryPort, value: string, text: string): Promise<void> {
  await port.commitFile(path(value), encoder.encode(text), { kind: "any" });
}

class RefusingPort extends InMemoryLibraryPort {
  override async readFile(target: LibraryPath) {
    if (target.join("/") === CHAPTER) throw new Error("A placeholder must not be read.");
    return super.readFile(target);
  }
}

class UnreadableBooksPort extends InMemoryLibraryPort {
  override async listDirectory(target: LibraryPath) {
    if (target.join("/") === "books") throw new Error("permission denied");
    return super.listDirectory(target);
  }
}

describe("scanLibrary", () => {
  test("lists author files and ignores derived, transient and provider files", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, `books/${BOOK}/book.json`, JSON.stringify({ schemaVersion: 1 }));
    await put(port, CHAPTER, chapterText);
    await put(port, `books/${BOOK}/.DS_Store`, "junk");
    await put(port, `${CHAPTER}.tmp`, "junk");
    await put(port, `${CHAPTER}.icloud`, "{}");
    await put(port, `.studio/trash/${BOOK}/2026-10-25T23-00-00-000Z-0001-the-door.md`, "old text");
    await put(port, ".studio/files.json", "{}");
    await put(port, "library.json", "{}");

    const scan = await scanLibrary(port);

    expect(scan.warnings).toEqual([]);
    expect(scan.files.map((file) => file.path)).toEqual([
      `.studio/trash/${BOOK}/2026-10-25T23-00-00-000Z-0001-the-door.md`,
      `books/${BOOK}/book.json`,
      CHAPTER
    ]);
  });

  test("keeps scanning other roots when one folder cannot be read", async () => {
    const port = new UnreadableBooksPort();
    await put(port, `.studio/trash/${BOOK}/2026-10-25T23-00-00-000Z-0001-the-door.md`, "old text");

    const scan = await scanLibrary(port);

    expect(scan.files.map((file) => file.path)).toEqual([
      `.studio/trash/${BOOK}/2026-10-25T23-00-00-000Z-0001-the-door.md`
    ]);
    expect(scan.warnings).toHaveLength(1);
    expect(scan.warnings[0]).toContain("could not be read");
    expect(scan.warnings[0]).toContain("books");
  });

  test("reports book schema and chapter identity from the bytes it hashes", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, `books/${BOOK}/book.json`, JSON.stringify({ schemaVersion: 2 }));
    await put(port, CHAPTER, chapterText);

    const scan = await scanLibrary(port);
    const book = scan.files.find((file) => file.path.endsWith("/book.json"));
    const chapter = scan.files.find((file) => file.path === CHAPTER);

    expect(book?.bookId).toBe(BOOK);
    expect(book?.schemaVersion).toBe(2);
    expect(chapter?.bookId).toBe(BOOK);
    expect(chapter?.chapterId).toBe("ch_test000001");
    expect(chapter?.version).toBe(7);
    expect(chapter?.conflict).toBeUndefined();
    expect(chapter?.sha256).toBe(await port.sha256(encoder.encode(chapterText)));
    expect(chapter?.size).toBe(encoder.encode(chapterText).byteLength);
  });

  test("marks conflict copies but keeps a chapter titled conflict", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, `books/${BOOK}/conflicts/0001-the-door.conflict-external-edit.device_x.2026.md`, "mine");
    await put(port, `books/${BOOK}/chapters/0001-the-door (conflicted copy 2026-10-25).md`, "theirs");
    const titled = `books/${BOOK}/chapters/0002-the-conflict.md`;
    await put(port, titled, chapterText);

    const scan = await scanLibrary(port);

    expect(scan.files).toHaveLength(3);
    expect(scan.files.filter((file) => file.conflict)).toHaveLength(2);
    expect(scan.files.find((file) => file.path === titled)?.conflict).toBeUndefined();
    expect(scan.files.find((file) => file.path === titled)?.chapterId).toBe("ch_test000001");
  });

  test("probes a placeholder before reading it", async () => {
    const port = new RefusingPort();
    await put(port, CHAPTER, "");

    const scan = await scanLibrary(port, { isPlaceholder: (value) => value === CHAPTER });

    expect(scan.files).toEqual([
      { path: CHAPTER, sha256: null, size: null, bookId: BOOK, placeholder: true }
    ]);
  });

  test("treats a failed placeholder probe as online-only instead of empty", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, CHAPTER, "");

    const scan = await scanLibrary(port, {
      isPlaceholder: () => {
        throw new Error("the provider is unavailable");
      }
    });

    expect(scan.files[0]?.placeholder).toBe(true);
    expect(scan.files[0]?.sha256).toBeNull();
  });

  test("reports invalid chapter front matter and book JSON as unreadable", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, CHAPTER, "---\nid: ch_1\n---\n\nText.\n");
    await put(port, `books/${BOOK}/book.json`, "{ not json");

    const scan = await scanLibrary(port);

    expect(scan.files.find((file) => file.path === CHAPTER)?.unreadable).toContain("front matter");
    expect(scan.files.find((file) => file.path.endsWith("/book.json"))?.unreadable).toContain("not valid JSON");
  });

  test("recovers a book id from the trash folder name", async () => {
    const port = new InMemoryLibraryPort();
    await put(port, `.studio/trash/books/2026-10-25T23-00-00-000Z-${BOOK}/book.json`, JSON.stringify({ schemaVersion: 1 }));
    await put(
      port,
      `.studio/trash/books/2026-10-25T23-00-00-000Z-${BOOK}/chapters/0001-the-door.md`,
      chapterText
    );

    const scan = await scanLibrary(port);

    expect(scan.files).toHaveLength(2);
    expect(scan.files.every((file) => file.bookId === BOOK)).toBe(true);
  });
});
