import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { OPEN_CONVERSATION_EVENT_CHANNEL } from "@ai-book-studio/core/ipc";
import type { AgentOutcome } from "../src/main/agent/runtime";
import { type MockNotification, mockElectron } from "./support/mock-electron";

/*
 * Where the studio's window opens after a background turn (spec 017 FR-012, filmed at 1:29). A turn
 * that ends while no window is open is remembered, and the next window the studio makes, from the
 * notification's click or the dock, opens on that conversation instead of on the library. These run
 * against the shared Electron mock, whose notifications can be clicked; the windows are stand-ins
 * that record what their page is sent.
 */
const posted: MockNotification[] = [];
mockElectron(tmpdir(), { notifications: { supported: true, posted: (notification) => posted.push(notification) } });

const { BackgroundNotifier } = await import("../src/main/background");
const { StudioWindows } = await import("../src/main/windows");

const finished: AgentOutcome = {
  kind: "done",
  turnId: "turn_reopen0001",
  bookId: "book_reopen0001",
  bookTitle: "The Salt Road",
  threadId: "thread_reopen0001",
  background: true,
  text: "The scene is ready. I added one line to “The Light”.",
  changed: 1
};

const conversation = { bookId: "book_reopen0001", threadId: "thread_reopen0001" };

/** The same turn while it is still running, on the chapter the author had open when they closed the window. */
const running = { ...conversation, chapterId: "ch_reopen0002" };

interface FakeWindow {
  sent: unknown[][];
  shown: number;
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: {
    isDestroyed(): boolean;
    isLoading(): boolean;
    once(event: "did-stop-loading", listener: () => void): unknown;
    send(channel: string, ...args: unknown[]): void;
  };
  /** The page finished loading, so the preload is listening. */
  load(): void;
}

function fakeWindow(): FakeWindow {
  let loading = true;
  const waiting: Array<() => void> = [];
  const window: FakeWindow = {
    sent: [],
    shown: 0,
    isVisible: () => true,
    isFocused: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => {
      window.shown += 1;
    },
    focus: () => {},
    webContents: {
      isDestroyed: () => false,
      isLoading: () => loading,
      once: (_event, listener) => waiting.push(listener),
      send: (channel, ...args) => window.sent.push([channel, ...args])
    },
    load() {
      loading = false;
      for (const listener of waiting.splice(0)) listener();
    }
  };
  return window;
}

/** The studio's window as the shell keeps it: one at a time, made on demand, gone once closed. */
function shell(headless = false) {
  const made: FakeWindow[] = [];
  let open: FakeWindow | null = null;
  const windows = new StudioWindows({
    current: () => open,
    create: () => {
      open = fakeWindow();
      made.push(open);
      return open;
    },
    headless
  });
  const notifier = new BackgroundNotifier(() => open as never, () => windows.show(), headless);
  return {
    windows,
    made,
    /** A turn's outcome reaches the shell the way `index.ts` passes it on. */
    outcome(outcome: AgentOutcome) {
      windows.noteOutcome(outcome);
      notifier.handle(outcome);
    },
    launch() {
      open = fakeWindow();
      made.push(open);
      return open;
    },
    close() {
      open = null;
    },
    /** The window closes while a background turn is still running, as `index.ts` reports it on `closed`. */
    closeDuring(turn: { bookId: string; threadId: string; chapterId?: string }) {
      open = null;
      windows.noteWindowClosed([turn]);
    },
    /** The window made last, which is the one each test is about. */
    newest(): FakeWindow {
      const window = made.at(-1);
      if (!window) throw new Error("No window was made.");
      return window;
    }
  };
}

/** The author clicks the notification the studio posted last. */
function clickNotification(): void {
  const notification = posted.at(-1);
  if (!notification) throw new Error("No notification was posted.");
  notification.click();
}

