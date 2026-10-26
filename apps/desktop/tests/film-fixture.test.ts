import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Library } from "../src/main/library/store";
import { buildFilmFixture } from "../../../scripts/film-fixture";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("film fixture", () => {
  test("builds a complete, original book with an illustration and a character cutout", async () => {
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
    const cutout = listed.manifest.images.find((image) => image.id === result.cutoutId)!;
    expect(illustration).toMatchObject({
      kind: "chapter",
      chapterId: result.chapterIds[0],
      width: 1024,
      height: 1024,
      source: "imported"
    });
    expect(cutout).toMatchObject({
      kind: "character",
      characterId: result.characterId,
      cutoutOf: result.illustrationId,
      width: 512,
      height: 512,
      source: "cutout"
    });

    const illustrationBytes = (await library.readImage(result.bookId, result.illustrationId))!.bytes;
    expect([...illustrationBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cutoutBytes = (await library.readImage(result.bookId, result.cutoutId))!.bytes;
    expect([...cutoutBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const manifest = await readFile(join(root, "books", result.bookId, "images.json"), "utf8");
    expect(manifest).not.toContain(root);
    expect(manifest).not.toMatch(/secret|api[_-]?key/i);
  });
});
