import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";

const cleanups: string[] = [];

afterEach(async () => {
  for (const root of cleanups.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "abs-search-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  await library.createChapter(book.id, {
    title: "The Door",
    content: "The hall was cold.\nMara closed the door.\n"
  });
  await library.createChapter(book.id, {
    title: "The Gate",
    content: "Morning came slowly.\nThe door opened.\n"
  });
  return { library, book };
}

describe("search", () => {
  test("finds a line across chapters with its chapter and line number", async () => {
    const { library, book } = await fixture();
    const hits = await library.search(book.id, "COLD");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      chapterTitle: "The Door",
      order: 1,
      line: 1,
      text: "The hall was cold."
    });
  });

  test("returns every matching line in reading order", async () => {
    const { library, book } = await fixture();
    const hits = await library.search(book.id, "door");

    expect(hits.map((hit) => [hit.chapterTitle, hit.line])).toEqual([
      ["The Door", 2],
      ["The Gate", 2]
    ]);
  });

  test("stops at the limit", async () => {
    const { library, book } = await fixture();
    const hits = await library.search(book.id, "the", 1);

    expect(hits).toHaveLength(1);
  });

  test("returns nothing for an empty or unmatched query", async () => {
    const { library, book } = await fixture();

    expect(await library.search(book.id, "   ")).toEqual([]);
    expect(await library.search(book.id, "lighthouse")).toEqual([]);
  });
});
