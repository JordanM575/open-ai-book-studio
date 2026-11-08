/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import type {
  HandsFreePort,
  HandsFreeSnapshot,
  HandsFreeTurn,
} from "@ai-book-studio/app/lib/hands-free";

let testing!: typeof import("@testing-library/react/pure");
let HandsFreeBar!: typeof import("@ai-book-studio/app/components/HandsFreeBar").HandsFreeBar;
let ChatPanel!: typeof import("@ai-book-studio/app/components/ChatPanel").ChatPanel;

beforeAll(async () => {
  testing = await mountDom();
  ({ HandsFreeBar } = await import("@ai-book-studio/app/components/HandsFreeBar"));
  ({ ChatPanel } = await import("@ai-book-studio/app/components/ChatPanel"));
});
afterAll(async () => {
  await unmountDom();
});
afterEach(() => testing.cleanup());

/*
 * 017 T017: the mounted Discuss controls, driven by a synthetic host adapter.
 *
 * The adapter is a test double, not a capture implementation: it reports facts, opens and closes a
 * fake capture, and answers a segment with text. Nothing here touches the microphone, the OS, a
 * provider or the author's profile.
 */

const BOOK = "book_synthetic";
const CHAPTER = "chapter_synthetic";
const THREAD = "thread_synthetic";
const AT = "2026-01-01T00:00:00.000Z";

const IDENTITY = {
  hostId: "host_synthetic",
  windowId: "synthetic-window",
  frameId: "synthetic-frame",
  origin: "file://",
  libraryId: "library_synthetic",
} as const;

const ROUTE = {
  connectionId: "conn_synthetic",
  provider: "meta",
  model: "synthetic-transcribe",
  destination: "synthetic",
  voice: null,
  revision: 1,
} as const;

const GRANT = {
  grantId: "grant_synthetic",
  sessionId: "session_synthetic",
  generation: 1,
  hostId: IDENTITY.hostId,
  windowId: IDENTITY.windowId,
  frameId: IDENTITY.frameId,
  origin: IDENTITY.origin,
  active: true,
  audioOnly: true,
  expiresAt: 60_000,
} as const;

interface FakePort {
  port: HandsFreePort;
  startCapture: ReturnType<typeof mock>;
  stopCapture: ReturnType<typeof mock>;
  transcribeSegment: ReturnType<typeof mock>;
  emitSegment: (segmentId: number) => void;
}

