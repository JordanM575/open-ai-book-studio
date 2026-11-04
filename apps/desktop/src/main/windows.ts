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
 * A background turn keeps running after the author closes the window (spec 017 FR-010). When it
 * finishes, fails or pauses for approval with no window open, its conversation is remembered, and
 * the next window the studio makes, from the notification's click or the dock, opens on it instead
 * of on the library (FR-012). A window made with nothing remembered opens as it always did.
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

  /** Remember the conversation of a turn that ended with no window open. A stop was the author's own doing. */
  noteOutcome(outcome: AgentOutcome): void {
    if (outcome.kind === "stopped" || this.options.current()) return;
    const target = agentConversationRefSchema.safeParse({ bookId: outcome.bookId, threadId: outcome.threadId });
    if (target.success) this.pending = target.data;
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
