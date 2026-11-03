import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { BookMeta } from "@ai-book-studio/core/schema";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
import { Library } from "../src/main/library/store";
import { MetricsStore } from "../src/main/metrics";
import { UsageStore } from "../src/main/usage";
import { cachePrefixFor } from "../src/main/agent/cache";

let root = "";
let library: Library;
let book: BookMeta;

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 12, text: 12, reasoning: undefined }
};

const credential: StoredCredential = {
  id: "conn_test0001",
  provider: "openrouter",
  label: "Test connection",
  kind: "api-key",
  createdAt: "2026-10-25T00:00:00.000Z",
  secret: "sk-test"
};

const anthropicCredential: StoredCredential = { ...credential, provider: "anthropic" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-capabilities-"));
  library = await Library.open(root);
  book = await library.createBook({ title: "The Salt Road" });
  await library.updateBook(book.id, {
    defaultProvider: "openrouter",
    defaultConnectionId: credential.id,
    defaultModelId: "test-model"
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function studioFor(): Studio {
  return { library, requireLibrary: () => library } as unknown as Studio;
}

function providersFor(stored: StoredCredential = credential): ProviderService {
  return {
    credential: async () => stored,
    models: async () => ({
      models: [
        {
          id: "test-model",
          name: "Test Model",
          contextLength: 1_000,
          supportsTools: true,
          supportsImages: false,
          inputPricePerMillion: null,
          outputPricePerMillion: null
        }
      ],
      fetchedAt: "2026-10-25T00:00:00.000Z"
    })
  } as unknown as ProviderService;
}

function textModel(text = "Done."): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            logprobs: undefined,
            usage: USAGE
          }
        ]
      })
    }
  });
}

/** Run one turn and wait for it to finish. */
async function runTurn(
  options: {
    model?: MockLanguageModelV4;
    provider?: StoredCredential;
    metrics?: MetricsStore;
    pluginFolder?: () => string | null;
  } = {},
  prompt = "Go on."
): Promise<{ model: MockLanguageModelV4; done: Extract<AgentEvent, { type: "done" }> }> {
  const model = options.model ?? textModel();
  let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
  let rejectDone!: (error: Error) => void;
  const timer = setTimeout(() => rejectDone(new Error("The mock turn did not finish.")), 5_000);
  const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const agent = new AgentRuntime(
    studioFor(),
    providersFor(options.provider ?? credential),
    (event) => {
      if (event.type === "done") {
        clearTimeout(timer);
        resolveDone(event);
      } else if (event.type === "error") {
        clearTimeout(timer);
        rejectDone(new Error(event.message));
      }
    },
    () => model,
    () => {},
    options.pluginFolder ?? (() => null),
    options.metrics
  );
  await agent.start({ mode: "edit", bookId: book.id, prompt });
  return { model, done: await done };
}

describe("the runtime and the book's own instructions", () => {
  test("gives the model the book's SKILLS.md", async () => {
    await writeFile(join(root, "books", book.id, "SKILLS.md"), "Never use adverbs.", "utf8");
    const { model } = await runTurn();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("Never use adverbs.");
  });

  test("leaves the SKILLS.md out when the author turned it off", async () => {
    await writeFile(join(root, "books", book.id, "SKILLS.md"), "Never use adverbs.", "utf8");
    const { book: current } = await library.readBook(book.id);
    await library.updateBook(book.id, {
      settings: {
        ...current.settings,
        agent: { ...current.settings.agent, skillsEnabled: false }
      }
    });
    const { model } = await runTurn();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain("Never use adverbs.");
  });
});

describe("the runtime and the withdrawn tools", () => {
  test("never offers a tool the author withdrew", async () => {
    const { book: current } = await library.readBook(book.id);
    await library.updateBook(book.id, {
      settings: {
        ...current.settings,
        agent: { ...current.settings.agent, disabledTools: ["overwrite_chapter"] }
      }
    });
    const { model } = await runTurn();
    const offered = model.doStreamCalls[0]?.tools?.map((entry) => entry.name) ?? [];
    expect(offered).not.toContain("overwrite_chapter");
    expect(offered).toContain("append_to_chapter");
  });
});

