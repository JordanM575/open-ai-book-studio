import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { LibraryError, LibraryPortError } from "../src/library/errors";
import { chapterPath } from "../src/library/paths";
import { libraryPathFromArchivePath, toLibraryPath } from "../src/library/path";
import type { LibraryPort } from "../src/library/port";
import { serializeChapter } from "../src/markdown";
import { InMemoryLibraryPort } from "./support/in-memory-port";

async function openLibrary() {
  const port = new InMemoryLibraryPort();
  const service = await LibraryService.open({ storage: port, runtime: port });
  return { port, service };
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function text(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}

describe("LibraryService over the in-memory port", () => {
  test("a chapter whose title mentions conflict is still a chapter", async () => {
    const { service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "Conflict" });

    expect(chapter.path).toBe("0001-conflict.md");
    expect((await service.readBook(book.id)).chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect((await service.readChapter(book.id, chapter.id)).id).toBe(chapter.id);
    expect(await service.listConflicts(book.id)).toEqual([]);
  });

  test("creates a book and chapter with stable identities and rebuilds the catalog", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "The Salt Road", description: "A crossing." });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "The hall was cold.\n" });

    expect(book.id).toMatch(/^book_[A-Za-z0-9-]{6,}$/);
    expect(chapter.id).toMatch(/^ch_[A-Za-z0-9-]{6,}$/);
    expect(chapter.path).toBe("0001-the-door.md");

    const detail = await service.readBook(book.id);
    expect(detail.book.title).toBe("The Salt Road");
    expect(detail.chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect(detail.chapters[0]?.content).toBe("The hall was cold.\n");

    const catalog = await port.readFile(toLibraryPath(["library.json"]));
    expect(catalog).not.toBeNull();
    expect(JSON.parse(text(catalog?.bytes))).toMatchObject({
      schemaVersion: 1,
      app: "ai-book-studio",
      books: [{ id: book.id, chapterCount: 1 }]
    });
  });

  test("a save bumps the version once and identical text is a no-op", async () => {
    const { service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "One" });

    const saved = await service.saveChapter(book.id, chapter.id, "First line.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    expect(saved.chapter.version).toBe(2);
    expect(saved.chapter.hash).not.toBe(chapter.hash);

    const same = await service.saveChapter(book.id, chapter.id, "First line.\n", {
      baseVersion: saved.chapter.version,
      baseHash: saved.chapter.hash
    });
    expect(same.status).toBe("saved");
    if (same.status !== "saved") return;
    expect(same.chapter.version).toBe(2);
  });

  test("a stale version keeps the local text as a conflict copy and leaves the disk file alone", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "One", content: "Original.\n" });

    const advanced = await service.saveChapter(book.id, chapter.id, "Other device.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(advanced.status).toBe("saved");

    const stale = await service.saveChapter(book.id, chapter.id, "This device.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.conflict.reason).toBe("newer-version");
    expect(stale.conflict.diskVersion).toBe(2);
    expect(stale.conflict.localVersion).toBe(2);

    const preserved = await port.readFile(libraryPathFromArchivePath(stale.conflict.savedAs));
    expect(preserved).not.toBeNull();
    expect(text(preserved?.bytes)).toContain("This device.");

    const current = await service.readChapter(book.id, chapter.id);
    expect(current.content).toBe("Other device.\n");
    expect(current.version).toBe(2);
  });

  test("an edit made behind the service produces an external-edit conflict", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "One", content: "Original.\n" });
    const disk = await port.readFile(chapterPath(book.id, chapter.path));

    const external = serializeChapter(
      {
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        version: chapter.version,
        createdAt: chapter.createdAt,
        updatedAt: new Date().toISOString()
      },
      "Edited in another editor.\n"
    );
    await port.commitFile(chapterPath(book.id, chapter.path), bytes(external), {
      kind: "sha256",
      value: disk!.sha256
    });

    const result = await service.saveChapter(book.id, chapter.id, "From the studio.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    expect(result.conflict.reason).toBe("external-edit");
    expect(text((await port.readFile(libraryPathFromArchivePath(result.conflict.savedAs)))?.bytes)).toContain(
      "From the studio."
    );

    const current = await service.readChapter(book.id, chapter.id);
    expect(current.content).toBe("Edited in another editor.\n");
  });

  test("reorders chapters by metadata without renaming their files", async () => {
    const { service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const one = await service.createChapter(book.id, { title: "One", content: "One.\n" });
    const two = await service.createChapter(book.id, { title: "Two", content: "Two.\n" });
    const three = await service.createChapter(book.id, { title: "Three", content: "Three.\n" });

    const moved = await service.reorderChapter(book.id, three.id, "up");
    expect(moved.status).toBe("saved");
    if (moved.status !== "saved") return;
    expect(moved.chapters.map((chapter) => chapter.id)).toEqual([one.id, three.id, two.id]);
    expect(moved.chapters.map((chapter) => chapter.order)).toEqual([1, 2, 3]);
    expect(moved.chapters.map((chapter) => chapter.path)).toEqual([
      "0001-one.md",
      "0003-three.md",
      "0002-two.md"
    ]);

    const atTop = await service.reorderChapter(book.id, one.id, "up");
    expect(atTop.status).toBe("saved");
    if (atTop.status !== "saved") return;
    expect(atTop.chapters.map((chapter) => chapter.id)).toEqual([one.id, three.id, two.id]);

    const atBottom = await service.reorderChapter(book.id, two.id, "down");
    expect(atBottom.status).toBe("saved");
    if (atBottom.status !== "saved") return;
    expect(atBottom.chapters.map((chapter) => chapter.id)).toEqual([one.id, three.id, two.id]);

    expect((await service.readBook(book.id)).chapters.map((chapter) => chapter.order)).toEqual([1, 2, 3]);
  });

  test("moves a chapter to a position and renumbers the orders", async () => {
    const { service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const one = await service.createChapter(book.id, { title: "One", content: "One.\n" });
    const two = await service.createChapter(book.id, { title: "Two", content: "Two.\n" });
    const three = await service.createChapter(book.id, { title: "Three", content: "Three.\n" });

    const moved = await service.moveChapterTo(book.id, one.id, 2);
    expect(moved.status).toBe("saved");
    if (moved.status !== "saved") return;
    expect(moved.chapters.map((chapter) => chapter.id)).toEqual([two.id, three.id, one.id]);
    expect(moved.chapters.map((chapter) => chapter.order)).toEqual([1, 2, 3]);
    expect(moved.chapters.map((chapter) => chapter.path)).toEqual(["0002-two.md", "0003-three.md", "0001-one.md"]);

    const back = await service.moveChapterTo(book.id, one.id, 0);
    expect(back.status).toBe("saved");
    if (back.status !== "saved") return;
    expect(back.chapters.map((chapter) => chapter.id)).toEqual([one.id, two.id, three.id]);

    const clamped = await service.moveChapterTo(book.id, one.id, 99);
    expect(clamped.status).toBe("saved");
    if (clamped.status !== "saved") return;
    expect(clamped.chapters.map((chapter) => chapter.id)).toEqual([two.id, three.id, one.id]);
  });

  test("a reorder that meets an external edit rolls back and keeps a conflict copy", async () => {
    const inner = new InMemoryLibraryPort();
    const failing = new FailingCommitPort(inner);
    const service = await LibraryService.open({ storage: failing, runtime: inner });
    const book = await service.createBook({ title: "Book" });
    const one = await service.createChapter(book.id, { title: "One", content: "One.\n" });
    const two = await service.createChapter(book.id, { title: "Two", content: "Two.\n" });

    const onePath = chapterPath(book.id, one.path);
    const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...meta } = one;
    const external = serializeChapter(
      { ...meta, version: one.version + 1, updatedAt: "2026-10-25T23:30:00.000Z" },
      "External one.\n"
    );
    let injected = false;
    failing.beforeCommit = async (path) => {
      if (injected || path.join("/") !== onePath.join("/")) return;
      injected = true;
      await inner.commitFile(onePath, bytes(external), { kind: "any" });
    };

    const result = await service.reorderChapter(book.id, two.id, "up");

    expect(result.status).toBe("conflict");
    const after = await service.readBook(book.id);
    expect(after.chapters.map((chapter) => chapter.id)).toEqual([one.id, two.id]);
    expect(after.chapters.map((chapter) => chapter.order)).toEqual([1, 2]);
    expect(after.chapters[0]?.content).toBe("External one.\n");
    expect((await service.listConflicts(book.id)).length).toBeGreaterThan(0);
  });

  test("deleting moves the chapter to trash and restoring keeps its identity", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "One", content: "Keep me.\n" });

    const deleted = await service.deleteChapter(book.id, chapter.id);
    expect(deleted.trashedAt.startsWith(`.studio/trash/${book.id}/`)).toBe(true);
    expect((await service.readBook(book.id)).chapters).toHaveLength(0);

    const trashed = await port.readFile(libraryPathFromArchivePath(deleted.trashedAt));
    expect(trashed).not.toBeNull();

    await port.moveFile(libraryPathFromArchivePath(deleted.trashedAt), chapterPath(book.id, chapter.path));
    const restored = await service.readBook(book.id);
    expect(restored.chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect(restored.chapters[0]?.content).toBe("Keep me.\n");
  });

  test("a newer schema is refused instead of silently dropped", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Book" });
    const path = toLibraryPath(["books", book.id, "book.json"]);
    const snapshot = await port.readFile(path);

    await port.commitFile(path, bytes(JSON.stringify({ ...JSON.parse(text(snapshot!.bytes)), schemaVersion: 99 })), {
      kind: "any"
    });

    try {
      await service.readBook(book.id);
      throw new Error("readBook should have refused the newer schema");
    } catch (error) {
      expect(error).toBeInstanceOf(LibraryError);
      expect((error as LibraryError).code).toBe("newer-schema");
    }
  });

  test("a failed write leaves the previous chapter bytes intact", async () => {
    const inner = new InMemoryLibraryPort();
    const failing = new FailingCommitPort(inner);
    const service = await LibraryService.open({ storage: failing, runtime: inner });
    const book = await service.createBook({ title: "Book" });
    const chapter = await service.createChapter(book.id, { title: "One", content: "Safe text.\n" });
    const before = text((await inner.readFile(chapterPath(book.id, chapter.path)))?.bytes);

    failing.fail = true;
    await expect(
      service.saveChapter(book.id, chapter.id, "New text.\n", {
        baseVersion: chapter.version,
        baseHash: chapter.hash
      })
    ).rejects.toMatchObject({ code: "storage-full" });

    expect(text((await inner.readFile(chapterPath(book.id, chapter.path)))?.bytes)).toBe(before);
  });
});

