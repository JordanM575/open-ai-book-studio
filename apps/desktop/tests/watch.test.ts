import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ai-book-studio-watch-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("a change from another editor reaches the library watcher", async () => {
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Watch" });
  const chapter = await library.createChapter(book.id, { title: "One", content: "Original.\n" });
  const path = join(root, "books", book.id, "chapters", chapter.path);

  let stop = (): void => {};
  const changed = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no watch event")), 10_000);
    stop = library.watch((changedPath) => {
      if (!changedPath.endsWith(chapter.path)) return;
      clearTimeout(timer);
      resolve(changedPath);
    });
  });

  try {
    // fs.watch is armed asynchronously; a write in the same tick can be missed under load.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(path, "External edit.\n", "utf8");
    expect(await changed).toBe(`books/${book.id}/chapters/${chapter.path}`);
  } finally {
    stop();
  }
});
