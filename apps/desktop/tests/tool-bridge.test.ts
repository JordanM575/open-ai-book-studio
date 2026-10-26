import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { ToolBridge, ToolError } from "../src/main/agent/tool-bridge";
import { chapterToolCatalog } from "../src/main/agent/tools";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-tool-bridge-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const chapter = await library.createChapter(book.id, {
    title: "The Door",
    content: "The door was open.\n"
  });
  return { library, book, chapter, bridge: new ToolBridge(() => library) };
}

describe("tool catalog", () => {
  test("lists every studio tool with a schema and a tier", () => {
    const catalog = chapterToolCatalog();
    expect(catalog.length).toBeGreaterThan(15);
    for (const tool of catalog) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(["read", "write", "destructive"]).toContain(tool.tier);
    }
  });

  test("separates the read, write and destructive tools", () => {
    const catalog = chapterToolCatalog();
    const tier = (name: string) => catalog.find((tool) => tool.name === name)?.tier;
    expect(tier("read_story_bible")).toBe("read");
    expect(tier("table_of_contents")).toBe("read");
    expect(tier("append_to_chapter")).toBe("write");
    expect(tier("replace_in_chapter")).toBe("write");
    expect(tier("overwrite_chapter")).toBe("destructive");
    expect(tier("delete_chapter")).toBe("destructive");
    expect(tier("remove_memory")).toBe("destructive");
  });
});

describe("tool bridge", () => {
  test("reads the Story Bible of the open book", async () => {
    const { bridge, book } = await fixture();
    const result = (await bridge.run({ bookId: book.id, name: "read_story_bible", args: {} })) as unknown as {
      ok: boolean;
      book: { title: string };
    };
    expect(result.ok).toBe(true);
    expect(result.book.title).toBe("The Salt Road");
  });

  test("writes through the library, so the file on disk changes", async () => {
    const { bridge, book, chapter, library } = await fixture();
    const result = (await bridge.run({
      bookId: book.id,
      name: "append_to_chapter",
      args: { chapterId: chapter.id, text: "The hall was cold." }
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const disk = await library.readChapter(book.id, chapter.id);
    expect(disk.content).toContain("The hall was cold.");
  });

  test("rejects arguments that do not fit the tool's schema", async () => {
    const { bridge, book, chapter } = await fixture();
    await expect(
      bridge.run({ bookId: book.id, name: "append_to_chapter", args: { chapterId: chapter.id } })
    ).rejects.toThrow(/arguments do not fit/i);
  });

  test("refuses an unknown tool", async () => {
    const { bridge, book } = await fixture();
    await expect(
      bridge.run({ bookId: book.id, name: "not_a_tool", args: {} })
    ).rejects.toThrow(/Unknown tool/);
  });

  test("refuses a destructive tool unless the caller opts in", async () => {
    const { bridge, book, chapter, library } = await fixture();
    await expect(
      bridge.run({
        bookId: book.id,
        name: "overwrite_chapter",
        args: { chapterId: chapter.id, content: "Replaced.\n" }
      })
    ).rejects.toThrow(/destructive/i);
    expect((await library.readChapter(book.id, chapter.id)).content).not.toBe("Replaced.\n");
  });

  test("leaves an undo checkpoint the studio can restore", async () => {
    const { bridge, book, chapter, library } = await fixture();
    const before = (await library.readChapter(book.id, chapter.id)).content;
    await bridge.run({
      bookId: book.id,
      name: "append_to_chapter",
      args: { chapterId: chapter.id, text: "Added by another agent." }
    });
    expect((await library.readChapter(book.id, chapter.id)).content).not.toBe(before);

    const { CheckpointStore } = await import("../src/main/agent/checkpoints");
    const store = new CheckpointStore(library.root);
    const checkpoint = await store.latest(book.id);
    expect(checkpoint?.entries[0]?.before).toBe(before);
  });

  test("explains that no library is open", async () => {
    const bridge = new ToolBridge(() => null);
    await expect(
      bridge.run({ bookId: "book_test0001", name: "read_story_bible", args: {} })
    ).rejects.toBeInstanceOf(ToolError);
  });
});