class FailingCommitPort implements LibraryPort {
  fail = false;
  beforeCommit?: (path: Parameters<LibraryPort["commitFile"]>[0]) => Promise<void> | void;

  constructor(private readonly inner: InMemoryLibraryPort) {}

  readFile(path: Parameters<LibraryPort["readFile"]>[0]) {
    return this.inner.readFile(path);
  }

  listDirectory(path: Parameters<LibraryPort["listDirectory"]>[0]) {
    return this.inner.listDirectory(path);
  }

  stat(path: Parameters<LibraryPort["stat"]>[0]) {
    return this.inner.stat(path);
  }

  ensureDirectory(path: Parameters<LibraryPort["ensureDirectory"]>[0]) {
    return this.inner.ensureDirectory(path);
  }

  async commitFile(
    path: Parameters<LibraryPort["commitFile"]>[0],
    file: Parameters<LibraryPort["commitFile"]>[1],
    expected: Parameters<LibraryPort["commitFile"]>[2]
  ) {
    if (this.fail) throw new LibraryPortError("storage-full", "The disk is full. Nothing was replaced.", true);
    await this.beforeCommit?.(path);
    return this.inner.commitFile(path, file, expected);
  }

  moveFile(from: Parameters<LibraryPort["moveFile"]>[0], to: Parameters<LibraryPort["moveFile"]>[1]) {
    return this.inner.moveFile(from, to);
  }

  moveDirectory(from: Parameters<LibraryPort["moveDirectory"]>[0], to: Parameters<LibraryPort["moveDirectory"]>[1]) {
    return this.inner.moveDirectory(from, to);
  }

  removeFile(path: Parameters<LibraryPort["removeFile"]>[0]) {
    return this.inner.removeFile(path);
  }

  deviceInfo() {
    return this.inner.deviceInfo();
  }
}
