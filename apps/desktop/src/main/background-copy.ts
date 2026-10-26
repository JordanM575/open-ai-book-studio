import type { AgentOutcome } from "./agent/runtime";

export interface NotificationCopy {
  title: string;
  body: string;
}

export interface WindowState {
  visible: boolean;
  focused: boolean;
}

const PREVIEW_LENGTH = 140;

/**
 * The notification says what happened without repeating the manuscript. A finished turn previews
 * the assistant's opening words; an approval pause names the tool but not its contents.
 */
export function notificationFor(outcome: AgentOutcome): NotificationCopy | null {
  switch (outcome.kind) {
    case "done": {
      const preview = previewText(outcome.text);
      return {
        title: `${outcome.bookTitle} — ready`,
        body:
          preview ||
          (outcome.changed > 0
            ? `${outcome.changed} ${outcome.changed === 1 ? "chapter" : "chapters"} changed.`
            : "The agent finished. Open the studio to read the conversation.")
      };
    }
    case "error":
      return {
        title: `${outcome.bookTitle} — the agent stopped`,
        body: outcome.message?.trim() || "The turn failed. Open the studio to see what happened."
      };
    case "approval":
      return {
        title: `${outcome.bookTitle} — needs you`,
        body: `The agent is waiting for approval to run ${outcome.approvalName ?? "a destructive action"}.`
      };
    case "stopped":
      return null;
  }
}

/**
 * Notify when the author asked for a background turn or cannot see the window. A stopped turn was
 * the author's own action, so it stays silent.
 */
export function shouldNotify(outcome: AgentOutcome, state: WindowState): boolean {
  if (outcome.kind === "stopped") return false;
  return outcome.background || !state.visible || !state.focused;
}

export function previewText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_LENGTH) return collapsed;
  return `${collapsed.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}
