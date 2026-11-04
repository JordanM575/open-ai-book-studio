import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentMessageSchema,
  agentThreadSchema,
  messageText,
  serializeAgentThread,
  type AgentMessage
} from "@ai-book-studio/core/agent/messages";
import { ThreadStore, ThreadStoreError } from "@ai-book-studio/core/agent/threads";
import { toLibraryFilePath } from "@ai-book-studio/core/library/path";
import { threadsPath } from "@ai-book-studio/core/library/paths";
import type { LibraryEnvironment } from "@ai-book-studio/core/library/port";
import { createFileSystemEnvironment } from "../src/main/library/fs-port";
import { prepareThread } from "../src/main/agent/runtime";

const BOOK = "book_test0001";
let root = "";
let env: LibraryEnvironment;
let store: ThreadStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-threads-"));
  env = createFileSystemEnvironment(root);
  store = new ThreadStore(env.storage, env.runtime);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function message(id: string, createdAt: string): AgentMessage {
  return agentMessageSchema.parse({
    id,
    role: "assistant",
    parts: [
      { type: "reasoning", text: "She should sound tired." },
      { type: "tool-call", id: "call_read", name: "read_chapter", input: { chapterId: "ch_test0001" } },
      { type: "tool-result", id: "call_read", name: "read_chapter", output: { ok: true, text: "The door." } },
      { type: "text", text: "I tightened the opening." }
    ],
    model: {
      provider: "openrouter",
      modelId: "openai/gpt-5-mini",
      connectionLabel: "OpenRouter"
    },
    usage: {
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 80,
      costUsd: 0.0012,
      costBasis: "reported"
    },
    createdAt
  });
}

describe("agent message schema", () => {
  test("round-trips every part through the thread file format", async () => {
    const thread = await store.create(BOOK, "Opening scene");
    const createdAt = new Date().toISOString();
    const saved = await store.save({ ...thread, messages: [message("msg_test0001", createdAt)] });
    const read = await store.read(BOOK, thread.id);

    expect(read).not.toBeNull();
    const stored = read!;
    expect(stored.messages[0]?.parts).toHaveLength(4);
    expect(stored.messages[0]?.parts[1]).toMatchObject({ type: "tool-call", name: "read_chapter" });
    expect(stored.messages[0]?.usage?.cachedInputTokens).toBe(80);
    expect(messageText(stored.messages[0]!)).toBe("I tightened the opening.");
    expect(saved.updatedAt >= thread.updatedAt).toBe(true);
  });

  test("rejects empty parts and duplicate message ids", () => {
    const base = {
      schemaVersion: 1,
      id: "thread_test0001",
      bookId: BOOK,
      title: "A conversation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpointTurns: []
    };
    expect(agentThreadSchema.safeParse({ ...base, messages: [{ id: "msg_test0001", role: "user", parts: [] }] }).success).toBe(false);
    const one = message("msg_test0001", new Date().toISOString());
    expect(agentThreadSchema.safeParse({ ...base, messages: [one, one] }).success).toBe(false);
  });

  test("serialization is stable and validates the thread", async () => {
    const thread = await store.create(BOOK, "Stable");
    const text = serializeAgentThread(thread);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).id).toBe(thread.id);
  });
});

