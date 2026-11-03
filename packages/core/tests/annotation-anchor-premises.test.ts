import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 033 T003 (OD-033-03) premises. These pin the source facts a passage
 * anchor can rely on; they choose no representation. Saved chapter content is
 * content-addressable by its (version, hash) pair: any real edit advances
 * both, an identical re-save touches neither, body lines extract
 * deterministically, and a trashed chapter is unresolvable.
 */
const BODY = "Salt on the floor.\nCold through the door.\nNothing moved.\n";

async function openService() {
  const port = new InMemoryLibraryPort();
  return LibraryService.open({ storage: port, runtime: port });
}

describe("annotation anchor premises", () => {
  test("a one-character edit advances version and hash", async () => {
    const service = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: BODY });

    const edited = await service.saveChapter(book.id, chapter.id, BODY.replace("Salt", "Dust"), {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    if (edited.status !== "saved") throw new Error(`Expected a save, got ${edited.status}.`);

    expect(edited.chapter.version).toBe(chapter.version + 1);
    expect(edited.chapter.hash).not.toBe(chapter.hash);
  });

  test("an identical re-save keeps version and hash", async () => {
    const service = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: BODY });

    const again = await service.saveChapter(book.id, chapter.id, BODY, {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    if (again.status !== "saved") throw new Error(`Expected a save, got ${again.status}.`);

    expect(again.chapter.version).toBe(chapter.version);
    expect(again.chapter.hash).toBe(chapter.hash);
  });

  test("body lines extract deterministically from the saved chapter", async () => {
    const service = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: BODY });

    const read = await service.readBook(book.id);
    const [firstChapter] = read.chapters;
    if (!firstChapter) throw new Error("Fixture book has no chapters.");
    const lines = firstChapter.content.split("\n");
    expect(lines.slice(0, 2)).toEqual(["Salt on the floor.", "Cold through the door."]);
    expect(chapter.hash).toHaveLength(64);
  });

  test("a trashed chapter is unresolvable", async () => {
    const service = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: BODY });

    await service.deleteChapter(book.id, chapter.id);
    await expect(service.readChapter(book.id, chapter.id)).rejects.toThrow();
  });
});
