import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { buildToolSet, pluginLibrary } from "../src/main/agent/tool-set";
import { chapterToolCatalog, READ_TOOL_NAMES, toolTier } from "../src/main/agent/tools";

/**
 * Spec 031 T001 (Discuss default and read-tool policy) premises. These pin the
 * classification and seam facts the policy rests on; they choose nothing. The
 * read tier is exactly six tools, a read-only subset builds through the
 * existing withdrawal seam, and plugin tools carry no read-only declaration on
 * a write-capable plugin library.
 */
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-discuss-policy-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road", description: "A keeper keeps light." });
  await library.createChapter(book.id, { title: "The Light", content: "The storm came in low.\n" });
  return { library, book };
}

describe("discuss read-tool policy premises", () => {
  test("the read tier is exactly the six read-only tools", () => {
    const catalog = chapterToolCatalog();
    expect(catalog).toHaveLength(22);
    const read = catalog
      .filter((tool) => tool.tier === "read")
      .map((tool) => tool.name)
      .sort();
    expect([...READ_TOOL_NAMES].sort()).toEqual([
      "chapter_stats",
      "find_in_chapter",
      "find_in_chapters",
      "read_chapter",
      "read_story_bible",
      "table_of_contents"
    ]);
    expect(read).toEqual([...READ_TOOL_NAMES].sort());
  });

  test("a read-only subset builds through the existing withdrawal seam", async () => {
    const { library, book } = await fixture();
    const catalog = chapterToolCatalog();
    const disabled = catalog.filter((tool) => tool.tier !== "read").map((tool) => tool.name);
    expect(disabled).toHaveLength(16);
    const subset = buildToolSet(library, book.id, { disabledTools: disabled });
    expect(Object.keys(subset).sort()).toEqual([...READ_TOOL_NAMES].sort());
    for (const name of Object.keys(subset)) {
      const definition = subset[name] as { execute?: unknown };
      expect(typeof definition.execute).toBe("function");
    }
  });

  test("plugin tools carry no read-only declaration and default to the write tier", async () => {
    const { library, book } = await fixture();
    expect(toolTier("say_hello")).toBe("write");
    expect(toolTier("")).toBe("write");
    const view = pluginLibrary(library);
    expect(typeof view.saveChapter).toBe("function");
    expect(typeof view.appendToChapter).toBe("function");
    const { chapters } = await library.readBook(book.id);
    const chapterId = chapters[0]?.id;
    if (!chapterId) throw new Error("Expected the fixture chapter.");
    const saved = await view.saveChapter(book.id, chapterId, "No.\n", { baseVersion: 0, baseHash: "x" });
    expect(saved.status).toBe("conflict");
  });
});
