import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLibraryArchiveToFolder, writeLibraryArchive } from "../src/main/library/archive";
import { Library } from "../src/main/library/store";

let temp: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "ai-book-studio-archive-"));
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe("desktop library archive", () => {
  it("exports and imports a whole library with its book and chapter identities", async () => {
    const source = join(temp, "source");
    const library = await Library.open(source);
    const book = await library.createBook({ title: "Archive Book", description: "Travels well." });
    const chapter = await library.createChapter(book.id, { title: "One", content: "The archive keeps this.\n" });

    const archivePath = join(temp, "library.zip");
    const summary = await writeLibraryArchive(library, archivePath, "0.1.0");
    expect(summary.path).toBe(archivePath);
    expect(summary.entryCount).toBeGreaterThan(0);
    expect(summary.expandedBytes).toBeGreaterThan(0);

    const destination = join(temp, "imported");
    const imported = await importLibraryArchiveToFolder(archivePath, destination);
    expect(imported.bookCount).toBe(1);
    expect(imported.root).toBe(destination);

    const reopened = await Library.open(destination);
    const detail = await reopened.readBook(book.id);
    expect(detail.book.title).toBe("Archive Book");
    expect(detail.chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect(detail.chapters[0]?.content).toBe("The archive keeps this.\n");
  });

  it("refuses a destination that already has files and leaves them untouched", async () => {
    const library = await Library.open(join(temp, "source"));
    await library.createBook({ title: "Book" });
    const archivePath = join(temp, "library.zip");
    await writeLibraryArchive(library, archivePath, "0.1.0");

    const occupied = join(temp, "occupied");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "keep.txt"), "keep me", "utf8");

    await expect(importLibraryArchiveToFolder(archivePath, occupied)).rejects.toMatchObject({ code: "invalid" });
    expect(await readFile(join(occupied, "keep.txt"), "utf8")).toBe("keep me");
  });

  it("rejects a damaged archive without leaving imported files behind", async () => {
    const damaged = join(temp, "damaged.zip");
    await writeFile(damaged, "this is not a zip archive", "utf8");
    const destination = join(temp, "damaged-destination");

    await expect(importLibraryArchiveToFolder(damaged, destination)).rejects.toThrow();
    expect(await readdir(destination)).toEqual([]);
  });

  it("replaces a previous export only after the new archive is complete", async () => {
    const library = await Library.open(join(temp, "source"));
    await library.createBook({ title: "First" });
    const archivePath = join(temp, "library.zip");
    await writeLibraryArchive(library, archivePath, "0.1.0");
    const first = await readFile(archivePath);

    await library.createBook({ title: "Second" });
    const second = await writeLibraryArchive(library, archivePath, "0.1.0");
    const updated = await readFile(archivePath);

    expect(second.entryCount).toBeGreaterThan(0);
    expect(updated.equals(first)).toBe(false);
    expect(updated.length).toBeGreaterThan(0);
  });
});
