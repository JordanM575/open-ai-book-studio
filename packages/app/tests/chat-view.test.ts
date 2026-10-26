import { describe, expect, test } from "bun:test";
import { agentMessageSchema, type AgentMessage, type AgentPart } from "@ai-book-studio/core/agent/messages";
import { approvalLabel, toolDetailText, toolLabel, toChatMessage } from "../src/lib/chat-view";

const AT = "2026-01-01T00:00:00.000Z";

function message(parts: AgentPart[], extra: Record<string, unknown> = {}): AgentMessage {
  return agentMessageSchema.parse({
    id: "msg_test0001",
    role: "assistant",
    parts,
    createdAt: AT,
    ...extra
  });
}

describe("chat view", () => {
  test("turns a stored assistant message into text, tools, model and usage", () => {
    const stored = message(
      [
        { type: "reasoning", text: "Think about the scene." },
        { type: "tool-call", id: "call_1", name: "read_chapter", input: { chapterId: "ch_test0001" } },
        { type: "tool-result", id: "call_1", name: "read_chapter", output: { ok: true, message: "Read it." } },
        { type: "text", text: "I read the chapter." }
      ],
      {
        model: { provider: "openrouter", modelId: "test-model", connectionLabel: "OpenRouter" },
        usage: {
          inputTokens: 120,
          outputTokens: 12,
          cachedInputTokens: 8,
          costUsd: null,
          costBasis: "unknown"
        },
        turnId: "turn_test0001",
        context: {
          estimated: true,
          sections: [
            { id: "instructions", label: "Instructions", characters: 40, estimatedTokens: 10 },
            { id: "chapters", label: "Chapters", characters: 80, estimatedTokens: 20 }
          ],
          conversationTokens: 5,
          totalTokens: 35
        }
      }
    );

    const view = toChatMessage(stored, "turn_test0001");
    expect(view.text).toBe("I read the chapter.");
    expect(view.model).toBe("OpenRouter · test-model");
    expect(view.note).toContain("120 in · 12 out");
    expect(view.context?.totalTokens).toBe(35);
    expect(view.context?.sections).toHaveLength(2);
    expect(view.undoAvailable).toBe(true);
    expect(view.changed).toBe(1);
    expect(view.tools[0]).toMatchObject({
      id: "call_1",
      name: "read_chapter",
      status: "end",
      input: { chapterId: "ch_test0001" },
      output: { ok: true, message: "Read it." }
    });
    expect(toolDetailText(view.tools[0]!)).toContain("Input:");
    expect(toolDetailText(view.tools[0]!)).toContain("Read it.");
  });

  test("shows a provider-reported cost instead of the unknown label", () => {
    const view = toChatMessage(
      message([{ type: "text", text: "Done." }], {
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 0,
          costUsd: 0.0012,
          costBasis: "reported",
          contextLength: 1_000
        }
      }),
      undefined
    );
    expect(view.note).toContain("$0.0012");
    expect(view.note).toContain("10% of 1,000 context");
    expect(view.note).not.toContain("cost not reported");
  });

  test("marks a provider failure as non-retryable after reload", () => {
    const view = toChatMessage(
      message([
        { type: "text", text: "Partial reply." },
        { type: "error", code: "auth", message: "Reconnect the provider." }
      ]),
      undefined
    );
    expect(view.failed).toBe(true);
    expect(view.retryable).toBe(false);
    expect(view.note).toBe("Reconnect the provider.");
    expect(view.errorCode).toBe("auth");
  });

  test("shows a stopped turn as stopped, not failed", () => {
    const view = toChatMessage(
      message([{ type: "error", code: "stopped", message: "Stopped by the author." }]),
      undefined
    );
    expect(view.failed).toBeUndefined();
    expect(view.note).toBe("Stopped by the author.");
  });

  test("reloads a pending approval onto its turn message", () => {
    const view = toChatMessage(
      message(
        [
          { type: "text", text: "I can remove that memory." },
          {
            type: "approval",
            approvalId: "appr_test0001",
            turnId: "turn_test0001",
            name: "remove_memory",
            input: { memoryId: "mem_test0001" },
            status: "pending",
            requestedAt: AT
          }
        ],
        { turnId: "turn_test0001" }
      ),
      undefined
    );

    expect(view.approvals).toHaveLength(1);
    expect(view.approvals?.[0]).toMatchObject({
      id: "appr_test0001",
      turnId: "turn_test0001",
      name: "remove_memory",
      status: "pending"
    });
    expect(view.note).toBe("Waiting for your approval.");
  });

  test("keeps an answered approval with the final usage line", () => {
    const view = toChatMessage(
      message(
        [
          { type: "text", text: "The memory is gone." },
          {
            type: "approval",
            approvalId: "appr_test0001",
            turnId: "turn_test0001",
            name: "remove_memory",
            input: { memoryId: "mem_test0001" },
            status: "approved",
            requestedAt: AT,
            resolvedAt: AT
          }
        ],
        {
          turnId: "turn_test0001",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            costUsd: 0.001,
            costBasis: "reported"
          }
        }
      ),
      "turn_test0001"
    );

    expect(view.approvals?.[0]?.status).toBe("approved");
    expect(view.note).toContain("10 in · 5 out");
    expect(view.undoAvailable).toBe(true);
  });

  test("keeps raw detail behind a bounded disclosure", () => {
    const detail = toolDetailText({
      name: "overwrite_chapter",
      status: "end",
      input: { content: "A".repeat(5_000) }
    });
    expect(detail.length).toBeLessThan(4_100);
    expect(detail.endsWith("…")).toBe(true);
    expect(toolLabel("remove_memory")).toBe("Asked to remove a memory");
    expect(approvalLabel("remove_memory")).toBe("Remove a saved memory?");
  });
});
