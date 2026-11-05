import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError, ToolLoopAgent, isStepCount, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { messageText, type AgentApprovalPart } from "@ai-book-studio/core/agent/messages";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { BookMeta } from "@ai-book-studio/core/schema";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime, type AgentOutcome } from "../src/main/agent/runtime";
import { createChapterTools } from "../src/main/agent/tools";
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

/*
 * Each test races its events against a five-second deadline, and the deadlines are cleared after every
 * test. One that outlived its test would reject a promise nobody awaits any more, and bun charges that
 * rejection to whichever test in another file is running when it fires.
 */
const deadlines = new Set<ReturnType<typeof setTimeout>>();

function deadline(reject: (error: Error) => void, message: string): void {
  deadlines.add(setTimeout(() => reject(new Error(message)), 5_000));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-runtime-"));
  library = await Library.open(root);
  book = await library.createBook({ title: "The Salt Road" });
  await library.updateBook(book.id, {
    defaultProvider: "openrouter",
    defaultConnectionId: credential.id,
    defaultModelId: "test-model"
  });
});

afterEach(async () => {
  for (const timer of deadlines) clearTimeout(timer);
  deadlines.clear();
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
        },
        {
          id: "override-model",
          name: "Override Model",
          contextLength: 2_000,
          supportsTools: true,
          supportsImages: false,
          inputPricePerMillion: null,
          outputPricePerMillion: null
        },
        {
          id: "muse-spark-1.3-contributor",
          name: "Muse Spark 1.3 Contributor",
          contextLength: 1_048_576,
          supportsTools: true,
          supportsImages: true,
          inputPricePerMillion: 0.1,
          outputPricePerMillion: 0.2,
          trainingOnData: true
        }
      ],
      fetchedAt: "2026-10-25T00:00:00.000Z"
    })
  } as unknown as ProviderService;
}

function textModel(text = "I tightened the opening.", cost?: number): MockLanguageModelV4 {
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
            usage: USAGE,
            ...(cost !== undefined
              ? { providerMetadata: { openrouter: { usage: { cost } } } }
              : {})
          }
        ]
      })
    }
  });
}

function approvalModel(reply: string, toolName: string, input: Record<string, unknown>): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-approval",
              toolName,
              input: JSON.stringify(input)
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
            { type: "text-delta", id: "text-1", delta: reply },
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
}

function twoStepReadModel(chapterId: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-read",
              toolName: "read_chapter",
              input: JSON.stringify({ chapterId })
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 5, text: 0, reasoning: 5 }
              },
              providerMetadata: { openrouter: { usage: { cost: 0.0004 } } }
            }
          ]
        })
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "I read it first." },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 7, text: 7, reasoning: undefined }
              },
              providerMetadata: { openrouter: { usage: { cost: 0.0012 } } }
            }
          ]
        })
      }
    ]
  });
}

const MEMORY = {
  id: "mem_test0001",
  text: "The tide comes in fast.",
  importance: "high" as const,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z"
};

function approvalRuntime(model: MockLanguageModelV4): {
  runtime: AgentRuntime;
  approval: Promise<Extract<AgentEvent, { type: "approval" }>>;
  done: Promise<Extract<AgentEvent, { type: "done" }>>;
} {
  let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
  let rejectApproval!: (error: Error) => void;
  let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
  let rejectDone!: (error: Error) => void;
  const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve, reject) => {
    resolveApproval = resolve;
    rejectApproval = reject;
    deadline(reject, "The approval request did not arrive.");
  });
  const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
    deadline(reject, "The approved turn did not finish.");
  });
  const runtime = new AgentRuntime(
    studioFor(),
    providersFor(),
    (event) => {
      if (event.type === "approval") resolveApproval(event);
      if (event.type === "done") resolveDone(event);
      if (event.type === "error") {
        rejectApproval(new Error(event.message));
        rejectDone(new Error(event.message));
      }
    },
    () => model
  );
  return { runtime, approval, done };
}

function createChapter(content = "The old opening.\n"): ReturnType<Library["createChapter"]> {
  return library.createChapter(book.id, { title: "The Door", content });
}

/** An exchange the author had earlier in the conversation, before the turn under test. */
const HISTORY = [
  { role: "user" as const, text: "Who keeps the lighthouse?" },
  { role: "assistant" as const, text: "Mara keeps it, since the second chapter." }
];

type ModelPrompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];

/** One line per message the provider received: its role and what it carried. */
function transcript(prompt: ModelPrompt): string[] {
  return prompt.map((message) => {
    if (message.role === "system") return "system";
    const parts: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") parts.push(part.text);
      else if (part.type === "tool-call") parts.push(`call ${part.toolName}`);
      else if (part.type === "tool-result") parts.push(`result ${part.toolName} (${part.output.type})`);
      else parts.push(part.type);
    }
    return `${message.role}: ${parts.join(" · ")}`;
  });
}