function makePort(options: {
  grant?: unknown;
  text?: string;
  startCapture?: () => Promise<{ ok: boolean; reason?: string }>;
  stopCapture?: () => Promise<{ ok: boolean; reason?: string }>;
} = {}): FakePort {
  const grant = options.grant === undefined ? GRANT : options.grant;
  let listener: ((segment: { segmentId: number }) => void) | null = null;
  const startCapture = mock(options.startCapture ?? (() => Promise.resolve({ ok: true })));
  const stopCapture = mock(options.stopCapture ?? (() => Promise.resolve({ ok: true })));
  const transcribeSegment = mock(() => Promise.resolve({ ok: true as const, text: options.text ?? "The gate was open." }));
  const port: HandsFreePort = {
    snapshot: async (): Promise<HandsFreeSnapshot> => ({
      identity: IDENTITY,
      routes: { stt: ROUTE, tts: null, agent: ROUTE },
      grant: grant as HandsFreeSnapshot["grant"],
      sourceDigest: "sha256:synthetic-source",
      available: true,
      visible: true,
      unlocked: true,
    }),
    now: () => 1_000,
    startCapture,
    stopCapture,
    transcribeSegment,
    onSegment(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  return {
    port,
    startCapture,
    stopCapture,
    transcribeSegment,
    emitSegment: (segmentId: number) => listener?.({ segmentId }),
  };
}

function renderBar(
  port: HandsFreePort | undefined,
  onSendTurn = mock((_turn: HandsFreeTurn) => Promise.resolve({ ok: true })),
  threadId: string | null = THREAD
): { view: ReturnType<typeof testing.within>; onSendTurn: typeof onSendTurn } {
  testing.render(
    React.createElement(HandsFreeBar, {
      bookId: BOOK,
      chapterId: CHAPTER,
      threadId,
      ...(port ? { port } : {}),
      onSendTurn,
      onNotice: () => {},
      disabled: false,
    })
  );
  return { view: testing.within(document.body), onSendTurn };
}

function status(view: ReturnType<typeof testing.within>): string {
  return view.getByTestId("hands-free-status").textContent ?? "";
}

async function beginSession(view: ReturnType<typeof testing.within>): Promise<void> {
  await testing.waitFor(() => expect((view.getByTestId("hands-free-start") as HTMLButtonElement).disabled).toBe(false));
  await testing.act(async () => {
    testing.fireEvent.click(view.getByTestId("hands-free-start"));
  });
  await testing.waitFor(() => expect(status(view)).toContain("Listening"));
}

async function speak(view: ReturnType<typeof testing.within>, fake: FakePort, text?: string): Promise<void> {
  await testing.act(async () => {
    fake.emitSegment(1);
  });
  await testing.waitFor(() => expect((view.getByTestId("hands-free-draft") as HTMLTextAreaElement).value).toBe(text ?? "The gate was open."));
}

describe("mounted hands-free controls", () => {
  test("without a host adapter the reason is shown and Start is disabled", async () => {
    const { view } = renderBar(undefined);
    await testing.waitFor(() =>
      expect(status(view)).toBe("Hands-free audio is not connected in this build, so nothing is recorded or sent.")
    );
    expect((view.getByTestId("hands-free-start") as HTMLButtonElement).disabled).toBe(true);
    expect(view.queryByTestId("hands-free-draft")).toBeNull();
  });

  test("a host without an audio grant refuses by name and records nothing", async () => {
    const fake = makePort({ grant: null });
    const { view } = renderBar(fake.port);
    await testing.waitFor(() =>
      expect(status(view)).toBe("No audio grant is active for this conversation. Nothing was recorded.")
    );
    expect((view.getByTestId("hands-free-start") as HTMLButtonElement).disabled).toBe(true);
    expect(fake.startCapture).not.toHaveBeenCalled();
  });

  test("grant then start opens capture once and shows the listening state", async () => {
    const fake = makePort();
    const { view } = renderBar(fake.port);
    await beginSession(view);
    expect(fake.startCapture).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("hands-free-stop")).toBeDefined();
    expect(view.queryByTestId("hands-free-confirm")).toBeNull();
  });

  test("the transcript is editable and a correction never sends by itself", async () => {
    const fake = makePort();
    const { view, onSendTurn } = renderBar(fake.port);
    await beginSession(view);
    await speak(view, fake);
    expect(status(view)).toContain("Correct the words");

    const draft = view.getByTestId("hands-free-draft") as HTMLTextAreaElement;
    await testing.act(async () => {
      testing.fireEvent.change(draft, { target: { value: "The gate was locked." } });
    });
    await testing.waitFor(() =>
      expect((view.getByTestId("hands-free-draft") as HTMLTextAreaElement).value).toBe("The gate was locked.")
    );
    expect(onSendTurn).not.toHaveBeenCalled();
  });

  test("one confirm sends one Discuss turn to the exact bound thread", async () => {
    const fake = makePort();
    let release!: () => void;
    const onSendTurn = mock(
      (_turn: HandsFreeTurn) => new Promise<{ ok: boolean }>((resolve) => {
        release = () => resolve({ ok: true });
      })
    );
    const { view } = renderBar(fake.port, onSendTurn);
    await beginSession(view);
    await speak(view, fake);

    const confirm = view.getByTestId("hands-free-confirm");
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    await testing.act(async () => {
      testing.fireEvent.click(confirm);
      testing.fireEvent.click(confirm);
    });
    await testing.waitFor(() => expect(onSendTurn).toHaveBeenCalledTimes(1));
    expect(onSendTurn.mock.calls[0]?.[0]).toEqual({
      text: "The gate was open.",
      bookId: BOOK,
      chapterId: CHAPTER,
      threadId: THREAD,
      mode: "discuss",
    });
    expect(status(view)).toContain("Sending your turn");
    await testing.act(async () => {
      release();
    });
    await testing.waitFor(() => expect(view.getByTestId("hands-free-note").textContent).toContain("Sent to this conversation."));
  });

  test("a different conversation ends the session and keeps the words unsent", async () => {
    const fake = makePort();
    const onSendTurn = mock((_turn: HandsFreeTurn) => Promise.resolve({ ok: true }));
    const view = testing.within(document.body);
    const props = {
      bookId: BOOK,
      chapterId: CHAPTER,
      port: fake.port,
      onSendTurn,
      onNotice: () => {},
      disabled: false,
    };
    const rendered = testing.render(React.createElement(HandsFreeBar, { ...props, threadId: THREAD }));
    await beginSession(view);
    await speak(view, fake);

    await testing.act(async () => {
      rendered.rerender(React.createElement(HandsFreeBar, { ...props, threadId: "thread_other" }));
    });
    await testing.waitFor(() => expect(view.getByTestId("hands-free-preserved").textContent).toContain("The gate was open."));
    expect(status(view)).not.toContain("Correct the words");
    expect(view.queryByTestId("hands-free-confirm")).toBeNull();
    expect(onSendTurn).not.toHaveBeenCalled();
  });

  test("stop waits for the host result before it says stopped, and late words cannot send", async () => {
    let holdStop = false;
    let releaseStop!: () => void;
    const fake = makePort({
      stopCapture: () => {
        if (!holdStop) return Promise.resolve({ ok: true });
        return new Promise<{ ok: boolean }>((resolve) => {
          releaseStop = () => resolve({ ok: true });
        });
      },
    });
    const onSendTurn = mock((_turn: HandsFreeTurn) => Promise.resolve({ ok: true }));
    const { view } = renderBar(fake.port, onSendTurn);
    await beginSession(view);
    await speak(view, fake);
    holdStop = true;

    await testing.act(async () => {
      testing.fireEvent.click(view.getByTestId("hands-free-stop"));
    });
    await testing.waitFor(() => expect(status(view)).toContain("Stopping"));
    expect(status(view)).not.toContain("Stopped");

    await testing.act(async () => {
      releaseStop();
    });
    await testing.waitFor(() => expect(status(view)).toBe("Stopped."));

    await testing.act(async () => {
      fake.emitSegment(2);
    });
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(view.queryByTestId("hands-free-draft")).toBeNull();
    expect(view.queryByTestId("hands-free-confirm")).toBeNull();
    expect(onSendTurn).not.toHaveBeenCalled();
  });

  test("a stop the host does not confirm is never reported as stopped", async () => {
    const fake = makePort({
      stopCapture: () => Promise.resolve({ ok: false, reason: "Track stop failed." }),
    });
    const { view } = renderBar(fake.port);
    await beginSession(view);
    await testing.act(async () => {
      testing.fireEvent.click(view.getByTestId("hands-free-stop"));
    });
    await testing.waitFor(() => expect(view.getByTestId("hands-free-status").getAttribute("role")).toBe("alert"));
    expect(status(view)).toContain("Stop was not confirmed");
    expect(status(view)).not.toContain("Stopped");
    expect(view.queryByTestId("hands-free-confirm")).toBeNull();
  });

  test("the status is announced and every control is keyboard reachable", async () => {
    const fake = makePort();
    const { view, onSendTurn } = renderBar(fake.port);
    const line = view.getByTestId("hands-free-status");
    expect(line.getAttribute("role")).toBe("status");
    expect(line.getAttribute("aria-live")).toBe("polite");
    const start = view.getByTestId("hands-free-start") as HTMLButtonElement;
    expect(start.tagName).toBe("BUTTON");
    await testing.waitFor(() => expect(start.disabled).toBe(false));
    start.focus();
    expect(document.activeElement).toBe(start);

    await beginSession(view);
    await speak(view, fake);
    const draft = view.getByTestId("hands-free-draft") as HTMLTextAreaElement;
    expect(draft.tagName).toBe("TEXTAREA");
    draft.focus();
    expect(document.activeElement).toBe(draft);
    const confirm = view.getByTestId("hands-free-confirm") as HTMLButtonElement;
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    await testing.act(async () => {
      testing.fireEvent.click(confirm);
    });
    await testing.waitFor(() => expect(onSendTurn).toHaveBeenCalledTimes(1));
  });
});

describe("Discuss panel binding", () => {
  test("a confirmed turn reuses the checked agent start with the loaded thread", async () => {
    const fake = makePort();
    const start = mock((_request: unknown) =>
      Promise.resolve({ ok: true, data: { turnId: "turn_voice", threadId: THREAD } })
    );
    let emit: ((event: AgentEvent) => void) | null = null;
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      platform: "darwin",
      agent: {
        threads: {
          list: mock(() =>
            Promise.resolve({
              ok: true,
              data: [{ id: THREAD, title: "A conversation", createdAt: AT, updatedAt: AT, messageCount: 0, preview: "" }],
            })
          ),
          read: mock(() =>
            Promise.resolve({
              ok: true,
              data: {
                schemaVersion: 1,
                id: THREAD,
                bookId: BOOK,
                title: "A conversation",
                createdAt: AT,
                updatedAt: AT,
                messages: [],
                checkpointTurns: [],
              },
            })
          ),
          fork: mock(() => Promise.resolve({ ok: true, data: null })),
          remove: mock(() => Promise.resolve({ ok: true, data: null })),
          rename: mock(() => Promise.resolve({ ok: true, data: null })),
        },
        start,
        stop: mock(() => Promise.resolve({ ok: true, data: null })),
        approve: mock(() => Promise.resolve({ ok: true, data: null })),
        undoLast: mock(() => Promise.resolve({ ok: true, data: null })),
        onEvent: mock((handler: (event: AgentEvent) => void) => {
          emit = handler;
          return () => {
            emit = null;
          };
        }),
      },
    };
    testing.render(
      React.createElement(ChatPanel, {
        bookId: BOOK,
        chapterId: CHAPTER,
        onClose: () => {},
        onBeforeSend: async () => {},
        onChanged: () => {},
        onReconnect: () => {},
        onChooseModel: () => {},
        onChooseTurnModel: () => {},
        onTurnModelUsed: () => {},
        onNotice: () => {},
        handsFreePort: fake.port,
      })
    );
    const view = testing.within(document.body);
    await beginSession(view);
    await speak(view, fake);
    await testing.act(async () => {
      testing.fireEvent.click(view.getByTestId("hands-free-confirm"));
    });
    await testing.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      bookId: BOOK,
      chapterId: CHAPTER,
      threadId: THREAD,
      prompt: "The gate was open.",
      mode: "discuss",
    });
    // The one send path records the author's message in the conversation too.
    expect(view.getByText("The gate was open.")).toBeDefined();
    expect(emit).not.toBeNull();
  });
});

describe("StrictMode mount", () => {
  test("a development double-effect does not leave the store disposed", async () => {
    const fake = makePort();
    testing.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(HandsFreeBar, {
          bookId: BOOK,
          chapterId: CHAPTER,
          threadId: THREAD,
          port: fake.port,
          onSendTurn: mock(() => Promise.resolve({ ok: true })),
          onNotice: () => {},
          disabled: false,
        }),
      ),
    );
    const view = testing.within(document.body);
    await testing.waitFor(() =>
      expect((view.getByTestId("hands-free-start") as HTMLButtonElement).disabled).toBe(false));
    await testing.act(async () => {
      testing.fireEvent.click(view.getByTestId("hands-free-start"));
    });
    await testing.waitFor(() => expect(fake.startCapture).toHaveBeenCalledTimes(1));
    await testing.waitFor(() => expect(status(view)).toContain("Listening"));
  });
});
