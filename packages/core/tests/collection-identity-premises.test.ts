import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { bookFilePath, bookPath } from "../src/library/paths";
import { toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 033 T002 (OD-033-02) premises. These pin the identity facts collection
 * references rest on; they choose nothing. Book identity is the stable
 * directory id: it survives title renames, dies with trash (unresolvable, never
 * substituted by a same-title book), and returns with restore.
 */
describe("collection identity premises", () => {
  test("a title rename preserves the book identity and chapter paths", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt.\n" });
    const [firstBefore] = (await service.readBook(book.id)).chapters;
    if (!firstBefore) throw new Error("Fixture book has no chapters.");
    const before = firstBefore.path;

    const renamed = await service.updateBook(book.id, { title: "The Salt Crossing" });

    expect(renamed.id).toBe(book.id);
    const after = await service.readBook(book.id);
    expect(after.book.title).toBe("The Salt Crossing");
    expect(after.chapters.map((item) => item.id)).toEqual([chapter.id]);
    const [firstAfter] = after.chapters;
    if (!firstAfter) throw new Error("Renamed book has no chapters.");
    expect(firstAfter.path).toBe(before);
    expect(await port.readFile(bookFilePath(book.id))).not.toBeNull();
  });

  test("a trashed book id is unresolvable and a same-title book never substitutes it", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await service.deleteBook(book.id);

    await expect(service.readBook(book.id)).rejects.toThrow();
    const replacement = await service.createBook({ title: "The Salt Road" });
    expect(replacement.id).not.toBe(book.id);
    await expect(service.readBook(book.id)).rejects.toThrow();
  });

  test("a restored book keeps its identity and chapters", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt.\n" });
    await service.deleteBook(book.id);

    const trashBooks = toLibraryPath([".studio", "trash", "books"]);
    const [stamped] = await port.listDirectory(trashBooks);
    if (stamped?.kind !== "directory") throw new Error("Expected one trashed book directory.");
    await port.moveDirectory(toLibraryPath([".studio", "trash", "books", stamped.name]), bookPath(book.id));

    const restored = await service.readBook(book.id);
    expect(restored.book.id).toBe(book.id);
    expect(restored.book.title).toBe("The Salt Road");
    expect(restored.chapters.map((item) => item.id)).toEqual([chapter.id]);
  });
});
