import {
  messageText,
  type AgentMessage,
  type AgentPart,
  type AgentThread
} from "./messages";

/** The newest user turns are sent unchanged. */
export const HISTORY_RECENT_TURNS = 6;
/** Older user prompts are truncated to this many characters. */
export const HISTORY_USER_MAX_CHARS = 4_000;
/** The final assistant text of an older turn is truncated to this many characters. */
export const HISTORY_SUMMARY_MAX_CHARS = 200;

export interface HistoryCompaction {
  /** A view for the model. The input thread and its messages are not changed. */
  messages: AgentMessage[];
  /** How many messages were shortened. Zero means the history was already small. */
  compacted: number;
}

/**
 * Shorten the history sent to the model without changing the stored conversation (002 FR-030).
 *
 * The last `recentTurns` user turns stay exactly as they were, including the current turn. Older
 * assistant turns are reduced to their final text and the names of the tools they used; old user
 * prompts are capped. Tool payloads, reasoning and usage are not sent for old turns. The model can
 * call `read_chapter`, `find_in_chapters` or `read_story_bible` to fetch current detail.
 */
export function compactHistory(
  thread: AgentThread,
  options: {
    recentTurns?: number;
    userMaxChars?: number;
    summaryMaxChars?: number;
  } = {}
): HistoryCompaction {
  const recentTurns = Math.max(1, options.recentTurns ?? HISTORY_RECENT_TURNS);
  const userMaxChars = Math.max(200, options.userMaxChars ?? HISTORY_USER_MAX_CHARS);
  const summaryMaxChars = Math.max(60, options.summaryMaxChars ?? HISTORY_SUMMARY_MAX_CHARS);
  const userIndices: number[] = [];
  for (const [index, message] of thread.messages.entries()) {
    if (message.role === "user") userIndices.push(index);
  }
  if (userIndices.length <= recentTurns) {
    return { messages: thread.messages, compacted: 0 };
  }

  const cutoff = userIndices[userIndices.length - recentTurns]!;
  let compacted = 0;
  const messages: AgentMessage[] = [];
  for (const [index, message] of thread.messages.entries()) {
    if (index >= cutoff) {
      messages.push(message);
      continue;
    }
    if (message.role === "user") {
      const text = messageText(message);
      if (text.length <= userMaxChars) {
        messages.push(message);
        continue;
      }
      messages.push({
        id: message.id,
        role: message.role,
        parts: [{ type: "text", text: `${text.slice(0, userMaxChars)}…` }],
        createdAt: message.createdAt
      });
      compacted += 1;
      continue;
    }

    messages.push(summarizeAssistant(message, summaryMaxChars));
    compacted += 1;
  }
  return { messages, compacted };
}

function summarizeAssistant(message: AgentMessage, summaryMaxChars: number): AgentMessage {
  const text = messageText(message);
  const tools = new Set<string>();
  let failed = false;
  for (const part of message.parts) {
    if (part.type === "tool-call" || part.type === "tool-result") tools.add(part.name);
    if (part.type === "tool-result" && part.isError) failed = true;
  }
  const summary: string[] = [];
  if (text) summary.push(truncate(text, summaryMaxChars));
  if (tools.size > 0) {
    summary.push(`Earlier tools: ${[...tools].join(", ")}${failed ? " (one failed)" : ""}.`);
  }
  if (summary.length === 0) summary.push("Earlier turn omitted.");
  const parts: AgentPart[] = [{ type: "text", text: summary.join(" ") }];
  return {
    id: message.id,
    role: message.role,
    parts,
    createdAt: message.createdAt
  };
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
