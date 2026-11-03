import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chapterToolCatalog, createChapterTools } from "../src/main/agent/tools";
import { buildPrompt } from "../src/main/agent/prompt";
import { Library } from "../src/main/library/store";
import { bookSchema, chapterMetaSchema, type Chapter } from "@ai-book-studio/core/schema";

/**
 * Spec 002 FR-022: every tool enforces its own stated limit in one place, and the
 * prompt and tool descriptions state exactly those limits and no others.
 *
 * Tool descriptions interpolate the enforced constants and the JSON Schema the
 * model receives carries every exact bound, so the prose agrees by
 * construction - these tests pin that contract three ways: every stated limit
 * phrase resolves to an enforced input maximum or a proven execute cap, the
 * two result caps the schema cannot see are proven by running past them, and
 * the system prompt policy sections state no numeric limits of their own.
 */

/** The phrasings the tool texts use for limits (anything else is prose, not a stated limit). */
const LIMIT_PHRASE = /(?:at most|up to)\s+([\d,]+)|([\d,]+)\s+characters or less/gi;

function statedLimitNumbers(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(LIMIT_PHRASE)) {
    found.push(Number((match[1] ?? match[2] ?? "").replace(/,/g, "")));
  }
  return found;
}

/** Every `maximum`/`maxLength` the tool's JSON Schema input enforces. */
function enforcedMaxima(schema: unknown): number[] {
  const found: number[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record["maximum"] === "number") found.push(record["maximum"]);
    if (typeof record["maxLength"] === "number") found.push(record["maxLength"]);
    for (const value of Object.values(record)) visit(value);
  };
  visit(schema);
  return found;
}

/**
 * Result caps enforced in `execute` rather than the input schema. Each entry is
 * proven by the truncation test below; stating a cap here without proving it
 * there (or vice versa) fails the suite.
 */
const EXECUTE_ENFORCED_MAXIMA: Record<string, number[]> = {
  find_in_chapter: [200],
  find_in_chapters: [200]
};

/** The tool text plus every input property description. */
function toolTexts(description: string, schema: unknown): string {
  const texts = [description];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record["description"] === "string") texts.push(record["description"]);
    for (const value of Object.values(record)) visit(value);
  };
  visit(schema);
  return texts.join("\n");
}

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("tool limits contract", () => {
  test("every stated limit is enforced by the input schema or a proven execute cap", () => {
    const catalog = chapterToolCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const tool of catalog) {
      // The JSON Schema the model receives carries every exact bound, so prose
      // only restates the planning limits — but anything it states must hold.
      const enforced = [...enforcedMaxima(tool.inputSchema), ...(EXECUTE_ENFORCED_MAXIMA[tool.name] ?? [])];
      for (const stated of statedLimitNumbers(toolTexts(tool.description, tool.inputSchema))) {
        expect(enforced.includes(stated), `${tool.name} states a limit of ${stated} it does not enforce`).toBe(true);
      }
    }
  });

  test("the stated 200-match caps truncate instead of returning everything", async () => {
    const root = await mkdtemp(join(tmpdir(), "studio-limits-"));
    cleanups.push(root);
    const library = await Library.open(root);
    const book = await library.createBook({ title: "The Salt Road", description: "A keeper keeps light." });
    const lines = Array.from({ length: 205 }, (_, index) => `needle line ${index}`);
    const chapter = await library.createChapter(book.id, { title: "Haystack", content: `${lines.join("\n")}\n` });
    const tools = createChapterTools(library, book.id) as unknown as Record<
      string,
      { execute?: (input: unknown, options?: unknown) => Promise<unknown> }
    >;
    const run = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
      const execute = tools[name]?.execute;
      if (!execute) throw new Error(`${name} has no handler`);
      return (await execute(input, {})) as Record<string, unknown>;
    };

    const [findCap] = EXECUTE_ENFORCED_MAXIMA["find_in_chapter"] ?? [];
    const [searchCap] = EXECUTE_ENFORCED_MAXIMA["find_in_chapters"] ?? [];
    if (findCap === undefined || searchCap === undefined) throw new Error("Execute caps must be listed with their tests.");
    const single = await run("find_in_chapter", { chapterId: chapter.id, query: "needle" });
    expect(single["ok"]).toBe(true);
    expect((single["matches"] as unknown[]).length).toBe(findCap);
    expect(single["total"]).toBe(205);
    expect(single["truncated"]).toBe(true);

    const all = await run("find_in_chapters", { query: "needle" });
    expect(all["ok"]).toBe(true);
    expect((all["matches"] as unknown[]).length).toBe(searchCap);
    expect(all["truncated"]).toBe(true);
    expect(all["message"]).toMatch(new RegExp(`${searchCap}\\+ matches`));
  });

  test("the system prompt states no numeric limits of its own", () => {
    const book = bookSchema.parse({
      id: "book_limits000001",
      title: "The Salt Road",
      createdAt: "2026-11-02T00:00:00.000Z",
      updatedAt: "2026-11-02T00:00:00.000Z"
    });
    const chapter = (id: string, title: string, order: number): Chapter => ({
      ...chapterMetaSchema.parse({
        id,
        title,
        order,
        createdAt: "2026-11-02T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z"
      }),
      content: "The hall was cold.\n",
      path: `000${order}-chapter.md`,
      wordCount: 4,
      hash: order.toString().repeat(64).slice(0, 64)
    });
    const { sections } = buildPrompt({
      book,
      chapters: [chapter("ch_limits000001", "The Door", 1), chapter("ch_limits000002", "The Gate", 2)],
      activeChapter: null
    });
    const policy = sections
      .filter((section) => section.id === "instructions" || section.id === "guard")
      .map((section) => section.text)
      .join("\n");
    expect(policy.length).toBeGreaterThan(0);
    expect(statedLimitNumbers(policy)).toEqual([]);
  });
});
