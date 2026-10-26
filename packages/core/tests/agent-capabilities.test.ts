import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  agentSettingsSchema,
  cacheSettingsSchema,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_CACHE_SETTINGS
} from "../src/agent/settings";
import { summarizeCache, summarizeToolMetrics, type ToolCallRecord } from "../src/agent/metrics";
import {
  isJsonSchema,
  isZodParameters,
  parsePlugin,
  pluginJsonSchema,
  validatePluginArgs
} from "../src/agent/plugins";
import { bookSchema } from "../src/schema";

describe("the per-book agent settings", () => {
  test("default to no withdrawn tools and the skills file on", () => {
    expect(DEFAULT_AGENT_SETTINGS.disabledTools).toEqual([]);
    expect(DEFAULT_AGENT_SETTINGS.skillsEnabled).toBe(true);
    expect(DEFAULT_CACHE_SETTINGS.prefixMode).toBe("auto");
  });

  test("keep the withdrawn tools per book", () => {
    const parsed = agentSettingsSchema.parse({ disabledTools: ["overwrite_chapter"] });
    expect(parsed.disabledTools).toEqual(["overwrite_chapter"]);
    expect(parsed.skillsEnabled).toBe(true);
  });

  test("refuse a cache mode that is not one of the two", () => {
    expect(cacheSettingsSchema.safeParse({ prefixMode: "sometimes" }).success).toBe(false);
    expect(cacheSettingsSchema.safeParse({ prefixMode: "off" }).success).toBe(true);
  });

  test("fill in the settings a book written before them is missing", () => {
    // A book written before the agent settings existed has only the manuscript settings. It must
    // still open, because the author already has it on disk.
    const book = bookSchema.parse({
      id: "book_test0001",
      title: "The Salt Road",
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-26T00:00:00.000Z",
      settings: { manuscript: { bodyFont: "Georgia" } }
    });
    expect(book.settings.agent.disabledTools).toEqual([]);
    expect(book.settings.agent.skillsEnabled).toBe(true);
    expect(book.settings.cache.prefixMode).toBe("auto");
    expect(book.settings.manuscript.bodyFont).toBe("Georgia");
  });
});

describe("the tool metrics", () => {
  const record = (name: string, ok: boolean): ToolCallRecord => ({
    name,
    ok,
    at: "2026-10-26T00:00:00.000Z"
  });

  test("count the calls, the successes and the failures per tool", () => {
    const summary = summarizeToolMetrics([
      record("append_to_chapter", true),
      record("append_to_chapter", true),
      record("append_to_chapter", false),
      record("read_story_bible", true)
    ]);
    expect(summary.calls).toBe(4);
    expect(summary.failures).toBe(1);
    const append = summary.tools.find((tool) => tool.name === "append_to_chapter");
    expect(append?.calls).toBe(3);
    expect(append?.successes).toBe(2);
    expect(append?.failures).toBe(1);
    expect(append?.successRate).toBeCloseTo(2 / 3);
  });

  test("list the busiest tool first", () => {
    const summary = summarizeToolMetrics([
      record("a", true),
      record("b", true),
      record("b", true)
    ]);
    expect(summary.tools[0]?.name).toBe("b");
  });

  test("report nothing for a book that never called a tool", () => {
    const summary = summarizeToolMetrics([]);
    expect(summary.calls).toBe(0);
    expect(summary.tools).toEqual([]);
  });
});

describe("the cache summary", () => {
  test("say nothing was reported rather than a rate of zero", () => {
    const summary = summarizeCache([]);
    expect(summary.hitRate).toBeNull();
    expect(summary.turns).toBe(0);
  });

  test("ignore the turns the provider did not report a cache for", () => {
    const summary = summarizeCache([
      { cachedInputTokens: 0, inputTokens: 100, reported: false },
      { cachedInputTokens: 80, inputTokens: 100, reported: true },
      { cachedInputTokens: 40, inputTokens: 100, reported: true }
    ]);
    expect(summary.turns).toBe(2);
    expect(summary.turnsWithCache).toBe(2);
    expect(summary.cachedInputTokens).toBe(120);
    expect(summary.hitRate).toBeCloseTo(120 / 200);
  });

  test("show a rate of zero when the provider reported a cache and there was none", () => {
    const summary = summarizeCache([{ cachedInputTokens: 0, inputTokens: 100, reported: true }]);
    expect(summary.hitRate).toBe(0);
    expect(summary.turnsWithCache).toBe(0);
  });
});

