import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Library } from "../src/main/library/store";
import { buildFilmFixture } from "../../../scripts/film-fixture";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("the committed sample library", () => {
  test("opens with the current schema, so a new setting never locks the author out", async () => {
    // The committed sample was written before the agent settings existed. If a new setting breaks
    // an older book, the sample stops opening and the shipped library is broken.
    const root = await mkdtemp(join(tmpdir(), "abs-sample-library-"));
    cleanups.push(root);
    const libraryRoot = join(root, "library");
    await cp(resolve(import.meta.dir, "../../../samples/the-salt-road"), libraryRoot, { recursive: true });
    const library = await Library.open(libraryRoot);
    const books = await library.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]?.title).toBe("The Salt Road");
    const detail = await library.readBook(books[0]!.id);
    expect(detail.book.settings.agent.disabledTools).toEqual([]);
    expect(detail.book.settings.cache.prefixMode).toBe("auto");
  });

  test("presents no SAM cutout, and each image record still matches its bytes", async () => {
    // SAM left the build (D-158), so the sample's drawn figure of Mara is recorded as imported.
    const root = await mkdtemp(join(tmpdir(), "abs-sample-images-"));
    cleanups.push(root);
    await cp(resolve(import.meta.dir, "../../../samples/the-salt-road"), root, { recursive: true });
    const library = await Library.open(root);
    const bookId = (await library.listBooks())[0]!.id;
    const listed = await library.listImages(bookId);
    expect(listed.warning).toBeNull();
    expect(listed.manifest.images.map((image) => [image.kind, image.source, image.cutoutOf])).toEqual([
      ["chapter", "imported", null],
      ["character", "imported", null]
    ]);
    for (const image of listed.manifest.images) {
      const bytes = (await library.readImage(bookId, image.id))!.bytes;
      expect(bytes.byteLength).toBe(image.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.sha256);
    }
  });
});

describe("film fixture", () => {
  test("builds a complete, original book with an illustration and a character figure", async () => {
    const root = await mkdtemp(join(tmpdir(), "abs-film-fixture-"));
    cleanups.push(root);
    const result = await buildFilmFixture(root);
    const library = await Library.open(root);
    const detail = await library.readBook(result.bookId);
    expect(detail.book.title).toBe("The Salt Road");
    expect(detail.book.characters).toHaveLength(1);
    expect(detail.book.characters[0]).toMatchObject({ id: result.characterId, name: "Mara Venn" });
    expect(detail.book.memories).toHaveLength(1);
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters.map((chapter) => chapter.id)).toEqual(result.chapterIds);
    expect(detail.chapters[0]?.content).toContain("The storm came in low");

    const listed = await library.listImages(result.bookId);
    expect(listed.warning).toBeNull();
    expect(listed.manifest.images).toHaveLength(2);
    const illustration = listed.manifest.images.find((image) => image.id === result.illustrationId)!;
    const figure = listed.manifest.images.find((image) => image.id === result.figureId)!;
    expect(illustration).toMatchObject({
      kind: "chapter",
      chapterId: result.chapterIds[0],
      width: 1024,
      height: 1024,
      source: "imported"
    });
    expect(figure).toMatchObject({
      kind: "character",
      characterId: result.characterId,
      cutoutOf: null,
      width: 512,
      height: 512,
      source: "imported"
    });

    const illustrationBytes = (await library.readImage(result.bookId, result.illustrationId))!.bytes;
    expect([...illustrationBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const figureBytes = (await library.readImage(result.bookId, result.figureId))!.bytes;
    expect([...figureBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const manifest = await readFile(join(root, "books", result.bookId, "images.json"), "utf8");
    expect(manifest).not.toContain(root);
    expect(manifest).not.toMatch(/secret|api[_-]?key/i);
  });
});
