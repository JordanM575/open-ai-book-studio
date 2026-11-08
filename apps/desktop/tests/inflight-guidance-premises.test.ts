import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { messageText } from "@ai-book-studio/core/agent/messages";
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
  root = await mkdtemp(join(tmpdir(), "studio-guidance-"));
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

function textModel(text: string): MockLanguageModelV4 {
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

/**
 * Spec 031 T003 (in-flight guidance semantics) premises. These pin the facts
 * the no-live-steering decision rests on; they choose nothing. A turn's
 * submitted prompt is fixed in its thread while it runs, and revised guidance
 * travels by stopping and starting a new turn in the same conversation.
 */
describe("in-flight guidance premises", () => {
  test("a running turn's submitted prompt stays fixed in its thread", async () => {
    await library.updateBook(book.id, {
      memories: [{ id: "mem_test0001", text: "The tide.", importance: "low", createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" }]
    });
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
    }, () => memoryApprovalModel());

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Forget the tide gently." });
    await waitForApproval(events, started.turnId);
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread?.messages.map((message) => messageText(message))[0]).toBe("Forget the tide gently.");
    // The only other stored message is the parked approval request, not revised guidance.
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.messages[1]?.parts.find((part) => part.type === "approval")).toMatchObject({
      status: "pending",
      turnId: started.turnId,
      name: "remove_memory"
    });
    const stopped = new Promise<void>((resolve) => {
      const off = runtime.onEvent((event) => { if (event.type === "stopped") { off(); resolve(); } });
    });
    await runtime.stop(started.turnId);
    await stopped;
  });

  test("revised guidance travels by stopping and starting a new turn in the same thread", async () => {
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
    }, () => textModel("Noted."));

    const first = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Summarize the chapter." });
    await waitForDone(events, first.turnId);
    await runtime.stop(first.turnId);
    const second = await runtime.start({ mode: "edit", bookId: book.id, threadId: first.threadId, prompt: "Summarize it briefly." });
    await waitForDone(events, second.turnId);

    expect(second.threadId).toBe(first.threadId);
    expect(second.turnId).not.toBe(first.turnId);
    const thread = await library.threads.read(book.id, first.threadId);
    expect(thread?.messages.map((message) => messageText(message))).toEqual([
      "Summarize the chapter.",
      "Noted.",
      "Summarize it briefly.",
      "Noted."
    ]);
  });
});
