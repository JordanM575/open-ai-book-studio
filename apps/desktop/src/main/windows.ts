import { agentConversationRefSchema } from "@ai-book-studio/core/agent/messages";
import { OPEN_CONVERSATION_EVENT_CHANNEL, type OpenConversationEvent } from "@ai-book-studio/core/ipc";
import type { AgentOutcome } from "./agent/runtime";
import { sendWhenLoaded, type SignalTarget } from "./instance";

/** The parts of the studio's window this needs, so a test can stand in for Electron's. */
export interface StudioWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  readonly webContents: SignalTarget;
}

/**
 * The studio's one window: brought back when it is open, made again when it is not.
 *
 * A background turn keeps running after the author closes the window (spec 017 FR-010). When its
 * window closes, its conversation and the chapter that was open are remembered, and the next
 * window the studio makes, from the notification's click or the dock, opens on them instead of on
 * the library (FR-012) — whether the turn is still running or has since finished, failed or
 * paused for approval. A window made with nothing remembered opens as it always did.
 */
export class StudioWindows {
  private pending: OpenConversationEvent | null = null;

  constructor(
    private readonly options: {
      /** The open window, or null once it has closed. */
      current: () => StudioWindow | null;
      /** Make the window and keep it as the open one. */
      create: () => StudioWindow;
      /** A hidden run's window is never shown (`launchMode`). */
      headless: boolean;
    }
  ) {}

  /**
   * Remember the conversation of a turn that ended with no window open. A stop was the author's
   * own doing, so it also forgets a conversation remembered when that turn's window closed. A
   * window already open on the conversation — reopened while the turn still ran — is left alone.
   */
  noteOutcome(outcome: AgentOutcome): void {
    if (outcome.kind === "stopped") {
      if (this.pending?.bookId === outcome.bookId && this.pending.threadId === outcome.threadId) this.pending = null;
      return;
    }
    if (this.options.current()) return;
    const remembered =
      this.pending?.bookId === outcome.bookId && this.pending.threadId === outcome.threadId ? this.pending : null;
    this.remember({
      bookId: outcome.bookId,
      threadId: outcome.threadId,
      chapterId: outcome.chapterId ?? remembered?.chapterId
    });
  }

  /**
   * The window closed while these background turns were still running: remember the newest one's
   * conversation and open chapter, so the next window opens on them live, not only once the turn
   * has ended. The runtime names only the turns the author marked background.
   */
  noteWindowClosed(turns: Iterable<{ bookId: string; threadId: string; chapterId?: string | undefined }>): void {
    for (const turn of turns) this.remember(turn);
  }

  /** Keep one conversation for the next window, checking its ids; an id that is not a chapter is dropped. */
  private remember(ref: { bookId: string; threadId: string; chapterId?: string | undefined }): void {
    const target = agentConversationRefSchema.safeParse({
      bookId: ref.bookId,
      threadId: ref.threadId,
      ...(ref.chapterId ? { chapterId: ref.chapterId } : {})
    });
    if (target.success) {
      this.pending = target.data;
      return;
    }
    if (!ref.chapterId) return;
    const conversation = agentConversationRefSchema.safeParse({ bookId: ref.bookId, threadId: ref.threadId });
    if (conversation.success) this.pending = conversation.data;
  }

  /** Bring back the open window, or make it again, after a notification's click or a second copy. */
  show(): void {
    const window = this.options.current();
    if (!window) {
      this.open();
      return;
    }
    // A hidden test window must never surface; it still hears what it is sent.
    if (this.options.headless) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** The dock's activate: make the window when the studio has none open. */
  activate(): void {
    if (!this.options.current()) this.open();
  }

  /** Make the window; once its page listens, it opens the remembered conversation, once. */
  private open(): void {
    const window = this.options.create();
    const target = this.pending;
    this.pending = null;
    if (target) sendWhenLoaded(window.webContents, OPEN_CONVERSATION_EVENT_CHANNEL, target);
  }
}