describe("reopening after a background turn", () => {
  test("the notification's click opens a new window on the finished conversation", () => {
    posted.length = 0;
    const studio = shell();
    studio.launch();
    studio.close();
    studio.outcome(finished);
    expect(posted).toHaveLength(1);

    clickNotification();
    expect(studio.made).toHaveLength(2);
    const reopened = studio.newest();
    // Sent once the page has loaded, when the preload is listening.
    expect(reopened.sent).toEqual([]);
    reopened.load();
    expect(reopened.sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, conversation]]);
  });

  test("the dock's activate opens the same conversation", () => {
    const studio = shell();
    studio.outcome(finished);
    studio.windows.activate();
    const reopened = studio.newest();
    reopened.load();
    expect(reopened.sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, conversation]]);
  });

  test("a turn waiting for approval, or one that failed, reopens on its conversation too", () => {
    for (const kind of ["approval", "error"] as const) {
      const studio = shell();
      studio.outcome({ ...finished, kind, approvalName: "overwrite_chapter", message: "The provider refused." });
      studio.windows.activate();
      studio.newest().load();
      expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, conversation]]);
    }
  });

  test("the conversation is opened once; the next reopen is an ordinary one", () => {
    const studio = shell();
    studio.outcome(finished);
    studio.windows.activate();
    studio.newest().load();
    studio.close();

    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("a reopen with nothing remembered opens on the library, as before", () => {
    const studio = shell();
    studio.windows.show();
    studio.windows.activate();
    expect(studio.made).toHaveLength(1);
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("a turn that finished while the window was open leaves nothing to reopen", () => {
    const studio = shell();
    studio.launch();
    studio.outcome(finished);
    studio.close();
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("a turn the author stopped leaves nothing to reopen", () => {
    const studio = shell();
    studio.outcome({ ...finished, kind: "stopped" });
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("ids that are not a book and a thread are never sent to the page", () => {
    const studio = shell();
    studio.outcome({ ...finished, threadId: "../../etc" });
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("with the window open, a click brings it back and makes no other", () => {
    posted.length = 0;
    const studio = shell();
    const window = studio.launch();
    studio.outcome({ ...finished, background: true });
    clickNotification();
    expect(studio.made).toHaveLength(1);
    expect(window.shown).toBe(1);
    studio.windows.activate();
    expect(studio.made).toHaveLength(1);
  });

  test("reopening while the turn still runs opens its conversation and its open chapter", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring(running);

    // The dock, before the turn has finished: no outcome has been noted yet.
    studio.windows.activate();
    expect(studio.made).toHaveLength(2);
    const reopened = studio.newest();
    reopened.load();
    expect(reopened.sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, running]]);
  });

  test("a turn that finishes after a mid-turn reopen is not sent to that window again", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring(running);
    studio.windows.activate();
    const reopened = studio.newest();
    reopened.load();

    // The reopened window is already on the conversation when the turn ends, so the outcome
    // neither routes it a second time nor leaves anything for the next ordinary reopen.
    studio.outcome({ ...finished, chapterId: running.chapterId });
    expect(reopened.sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, running]]);
    studio.close();
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("a turn that finishes after its window closed reopens on the chapter it was open on", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring(running);
    // The outcome itself need not name the chapter: the close already remembered it.
    studio.outcome(finished);
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, running]]);
  });

  test("a finished turn's own chapter is remembered when nothing was noted at the close", () => {
    const studio = shell();
    studio.outcome({ ...finished, chapterId: running.chapterId });
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, running]]);
  });

  test("closing again while the turn still runs remembers it for the next window too", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring(running);
    studio.windows.activate();
    studio.newest().load();
    studio.closeDuring(running);
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, running]]);
  });

  test("an id that is not a chapter is dropped, and the conversation still opens", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring({ ...conversation, chapterId: "../../etc" });
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, conversation]]);
  });

  test("a remembered turn the author then stopped leaves nothing to reopen", () => {
    const studio = shell();
    studio.launch();
    studio.closeDuring(running);
    studio.outcome({ ...finished, kind: "stopped" });
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([]);
  });

  test("a hidden run's window is never shown, though a new one still opens on the conversation", () => {
    const studio = shell(true);
    const window = studio.launch();
    studio.windows.show();
    expect(window.shown).toBe(0);
    studio.close();
    studio.outcome(finished);
    studio.windows.activate();
    studio.newest().load();
    expect(studio.newest().sent).toEqual([[OPEN_CONVERSATION_EVENT_CHANNEL, conversation]]);
  });
});
