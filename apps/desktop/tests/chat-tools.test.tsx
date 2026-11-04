/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { agentThreadSchema, type AgentThread } from "@ai-book-studio/core/agent/messages";

let testing!: typeof import("@testing-library/react/pure");
let ChatPanel!: typeof import("@ai-book-studio/app/components/ChatPanel").ChatPanel;

beforeAll(async () => {
  testing = await mountDom();
  ({ ChatPanel } = await import("@ai-book-studio/app/components/ChatPanel"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * A turn's tool steps and its checkpoint in the writing agent's chat (D-185): each step is one line
 * in the author's words, a step with detail opens in place, a failed step reads as an error, and the
 * turn ends with the line that undoes it.
 */

const BOOK = "book_tls000001";
const CHAPTER = "ch_tls000001";
const TURN = "turn_tls000001";
const TURN_B = "turn_tls000002";
const AT = "2026-01-01T00:00:00.000Z";

interface PanelOptions {
  /** The turn ids the agent hands out, one per start, in order. */
  turns?: string[];
  /** A stored conversation the panel opens with. */
  seed?: AgentThread;
}

function renderPanel({ turns = [TURN], seed }: PanelOptions = {}) {
  let starts = 0;
  const start = mock((_request: unknown) =>
    Promise.resolve({
      ok: true,
      data: { turnId: turns[Math.min(starts++, turns.length - 1)], threadId: "thread_tls000001" }
    })
  );
  const undoLast = mock(() => Promise.resolve({ ok: true, data: { restored: 1, skipped: 0 } }));
  const onChanged = mock(() => {});
  let emit: ((event: AgentEvent) => void) | null = null;
  const listed = seed
    ? [{ id: seed.id, title: seed.title, createdAt: AT, updatedAt: AT, messageCount: seed.messages.length, preview: "" }]
    : [];
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    agent: {
      threads: {
        list: mock(() => Promise.resolve({ ok: true, data: listed })),
        read: mock(() => Promise.resolve({ ok: true, data: seed ?? null })),
        fork: mock(() => Promise.resolve({ ok: true, data: null })),
        remove: mock(() => Promise.resolve({ ok: true, data: null })),
        rename: mock(() => Promise.resolve({ ok: true, data: null }))
      },
      start,
      stop: mock(() => Promise.resolve({ ok: true, data: null })),
      approve: mock(() => Promise.resolve({ ok: true, data: null })),
      undoLast,
      onEvent: mock((handler: (event: AgentEvent) => void) => {
        emit = handler;
        return () => {
          emit = null;
        };
      })
    }
  };
  testing.render(
    React.createElement(ChatPanel, {
      bookId: BOOK,
      chapterId: CHAPTER,
      onClose: () => {},
      onBeforeSend: async () => {},
      onChanged,
      onReconnect: () => {},
      onChooseModel: () => {},
      onChooseTurnModel: () => {},
      turnModel: null,
      onTurnModelUsed: () => {},
      onNotice: () => {}
    })
  );
  const fire = async (event: AgentEvent): Promise<void> => {
    await testing.act(async () => {
      emit?.(event);
    });
  };
  return { start, undoLast, onChanged, fire };
}

async function send(
  prompt: string,
  start: ReturnType<typeof mock>,
  sent = 1
): Promise<ReturnType<typeof testing.within>> {
  const view = testing.within(document.body);
  const input = await testing.waitFor(() => view.getByTestId("chat-input"));
  testing.fireEvent.change(input, { target: { value: prompt } });
  testing.fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
  await testing.waitFor(() => expect(start).toHaveBeenCalledTimes(sent));
  // Let the started turn register itself before its events arrive.
  await testing.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return view;
}

function status(element: HTMLElement): string | null {
  return element.closest('[data-slot="trace-line"]')?.getAttribute("data-status") ?? null;
}

describe("chat tool steps", () => {
  test("a step runs, finishes, opens to its detail, and a failed step reads as an error", async () => {
    const { start, fire } = renderPanel();
    const view = await send("Tighten the opening.", start);

    await fire({ type: "tool", turnId: TURN, id: "call_1", name: "read_chapter", status: "start", input: { chapterId: CHAPTER } });
    const reading = await testing.waitFor(() => view.getByText("Read a chapter"));
    expect(status(reading)).toBe("running");

    await fire({ type: "tool", turnId: TURN, id: "call_1", name: "read_chapter", status: "end", output: { ok: true, title: "One" } });
    await testing.waitFor(() => expect(status(view.getByText("Read a chapter"))).toBeNull());
    const step = view.getByRole("button", { name: "Read a chapter" });
    expect(step.getAttribute("aria-expanded")).toBe("false");
    await testing.act(async () => {
      testing.fireEvent.click(step);
    });
    expect(step.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText(/Input:/).textContent).toContain('"chapterId": "ch_tls000001"');
    expect(view.getByText(/Input:/).textContent).toContain('"title": "One"');

    // A step with nothing to show stays a plain line.
    await fire({ type: "tool", turnId: TURN, id: "call_2", name: "table_of_contents", status: "start" });
    const contents = await testing.waitFor(() => view.getByText("Read the chapter list"));
    expect(contents.closest("button")).toBeNull();
    expect(status(contents)).toBe("running");

    // A result whose start never arrived still lands, and a failure says so.
    await fire({
      type: "tool",
      turnId: TURN,
      id: "call_3",
      name: "replace_in_chapter",
      status: "end",
      output: { ok: false, error: "The text was not found." },
      detail: "The tool failed."
    });
    const failed = await testing.waitFor(() => view.getByRole("button", { name: "Edited a chapter" }));
    expect(failed.querySelector('[data-status="error"]')).not.toBeNull();
  });

  test("a turn that changed the book ends with the line that undoes it", async () => {
    const { start, fire, undoLast, onChanged } = renderPanel();
    const view = await send("Rewrite the storm.", start);
    await fire({
      type: "done",
      turnId: TURN,
      text: "I rewrote the storm.",
      model: { provider: "openrouter", modelId: "test-model", connectionLabel: "Test connection", name: "Test Model" },
      inputTokens: 300,
      outputTokens: 40,
      costUsd: null,
      costBasis: "unknown",
      contextLength: null,
      context: {
        estimated: true as const,
        sections: [{ id: "chapters", label: "Chapters", characters: 900, estimatedTokens: 225 }],
        conversationTokens: 20,
        totalTokens: 245
      },
      changed: 1,
      undoAvailable: true
    });

    const undo = await testing.waitFor(() => view.getByTestId("agent-undo-turn"));
    expect(undo.textContent).toBe("Undo this turn");
    expect(view.getByText("Now answering with Test connection · Test Model")).toBeDefined();
    await testing.act(async () => {
      testing.fireEvent.click(undo);
    });
    expect(undoLast).toHaveBeenCalledWith(BOOK);
    await testing.waitFor(() => expect(view.getByText("Restored 1 chapter.")).toBeDefined());
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });
});

/** A turn that finished, changing `changed` chapters with its checkpoint saved. */
function finished(turnId: string, text: string, changed = 1): AgentEvent {
  return {
    type: "done",
    turnId,
    text,
    model: { provider: "openrouter", modelId: "test-model", connectionLabel: "Test connection", name: "Test Model" },
    inputTokens: 300,
    outputTokens: 40,
    costUsd: null,
    costBasis: "unknown",
    contextLength: null,
    context: { estimated: true as const, sections: [], conversationTokens: 20, totalTokens: 20 },
    changed,
    undoAvailable: true
  };
}

/**
 * A stored conversation of two turns that each changed a chapter, with these checkpoint turns. With
 * `paused`, the second turn is still waiting for the author to approve a replacement.
 */
function storedConversation(checkpointTurns: string[], paused = false): AgentThread {
  const reply = (id: string, turnId: string, text: string) => ({
    id,
    role: "assistant" as const,
    parts:
      paused && turnId === TURN_B
        ? [
            { type: "tool-call" as const, id: "call_1", name: "overwrite_chapter", input: { chapterId: CHAPTER } },
            {
              type: "approval" as const,
              approvalId: "approval_tls000001",
              turnId,
              name: "overwrite_chapter",
              input: { chapterId: CHAPTER },
              status: "pending" as const,
              requestedAt: AT
            }
          ]
        : [{ type: "text" as const, text }],
    model: { provider: "openrouter" as const, modelId: "test-model", connectionLabel: "Test connection", name: "Test Model" },
    turnId,
    createdAt: AT
  });
  return agentThreadSchema.parse({
    schemaVersion: 1,
    id: "thread_tls000001",
    bookId: BOOK,
    title: "Two changes",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: "msg_tls000001", role: "user", parts: [{ type: "text", text: "Tighten the door." }], createdAt: AT },
      reply("msg_tls000002", TURN, "I tightened the door."),
      { id: "msg_tls000003", role: "user", parts: [{ type: "text", text: "Now the lamp." }], createdAt: AT },
      reply("msg_tls000004", TURN_B, "I tightened the lamp.")
    ],
    checkpointTurns
  });
}

/** The conversation item an element sits in. */
function itemOf(element: HTMLElement): HTMLElement {
  const item = element.closest<HTMLElement>('[data-slot="message-scroller-item"]');
  if (!item) throw new Error("The element is not inside a conversation item.");
  return item;
}

/** The one "Undo this turn" in the conversation, once there is exactly one. */
async function onlyUndo(view: ReturnType<typeof testing.within>): Promise<HTMLElement> {
  return testing.waitFor(() => {
    const offered = view.getAllByTestId("agent-undo-turn");
    expect(offered).toHaveLength(1);
    const [only] = offered;
    if (!only) throw new Error("No undo is offered.");
    return only;
  });
}

/*
 * QA B2: undo always takes the book's newest checkpoint, so only the turn that owns it may offer
 * "Undo this turn". An undo uses that turn up, and the turn before it owns the newest checkpoint
 * again, both in the open chat and in a reopened one.
 */
describe("undo this turn", () => {
  test("only the newest turn with a checkpoint offers its undo, and then the turn before it", async () => {
    const { start, fire, undoLast } = renderPanel({ turns: [TURN, TURN_B] });
    const view = await send("Tighten the door.", start);
    await fire(finished(TURN, "I tightened the door."));
    await send("Now the lamp.", start, 2);
    await fire(finished(TURN_B, "I tightened the lamp."));

    const lamp = await onlyUndo(view);
    expect(itemOf(lamp).textContent).toContain("I tightened the lamp.");
    await testing.act(async () => {
      testing.fireEvent.click(lamp);
    });
    expect(undoLast).toHaveBeenCalledTimes(1);
    const restored = await testing.waitFor(() => view.getByText("Restored 1 chapter."));
    expect(itemOf(restored).textContent).toContain("I tightened the lamp.");

    const door = await onlyUndo(view);
    expect(itemOf(door).textContent).toContain("I tightened the door.");
    await testing.act(async () => {
      testing.fireEvent.click(door);
    });
    expect(undoLast).toHaveBeenCalledTimes(2);
    await testing.waitFor(() => expect(view.getAllByText("Restored 1 chapter.")).toHaveLength(2));
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();
  });

  test("no turn offers undo while another runs, because the running turn may own the newest checkpoint", async () => {
    const { start, fire } = renderPanel({ turns: [TURN, TURN_B] });
    const view = await send("Tighten the door.", start);
    await fire(finished(TURN, "I tightened the door."));
    await onlyUndo(view);

    await send("Now the lamp.", start, 2);
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();
    await fire({ type: "tool", turnId: TURN_B, id: "call_1", name: "append_to_chapter", status: "start" });
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();

    // The lamp's turn ended without a change, so the door's turn owns the newest checkpoint again.
    await fire(finished(TURN_B, "The lamp needed nothing.", 0));
    const door = await onlyUndo(view);
    expect(itemOf(door).textContent).toContain("I tightened the door.");
  });

  test("a turn that changed nothing leaves the undo with the turn that did", async () => {
    const { start, fire } = renderPanel({ turns: [TURN, TURN_B] });
    const view = await send("Tighten the door.", start);
    await fire(finished(TURN, "I tightened the door."));
    await send("What happened to the lamp?", start, 2);
    await fire(finished(TURN_B, "The lamp went out in chapter two.", 0));

    const door = await onlyUndo(view);
    expect(itemOf(door).textContent).toContain("I tightened the door.");
  });

  test("a reopened conversation offers undo on its newest checkpoint turn, then on the one before", async () => {
    const { undoLast } = renderPanel({ seed: storedConversation([TURN, TURN_B]) });
    const view = testing.within(document.body);
    const lamp = await onlyUndo(view);
    expect(itemOf(lamp).textContent).toContain("I tightened the lamp.");
    await testing.act(async () => {
      testing.fireEvent.click(lamp);
    });
    expect(undoLast).toHaveBeenCalledTimes(1);
    const door = await onlyUndo(view);
    expect(itemOf(door).textContent).toContain("I tightened the door.");
  });

  test("a conversation whose turns were all undone offers no undo when it opens", async () => {
    renderPanel({ seed: storedConversation([]) });
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getByText("I tightened the lamp.")).toBeDefined());
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();
  });

  // A turn waiting for approval is listed only when it ends, yet what it wrote before the pause already
  // holds the newest checkpoint. A chat opened during the pause, such as from the approval
  // notification, must not offer an earlier turn's undo.
  test("a chat opened while a turn waits for approval offers no earlier turn's undo", async () => {
    const { fire } = renderPanel({ seed: storedConversation([TURN], true) });
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getByTestId("agent-approval")).toBeDefined());
    expect(view.getByText("I tightened the door.")).toBeDefined();
    expect(view.queryByTestId("agent-undo-turn")).toBeNull();

    await testing.act(async () => {
      testing.fireEvent.click(view.getByTestId("agent-approve"));
    });
    await fire(finished(TURN_B, "I replaced the lamp."));
    const lamp = await onlyUndo(view);
    expect(itemOf(lamp).textContent).toContain("I replaced the lamp.");
  });
});
