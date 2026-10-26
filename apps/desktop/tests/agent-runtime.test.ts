import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolLoopAgent, isStepCount, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { messageText } from "@ai-book-studio/core/agent/messages";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { BookMeta } from "@ai-book-studio/core/schema";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
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
    setTimeout(() => reject(new Error("The approval request did not arrive.")), 5_000);
  });
  const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
    setTimeout(() => reject(new Error("The approved turn did not finish.")), 5_000);
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

describe("agent runtime contract", () => {
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

    const started = await runtime.start({ bookId: book.id, prompt: "Tighten the opening." });
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

  test("uses a one-off model without changing the book default", async () => {
    const seen: string[] = [];
    const model = textModel("The other model answered.");
    let resolveDone!: (event: Extract<AgentEvent, { type: "done" }>) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      setTimeout(() => reject(new Error("The override turn did not finish.")), 5_000);
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
      setTimeout(() => reject(new Error("The approval request did not arrive.")), 5_000);
    });
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      setTimeout(() => reject(new Error("The approved turn did not finish.")), 5_000);
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

    const started = await runtime.start({ bookId: book.id, prompt: "Remove the tide memory." });
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
      setTimeout(() => reject(new Error("The approval request did not arrive.")), 5_000);
    });
    const done = new Promise<Extract<AgentEvent, { type: "done" }>>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
      setTimeout(() => reject(new Error("The denied turn did not finish.")), 5_000);
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

    const started = await runtime.start({ bookId: book.id, prompt: "Remove the tide memory." });
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

    const started = await runtime.start({ bookId: book.id, prompt: "Remove the tide memory." });
    await approval;
    await runtime.stop(started.turnId);

    const thread = await library.threads.read(book.id, started.threadId);
    expect(thread?.messages.at(-1)?.parts.find((part) => part.type === "approval")).toMatchObject({
      status: "expired"
    });
    expect(events.some((event) => event.type === "stopped")).toBe(true);
  });

  test("waits for approval before overwriting a chapter and can undo it", async () => {
    const chapter = await createChapter();
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I replaced the opening.", "overwrite_chapter", {
        chapterId: chapter.id,
        content: "A new opening.\n"
      })
    );

    const started = await runtime.start({ bookId: book.id, prompt: "Replace the opening." });
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

  test("waits for approval before deleting a chapter", async () => {
    const chapter = await createChapter();
    const { runtime, approval, done } = approvalRuntime(
      approvalModel("I moved it to the trash.", "delete_chapter", { chapterId: chapter.id })
    );

    const started = await runtime.start({ bookId: book.id, prompt: "Delete the chapter." });
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

    const started = await runtime.start({ bookId: book.id, prompt: "Delete the middle line." });
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

    const started = await runtime.start({ bookId: book.id, prompt: "Move the first chapter to the end." });
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

    const started = await runtime.start({ bookId: book.id, prompt: "Split the chapter." });
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

    const started = await runtime.start({ bookId: book.id, prompt: "Merge the two chapters." });
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
      setTimeout(() => reject(new Error("The context error did not arrive.")), 5_000);
    });
    const runtime = new AgentRuntime(
      studioFor(),
      providersFor(),
      (event) => {
        if (event.type === "error") resolveError(event);
      },
      () => model
    );

    await runtime.start({ bookId: book.id, prompt: "Continue the chapter." });
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
