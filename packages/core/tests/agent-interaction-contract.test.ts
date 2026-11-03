import { describe, expect, test } from "bun:test";
import {
  agentGuidanceTextSchema,
  agentMessageSchema,
  agentModeSchema,
  agentThreadSchema,
  messageText,
  serializeAgentThread
} from "../src/agent/messages";
import { createLibraryArchive } from "../src/archive/export";
import { LibraryService } from "../src/library/service";
import { agentSettingsSchema } from "../src/agent/settings";
import { ThreadStore } from "../src/agent/threads";
import { toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 031 T004: the stored interaction contract. Modes, one-turn guidance,
 * and per-book tone/answer-length validate at the schema; older threads and
 * books read without the new fields; every thread file round-trips through
 * the store. No runtime, provider, or UI behavior is claimed here.
 */
describe("interaction contract", () => {
  test("mode is discuss or edit and nothing else", () => {
    expect(agentModeSchema.parse("discuss")).toBe("discuss");
    expect(agentModeSchema.parse("edit")).toBe("edit");
    expect(agentModeSchema.safeParse("review").success).toBe(false);
    expect(agentModeSchema.safeParse("").success).toBe(false);
  });

  test("guidance text is 1 to 2,000 characters, never silently cut", () => {
    expect(agentGuidanceTextSchema.parse("Keep it terse.")).toBe("Keep it terse.");
    expect(agentGuidanceTextSchema.safeParse("").success).toBe(false);
    expect(agentGuidanceTextSchema.safeParse("x".repeat(2_001)).success).toBe(false);
    expect(agentGuidanceTextSchema.parse("x".repeat(2_000))).toHaveLength(2_000);
  });

  test("a guidance part rides the user message but stays out of the prose", () => {
    const message = agentMessageSchema.parse({
      id: "msg_test0001",
      role: "user",
      parts: [
        { type: "guidance", text: "Keep it terse." },
        { type: "text", text: "Tighten the opening." }
      ],
      createdAt: "2026-10-25T00:00:00.000Z"
    });
    expect(message.parts).toHaveLength(2);
    expect(messageText(message)).toBe("Tighten the opening.");
  });

  test("mode is recorded on the assistant message and unrecorded before", () => {
    const base = {
      id: "msg_test0001",
      role: "assistant",
      parts: [{ type: "text", text: "Done." }],
      createdAt: "2026-10-25T00:00:00.000Z"
    };
    expect(agentMessageSchema.parse({ ...base, mode: "edit" }).mode).toBe("edit");
    expect(agentMessageSchema.parse(base).mode).toBeUndefined();
    expect(agentMessageSchema.safeParse({ ...base, mode: "review" }).success).toBe(false);
  });

  test("a thread written before mode and guidance still reads", () => {
    const legacy = {
      schemaVersion: 1,
      id: "thread_test0001",
      bookId: "book_test0001",
      title: "An old conversation",
      createdAt: "2026-10-25T00:00:00.000Z",
      updatedAt: "2026-10-25T00:00:00.000Z",
      messages: [
        {
          id: "msg_test0001",
          role: "user",
          parts: [{ type: "text", text: "Tighten the opening." }],
          createdAt: "2026-10-25T00:00:00.000Z"
        }
      ],
      checkpointTurns: []
    };
    const thread = agentThreadSchema.parse(legacy);
    expect(thread.messages[0]?.mode).toBeUndefined();
    expect(serializeAgentThread(thread)).toBe(`${JSON.stringify(agentThreadSchema.parse(legacy), null, 2)}\n`);
  });

  test("a thread carrying mode and guidance round-trips through the store", async () => {
    const port = new InMemoryLibraryPort();
    const store = new ThreadStore(port, port);
    const thread = await store.create("book_test0001", "Modes");
    const saved = await store.save({
      ...thread,
      messages: [
        {
          id: "msg_test0001",
          role: "user",
          parts: [
            { type: "guidance", text: "Keep it terse." },
            { type: "text", text: "Tighten the opening." }
          ],
          createdAt: thread.createdAt
        },
        {
          id: "msg_test0002",
          role: "assistant",
          parts: [{ type: "text", text: "Terse it is." }],
          mode: "discuss",
          turnId: "turn_test0001",
          createdAt: thread.createdAt
        }
      ]
    });
    expect(saved.messages).toHaveLength(2);
    const read = await store.read("book_test0001", thread.id);
    expect(read?.messages[0]?.parts[0]).toMatchObject({ type: "guidance", text: "Keep it terse." });
    expect(read?.messages[1]?.mode).toBe("discuss");
    const raw = await port.readFile(toLibraryPath(["books", "book_test0001", "threads", `${thread.id}.json`]));
    expect(raw).not.toBeNull();
  });

  test("tone and answer length persist on the book and ride the archive", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await service.updateBook(book.id, {
      settings: {
        ...book.settings,
        agent: {
          ...book.settings.agent,
          tone: "Plainspoken.",
          answerLength: "brief",
          perTurnCeilingUsd: 5,
          monthlyWarningUsd: 20
        }
      }
    });
    const read = await service.readBook(book.id);
    expect(read.book.settings.agent.tone).toBe("Plainspoken.");
    expect(read.book.settings.agent.answerLength).toBe("brief");
    expect(read.book.settings.agent.perTurnCeilingUsd).toBe(5);
    expect(read.book.settings.agent.monthlyWarningUsd).toBe(20);

    const archive = await createLibraryArchive({ storage: port, runtime: port }, { appVersion: "test" });
    const entry = archive.manifest.entries.find((candidate) => candidate.path === `books/${book.id}/book.json`);
    expect(entry).toBeDefined();
    const stored = await port.readFile(toLibraryPath(["books", book.id, "book.json"]));
    expect(stored ? JSON.parse(new TextDecoder().decode(stored.bytes)).settings.agent : null).toMatchObject({
      tone: "Plainspoken.",
      answerLength: "brief"
    });
  });

  test("per-book tone and answer length default and validate", () => {
    expect(agentSettingsSchema.parse({})).toMatchObject({ tone: "", answerLength: "standard" });
    expect(agentSettingsSchema.parse({ tone: "Plainspoken.", answerLength: "brief" })).toMatchObject({
      tone: "Plainspoken.",
      answerLength: "brief"
    });
    expect(agentSettingsSchema.safeParse({ tone: "x".repeat(500) }).success).toBe(true);
    expect(agentSettingsSchema.safeParse({ tone: "x".repeat(501) }).success).toBe(false);

    expect(agentSettingsSchema.parse({})).toMatchObject({
      perTurnCeilingUsd: null,
      monthlyWarningUsd: null
    });
    expect(
      agentSettingsSchema.parse({ perTurnCeilingUsd: 5, monthlyWarningUsd: 20 })
    ).toMatchObject({ perTurnCeilingUsd: 5, monthlyWarningUsd: 20 });
    expect(agentSettingsSchema.safeParse({ perTurnCeilingUsd: 0 }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ perTurnCeilingUsd: -3 }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ monthlyWarningUsd: Number.NaN }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ monthlyWarningUsd: null }).success).toBe(true);
    expect(agentSettingsSchema.safeParse({ answerLength: "purple" }).success).toBe(false);
  });
});
