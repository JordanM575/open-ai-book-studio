import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentMessageSchema,
  agentThreadSchema,
  messageText,
  serializeAgentThread,
  type AgentMessage,
  type AgentThread
} from "@ai-book-studio/core/agent/messages";
import { ThreadStore, ThreadStoreError } from "@ai-book-studio/core/agent/threads";
import { libraryPathFromArchivePath, toLibraryFilePath } from "@ai-book-studio/core/library/path";
import { conflictsPath, threadsPath } from "@ai-book-studio/core/library/paths";
import { LibraryService } from "@ai-book-studio/core/library/service";
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


/** Save the object as built, using the exact base hash currently on disk. */
async function saveWith(store: ThreadStore, thread: AgentThread): Promise<AgentThread> {
  const snapshot = await store.readSnapshot(thread.bookId, thread.id);
  if (!snapshot) throw new Error("missing thread snapshot");
  return store.save(thread, { baseHash: snapshot.baseHash });
}

describe("agent message schema", () => {
  test("round-trips every part through the thread file format", async () => {
    const thread = await store.create(BOOK, "Opening scene");
    const createdAt = new Date().toISOString();
    const saved = await saveWith(store, { ...thread, messages: [message("msg_test0001", createdAt)] });
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
    await saveWith(store, { ...source, checkpointTurns: ["turn_00000001", "turn_00000002"] });

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
    const sourceBase = await clock.create(BOOK, "Source");
    const source = await saveWith(clock, { ...sourceBase, checkpointTurns: ["turn_00000001", "turn_00000002"] });
    const branchBase = await clock.create(BOOK, "Source (branch)");
    const branch = await saveWith(clock, { ...branchBase, checkpointTurns: ["turn_00000001", "turn_00000002"] });
    const otherBase = await clock.create(BOOK, "Other");
    const other = await saveWith(clock, { ...otherBase, checkpointTurns: ["turn_00000003"] });

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
    expect(await store.remove(BOOK, "thread_missing01")).toEqual({ status: "missing" });
    const thread = await store.create(BOOK, "Gone");
    await store.remove(BOOK, thread.id);
    expect(await store.read(BOOK, thread.id)).toBeNull();
  });
});

