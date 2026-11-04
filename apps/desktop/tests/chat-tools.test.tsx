/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { AgentEvent } from "@ai-book-studio/core/agent";

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

function renderPanel() {
  const start = mock((_request: unknown) => Promise.resolve({ ok: true, data: { turnId: TURN, threadId: "thread_tls000001" } }));
  const undoLast = mock(() => Promise.resolve({ ok: true, data: { restored: 1, skipped: 0 } }));
  const onChanged = mock(() => {});
  let emit: ((event: AgentEvent) => void) | null = null;
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    agent: {
      threads: {
        list: mock(() => Promise.resolve({ ok: true, data: [] })),
        read: mock(() => Promise.resolve({ ok: true, data: null })),
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

async function send(prompt: string, start: ReturnType<typeof mock>): Promise<ReturnType<typeof testing.within>> {
  const view = testing.within(document.body);
  const input = await testing.waitFor(() => view.getByTestId("chat-input"));
  testing.fireEvent.change(input, { target: { value: prompt } });
  testing.fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
  await testing.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
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