describe("the runtime and the plugins", () => {
  test("offers the tools the plugin folder provides", async () => {
    const folder = await mkdtemp(join(tmpdir(), "studio-plugins-"));
    await writeFile(
      join(folder, "demo.ts"),
      `export default {
  name: "demo",
  tools: [
    {
      name: "say_hello",
      description: "Say hello to the author.",
      parameters: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
      handler: async (input) => ({ message: "Hello " + input.who })
    }
  ]
};`,
      "utf8"
    );
    const { model } = await runTurn({ pluginFolder: () => folder });
    const offered = model.doStreamCalls[0]?.tools?.map((entry) => entry.name) ?? [];
    expect(offered).toContain("say_hello");
    await rm(folder, { recursive: true, force: true });
  });
});

describe("the runtime and the tool metrics", () => {
  test("records the outcome of every tool call", async () => {
    const chapter = await library.createChapter(book.id, { title: "The Door", content: "The door was open.\n" });
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "read_chapter",
                input: JSON.stringify({ chapterId: chapter.id })
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                logprobs: undefined,
                usage: USAGE
              }
            ]
          })
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "Read it." },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                logprobs: undefined,
                usage: USAGE
              }
            ]
          })
        }
      ]
    });
    const metrics = new MetricsStore(root);
    await runTurn({ model, metrics });
    const summary = await metrics.summary(book.id);
    expect(summary.calls).toBe(1);
    expect(summary.failures).toBe(0);
    expect(summary.tools[0]?.name).toBe("read_chapter");
  });
});

describe("the cache prefix", () => {
  /** The usage log is written after the turn reports itself, so wait for it. */
  async function usageRecords(): Promise<Awaited<ReturnType<UsageStore["read"]>>> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const records = await new UsageStore(root).read(book.id);
      if (records.length > 0) return records;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return [];
  }

  test("records that the provider reported its cache, so a measured zero is not a missing one", async () => {
    const withCache = new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Done." },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 120, noCache: 80, cacheRead: 40, cacheWrite: undefined },
                outputTokens: { total: 12, text: 12, reasoning: undefined }
              }
            }
          ]
        })
      }
    });
    await runTurn({ model: withCache });
    const records = await usageRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.cacheReported).toBe(true);
    expect(records[0]?.cachedInputTokens).toBe(40);
  });

  test("records that a provider reported no cache at all", async () => {
    await runTurn();
    const records = await usageRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.cacheReported).toBeFalsy();
    expect(records[0]?.cachedInputTokens).toBe(0);
  });

  test("marks the stable prefix for a provider that supports it", () => {
    const prefix = cachePrefixFor("anthropic", true);
    expect(prefix.systemProviderOptions).toBeDefined();
    expect(prefix.toolProviderOptions).toBeDefined();
  });

  test("leaves the request alone for a provider that has no marker", () => {
    expect(cachePrefixFor("openrouter", true)).toEqual({});
    expect(cachePrefixFor("anthropic", false)).toEqual({});
  });

  test("puts the marker on the system message and the last tool", async () => {
    const { model } = await runTurn({ provider: anthropicCredential });
    const call = model.doStreamCalls[0];
    const system = call?.prompt?.find((message) => message.role === "system");
    expect(system).toBeDefined();
    expect((system as { providerOptions?: unknown } | undefined)?.providerOptions).toBeDefined();
    const tools = call?.tools ?? [];
    const marked = tools.filter((entry) => (entry as { providerOptions?: unknown }).providerOptions);
    expect(marked.length).toBe(1);
  });

  test("marks nothing when the author turned the prefix off", async () => {
    const { book: current } = await library.readBook(book.id);
    await library.updateBook(book.id, {
      settings: { ...current.settings, cache: { prefixMode: "off" } }
    });
    const { model } = await runTurn({ provider: anthropicCredential });
    const call = model.doStreamCalls[0];
    const system = call?.prompt?.find((message) => message.role === "system");
    expect((system as { providerOptions?: unknown } | undefined)?.providerOptions).toBeUndefined();
    const marked = (call?.tools ?? []).filter(
      (entry) => (entry as { providerOptions?: unknown }).providerOptions
    );
    expect(marked.length).toBe(0);
  });
});