describe("agent runtime contract", () => {
  test("refuses a contributor model until the book opts in", async () => {
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      () => {},
      () => textModel(),
      () => {}
    );
    await expect(
      runtime.start({
        mode: "edit",
        bookId: book.id,
        prompt: "Plan the next scene.",
        model: { connectionId: credential.id, modelId: "muse-spark-1.3-contributor" }
      })
    ).rejects.toMatchObject({
      code: "invalid-request",
      message: expect.stringMatching(/Contributor training/)
    });
  });

  test("persists a text turn and its usage without a provider call", async () => {
    const events: AgentEvent[] = [];
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      timer = setTimeout(() => reject(new Error("The mock turn did not finish.")), 5_000);
    });
    const model = textModel("I tightened the opening.", 0.0012);
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        events.push(event);
        if (event.type === "done") {
          clearTimeout(timer);
          resolveDone(event);
        } else if (event.type === "error") {
          clearTimeout(timer);
          rejectDone(new Error(event.message));
        }
      },
      (stored, modelId) => {
        expect(stored.id).toBe(credential.id);
        expect(modelId).toBe("test-model");
        return model;
      }
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Tighten the opening." });
    const finished = await done;

    expect(finished.text).toBe("I tightened the opening.");
    expect(finished.costUsd).toBe(0.0012);
    expect(finished.costBasis).toBe("reported");
    expect(finished.contextLength).toBe(1_000);
    expect(finished.context.estimated).toBe(true);
    expect(finished.context.sections.length).toBeGreaterThan(0);
    expect(finished.context.totalTokens).toBeGreaterThan(0);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("Tighten the opening.");

    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messageText(thread!.messages[0]!)).toBe("Tighten the opening.");
    expect(messageText(thread!.messages[1]!)).toBe("I tightened the opening.");
    expect(thread!.messages[1]!.usage?.inputTokens).toBe(120);
    expect(thread!.messages[1]!.usage?.outputTokens).toBe(12);
    expect(thread!.messages[1]!.usage?.costUsd).toBe(0.0012);
    expect(thread!.messages[1]!.usage?.costBasis).toBe("reported");
    expect(thread!.messages[1]!.usage?.contextLength).toBe(1_000);
    expect(thread!.messages[1]!.context?.totalTokens).toBe(finished.context.totalTokens);
    expect(thread!.messages[1]!.turnId).toBe(started.turnId);
    expect(events.some((event) => event.type === "text")).toBe(true);
  });

  function rateLimitModel(header: string): MockLanguageModelV4 {
    return new MockLanguageModelV4({
      doStream: (async () => {
        throw new APICallError({
          message: "Rate limit exceeded",
          url: "https://openrouter.ai/api/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 429,
          responseHeaders: { "retry-after": header },
          responseBody: "Rate limit exceeded",
          isRetryable: true
        });
      }) as MockLanguageModelV4["doStream"]
    });
  }

  function failureRuntime(model: MockLanguageModelV4): {
    runtime: AgentRuntime;
    approval: Promise<Extract<AgentEvent, { type: "approval" }>>;
    failed: Promise<Extract<AgentEvent, { type: "error" }>>;
  } {
    let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
    let resolveFailed!: (event: Extract<AgentEvent, { type: "error" }>) => void;
    let rejectFailed!: (error: Error) => void;
    const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve, reject) => {
      resolveApproval = resolve;
      deadline(reject, "The approval request did not arrive.");
    });
    const failed = new Promise<Extract<AgentEvent, { type: "error" }>>((resolve, reject) => {
      resolveFailed = resolve;
      rejectFailed = reject;
      deadline(reject, "The limited turn reported nothing.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") resolveApproval(event);
        else if (event.type === "error") resolveFailed(event);
        else if (event.type === "done") rejectFailed(new Error("The limited turn should not finish."));
      },
      () => model
    );
    return { runtime, approval, failed };
  }

  test("a rate-limited turn fails once with the provider's wait", async () => {
    const model = rateLimitModel("90");
    const { runtime, failed } = failureRuntime(model);

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Keep going." });
    const failure = await failed;

    // No retry loop: one provider request, one failure.
    expect(model.doStreamCalls).toHaveLength(1);
    expect(failure.code).toBe("rate-limit");
    expect(failure.retryAfterSeconds).toBe(90);
    // A turn that never wrote an assistant message stores nothing to retry from.
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread?.messages.map((message) => message.role)).toEqual(["user"]);
  });

  test("a resumed turn that hits the limit stores the wait with the failure", async () => {
    const chapter = await createChapter();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: (async () => {
        calls += 1;
        if (calls > 1) {
          throw new APICallError({
            message: "Rate limit exceeded",
            url: "https://openrouter.ai/api/v1/chat/completions",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { "retry-after": "120" },
            responseBody: "Rate limit exceeded",
            isRetryable: true
          });
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-overwrite",
                toolName: "overwrite_chapter",
                input: JSON.stringify({ chapterId: chapter.id, content: "A new opening.\n" })
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                logprobs: undefined,
                usage: USAGE
              }
            ]
          })
        };
      }) as MockLanguageModelV4["doStream"]
    });
    const { runtime, approval, failed } = failureRuntime(model);

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace the opening." });
    const request = await approval;
    expect(request.name).toBe("overwrite_chapter");
    await runtime.approve(started.turnId, request.approvalId, true);
    const failure = await failed;

    // One request per attempt: the first turn and the approved resume, never a retry loop.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(failure.code).toBe("rate-limit");
    expect(failure.retryAfterSeconds).toBe(120);
    const thread = await library.threads.read(book.id, started.threadId);
    const assistant = thread!.messages.find((message) => message.role === "assistant");
    expect(assistant!.parts.find((part) => part.type === "error")).toMatchObject({
      code: "rate-limit",
      retryAfterSeconds: 120
    });
  });

  test("records the catalogue's display name with the turn", async () => {
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      timer = setTimeout(() => reject(new Error("The mock turn did not finish.")), 5_000);
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "done") {
          clearTimeout(timer);
          resolveDone(event);
        } else if (event.type === "error") {
          clearTimeout(timer);
          rejectDone(new Error(event.message));
        }
      },
      () => textModel("A line.")
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Say something." });
    const finished = await done;

    expect(finished.model).toMatchObject({
      modelId: "test-model",
      connectionLabel: "Test connection",
      name: "Test Model"
    });
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread!.messages[1]!.model).toMatchObject({ modelId: "test-model", name: "Test Model" });
  });

  test("a turn that changed chapters saves its checkpoint before reporting the failure", async () => {
    const chapter = await createChapter();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: (async () => {
        calls += 1;
        if (calls > 1) throw new Error("The model stopped mid-reply.");
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-overwrite",
                toolName: "overwrite_chapter",
                input: JSON.stringify({ chapterId: chapter.id, content: "A new opening.\n" })
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                logprobs: undefined,
                usage: USAGE
              }
            ]
          })
        };
      }) as MockLanguageModelV4["doStream"]
    });
    const { runtime, approval, failed } = failureRuntime(model);

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace the opening." });
    const request = await approval;
    expect(request.name).toBe("overwrite_chapter");
    await runtime.approve(started.turnId, request.approvalId, true);
    const failure = await failed;

    // The approved overwrite ran, then the resume failed: one request per attempt.
    expect(model.doStreamCalls).toHaveLength(2);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("A new opening.\n");
    expect(failure.changed).toBe(1);
    expect(failure.undoAvailable).toBe(true);
    const thread = await library.threads.read(book.id, started.threadId);
    const assistant = thread!.messages.find((message) => message.role === "assistant");
    expect(assistant!.parts.some((part) => part.type === "error")).toBe(true);

    // The checkpoint went down before the error, so one undo restores the chapter.
    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(1);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
  });

  test("totals price and tokens across every step of a turn", async () => {
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      timer = setTimeout(() => reject(new Error("The mock turn did not finish.")), 5_000);
    });
    const chapter = await createChapter("The old opening.\n");
    const model = twoStepReadModel(chapter.id);
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "done") {
          clearTimeout(timer);
          resolveDone(event);
        } else if (event.type === "error") {
          clearTimeout(timer);
          rejectDone(new Error(event.message));
        }
      },
      () => model
    );

    const started = await runtime.start({
      mode: "edit",
      bookId: book.id,
      prompt: "Read the opening, then tighten it."
    });
    const finished = await done;

    // Both provider steps ran: a read, then the reply.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(finished.text).toBe("I read it first.");
    // Tokens accumulate across both steps, not just the last one.
    expect(finished.inputTokens).toBe(120);
    expect(finished.outputTokens).toBe(12);
    // Each step reported its own price; the turn costs the sum.
    expect(finished.costUsd).toBeCloseTo(0.0016, 10);
    expect(finished.costBasis).toBe("reported");

    const thread = await library.threads.read(book.id, started.threadId);
    const assistant = thread!.messages.find((message) => message.role === "assistant");
    expect(assistant!.usage?.inputTokens).toBe(120);
    expect(assistant!.usage?.outputTokens).toBe(12);
    expect(assistant!.usage?.costUsd).toBeCloseTo(0.0016, 10);
    expect(assistant!.usage?.costBasis).toBe("reported");
  });

  test("uses a one-off model without changing the book default", async () => {
    const seen: string[] = [];
    const model = textModel("The other model answered.");
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      deadline(reject, "The override turn did not finish.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "done") resolveDone(event);
        if (event.type === "error") rejectDone(new Error(event.message));
      },
      (_credential, modelId) => {
        seen.push(modelId);
        return model;
      }
    );

    const started = await runtime.start({
      mode: "edit",
      bookId: book.id,
      prompt: "Use the other model.",
      model: { connectionId: credential.id, modelId: "override-model" }
    });
    const finished = await done;

    expect(seen).toEqual(["override-model"]);
    expect(finished.model.modelId).toBe("override-model");
    expect(finished.contextLength).toBe(2_000);
    expect((await library.readBook(book.id)).book.defaultModelId).toBe("test-model");
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread!.messages.at(-1)!.model?.modelId).toBe("override-model");
  });

  test("refuses a one-off model that the connection no longer offers", async () => {
    const runtime = new AgentRuntime(studioFor(), providersFor(), () => {}, () => textModel());

    await expect(
      runtime.start({
        mode: "edit",
        bookId: book.id,
        prompt: "Use a missing model.",
        model: { connectionId: credential.id, modelId: "missing-model" }
      })
    ).rejects.toThrow("no longer offered");
  });

  test("waits for approval before removing a memory", async () => {
    await library.updateBook(book.id, { memories: [MEMORY] });
    const model = approvalModel("The memory is gone.", "remove_memory", { memoryId: MEMORY.id });
    let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
    let rejectApproval!: (error: Error) => void;
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve, reject) => {
      resolveApproval = resolve;
      rejectApproval = reject;
      deadline(reject, "The approval request did not arrive.");
    });
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      deadline(reject, "The approved turn did not finish.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") resolveApproval(event);
        if (event.type === "done") resolveDone(event);
        if (event.type === "error") {
          rejectApproval(new Error(event.message));
          rejectDone(new Error(event.message));
        }
      },
      () => model
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Remove the tide memory." });
    const request = await approval;
    expect(request.name).toBe("remove_memory");
    expect((await library.readBook(book.id)).book.memories).toHaveLength(1);
    const paused = await library.threads.read(book.id, started.threadId);
    const pausedMessage = paused!.messages.at(-1)!;
    expect(pausedMessage.parts.find((part) => part.type === "approval")).toMatchObject({
      type: "approval",
      approvalId: request.approvalId,
      name: "remove_memory",
      status: "pending"
    });

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("The memory is gone.");
    expect((await library.readBook(book.id)).book.memories).toHaveLength(0);
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread!.messages).toHaveLength(2);
    expect(thread!.messages.at(-1)!.id).toBe(pausedMessage.id);
    expect(messageText(thread!.messages.at(-1)!)).toBe("The memory is gone.");
    expect(thread!.messages.at(-1)!.parts.find((part) => part.type === "approval")).toMatchObject({
      status: "approved"
    });
  });

  test("keeps the memory when the author denies the approval", async () => {
    await library.updateBook(book.id, { memories: [MEMORY] });
    const model = approvalModel("I left the memory alone.", "remove_memory", { memoryId: MEMORY.id });
    let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve, reject) => {
      resolveApproval = resolve;
      deadline(reject, "The approval request did not arrive.");
    });
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      deadline(reject, "The denied turn did not finish.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") resolveApproval(event);
        if (event.type === "done") resolveDone(event);
        if (event.type === "error") rejectDone(new Error(event.message));
      },
      () => model
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Remove the tide memory." });
    const request = await approval;
    await runtime.approve(started.turnId, request.approvalId, false);
    const finished = await done;

    expect(finished.text).toBe("I left the memory alone.");
    expect((await library.readBook(book.id)).book.memories).toHaveLength(1);
    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread!.messages.at(-1)!.parts.find((part) => part.type === "approval")).toMatchObject({
      status: "denied"
    });
  });

  test("an approved resume resends the conversation before the call and its approval", async () => {
    const chapter = await createChapter();
    const model = approvalModel("I replaced the opening.", "overwrite_chapter", {
      chapterId: chapter.id,
      content: "A new opening.\n"
    });
    const { runtime, approval, done } = approvalRuntime(model);

    const prompt = "Replace the opening, then tell me what you changed.";
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt, history: HISTORY });
    const request = await approval;
    await runtime.approve(started.turnId, request.approvalId, true);
    await done;

    expect(model.doStreamCalls).toHaveLength(2);
    const [asked = [], resumed = []] = model.doStreamCalls.map((call) => call.prompt);
    expect(transcript(asked)).toEqual([
      "system",
      "user: Who keeps the lighthouse?",
      "assistant: Mara keeps it, since the second chapter.",
      `user: ${prompt}`
    ]);
    // The resume is the same conversation, message for message, then the call and what it did.
    expect(resumed.slice(0, asked.length)).toEqual(asked);
    expect(transcript(resumed.slice(asked.length))).toEqual([
      "assistant: call overwrite_chapter",
      "tool: result overwrite_chapter (json)"
    ]);
    expect(resumed.at(-1)).toMatchObject({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-approval", output: { type: "json", value: { ok: true } } }]
    });
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("A new opening.\n");
  });

  test("a running background turn names its conversation and open chapter for a reopened window", async () => {
    const chapter = await createChapter();
    const model = approvalModel("I left the opening as it was.", "overwrite_chapter", {
      chapterId: chapter.id,
      content: "A new opening.\n"
    });
    const outcomes: AgentOutcome[] = [];
    let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve, reject) => {
      resolveApproval = resolve;
      deadline(reject, "The approval request did not arrive.");
    });
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      deadline(reject, "The background turn did not finish.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") resolveApproval(event);
        if (event.type === "done") resolveDone(event);
      },
      () => model,
      (outcome) => outcomes.push(outcome)
    );

    const started = await runtime.start({
      mode: "edit",
      bookId: book.id,
      chapterId: chapter.id,
      prompt: "Replace the opening.",
      background: true
    });
    const request = await approval;

    // Still running, paused for approval: this is what the shell remembers when the window closes.
    expect(runtime.activeBackgroundTurns()).toEqual([
      { bookId: book.id, threadId: started.threadId, chapterId: chapter.id }
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: "approval", threadId: started.threadId, chapterId: chapter.id })
    ]);

    await runtime.approve(started.turnId, request.approvalId, false);
    await done;
    expect(outcomes.at(-1)).toMatchObject({ kind: "done", threadId: started.threadId, chapterId: chapter.id });
    // The turn leaves the running list once its end has been recorded, just after the done event.
    for (let waited = 0; runtime.activeBackgroundTurns().length > 0 && waited < 100; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(runtime.activeBackgroundTurns()).toEqual([]);
  });

  test("a denied resume resends the conversation, writes nothing and reports plainly", async () => {
    const before = await library.readChapter(book.id, (await createChapter()).id);
    const model = approvalModel("I left the opening as it was.", "overwrite_chapter", {
      chapterId: before.id,
      content: "A new opening.\n"
    });
    const { runtime, approval, done } = approvalRuntime(model);

    const prompt = "Replace the opening, then tell me what you changed.";
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt, history: HISTORY });
    const request = await approval;
    await runtime.approve(started.turnId, request.approvalId, false);
    const finished = await done;

    // Nothing was written: the same bytes and version, and no turn to undo.
    const after = await library.readChapter(book.id, before.id);
    expect(after.content).toBe("The old opening.\n");
    expect(after.version).toBe(before.version);
    expect(after.hash).toBe(before.hash);
    await expect(runtime.undoLast(book.id)).rejects.toThrow("no agent turn to undo");
    expect(finished.text).toBe("I left the opening as it was.");
    expect(finished.changed).toBe(0);

    // The model still hears the whole conversation, then the denial where a result would be.
    const [asked = [], resumed = []] = model.doStreamCalls.map((call) => call.prompt);
    expect(resumed.slice(0, asked.length)).toEqual(asked);
    expect(transcript(resumed.slice(asked.length))).toEqual([
      "assistant: call overwrite_chapter",
      "tool: result overwrite_chapter (execution-denied)"
    ]);
    expect(resumed.at(-1)).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-approval",
          output: { type: "execution-denied", reason: "Denied by the author." }
        }
      ]
    });

    const answer = (await library.threads.read(book.id, started.threadId))?.messages.at(-1);
    expect(answer && messageText(answer)).toBe("I left the opening as it was.");
    expect(answer?.parts.find((part) => part.type === "approval")).toMatchObject({ status: "denied" });
    expect(answer?.parts.some((part) => part.type === "error")).toBe(false);
  });

  test("a second approval in one turn resends everything and runs each call once", async () => {
    const chapter = await createChapter("One.\nTwo.\nThree.\n");
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-overwrite",
                toolName: "overwrite_chapter",
                input: JSON.stringify({ chapterId: chapter.id, content: "One.\nTwo.\nThree.\nFour.\n" })
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                logprobs: undefined,
                usage: USAGE,
                providerMetadata: { openrouter: { usage: { cost: 0.001 } } }
              }
            ]
          })
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-delete",
                toolName: "delete_lines_in_chapter",
                input: JSON.stringify({ chapterId: chapter.id, startLine: 1, endLine: 1 })
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                logprobs: undefined,
                usage: USAGE,
                providerMetadata: { openrouter: { usage: { cost: 0.002 } } }
              }
            ]
          })
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "I added a fourth line and cut the first." },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                logprobs: undefined,
                usage: USAGE,
                providerMetadata: { openrouter: { usage: { cost: 0.004 } } }
              }
            ]
          })
        }
      ]
    });
    const answers: Array<{
      resolve: (event: Extract<AgentEvent, { type: "approval" }>) => void;
      reject: (error: Error) => void;
    }> = [];
    const nextApproval = (message: string): Promise<Extract<AgentEvent, { type: "approval" }>> =>
      new Promise((resolve, reject) => {
        answers.push({ resolve, reject });
        deadline(reject, message);
      });
    const firstAsked = nextApproval("The first approval request did not arrive.");
    const secondAsked = nextApproval("The second approval request did not arrive.");
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      deadline(reject, "The twice-approved turn did not finish.");
    });
    const ran: string[] = [];
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") answers.shift()?.resolve(event);
        if (event.type === "tool" && event.status === "end") ran.push(event.id);
        if (event.type === "done") resolveDone(event);
        if (event.type === "error") {
          for (const answer of answers.splice(0)) answer.reject(new Error(event.message));
          rejectDone(new Error(event.message));
        }
      },
      () => model
    );

    const prompt = "Add a fourth line, then cut the first.";
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt, history: HISTORY });
    await runtime.approve(started.turnId, (await firstAsked).approvalId, true);
    await runtime.approve(started.turnId, (await secondAsked).approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I added a fourth line and cut the first.");
    // Usage and price are the sum of all three legs, not the last one's alone.
    expect(finished.inputTokens).toBe(360);
    expect(finished.outputTokens).toBe(36);
    expect(finished.costUsd).toBeCloseTo(0.007, 10);
    // Each approved call ran once: the second resume did not replay the first approval.
    expect(ran).toEqual(["call-overwrite", "call-delete"]);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("Two.\nThree.\nFour.\n");

    // Every resume carries the conversation so far, so the last request holds all of it, in order.
    expect(model.doStreamCalls).toHaveLength(3);
    const [asked = [], afterFirst = [], afterSecond = []] = model.doStreamCalls.map((call) => call.prompt);
    expect(afterFirst.slice(0, asked.length)).toEqual(asked);
    expect(afterSecond.slice(0, afterFirst.length)).toEqual(afterFirst);
    expect(transcript(afterSecond)).toEqual([
      "system",
      "user: Who keeps the lighthouse?",
      "assistant: Mara keeps it, since the second chapter.",
      `user: ${prompt}`,
      "assistant: call overwrite_chapter",
      "tool: result overwrite_chapter (json)",
      "assistant: call delete_lines_in_chapter",
      "tool: result delete_lines_in_chapter (json)"
    ]);

    // One turn, one undo: the checkpoint holds the chapter as it was before the first approval.
    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(1);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("One.\nTwo.\nThree.\n");
  });

  test("an approval never carries over to the next turn", async () => {
    const chapter = await createChapter();
    const first = approvalModel("I replaced the opening.", "overwrite_chapter", {
      chapterId: chapter.id,
      content: "A new opening.\n"
    });
    const second = approvalModel("Unused.", "overwrite_chapter", {
      chapterId: chapter.id,
      content: "Another opening.\n"
    });
    const models = [first, second];
    const answers: Array<(event: Extract<AgentEvent, { type: "approval" }>) => void> = [];
    const nextApproval = (message: string): Promise<Extract<AgentEvent, { type: "approval" }>> =>
      new Promise((resolve, reject) => {
        answers.push(resolve);
        deadline(reject, message);
      });
    const firstAsked = nextApproval("The first turn's approval request did not arrive.");
    const secondAsked = nextApproval("The next turn's approval request did not arrive.");
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      deadline(reject, "The first turn did not finish.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "approval") answers.shift()?.(event);
        if (event.type === "done") resolveDone(event);
      },
      () => {
        const next = models.shift();
        if (!next) throw new Error("No model is left for this turn.");
        return next;
      }
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace the opening." });
    const approved = await firstAsked;
    await runtime.approve(started.turnId, approved.approvalId, true);
    await done;
    const afterFirst = await library.readChapter(book.id, chapter.id);
    expect(afterFirst.content).toBe("A new opening.\n");

    const next = await runtime.start({
      mode: "edit",
      bookId: book.id,
      threadId: started.threadId,
      prompt: "Now replace it again."
    });
    // The same destructive call in a new turn asks again, and nothing runs while it waits.
    const asked = await secondAsked;
    expect(asked.turnId).toBe(next.turnId);
    expect(asked.approvalId).not.toBe(approved.approvalId);
    const waiting = await library.readChapter(book.id, chapter.id);
    expect(waiting.version).toBe(afterFirst.version);
    expect(waiting.hash).toBe(afterFirst.hash);
    // The new turn hears the earlier one as text: no tool call, result or approval comes with it.
    expect(transcript(second.doStreamCalls[0]?.prompt ?? [])).toEqual([
      "system",
      "user: Replace the opening.",
      "assistant: I replaced the opening.",
      "user: Now replace it again."
    ]);

    await runtime.stop(next.turnId);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("A new opening.\n");
    expect(second.doStreamCalls).toHaveLength(1);
  });

  test("expires a waiting approval when the author stops the turn", async () => {
    await library.updateBook(book.id, { memories: [MEMORY] });
    const model = approvalModel("Unused.", "remove_memory", { memoryId: MEMORY.id });
    let resolveApproval!: (event: Extract<AgentEvent, { type: "approval" }>) => void;
    const approval = new Promise<Extract<AgentEvent, { type: "approval" }>>((resolve) => {
      resolveApproval = resolve;
    });
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        events.push(event);
        if (event.type === "approval") resolveApproval(event);
      },
      () => model
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Remove the tide memory." });
    await approval;
    await runtime.stop(started.turnId);

    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread?.messages.at(-1)?.parts.find((part) => part.type === "approval")).toMatchObject({
      status: "expired"
    });
    expect(events.some((event) => event.type === "stopped")).toBe(true);
  });

  test("a previous run's approval never resumes and expires with an explanation", async () => {
    await library.updateBook(book.id, { memories: [MEMORY] });
    const first = approvalRuntime(approvalModel("Unused.", "remove_memory", { memoryId: MEMORY.id }));
    // The abandoned turn never finishes, so its done timer is disarmed, not awaited.
    first.done.catch(() => {});
    const started = await first.runtime.start({ mode: "edit", bookId: book.id, prompt: "Remove the tide memory." });
    const request = await first.approval;
    // Simulate the app closing with the approval unanswered: the first runtime is dropped and
    // nothing ever stops its turn.

    const second = approvalRuntime(textModel("A fresh answer."));
    // The old turn is gone: answering it explains instead of resuming.
    await expect(second.runtime.approve(started.turnId, request.approvalId, true)).rejects.toThrow(
      /no longer waiting/i
    );
    // A new turn on the same thread expires the zombie and runs fresh.
    await second.runtime.start({
      mode: "edit",
      bookId: book.id,
      threadId: started.threadId,
      prompt: "Say something new."
    });
    const finished = await second.done;
    expect(finished.text).toBe("A fresh answer.");

    const thread = await library.threads.read(book.id, started.threadId);
    const zombie = thread!.messages
      .flatMap((message) => message.parts)
      .find(
        (part): part is AgentApprovalPart =>
          part.type === "approval" && part.approvalId === request.approvalId
      );
    expect(zombie).toMatchObject({ status: "expired" });
    expect(zombie?.resolvedAt).toBeTruthy();
    expect((await library.readBook(book.id)).book.memories).toHaveLength(1);
  });

  test("waits for approval before overwriting a chapter and can undo it", async () => {
    const chapter = await createChapter();
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I replaced the opening.", "overwrite_chapter", {
        chapterId: chapter.id,
        content: "A new opening.\n"
      })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace the opening." });
    const request = await approval;
    expect(request.name).toBe("overwrite_chapter");
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I replaced the opening.");
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("A new opening.\n");
    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(1);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
  });

  test("typing during a live turn stays in the chapter when the overwrite is approved", async () => {
    const chapter = await createChapter();
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("The opening changed while I waited, so I left it.", "overwrite_chapter", {
        chapterId: chapter.id,
        content: "A new opening.\n"
      })
    );

    // The author's editor buffer was loaded before the turn started.
    const buffer = await library.readChapter(book.id, chapter.id);

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace the opening." });
    const request = await approval;
    // The turn is live and waiting; the author types and saves against the pre-turn version.
    expect(runtime.isWorking(book.id)).toBe(true);
    const typed = await library.saveChapter(book.id, chapter.id, "The old opening. Author typing.\n", {
      baseVersion: buffer.version,
      baseHash: buffer.hash
    });
    expect(typed.status).toBe("saved");

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    // Nothing the author typed leaves the chapter. The overwrite was made against the text the
    // author was asked about, so the checked save kept it as a conflict copy instead.
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening. Author typing.\n");
    expect(finished.changed).toBe(0);
    const conflicts = await library.listConflicts(book.id);
    expect(conflicts.map((conflict) => conflict.savedAs)).toEqual([
      expect.stringMatching(new RegExp(`^books/${book.id}/conflicts/0001-the-door\\.conflict-newer-version\\.`))
    ]);
    expect(await readFile(join(root, conflicts[0]?.savedAs ?? ""), "utf8")).toContain("A new opening.");
    // The turn changed nothing, so undo has nothing of it to take back.
    await expect(runtime.undoLast(book.id)).rejects.toThrow("no agent turn to undo");
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening. Author typing.\n");
  });

  test("waits for approval before deleting a chapter", async () => {
    const chapter = await createChapter();
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I moved it to the trash.", "delete_chapter", { chapterId: chapter.id })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Delete the chapter." });
    const request = await approval;
    expect(request.name).toBe("delete_chapter");
    await expect(library.readChapter(book.id, chapter.id)).resolves.toBeDefined();

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I moved it to the trash.");
    await expect(library.readChapter(book.id, chapter.id)).rejects.toBeDefined();
  });

  test("waits for approval before deleting lines", async () => {
    const chapter = await createChapter("One.\nTwo.\nThree.\n");
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I deleted that line.", "delete_lines_in_chapter", {
        chapterId: chapter.id,
        startLine: 2,
        endLine: 2
      })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Delete the middle line." });
    const request = await approval;
    expect(request.name).toBe("delete_lines_in_chapter");
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("One.\nTwo.\nThree.\n");

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I deleted that line.");
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("One.\nThree.\n");
  });

  test("waits for approval before moving a chapter", async () => {
    const first = await createChapter("One.\n");
    await library.createChapter(book.id, { title: "Two", content: "Two.\n" });
    await library.createChapter(book.id, { title: "Three", content: "Three.\n" });
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I moved it to the end.", "move_chapter", { chapterId: first.id, position: 3 })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Move the first chapter to the end." });
    const request = await approval;
    expect(request.name).toBe("move_chapter");
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual([
      "The Door",
      "Two",
      "Three"
    ]);

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I moved it to the end.");
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual([
      "Two",
      "Three",
      "The Door"
    ]);
  });

  test("waits for approval before splitting and undo removes the new chapter", async () => {
    const chapter = await createChapter("One.\nTwo.\nThree.\n");
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I split the chapter.", "split_chapter", { chapterId: chapter.id, line: 2 })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Split the chapter." });
    const request = await approval;
    expect(request.name).toBe("split_chapter");
    expect((await library.readBook(book.id)).chapters).toHaveLength(1);

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I split the chapter.");
    const split = await library.readBook(book.id);
    expect(split.chapters).toHaveLength(2);
    expect(split.chapters.map((entry) => entry.content)).toEqual(["One.\n", "Two.\nThree.\n"]);

    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(2);
    const restored = await library.readBook(book.id);
    expect(restored.chapters).toHaveLength(1);
    expect(restored.chapters[0]?.content).toBe("One.\nTwo.\nThree.\n");
  });

  test("waits for approval before merging and undo restores both chapters", async () => {
    const first = await createChapter("One.\n");
    const second = await library.createChapter(book.id, { title: "Two", content: "Two.\n" });
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I merged the chapters.", "merge_chapters", {
        firstChapterId: first.id,
        secondChapterId: second.id
      })
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Merge the two chapters." });
    const request = await approval;
    expect(request.name).toBe("merge_chapters");
    expect((await library.readBook(book.id)).chapters).toHaveLength(2);

    await runtime.approve(started.turnId, request.approvalId, true);
    const finished = await done;

    expect(finished.text).toBe("I merged the chapters.");
    const merged = await library.readBook(book.id);
    expect(merged.chapters).toHaveLength(1);
    expect(merged.chapters[0]?.content).toBe("One.\n\nTwo.\n");

    const undone = await runtime.undoLast(book.id);
    expect(undone.restored).toBe(2);
    const restored = await library.readBook(book.id);
    expect(restored.chapters).toHaveLength(2);
    expect(restored.chapters.map((entry) => entry.content)).toEqual(["One.\n", "Two.\n"]);
  });

  test("explains a context overflow with the model limit and remedies", async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("This model's maximum context length was exceeded.") }
          ]
        })
      }
    });
    let resolveError!: (event: Extract<AgentEvent, { type: "error" }>) => void;
    const failed = new Promise<Extract<AgentEvent, { type: "error" }>>((resolve, reject) => {
      resolveError = resolve;
      deadline(reject, "The context error did not arrive.");
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "error") resolveError(event);
      },
      () => model
    );

    await runtime.start({ mode: "edit", bookId: book.id, prompt: "Continue the chapter." });
    const error = await failed;

    expect(error.code).toBe("context");
    expect(error.message).toContain("1,000 tokens");
    expect(error.message).toContain("Choose a larger model");
  });

  test("runs a tool call through the same ToolLoopAgent", async () => {
    const chapter = await library.createChapter(book.id, {
      title: "The Door",
      content: "The door was open.\n"
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "read_chapter",
              input: JSON.stringify({ chapterId: chapter.id })
            }
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: USAGE,
          warnings: []
        },
        {
          content: [{ type: "text", text: "Read the chapter." }],
          finishReason: { unified: "stop", raw: undefined },
          usage: USAGE,
          warnings: []
        }
      ]
    });
    const agent = new ToolLoopAgent({
      model,
      tools: createChapterTools(library, book.id),
      stopWhen: isStepCount(5)
    });

    const result = await agent.generate({ messages: [{ role: "user", content: "Read the chapter." }] });
    expect(result.text).toBe("Read the chapter.");
    expect(model.doGenerateCalls).toHaveLength(2);
  });
});
