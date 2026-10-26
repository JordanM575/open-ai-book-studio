import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { buildDocx } from "../src/main/export";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ library: Library; bookId: string }> {
  const root = await mkdtemp(join(tmpdir(), "abs-export-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road", description: "A crossing at low tide." });
  const chapter = await library.createChapter(book.id, {
    title: "The Door",
    content: "The hall was cold.\n\nMara closed the door.\n"
  });
  await library.createChapter(book.id, { title: "The Gate", content: "Morning came slowly.\n" });
  expect(chapter.title).toBe("The Door");
  return { library, bookId: book.id };
}

describe("docx export", () => {
  test("builds a Word document for a book", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const data = await buildDocx(detail);
    expect(data.length).toBeGreaterThan(1_000);
    expect(Buffer.from(data).subarray(0, 2).toString()).toBe("PK");
  });

  test("builds a document for an empty book", async () => {
    const root = await mkdtemp(join(tmpdir(), "abs-export-empty-"));
    cleanups.push(root);
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Blank" });
    const detail = await library.readBook(book.id);
    const data = await buildDocx(detail);
    expect(data.length).toBeGreaterThan(500);
  });
});
