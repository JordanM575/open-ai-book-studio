import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-pause-"));
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

function providersFor(): ProviderService {
  return {
    credential: async () => credential,
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

function textModel(text = "Noted."): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage: USAGE }
        ]
      })
    }
  });
}

function memoryApprovalModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "call-1", toolName: "remove_memory", input: JSON.stringify({ memoryId: "mem_test0001" }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, logprobs: undefined, usage: USAGE }
        ]
      })
    }
  });
}

function waitForDone(events: AgentEvent[], turnId: string): Promise<Extract<AgentEvent, { type: "done" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The done event did not arrive.")), 5_000);
    void (async () => {
      for (let waited = 0; waited < 5_000; waited += 25) {
        const next = events.find(
          (event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done" && event.turnId === turnId
        );
        if (next) {
          clearTimeout(timer);
          resolve(next);
          return;
        }
        await new Promise((pause) => setTimeout(pause, 25));
      }
      clearTimeout(timer);
      reject(new Error("The done event did not arrive."));
    })();
  });
}

function replaceModel(chapterId: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "replace_in_chapter",
              input: JSON.stringify({ chapterId, find: "The old opening.", replace: "The new opening." })
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, logprobs: undefined, usage: USAGE }
          ]
        })
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Sharpened." },
            { type: "text-end", id: "text-1" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined, usage: USAGE }
          ]
        })
      }
    ]
  });
}

function waitForToolStart(events: AgentEvent[], turnId: string, name: string): Promise<Extract<AgentEvent, { type: "tool" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The tool-start event did not arrive.")), 5_000);
    void (async () => {
      for (let waited = 0; waited < 5_000; waited += 25) {
        const next = events.find(
          (event): event is Extract<AgentEvent, { type: "tool" }> =>
            event.type === "tool" && event.turnId === turnId && event.name === name && event.status === "start"
        );
        if (next) {
          clearTimeout(timer);
          resolve(next);
          return;
        }
        await new Promise((pause) => setTimeout(pause, 25));
      }
      clearTimeout(timer);
      reject(new Error("The tool-start event did not arrive."));
    })();
  });
}

function waitForStopped(events: AgentEvent[], turnId: string): Promise<Extract<AgentEvent, { type: "stopped" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The stopped event did not arrive.")), 5_000);
    void (async () => {
      for (let waited = 0; waited < 5_000; waited += 25) {
        const next = events.find(
          (event): event is Extract<AgentEvent, { type: "stopped" }> => event.type === "stopped" && event.turnId === turnId
        );
        if (next) {
          clearTimeout(timer);
          resolve(next);
          return;
        }
        await new Promise((pause) => setTimeout(pause, 25));
      }
      clearTimeout(timer);
      reject(new Error("The stopped event did not arrive."));
    })();
  });
}

function waitForApproval(events: AgentEvent[], turnId: string): Promise<Extract<AgentEvent, { type: "approval" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The approval event did not arrive.")), 5_000);
    void (async () => {
      for (let waited = 0; waited < 5_000; waited += 25) {
        const next = events.find(
          (event): event is Extract<AgentEvent, { type: "approval" }> =>
            event.type === "approval" && event.turnId === turnId
        );
        if (next) {
          clearTimeout(timer);
          resolve(next);
          return;
        }
        await new Promise((pause) => setTimeout(pause, 25));
      }
      clearTimeout(timer);
      reject(new Error("The approval event did not arrive."));
    })();
  });
}

/**
 * Spec 031 T002 (pause acknowledgment and continuation semantics) premises.
 * These pin the terminal-stop facts the pause boundary rests on; they choose
 * nothing. A stopped turn answers no approval — not even to a newer turn —
 * and every start is a new turn that never resurrects a stopped one.
 */
describe("pause boundary premises", () => {
  test("a stopped turn answers nothing, not even to a newer turn", async () => {
    await library.updateBook(book.id, {
      memories: [{ id: "mem_test0001", text: "The tide.", importance: "low", createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" }]
    });
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
    }, () => memoryApprovalModel());

    const first = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Forget the tide." });
    const approval = await waitForApproval(events, first.turnId);
    await runtime.stop(first.turnId);

    await expect(runtime.approve(first.turnId, approval.approvalId, true)).rejects.toThrow(/no longer waiting/);
    const second = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Something else." });
    // Wait until the second turn parks on its own approval: its stream is settled and
    // nothing is still in flight when the test tears the library down.
    await waitForApproval(events, second.turnId);
    await expect(runtime.approve(second.turnId, approval.approvalId, true)).rejects.toThrow(/no longer waiting/);
    await runtime.stop(second.turnId);
  });

  test("a stop during a write waits out the write: the file is never torn and the stop is reported", async () => {
    const chapter = await library.createChapter(book.id, { title: "The Door", content: "The old opening.\n" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalSave = library.saveChapter.bind(library);
    library.saveChapter = (async (...args: Parameters<typeof originalSave>) => {
      await gate;
      return originalSave(...args);
    }) as typeof originalSave;

    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
    }, () => replaceModel(chapter.id));
    try {
      const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Sharpen the opening." });
      await waitForToolStart(events, started.turnId, "replace_in_chapter");
      await runtime.stop(started.turnId);
      release();
      const stopped = await waitForStopped(events, started.turnId);
      expect(stopped.changed).toBe(1);
      expect(stopped.undoAvailable).toBe(true);

      const saved = await library.readChapter(book.id, chapter.id);
      expect(saved.content).toBe("The new opening.\n");
      const thread = await library.threads.read(book.id, started.threadId);
      const tail = thread?.messages.at(-1);
      expect(tail?.parts.some((part) => part.type === "error" && part.code === "stopped")).toBe(true);
    } finally {
      release();
    }
  });

  test("every start is a new turn; stopping never blocks the next one", async () => {
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
    }, () => textModel());

    const first = await runtime.start({ mode: "edit", bookId: book.id, prompt: "First." });
    await waitForDone(events, first.turnId);
    const second = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Second." });
    expect(second.turnId).not.toBe(first.turnId);
    await expect(runtime.stop(first.turnId)).resolves.toBeNull();
    await waitForDone(events, second.turnId);
    const thread = await library.threads.read(book.id, second.threadId);
    expect(thread?.messages.length).toBeGreaterThan(0);
  });
});
