import { describe, expect, test } from "bun:test";
import { createLibraryArchive } from "../src/archive/export";
import { LibraryService } from "../src/library/service";
import { bookFilePath, bookPath } from "../src/library/paths";
import { toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const historyFile = (bookId: string, chapterId: string, name: string) =>
  toLibraryPath(["books", bookId, "history", chapterId, name]);

/**
 * Spec 032 T001 (OQ-001) premises. These pin the storage facts the history
 * layout decision rests on; they choose nothing. A book-scoped history
 * directory rides whole-book trash/restore and the archive by construction,
 * chapter trash moves only the chapter file, stable chapter identity survives
 * renames and reorders, and single-file records write atomically with
 * expected-hash guards.
 */
describe("chapter history storage premises", () => {
  test("a book-scoped history directory travels with book trash and restore", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt wind.\n" });
    const payload = "---\nkind: snapshot\n---\nSalt wind.\n";
    await port.commitFile(historyFile(book.id, chapter.id, "123-label.md"), encoder.encode(payload), {
      kind: "any"
    });

    await service.deleteBook(book.id);
    expect(await port.readFile(bookFilePath(book.id))).toBeNull();

    const trashBooks = toLibraryPath([".studio", "trash", "books"]);
    const trashed = await port.listDirectory(trashBooks);
    expect(trashed).toHaveLength(1);
    const [stamped] = trashed;
    if (stamped?.kind !== "directory") throw new Error("Expected one trashed book directory.");
    const moved = await port.readFile(
      toLibraryPath([".studio", "trash", "books", stamped.name, "history", chapter.id, "123-label.md"])
    );
    expect(moved ? decoder.decode(moved.bytes) : null).toBe(payload);

    await port.moveDirectory(toLibraryPath([".studio", "trash", "books", stamped.name]), bookPath(book.id));
    const restored = await service.readBook(book.id);
    expect(restored.book.title).toBe("The Salt Road");
    const kept = await port.readFile(historyFile(book.id, chapter.id, "123-label.md"));
    expect(kept ? decoder.decode(kept.bytes) : null).toBe(payload);
  });

  test("history files ride the portable archive manifest", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt wind.\n" });
    await port.commitFile(historyFile(book.id, chapter.id, "123-label.md"), encoder.encode("snapshot"), {
      kind: "any"
    });

    const archive = await createLibraryArchive({ storage: port, runtime: port }, { appVersion: "test" });
    expect(archive.manifest.entries.map((entry) => entry.path)).toContain(
      `books/${book.id}/history/${chapter.id}/123-label.md`
    );
  });

  test("chapter trash moves only the chapter file; history stays with the book", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const kept = await service.createChapter(book.id, { title: "Kept", content: "Stay.\n" });
    const trashed = await service.createChapter(book.id, { title: "Gone", content: "Go.\n" });
    await port.commitFile(historyFile(book.id, trashed.id, "123-label.md"), encoder.encode("snapshot"), {
      kind: "any"
    });

    await service.deleteChapter(book.id, trashed.id);
    const trash = await port.listDirectory(toLibraryPath([".studio", "trash", book.id]));
    expect(trash.filter((entry) => entry.kind === "file")).toHaveLength(1);

    const history = await port.readFile(historyFile(book.id, trashed.id, "123-label.md"));
    expect(history ? decoder.decode(history.bytes) : null).toBe("snapshot");
    await expect(service.readChapter(book.id, trashed.id)).rejects.toMatchObject({ code: "not-found" });
    expect((await service.readChapter(book.id, kept.id)).title).toBe("Kept");
  });

  test("stable chapter identity survives a title change and a reorder", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const first = await service.createChapter(book.id, { title: "The Door", content: "Salt wind.\n" });
    const second = await service.createChapter(book.id, { title: "The Light", content: "A lamp.\n" });

    const saved = await service.readChapter(book.id, first.id);
    await service.updateChapterMeta(
      book.id,
      first.id,
      { title: "The Gate" },
      { baseVersion: saved.version, baseHash: saved.hash }
    );
    await service.moveChapterTo(book.id, first.id, 1);

    const resolved = await service.readChapter(book.id, first.id);
    expect(resolved.id).toBe(first.id);
    expect(resolved.title).toBe("The Gate");
    expect((await service.readChapter(book.id, second.id)).title).toBe("The Light");
  });

  test("a single-file record creates unconditionally and updates only on a hash match", async () => {
    const port = new InMemoryLibraryPort();
    const path = toLibraryPath(["books", "book_x", "history", "chapter_y", "123-label.md"]);

    const created = await port.commitFile(path, encoder.encode("v1"), { kind: "any" });
    if (created.status !== "written") throw new Error("Expected the record to be created.");

    const mismatch = await port.commitFile(path, encoder.encode("v2"), {
      kind: "sha256",
      value: "wrong"
    });
    expect(mismatch.status).toBe("changed");

    const updated = await port.commitFile(path, encoder.encode("v2"), {
      kind: "sha256",
      value: created.snapshot.sha256
    });
    expect(updated.status).toBe("written");
    const stored = await port.readFile(path);
    expect(stored ? decoder.decode(stored.bytes) : null).toBe("v2");
  });
});
