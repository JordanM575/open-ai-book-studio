import { describe, expect, test } from "bun:test";
import { createLibraryArchive } from "../src/archive/export";
import { LibraryService } from "../src/library/service";
import { bookFilePath, bookPath } from "../src/library/paths";
import { toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Spec 033 T001 (OD-033-01) premises. These pin the storage facts the
 * per-data-type matrix rests on; they choose nothing. Book-scoped sidecars
 * travel with trash/restore and the archive; a library-root metadata file is
 * archive-portable but untouched by book trash.
 */
describe("organization storage premises", () => {
  test("a book-scoped sidecar travels with book trash and restore", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const sidecar = toLibraryPath(["books", book.id, "goals.json"]);
    const payload = JSON.stringify({ schemaVersion: 1, targetWords: 80000 });
    await port.commitFile(sidecar, encoder.encode(payload), { kind: "any" });

    await service.deleteBook(book.id);
    expect(await port.readFile(bookFilePath(book.id))).toBeNull();

    const trashBooks = toLibraryPath([".studio", "trash", "books"]);
    const trashed = await port.listDirectory(trashBooks);
    expect(trashed).toHaveLength(1);
    const [stamped] = trashed;
    if (stamped?.kind !== "directory") throw new Error("Expected one trashed book directory.");
    const moved = await port.readFile(toLibraryPath([".studio", "trash", "books", stamped.name, "goals.json"]));
    expect(moved ? decoder.decode(moved.bytes) : null).toBe(payload);

    await port.moveDirectory(toLibraryPath([".studio", "trash", "books", stamped.name]), bookPath(book.id));
    const restored = await service.readBook(book.id);
    expect(restored.book.title).toBe("The Salt Road");
    const kept = await port.readFile(sidecar);
    expect(kept ? decoder.decode(kept.bytes) : null).toBe(payload);
  });

  test("a library-root metadata file rides the archive but survives book trash", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const rootFile = toLibraryPath(["collections.json"]);
    const payload = JSON.stringify({ schemaVersion: 1, collections: [] });
    await port.commitFile(rootFile, encoder.encode(payload), { kind: "any" });

    const archive = await createLibraryArchive({ storage: port, runtime: port }, { appVersion: "test" });
    expect(archive.manifest.entries.map((entry) => entry.path)).toContain("collections.json");

    await service.deleteBook(book.id);
    const kept = await port.readFile(rootFile);
    expect(kept ? decoder.decode(kept.bytes) : null).toBe(payload);
  });
});