describe("thread store", () => {
  test("lists conversations newest first", async () => {
    let tick = 0;
    const clock = new ThreadStore(env.storage, {
      ...env.runtime,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
    });
    const first = await clock.create(BOOK, "First");
    const second = await clock.create(BOOK, "Second");
    const list = await clock.list(BOOK);
    expect(list.map((thread) => thread.id)).toEqual([second.id, first.id]);
    expect(list[0]?.title).toBe("Second");
  });

  test("upserts an approval message and records its answer", async () => {
    const thread = await store.create(BOOK, "Approval");
    const at = new Date().toISOString();
    const pending = agentMessageSchema.parse({
      id: "msg_test0002",
      role: "assistant",
      parts: [
        { type: "text", text: "I can move that chapter." },
        {
          type: "approval",
          approvalId: "appr_test0001",
          turnId: "turn_test0001",
          name: "move_chapter",
          input: { chapterId: "ch_test0001", position: 2 },
          status: "pending",
          requestedAt: at
        }
      ],
      turnId: "turn_test0001",
      createdAt: at
    });

    await store.upsertMessage(BOOK, thread.id, pending);
    const updated = await store.updateApproval(BOOK, thread.id, pending.id, "appr_test0001", "approved");
    expect(updated?.messages).toHaveLength(1);
    const part = updated?.messages[0]?.parts.find((entry) => entry.type === "approval");
    expect(part).toMatchObject({ status: "approved" });
    expect(part).toHaveProperty("resolvedAt");
    expect(await store.updateApproval(BOOK, thread.id, pending.id, "appr_missing", "denied")).toBeNull();

    const final = agentMessageSchema.parse({
      ...updated!.messages[0],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedInputTokens: 0,
        costUsd: null,
        costBasis: "unknown"
      }
    });
    const saved = await store.upsertMessage(BOOK, thread.id, final);
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0]?.usage?.inputTokens).toBe(10);
  });

  test("appends a message and renames the conversation", async () => {
    const thread = await store.create(BOOK, "New");
    const appended = await store.appendMessage(BOOK, thread.id, message("msg_test0001", new Date().toISOString()));
    expect(appended.messages).toHaveLength(1);
    const renamed = await store.rename(BOOK, thread.id, "  The   door  ");
    expect(renamed.title).toBe("The door");
    expect((await store.read(BOOK, thread.id))?.title).toBe("The door");
  });

  test("forks a conversation at an assistant turn", async () => {
    const now = new Date().toISOString();
    const user = agentMessageSchema.parse({
      id: "msg_00000001",
      role: "user",
      parts: [{ type: "text", text: "Start." }],
      createdAt: now
    });
    const first = { ...message("msg_00000002", now), turnId: "turn_00000001" };
    const secondUser = agentMessageSchema.parse({
      id: "msg_00000003",
      role: "user",
      parts: [{ type: "text", text: "Continue." }],
      createdAt: now
    });
    const second = { ...message("msg_00000004", now), turnId: "turn_00000002" };
    const source = await store.create(BOOK, "Source conversation", [user, first, secondUser, second]);
    await store.save({ ...source, checkpointTurns: ["turn_00000001", "turn_00000002"] });

    const branch = await store.fork(BOOK, source.id, "turn_00000001");
    expect(branch.id).not.toBe(source.id);
    expect(branch.title).toBe("Source conversation (branch)");
    expect(branch.messages).toHaveLength(2);
    // Undo takes the newest checkpoint, which this branch left out, so it offers no undo (QA B2).
    expect(branch.checkpointTurns).toEqual([]);
    const fromNewest = await store.fork(BOOK, source.id, "turn_00000002");
    expect(fromNewest.checkpointTurns).toEqual(["turn_00000001", "turn_00000002"]);
    expect((await store.read(BOOK, source.id))?.messages).toHaveLength(4);
    await expect(store.fork(BOOK, source.id, "turn_missing")).rejects.toMatchObject({ code: "not-found" });
  });

  // QA B2: once undo has used a turn's checkpoint, no conversation may offer that undo again.
  test("forgets an undone turn in every conversation that names it", async () => {
    let tick = 0;
    const clock = new ThreadStore(env.storage, {
      ...env.runtime,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
    });
    const source = await clock.save({
      ...(await clock.create(BOOK, "Source")),
      checkpointTurns: ["turn_00000001", "turn_00000002"]
    });
    const branch = await clock.save({
      ...(await clock.create(BOOK, "Source (branch)")),
      checkpointTurns: ["turn_00000001", "turn_00000002"]
    });
    const other = await clock.save({ ...(await clock.create(BOOK, "Other")), checkpointTurns: ["turn_00000003"] });

    await clock.forgetCheckpointTurn(BOOK, "turn_00000002");

    expect((await clock.read(BOOK, source.id))?.checkpointTurns).toEqual(["turn_00000001"]);
    expect((await clock.read(BOOK, branch.id))?.checkpointTurns).toEqual(["turn_00000001"]);
    expect(await clock.read(BOOK, other.id)).toEqual(other);
    // The branch was newer than its source, and still is.
    const order = (await clock.list(BOOK)).map((thread) => thread.id);
    expect(order.indexOf(branch.id)).toBeLessThan(order.indexOf(source.id));

    // A turn no conversation names leaves every file as it was.
    await clock.forgetCheckpointTurn(BOOK, "turn_missing01");
    expect(await clock.read(BOOK, other.id)).toEqual(other);
  });

  test("skips a corrupt file in the list and reports it when opened", async () => {
    const thread = await store.create(BOOK, "Good");
    const corrupt = "thread_bad0001";
    const path = toLibraryFilePath([...threadsPath(BOOK), `${corrupt}.json`]);
    await writeFile(join(root, ...path), "{ not json", "utf8");

    expect((await store.list(BOOK)).map((entry) => entry.id)).toEqual([thread.id]);
    await expect(store.read(BOOK, corrupt)).rejects.toMatchObject({ code: "corrupt" });
  });

  test("rejects unsafe ids before touching the filesystem", async () => {
    await expect(store.read("../book", "thread_test0001")).rejects.toBeInstanceOf(ThreadStoreError);
    await expect(store.read(BOOK, "../../etc/passwd")).rejects.toMatchObject({ code: "invalid-id" });
    await expect(store.create("book_../escape")).rejects.toMatchObject({ code: "invalid-id" });
  });

  test("removing a missing conversation is idempotent", async () => {
    await store.remove(BOOK, "thread_missing01");
    const thread = await store.create(BOOK, "Gone");
    await store.remove(BOOK, thread.id);
    expect(await store.read(BOOK, thread.id)).toBeNull();
  });
});

describe("prepareThread", () => {
  test("creates a conversation from a prompt and reuses the user message on retry", async () => {
    const prepared = await prepareThread(store, { bookId: BOOK, prompt: "Tighten the opening." });
    expect(prepared.reused).toBe(false);
    expect(prepared.thread.title).toBe("Tighten the opening.");
    expect(prepared.thread.messages).toHaveLength(1);

    const again = await prepareThread(store, {
      bookId: BOOK,
      threadId: prepared.thread.id,
      prompt: "Tighten the opening."
    });
    expect(again.reused).toBe(true);
    expect(again.thread.messages).toHaveLength(1);
    expect(messageText(again.thread.messages[0]!)).toBe("Tighten the opening.");
  });

  test("seeds a new conversation from plain text history", async () => {
    const prepared = await prepareThread(store, {
      bookId: BOOK,
      prompt: "Keep going.",
      history: [
        { role: "user", text: "Open the scene." },
        { role: "assistant", text: "The door opened." }
      ]
    });
    expect(prepared.thread.messages.map((entry) => messageText(entry))).toEqual([
      "Open the scene.",
      "The door opened.",
      "Keep going."
    ]);
  });

  test("refuses a missing conversation and an empty prompt", async () => {
    await expect(
      prepareThread(store, { bookId: BOOK, threadId: "thread_missing01", prompt: "Hello." })
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(prepareThread(store, { bookId: BOOK, prompt: "   " })).rejects.toMatchObject({
      code: "invalid-request"
    });
  });
});