describe("checked conversation writes", () => {
  function pathOf(threadId: string): string {
    return join(root, ...toLibraryFilePath([...threadsPath(BOOK), `${threadId}.json`]));
  }

  function trashPathOf(trashedAt: string): string {
    return join(root, ...libraryPathFromArchivePath(trashedAt));
  }

  test("a stale base hash keeps the intended conversation and never overwrites", async () => {
    const thread = await store.create(BOOK, "First");
    const path = pathOf(thread.id);
    const baseHash = (await env.storage.readFile(toLibraryFilePath([...threadsPath(BOOK), `${thread.id}.json`])))!
      .sha256;

    await store.rename(BOOK, thread.id, "Second");
    await expect(store.save({ ...thread, title: "Mine" }, { baseHash })).rejects.toMatchObject({
      code: "conflict"
    });

    expect((await store.read(BOOK, thread.id))?.title).toBe("Second");
    const copies = await readdir(join(root, ...conflictsPath(BOOK)));
    expect(copies.some((name) => name.includes(thread.id) && name.endsWith(".json"))).toBe(true);
    const copy = JSON.parse(await readFile(join(root, ...conflictsPath(BOOK), copies[0]!), "utf8"));
    expect(copy.title).toBe("Mine");
    expect(await readFile(path, "utf8")).toContain('"title": "Second"');
  });

  test("two writers from the same base produce one result and one kept copy", async () => {
    const service = await LibraryService.open(env);
    const thread = await store.create(BOOK, "Base");
    const first = new ThreadStore(env.storage, env.runtime, service.writeHost);
    const second = new ThreadStore(env.storage, env.runtime, service.writeHost);
    const readFirst = await first.readSnapshot(BOOK, thread.id);
    const readSecond = await second.readSnapshot(BOOK, thread.id);

    const results = await Promise.allSettled([
      first.save({ ...readFirst!.thread, title: "First writer" }, { baseHash: readFirst!.baseHash }),
      second.save({ ...readSecond!.thread, title: "Second writer" }, { baseHash: readSecond!.baseHash })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "conflict" });
    const stored = await store.read(BOOK, thread.id);
    expect(["First writer", "Second writer"]).toContain(stored?.title ?? "");
    const copies = await readdir(join(root, ...conflictsPath(BOOK)));
    expect(copies.some((name) => name.includes(thread.id))).toBe(true);
  });

  test("saving an unchanged conversation writes nothing and keeps the timestamp", async () => {
    const thread = await store.create(BOOK, "Unchanged");
    const path = pathOf(thread.id);
    const before = await readFile(path, "utf8");
    const saved = await saveWith(store, thread);
    expect(saved.updatedAt).toBe(thread.updatedAt);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  test("unknown plain fields survive an ordinary rename", async () => {
    const thread = await store.create(BOOK, "Extras");
    const path = pathOf(thread.id);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.futureTop = { keep: [1, 2, 3] };
    raw.messages = [
      {
        id: "msg_test0001",
        role: "user",
        parts: [{ type: "text", text: "Hello.", futurePart: "kept" }],
        futureMessage: "kept",
        createdAt: thread.createdAt
      }
    ];
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    await store.rename(BOOK, thread.id, "Renamed");
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.title).toBe("Renamed");
    expect(after.futureTop).toEqual({ keep: [1, 2, 3] });
    expect(after.messages[0].futureMessage).toBe("kept");
    expect(after.messages[0].parts[0].futurePart).toBe("kept");
  });

  test("replacing a message keeps unknown fields attached to it", async () => {
    const thread = await store.create(BOOK, "Upsert");
    const path = pathOf(thread.id);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.messages = [
      {
        id: "msg_test0002",
        role: "assistant",
        parts: [{ type: "text", text: "First", futurePart: "part extra" }],
        futureMessage: "message extra",
        createdAt: thread.createdAt
      }
    ];
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    await store.upsertMessage(
      BOOK,
      thread.id,
      agentMessageSchema.parse({
        id: "msg_test0002",
        role: "assistant",
        parts: [{ type: "text", text: "Second" }],
        createdAt: thread.createdAt
      })
    );

    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.messages[0].futureMessage).toBe("message extra");
    expect(after.messages[0].parts[0].futurePart).toBe("part extra");
    expect(after.messages[0].parts[0].text).toBe("Second");
  });

  test("deletion moves the file to recoverable trash and restore brings it back", async () => {
    const thread = await store.create(BOOK, "Delete me");
    const removed = await store.remove(BOOK, thread.id);
    expect(removed.status).toBe("trashed");
    if (removed.status !== "trashed") throw new Error("expected a trashed conversation");
    expect(await store.read(BOOK, thread.id)).toBeNull();
    expect(removed.trashedAt).toContain(".studio/trash/");
    expect((await env.storage.readFile(libraryPathFromArchivePath(removed.trashedAt)))).not.toBeNull();
    expect(await readFile(trashPathOf(removed.trashedAt), "utf8")).toContain('"title": "Delete me"');

    const restored = await store.restore(BOOK, thread.id, removed.trashedAt);
    expect(restored.title).toBe("Delete me");
    expect((await store.read(BOOK, thread.id))?.title).toBe("Delete me");

    await expect(store.restore(BOOK, thread.id, removed.trashedAt)).rejects.toMatchObject({ code: "exists" });
    await expect(store.restore(BOOK, thread.id, "books/book_test0001/threads/x.json")).rejects.toMatchObject({
      code: "invalid-id"
    });
    await expect(store.restore(BOOK, "thread_other01", removed.trashedAt.replace(thread.id, "thread_other01"))).rejects.toMatchObject({
      code: "not-found"
    });
  });

  test("a future schema and an oversized record are refused without rewriting the file", async () => {
    const thread = await store.create(BOOK, "Future");
    const path = pathOf(thread.id);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.schemaVersion = 2;
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const futureBytes = await readFile(path, "utf8");
    await expect(store.read(BOOK, thread.id)).rejects.toMatchObject({ code: "newer" });
    await expect(saveWith(store, { ...thread, title: "No" })).rejects.toMatchObject({ code: "newer" });
    expect(await readFile(path, "utf8")).toBe(futureBytes);

    const normal = await store.create(BOOK, "A normal conversation with enough bytes to exceed a small test limit.");
    const limited = new ThreadStore(env.storage, env.runtime, undefined, { maxBytes: 64 });
    const normalBytes = await readFile(pathOf(normal.id), "utf8");
    await expect(limited.read(BOOK, normal.id)).rejects.toMatchObject({ code: "too-large" });
    expect(await readFile(pathOf(normal.id), "utf8")).toBe(normalBytes);
  });

  test("the desktop Library writes conversations through the shared write host and does not migrate on open", async () => {
    const service = await LibraryService.open(env);
    const hosted = new ThreadStore(env.storage, env.runtime, service.writeHost);
    const thread = await hosted.create(BOOK, "Hosted conversation");
    const path = pathOf(thread.id);
    const before = await readFile(path, "utf8");

    // Reopening the library rebuilds the catalog; it must not migrate or rewrite a v1 conversation.
    await LibraryService.open(env);
    expect(await readFile(path, "utf8")).toBe(before);
    expect((await hosted.read(BOOK, thread.id))?.title).toBe("Hosted conversation");
  });

  test("no unchecked conversation writer remains", async () => {
    const threads = await readFile(new URL("../../../packages/core/src/agent/threads.ts", import.meta.url), "utf8");
    expect(threads).not.toMatch(/kind:\s*"any"/);
    expect(threads).not.toMatch(/removeFile\s*\(/);
    expect(threads).not.toMatch(/\bunlink\b/);
    const facade = await readFile(new URL("../src/main/library/store.ts", import.meta.url), "utf8");
    expect(facade).toMatch(/new ThreadStore\([^)]*writeHost/s);
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

describe("base-bound saves (review F1/F2)", () => {
  test("an older copy cannot overwrite a newer save", async () => {
    const thread = await store.create(BOOK, "Title A");
    const first = await store.readSnapshot(BOOK, thread.id);
    const second = await store.readSnapshot(BOOK, thread.id);
    if (!first || !second) throw new Error("missing snapshots");

    await store.save({ ...first.thread, title: "Title B" }, { baseHash: first.baseHash });
    await expect(store.save({ ...second.thread, title: "Title C" }, { baseHash: second.baseHash }))
      .rejects.toMatchObject({ code: "conflict" });

    expect((await store.read(BOOK, thread.id))?.title).toBe("Title B");
    const copies = await readdir(join(root, ...conflictsPath(BOOK)));
    expect(copies.some((name) => name.includes(thread.id))).toBe(true);
  });

  test("a store that never read the conversation cannot save it", async () => {
    const thread = await store.create(BOOK, "Unread");
    const service = await LibraryService.open(env);
    const other = new ThreadStore(env.storage, env.runtime, service.writeHost);
    await expect(other.save(thread, {} as never)).rejects.toMatchObject({ code: "missing-base" });
    expect((await store.read(BOOK, thread.id))?.title).toBe("Unread");
  });

  test("a file deleted after the queue read keeps a missing-file copy", async () => {
    const service = await LibraryService.open(env);
    const thread = await store.create(BOOK, "Vanishing");
    const snapshot = await store.readSnapshot(BOOK, thread.id);
    if (!snapshot) throw new Error("missing snapshot");
    const base = service.writeHost;
    const racing = {
      ...base,
      commitFile: async (path: Parameters<typeof base.commitFile>[0], bytes: Uint8Array,
        expected: Parameters<typeof base.commitFile>[2]) => {
        await rm(join(root, ...path), { force: true });
        return base.commitFile(path, bytes, expected);
      }
    };
    const racingStore = new ThreadStore(env.storage, env.runtime, racing);
    const error = await racingStore.save({ ...snapshot.thread, title: "Gone" }, { baseHash: snapshot.baseHash })
      .catch((reason: unknown) => reason as { code?: string; savedAs?: string });
    expect(error.code).toBe("conflict");
    expect(error.savedAs).toContain("missing-file");
  });

  test("a create collision at commit reports exists, not a conflict copy", async () => {
    const service = await LibraryService.open(env);
    const seed = await store.create(BOOK, "Seed bytes");
    const seedBytes = await readFile(join(root, ...threadsPath(BOOK), `${seed.id}.json`));
    const base = service.writeHost;
    const racing = {
      ...base,
      commitFile: async (path: Parameters<typeof base.commitFile>[0], bytes: Uint8Array,
        expected: Parameters<typeof base.commitFile>[2]) => {
        await writeFile(join(root, ...path), seedBytes);
        return base.commitFile(path, bytes, expected);
      }
    };
    const racingStore = new ThreadStore(env.storage, env.runtime, racing);
    await expect(racingStore.create(BOOK, "Collision")).rejects.toMatchObject({ code: "exists" });
  });
});
