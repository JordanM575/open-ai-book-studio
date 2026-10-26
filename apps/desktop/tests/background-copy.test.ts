import { describe, expect, test } from "bun:test";
import { notificationFor, previewText, shouldNotify } from "../src/main/background-copy";
import type { AgentOutcome } from "../src/main/agent/runtime";

function outcome(overrides: Partial<AgentOutcome> = {}): AgentOutcome {
  return {
    kind: "done",
    turnId: "turn_1",
    bookId: "book_1",
    bookTitle: "The Salt Road",
    threadId: "thread_1",
    background: true,
    text: "The chapter is ready.",
    changed: 1,
    ...overrides
  };
}

describe("background notification copy", () => {
  test("previews a finished turn without the whole message", () => {
    expect(notificationFor(outcome())).toEqual({
      title: "The Salt Road — ready",
      body: "The chapter is ready."
    });
    expect(previewText("one\n\ntwo   three")).toBe("one two three");
    expect(previewText("x".repeat(200)).endsWith("…")).toBe(true);
  });

  test("names the action that is waiting for approval", () => {
    expect(
      notificationFor(outcome({ kind: "approval", approvalName: "overwrite_chapter", changed: 0 }))
    ).toEqual({
      title: "The Salt Road — needs you",
      body: "The agent is waiting for approval to run overwrite_chapter."
    });
  });

  test("reports a failure but stays silent when the author stopped the turn", () => {
    expect(notificationFor(outcome({ kind: "error", message: "The connection expired." }))).toEqual({
      title: "The Salt Road — the agent stopped",
      body: "The connection expired."
    });
    expect(notificationFor(outcome({ kind: "stopped" }))).toBeNull();
  });

  test("notifies for an explicit background turn even when the window is focused", () => {
    expect(shouldNotify(outcome(), { visible: true, focused: true })).toBe(true);
    expect(shouldNotify(outcome({ background: false }), { visible: true, focused: true })).toBe(false);
    expect(shouldNotify(outcome({ background: false }), { visible: false, focused: false })).toBe(true);
    expect(shouldNotify(outcome({ kind: "stopped" }), { visible: false, focused: false })).toBe(false);
  });
});
