import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { createChapterTools } from "../src/main/agent/tools";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-recovery-"));
  roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Book" });
  const first = await library.createChapter(book.id, { title: "One", content: "First.\n" });
  const second = await library.createChapter(book.id, { title: "Two", content: "Second.\n" });
  const chapterDir = join(root, "books", book.id, "chapters");
  const trashDir = join(root, ".studio", "trash", book.id);
  const firstBytes = await readFile(join(chapterDir, first.path));
  const secondBytes = await readFile(join(chapterDir, second.path));
  const tools = createChapterTools(library, book.id);
  const execute = tools.merge_chapters.execute as unknown as (
    input: { firstChapterId: string; secondChapterId: string },
    options: { toolCallId: string; messages: [] }
  ) => Promise<{ ok: boolean; message: string }>;
  const run = () => execute({ firstChapterId: first.id, secondChapterId: second.id },
    { toolCallId: "test", messages: [] });
  return { root, library, book, first, second, firstBytes, secondBytes, chapterDir, trashDir, run };
}

test("conflict keeps the concurrent edit and merged conflict copy, and restores the original chapter bytes", async () => {
  const f = await fixture();
  const save = f.library.saveChapter.bind(f.library);
  f.library.saveChapter = async (...args) => {
    await save(f.book.id, f.first.id, "Concurrent.\n", { baseVersion: f.first.version, baseHash: f.first.hash });
    return save(...args);
  };
  const result = await f.run();
  expect(result.ok).toBe(false);
  expect(String(result.message)).toContain("changed on disk");
  expect((await f.library.readBook(f.book.id)).chapters.map((c) => [c.id, c.content])).toEqual([
    [f.first.id, "Concurrent.\n"], [f.second.id, "Second.\n"]
  ]);
  expect(await readFile(join(f.chapterDir, f.second.path))).toEqual(f.secondBytes);
  const conflicts = await readdir(join(f.root, "books", f.book.id, "conflicts"));
  expect(conflicts).toHaveLength(1);
  expect(await readFile(join(f.root, "books", f.book.id, "conflicts", conflicts[0]!), "utf8")).toContain("Second.");
});

test("save I/O failure restores the original without claiming a disk conflict", async () => {
  const f = await fixture();
  f.library.saveChapter = async () => { throw new Error("injected I/O"); };
  const result = await f.run();
  expect(result.ok).toBe(false);
  expect(String(result.message)).toContain("could not be saved");
  expect(String(result.message)).not.toContain("changed on disk");
  expect(String(result.message)).toContain("restored");
  expect(await readFile(join(f.chapterDir, f.first.path))).toEqual(f.firstBytes);
  expect(await readFile(join(f.chapterDir, f.second.path))).toEqual(f.secondBytes);
  expect((await f.library.readBook(f.book.id)).chapters.map((c) => c.id)).toEqual([f.first.id, f.second.id]);
});

test("restore failure reports uncertainty and retains original bytes in trash", async () => {
  const f = await fixture();
  f.library.saveChapter = async () => { throw new Error("injected I/O"); };
  f.library.restoreChapter = async () => { throw new Error("injected restore failure"); };
  const result = await f.run();
  expect(result.ok).toBe(false);
  expect(String(result.message)).toContain("could not be restored");
  expect(String(result.message)).not.toContain("changed on disk");
  expect(await readFile(join(f.chapterDir, f.first.path))).toEqual(f.firstBytes);
  const trash = await readdir(f.trashDir);
  expect(trash).toHaveLength(1);
  expect(await readFile(join(f.trashDir, trash[0]!))).toEqual(f.secondBytes);
});

test("a conflict and a failed restore preserve both the conflict copy and original trash", async () => {
  const f = await fixture();
  const save = f.library.saveChapter.bind(f.library);
  f.library.saveChapter = async (...args) => {
    await save(f.book.id, f.first.id, "Concurrent.\n", { baseVersion: f.first.version, baseHash: f.first.hash });
    return save(...args);
  };
  f.library.restoreChapter = async () => { throw new Error("injected restore failure"); };
  const result = await f.run();
  expect(result.ok).toBe(false);
  expect(result.message).toContain("changed on disk");
  expect(result.message).toContain("could not be restored");
  expect((await f.library.readChapter(f.book.id, f.first.id)).content).toBe("Concurrent.\n");
  const trash = await readdir(f.trashDir);
  expect(trash).toHaveLength(1);
  expect(await readFile(join(f.trashDir, trash[0]!))).toEqual(f.secondBytes);
  const conflicts = await readdir(join(f.root, "books", f.book.id, "conflicts"));
  expect(conflicts).toHaveLength(1);
  expect(await readFile(join(f.root, "books", f.book.id, "conflicts", conflicts[0]!), "utf8")).toContain("Second.");
});

test("recognizes an original chapter already returned before restore", async () => {
  const f = await fixture();
  f.library.saveChapter = async () => { throw new Error("injected I/O"); };
  const restore = f.library.restoreChapter.bind(f.library);
  f.library.restoreChapter = async (...args) => {
    const trash = await readdir(f.trashDir);
    await rename(join(f.trashDir, trash[0]!), join(f.chapterDir, f.second.path));
    return restore(...args);
  };
  const result = await f.run();
  expect(result.ok).toBe(false);
  expect(String(result.message)).toContain("already back");
  expect(String(result.message)).not.toContain("Check the trash");
  expect(String(result.message)).not.toContain("changed on disk");
  expect(await readFile(join(f.chapterDir, f.first.path))).toEqual(f.firstBytes);
  expect(await readFile(join(f.chapterDir, f.second.path))).toEqual(f.secondBytes);
  expect((await f.library.readBook(f.book.id)).chapters.map((c) => c.id)).toEqual([f.first.id, f.second.id]);
  expect(await readdir(f.trashDir)).toEqual([]);
});
