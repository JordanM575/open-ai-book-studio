import { describe, expect, test } from "bun:test";
import {
  notificationFor,
  notificationRoute,
  previewText,
  shouldNotify,
  type WindowState
} from "../src/main/background-copy";
import { launchMode } from "../src/main/launch-mode";
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

/** Every kind of outcome, background or not, against every window state the shell can report. */
function everyCase(): Array<{ outcome: AgentOutcome; state: WindowState }> {
  const cases: Array<{ outcome: AgentOutcome; state: WindowState }> = [];
  for (const kind of ["done", "error", "approval", "stopped"] as const) {
    for (const background of [true, false]) {
      for (const visible of [true, false]) {
        for (const focused of [true, false]) {
          cases.push({ outcome: outcome({ kind, background }), state: { visible, focused } });
        }
      }
    }
  }
  return cases;
}

describe("where a background notification goes", () => {
  const inApp = launchMode({}).headless;

  test("a hidden test run never posts one; the copy goes to its log", () => {
    const hidden = launchMode({ STUDIO_TEST: "1" }).headless;
    for (const each of everyCase()) {
      expect(notificationRoute(each.outcome, each.state, hidden)).toBe(
        shouldNotify(each.outcome, each.state) ? "log" : null
      );
    }
    // Its window is never visible, so a finished foreground turn still has something to log.
    expect(notificationRoute(outcome({ background: false }), { visible: false, focused: false }, hidden)).toBe(
      "log"
    );
  });

  test("a visible test run notifies exactly as the app does", () => {
    const visible = launchMode({ STUDIO_TEST: "1", STUDIO_VISIBLE: "1" }).headless;
    for (const each of everyCase()) {
      expect(notificationRoute(each.outcome, each.state, visible)).toBe(
        notificationRoute(each.outcome, each.state, inApp)
      );
    }
    expect(notificationRoute(outcome(), { visible: true, focused: true }, visible)).toBe("desktop");
  });

  test("the app is unchanged: it posts whenever the author would be told", () => {
    for (const each of everyCase()) {
      expect(notificationRoute(each.outcome, each.state, inApp)).toBe(
        shouldNotify(each.outcome, each.state) ? "desktop" : null
      );
    }
  });
});