describe("the plugin contract", () => {
  const jsonParameters = {
    type: "object" as const,
    properties: { chapterId: { type: "string" as const } },
    required: ["chapterId"]
  };

  test("accept a plugin with a JSON Schema and no imports at all", () => {
    const plugin = parsePlugin({
      name: "word-count",
      tools: [
        {
          name: "count_words",
          description: "Count the words in a chapter.",
          parameters: jsonParameters,
          handler: async () => ({ words: 3 })
        }
      ]
    });
    expect(plugin.name).toBe("word-count");
    expect(plugin.tools[0]?.name).toBe("count_words");
    expect(isJsonSchema(plugin.tools[0]?.parameters)).toBe(true);
    expect(isZodParameters(plugin.tools[0]?.parameters)).toBe(false);
  });

  test("accept a plugin with a Zod schema", () => {
    const plugin = parsePlugin({
      name: "word-count",
      tools: [
        {
          name: "count_words",
          description: "Count the words in a chapter.",
          parameters: z.object({ chapterId: z.string() }),
          handler: async () => ({ words: 3 })
        }
      ]
    });
    expect(isZodParameters(plugin.tools[0]?.parameters)).toBe(true);
  });

  test("refuse a plugin that exports the wrong thing", () => {
    expect(() => parsePlugin(null)).toThrow(/plugin definition/i);
    expect(() => parsePlugin({ name: "x", tools: [] })).toThrow(/provides no tools/i);
    expect(() =>
      parsePlugin({ name: "x", tools: [{ name: "Bad Name", description: "d", parameters: jsonParameters, handler: () => 1 }] })
    ).toThrow(/lower case/i);
    expect(() =>
      parsePlugin({ name: "x", tools: [{ name: "ok_name", description: "", parameters: jsonParameters, handler: () => 1 }] })
    ).toThrow(/description/i);
    expect(() =>
      parsePlugin({ name: "x", tools: [{ name: "ok_name", description: "d", parameters: {}, handler: () => 1 }] })
    ).toThrow(/schema/i);
    expect(() =>
      parsePlugin({ name: "x", tools: [{ name: "ok_name", description: "d", parameters: jsonParameters }] })
    ).toThrow(/handler/i);
  });

  test("refuse a plugin that provides the same tool twice", () => {
    expect(() =>
      parsePlugin({
        name: "x",
        tools: [
          { name: "one_tool", description: "d", parameters: jsonParameters, handler: () => 1 },
          { name: "one_tool", description: "d", parameters: jsonParameters, handler: () => 1 }
        ]
      })
    ).toThrow(/twice/i);
  });

  test("check the arguments against a JSON Schema", () => {
    expect(validatePluginArgs(jsonParameters, { chapterId: "ch_123456" })).toEqual({
      ok: true,
      value: { chapterId: "ch_123456" }
    });
    const missing = validatePluginArgs(jsonParameters, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/chapterId is required/);
  });

  test("check the arguments against a Zod schema", () => {
    const parameters = z.object({ chapterId: z.string() });
    expect(validatePluginArgs(parameters, { chapterId: "ch_123456" }).ok).toBe(true);
    const wrong = validatePluginArgs(parameters, { chapterId: 7 });
    expect(wrong.ok).toBe(false);
  });

  test("keep the JSON Schema as the wire form", () => {
    expect(pluginJsonSchema(jsonParameters)).toEqual(jsonParameters);
  });
});
