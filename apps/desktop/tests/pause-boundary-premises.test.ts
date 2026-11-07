import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
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
import { CheckpointStore } from "../src/main/agent/checkpoints";

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

function replaceModel(chapterId: string, destructive = false): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: destructive ? "overwrite_chapter" : "replace_in_chapter",
              input: JSON.stringify(destructive ? { chapterId, content: "The new opening.\n" }
                : { chapterId, find: "The old opening.", replace: "The new opening." })
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
    await waitForStopped(events, first.turnId);

    await expect(runtime.approve(first.turnId, approval.approvalId, true)).rejects.toThrow(/no longer waiting/);
    const second = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Something else." });
    // Wait until the second turn parks on its own approval: its stream is settled and
    // nothing is still in flight when the test tears the library down.
    await waitForApproval(events, second.turnId);
    await expect(runtime.approve(second.turnId, approval.approvalId, true)).rejects.toThrow(/no longer waiting/);
    await runtime.stop(second.turnId);
    await waitForStopped(events, second.turnId);
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

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function terminals(events: AgentEvent[]) {
  return events.filter((event) => event.type === "done" || event.type === "stopped" || event.type === "error");
}

describe("D178 definitive stop boundary", () => {
  test("stop after approval has dispatched preserves the destructive write's late outcome", async () => {
    const chapter = await library.createChapter(book.id, { title: "Approved", content: "The old opening.\n" });
    const entered = gate();
    const held = gate();
    const save = library.saveChapter.bind(library);
    library.saveChapter = async (...args) => { entered.release(); await held.promise; return save(...args); };
    const model = replaceModel(chapter.id, true);
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Overwrite" });
    try {
      const approval = await waitForApproval(events, started.turnId);
      await runtime.approve(started.turnId, approval.approvalId, true);
      await entered.promise;
      await runtime.stop(started.turnId);
      expect(terminals(events)).toHaveLength(0);
      expect(runtime.isWorking(book.id)).toBe(true);
      held.release();
      expect(await waitForStopped(events, started.turnId)).toMatchObject({ changed: 1, undoAvailable: true });
      const tail = (await library.threads.read(book.id, started.threadId))?.messages.at(-1);
      expect(tail?.parts.filter((part) => part.type === "tool-result")).toEqual([
        expect.objectContaining({ id: "call-1", output: expect.objectContaining({ ok: true }) })
      ]);
      expect(tail?.parts.find((part) => part.type === "approval")).toMatchObject({ status: "approved" });
      expect(model.doStreamCalls).toHaveLength(1);
      expect(terminals(events)).toHaveLength(1);
      expect((await runtime.undoLast(book.id, started.turnId)).restored).toBe(1);
    } finally { held.release(); }
  });

  test("a stop at tool dispatch closes the execution gate synchronously", async () => {
    const chapter = await library.createChapter(book.id, { title: "Dispatch", content: "The old opening.\n" });
    const save = spyOn(library, "saveChapter");
    const events: AgentEvent[] = [];
    const model = replaceModel(chapter.id);
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => {
      events.push(event);
      if (event.type === "tool" && event.status === "start") void runtime.stop(event.turnId);
    }, () => model);
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace" });
    expect(await waitForStopped(events, started.turnId)).toMatchObject({ changed: 0 });
    expect(save).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
    save.mockRestore();
  });

  test("a late write rejection has a definitive failure receipt without a claimed change", async () => {
    const chapter = await library.createChapter(book.id, { title: "Rejected", content: "The old opening.\n" });
    const entered = gate();
    const held = gate();
    library.saveChapter = async () => { entered.release(); await held.promise; throw new Error("Synthetic rejected save"); };
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => replaceModel(chapter.id));
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace" });
    try {
      await entered.promise;
      await runtime.stop(started.turnId);
      held.release();
      expect(await waitForStopped(events, started.turnId)).toMatchObject({ changed: 0 });
      const tail = (await library.threads.read(book.id, started.threadId))?.messages.at(-1);
      expect(tail?.parts.filter((part) => part.type === "tool-result")).toEqual([
        expect.objectContaining({ isError: true, output: expect.objectContaining({ ok: false }) })
      ]);
      expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
      expect(terminals(events)).toHaveLength(1);
    } finally { held.release(); }
  });

  test("a checked write held beyond five seconds retains ownership and records its late receipt exactly once", async () => {
    const chapter = await library.createChapter(book.id, { title: "Gate", content: "The old opening.\n" });
    const entered = gate();
    const held = gate();
    const save = library.saveChapter.bind(library);
    library.saveChapter = async (...args) => { entered.release(); await held.promise; return save(...args); };
    const model = replaceModel(chapter.id);
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace", background: true });
    try {
      await entered.promise;
      await runtime.stop(started.turnId);
      await runtime.stop(started.turnId);
      await new Promise((resolve) => setTimeout(resolve, 5_250));
      expect(terminals(events)).toHaveLength(0);
      expect(runtime.isWorking(book.id)).toBe(true);
      expect(runtime.hasActiveBackgroundTurns()).toBe(true);
      expect(events.filter((event) => event.type === "stopping")).toHaveLength(1);
      expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
      await expect(runtime.start({ mode: "edit", bookId: book.id, threadId: started.threadId, prompt: "New attempt" })).rejects.toThrow(/still stopping/);
      held.release();
      const stopped = await waitForStopped(events, started.turnId);
      expect(stopped).toMatchObject({ changed: 1, undoAvailable: true });
      expect(runtime.isWorking(book.id)).toBe(false);
      expect(terminals(events)).toHaveLength(1);
      expect(model.doStreamCalls).toHaveLength(1);
      expect((await library.readChapter(book.id, chapter.id)).content).toBe("The new opening.\n");
      const thread = await library.threads.read(book.id, started.threadId);
      const receipts = thread?.messages.at(-1)?.parts.filter((part) => part.type === "tool-result");
      expect(receipts).toHaveLength(1);
      expect(receipts?.[0]).toMatchObject({ id: "call-1", output: { ok: true } });
      expect(thread?.checkpointTurns).toContain(started.turnId);
      expect(events.filter((event) => event.type === "tool" && event.status === "end")).toHaveLength(1);
      expect((await runtime.undoLast(book.id, started.turnId)).restored).toBe(1);
      expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
    } finally { held.release(); }
  }, 10_000);

  for (const order of ["stop-first", "approve-first"] as const) {
    test(`${order} consumes approval ownership before slow persistence`, async () => {
      const model = memoryApprovalModel();
      const events: AgentEvent[] = [];
      const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
      const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Forget" });
      const approval = await waitForApproval(events, started.turnId);
      const held = gate();
      const entered = gate();
      const update = library.threads.updateApproval.bind(library.threads);
      const upsert = library.threads.upsertMessage.bind(library.threads);
      if (order === "approve-first") {
        library.threads.updateApproval = async (...args) => { entered.release(); await held.promise; return update(...args); };
      } else {
        library.threads.upsertMessage = async (...args) => { entered.release(); await held.promise; return upsert(...args); };
      }
      let answering: Promise<null> | undefined;
      try {
        if (order === "approve-first") answering = runtime.approve(started.turnId, approval.approvalId, true);
        await runtime.stop(started.turnId);
        await entered.promise;
        await expect(runtime.approve(started.turnId, approval.approvalId, true)).rejects.toThrow(/no longer waiting/);
        expect(terminals(events)).toHaveLength(0);
        expect(runtime.isWorking(book.id)).toBe(true);
        held.release();
        await answering;
        await waitForStopped(events, started.turnId);
        expect(model.doStreamCalls).toHaveLength(1);
        expect(terminals(events)).toHaveLength(1);
        const tail = (await library.threads.read(book.id, started.threadId))?.messages.at(-1);
        expect(tail?.parts.find((part) => part.type === "approval")).toMatchObject({ status: order === "approve-first" ? "approved" : "expired" });
        expect(tail?.parts.some((part) => part.type === "tool-result")).toBe(false);
      } finally { held.release(); }
    });
  }

  test("failed approval persistence never resumes a destructive action", async () => {
    const model = memoryApprovalModel();
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Forget" });
    const approval = await waitForApproval(events, started.turnId);
    library.threads.updateApproval = async () => { throw new Error("Synthetic disk full"); };
    await expect(runtime.approve(started.turnId, approval.approvalId, true)).rejects.toThrow(/could not be saved/);
    const stopped = await waitForStopped(events, started.turnId);
    expect(stopped.persistenceError).toContain("action was not started");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(terminals(events)).toHaveLength(1);
  });

  for (const failure of ["none", "checkpoint", "conversation", "reference"] as const) {
    test(`stop waits for slow persistence with failure at: ${failure}`, async () => {
      const chapter = await library.createChapter(book.id, { title: "Checkpoint", content: "The old opening.\n" });
      const entered = gate();
      const held = gate();
      const saving = CheckpointStore.prototype.save;
      const checkpoint = spyOn(CheckpointStore.prototype, "save").mockImplementation(async function (this: CheckpointStore, ...args) {
        entered.release();
        await held.promise;
        if (failure === "checkpoint") throw new Error("Synthetic checkpoint failure");
        return saving.apply(this, args);
      });
      const events: AgentEvent[] = [];
      const model = replaceModel(chapter.id);
      const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
      const finalEntered = gate();
      const finalHeld = gate();
      const upsert = library.threads.upsertMessage.bind(library.threads);
      library.threads.upsertMessage = async (...args) => {
        finalEntered.release();
        await finalHeld.promise;
        if (failure === "conversation") throw new Error("Synthetic conversation failure");
        return upsert(...args);
      };
      const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace" });
      if (failure === "reference") {
        const saveThread = library.threads.save.bind(library.threads);
        library.threads.save = async (thread) => {
          if (thread.checkpointTurns.includes(started.turnId)) throw new Error("Synthetic checkpoint reference failure");
          return saveThread(thread);
        };
      }
      try {
        await entered.promise;
        await runtime.stop(started.turnId);
        expect(terminals(events)).toHaveLength(0);
        expect((await library.readChapter(book.id, chapter.id)).content).toBe("The new opening.\n");
        held.release();
        await finalEntered.promise;
        expect(terminals(events)).toHaveLength(0);
        expect(runtime.isWorking(book.id)).toBe(true);
        finalHeld.release();
        const stopped = await waitForStopped(events, started.turnId);
        expect(stopped).toMatchObject({ changed: 1, undoAvailable: failure !== "checkpoint" });
        expect(Boolean(stopped.persistenceError)).toBe(failure === "conversation" || failure === "reference");
        expect(terminals(events)).toHaveLength(1);
        expect(model.doStreamCalls).toHaveLength(1);
        expect(events.filter((event) => event.type === "tool" && event.status === "end")).toHaveLength(1);
      } finally { held.release(); finalHeld.release(); checkpoint.mockRestore(); }
    });
  }

  for (const approval of [false, true]) {
    test(`stop during ${approval ? "approval" : "ordinary outcome"} persistence cannot publish a late approval or done`, async () => {
      const entered = gate();
      const held = gate();
      const upsert = library.threads.upsertMessage.bind(library.threads);
      library.threads.upsertMessage = async (...args) => { entered.release(); await held.promise; return upsert(...args); };
      const model = approval ? memoryApprovalModel() : textModel();
      const events: AgentEvent[] = [];
      const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => model);
      const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Request" });
      try {
        await entered.promise;
        await runtime.stop(started.turnId);
        expect(runtime.isWorking(book.id)).toBe(true);
        expect(terminals(events)).toHaveLength(0);
        held.release();
        await waitForStopped(events, started.turnId);
        expect(terminals(events)).toHaveLength(1);
        expect(events.some((event) => event.type === "approval")).toBe(false);
        expect(model.doStreamCalls).toHaveLength(1);
        const tail = (await library.threads.read(book.id, started.threadId))?.messages.at(-1);
        expect(tail?.parts.some((part) => part.type === "error" && part.code === "stopped")).toBe(true);
        if (approval) expect(tail?.parts.find((part) => part.type === "approval")).toMatchObject({ status: "expired" });
      } finally { held.release(); }
    });
  }

  test("a never-settling adapter remains stopping with unknown outcome", async () => {
    const chapter = await library.createChapter(book.id, { title: "Hung", content: "The old opening.\n" });
    const entered = gate();
    // No delayed disk access: this adapter deliberately never returns or writes.
    library.saveChapter = async () => { entered.release(); return new Promise(() => {}); };
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime(studioFor(), providersFor(), (event) => events.push(event), () => replaceModel(chapter.id));
    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Replace" });
    await entered.promise;
    await runtime.stop(started.turnId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runtime.isWorking(book.id)).toBe(true);
    expect(terminals(events)).toHaveLength(0);
    await expect(runtime.start({ mode: "edit", bookId: book.id, prompt: "Another" })).rejects.toThrow(/still stopping/);
    expect((await library.readChapter(book.id, chapter.id)).content).toBe("The old opening.\n");
  });
});
