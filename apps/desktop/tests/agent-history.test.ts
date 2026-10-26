import { describe, expect, test } from "bun:test";
import {
  agentMessageSchema,
  agentThreadSchema,
  messageText,
  type AgentMessage,
  type AgentPart,
  type AgentThread
} from "@ai-book-studio/core/agent/messages";
import { compactHistory, HISTORY_RECENT_TURNS, HISTORY_USER_MAX_CHARS } from "@ai-book-studio/core/agent/history";

const AT = "2026-01-01T00:00:00.000Z";

function message(id: string, role: "user" | "assistant", parts: AgentPart[]): AgentMessage {
  return agentMessageSchema.parse({ id, role, parts, createdAt: AT });
}

function threadWithTurns(count: number, userText = "A request."): AgentThread {
  const messages: AgentMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(4, "0");
    messages.push(
      message(`msg_${String(index * 2 + 1).padStart(8, "0")}`, "user", [
        { type: "text", text: `${userText} ${index}` }
      ])
    );
    messages.push(
      message(`msg_${String(index * 2 + 2).padStart(8, "0")}`, "assistant", [
        { type: "reasoning", text: "Think about the scene." },
        { type: "tool-call", id: `call_${suffix}`, name: "read_chapter", input: { chapterId: `ch_${suffix}` } },
        {
          type: "tool-result",
          id: `call_${suffix}`,
          name: "read_chapter",
          output: { text: "x".repeat(2_000) }
        },
        { type: "text", text: "The chapter says." }
      ])
    );
  }
  return agentThreadSchema.parse({
    schemaVersion: 1,
    id: "thread_test0001",
    bookId: "book_test0001",
    title: "A long conversation",
    createdAt: AT,
    updatedAt: AT,
    messages,
    checkpointTurns: []
  });
}

describe("history compaction", () => {
  test("keeps the newest turns verbatim and summarizes older tool work", () => {
    const thread = threadWithTurns(HISTORY_RECENT_TURNS + 3);
    const before = JSON.stringify(thread);
    const result = compactHistory(thread);

    expect(result.compacted).toBe(3);
    expect(result.messages).toHaveLength(thread.messages.length);
    expect(result.messages.slice(6)).toEqual(thread.messages.slice(6));

    const oldestAssistant = messageText(result.messages[1]!);
    expect(oldestAssistant).toContain("The chapter says.");
    expect(oldestAssistant).toContain("Earlier tools: read_chapter.");
    expect(oldestAssistant).not.toContain("x".repeat(2_000));
    expect(JSON.stringify(thread)).toBe(before);
  });

  test("leaves a conversation shorter than the recent window alone", () => {
    const thread = threadWithTurns(3);
    const result = compactHistory(thread);
    expect(result.compacted).toBe(0);
    expect(result.messages).toEqual(thread.messages);
  });

  test("truncates a long old user prompt without touching the stored text", () => {
    const thread = threadWithTurns(HISTORY_RECENT_TURNS + 1, "x".repeat(HISTORY_USER_MAX_CHARS + 500));
    const result = compactHistory(thread);
    const first = messageText(result.messages[0]!);
    expect(first.length).toBeLessThanOrEqual(HISTORY_USER_MAX_CHARS + 1);
    expect(first.endsWith("…")).toBe(true);
    expect(JSON.stringify(thread)).toContain("x".repeat(HISTORY_USER_MAX_CHARS + 500));
  });

  test("summarizes a tool-only older turn instead of dropping it", () => {
    const thread = threadWithTurns(HISTORY_RECENT_TURNS + 1);
    const toolOnly = message("msg_99999999", "assistant", [
      { type: "tool-call", id: "call_tool", name: "find_in_chapters", input: { query: "door" } },
      { type: "tool-result", id: "call_tool", name: "find_in_chapters", output: { matches: [] } }
    ]);
    const withToolOnly = agentThreadSchema.parse({
      ...thread,
      messages: [thread.messages[0]!, toolOnly, ...thread.messages.slice(1)]
    });
    const result = compactHistory(withToolOnly);
    const summary = messageText(result.messages[1]!);
    expect(summary).toBe("Earlier tools: find_in_chapters.");
  });
});
