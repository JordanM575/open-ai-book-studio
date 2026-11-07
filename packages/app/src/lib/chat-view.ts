import {
  messageText,
  type AgentApprovalPart,
  type AgentErrorPart,
  type AgentMessage,
  type AgentMode,
  type AgentUsage
} from "@ai-book-studio/core/agent/messages";
import type { ContextBreakdown } from "@ai-book-studio/core/agent/context";
import { formatCost } from "@ai-book-studio/core/providers/usage";

export type ToolNote = {
  id?: string;
  name: string;
  status: "start" | "end";
  detail?: string;
  input?: unknown;
  output?: unknown;
};

export interface Approval {
  id: string;
  turnId: string;
  name: string;
  input: unknown;
  status: "pending" | "approved" | "denied" | "expired";
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  contextLength?: number | null | undefined;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolNote[];
  mode?: AgentMode | undefined;
  guidance?: string | undefined;
  note?: string | undefined;
  failed?: boolean | undefined;
  retryable?: boolean | undefined;
  errorCode?: string | undefined;
  /** Seconds the provider asked the studio to wait, when the failed turn named one. */
  retryAfterSeconds?: number | undefined;
  turnId?: string | undefined;
  changed?: number | undefined;
  undoAvailable?: boolean | undefined;
  /** Destructive tool calls waiting for, or answered by, the author. */
  approvals?: Approval[] | undefined;
  /** Where the request's estimated context went. */
  context?: ContextBreakdown | undefined;
  /** The provider's reported tokens for the turn, and the model's window when it is known. */
  usage?: TurnUsage | undefined;
  /** Connection label and model id used for this turn; shown when it changes. */
  model?: string | undefined;
}

const TOOL_LABELS: Record<string, string> = {
  table_of_contents: "Read the chapter list",
  read_story_bible: "Read the Story Bible",
  read_chapter: "Read a chapter",
  find_in_chapter: "Searched a chapter",
  find_in_chapters: "Searched the book",
  chapter_stats: "Counted the words",
  replace_in_chapter: "Edited a chapter",
  overwrite_chapter: "Asked to replace a chapter",
  insert_at_line: "Inserted a line",
  delete_lines_in_chapter: "Asked to delete lines",
  append_to_chapter: "Added text",
  create_chapter: "Started a chapter",
  delete_chapter: "Asked to delete a chapter",
  move_chapter: "Asked to move a chapter",
  split_chapter: "Asked to split a chapter",
  merge_chapters: "Asked to merge chapters",
  set_chapter_meta: "Updated the chapter details",
  update_book_details: "Updated the book details",
  update_character: "Updated a character",
  add_memory: "Saved a memory",
  update_memory: "Updated a memory",
  remove_memory: "Asked to remove a memory"
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "Worked on the book";
}

const KEPT_NOTES: Record<string, string> = {
  overwrite_chapter: "Left the chapter as you wrote it. The replacement is kept as a conflict copy.",
  delete_lines_in_chapter: "Left the chapter as you wrote it. No lines were deleted.",
  split_chapter: "Left the chapter as you wrote it. Nothing was split.",
  merge_chapters: "Left the chapters as you wrote them. Nothing was merged."
};

/**
 * What a destructive call did when the chapter changed after it was proposed, such as words saved
 * during its approval pause (ADR 0014 decision 6): it wrote over nothing, and an overwrite kept its text
 * as a conflict copy. Said in the studio's words on the step itself. Null for any other result.
 */
export function keptNote(tool: ToolNote): { text: string; savedAs?: string } | null {
  if (tool.status !== "end" || !tool.output || typeof tool.output !== "object") return null;
  const { ok, changedSinceRead, savedAs } = tool.output as Record<string, unknown>;
  const text = KEPT_NOTES[tool.name];
  if (ok !== false || changedSinceRead !== true || !text) return null;
  return typeof savedAs === "string" ? { text, savedAs } : { text };
}

/** A tool is running until its result arrives, and failed when the result says it did not work. */
export function toolStatus(tool: ToolNote): "running" | "done" | "error" {
  if (tool.status === "start") return "running";
  const output = tool.output;
  return output && typeof output === "object" && "ok" in output && output.ok === false ? "error" : "done";
}

export function approvalLabel(name: string): string {
  switch (name) {
    case "remove_memory":
      return "Remove a saved memory?";
    case "overwrite_chapter":
      return "Replace a chapter's text?";
    case "delete_chapter":
      return "Move a chapter to the trash?";
    case "delete_lines_in_chapter":
      return "Delete lines from a chapter?";
    case "move_chapter":
      return "Move a chapter?";
    case "split_chapter":
      return "Split a chapter?";
    case "merge_chapters":
      return "Merge two chapters?";
    default:
      return "Allow this change?";
  }
}

/**
 * A provider-named wait in the author's own words. No false precision: anything under a
 * minute and a half is about a minute, anything longer is about that many minutes.
 */
export function waitWords(seconds: number): string {
  if (seconds < 90) return "in about a minute";
  return `in about ${Math.round(seconds / 60)} minutes`;
}

/** One usage line, shared by a live turn and a reloaded message. */
export function usageNote(
  usage: Pick<AgentUsage, "inputTokens" | "outputTokens" | "costUsd" | "costBasis" | "contextLength">
): string {
  const cost = usage.costBasis === "unknown" ? "cost not reported" : formatCost(usage);
  const context =
    usage.contextLength && usage.contextLength > 0
      ? ` · ${Math.min(100, Math.round((usage.inputTokens / usage.contextLength) * 100))}% of ${usage.contextLength.toLocaleString()} context`
      : "";
  return `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out · ${cost}${context}`;
}

/** The raw tool detail, shown only inside a closed disclosure in the conversation. */
export function toolDetailText(tool: ToolNote): string {
  const pieces: string[] = [];
  if (tool.detail) pieces.push(tool.detail);
  if (tool.input !== undefined) pieces.push(`Input:\n${formatValue(tool.input)}`);
  if (tool.output !== undefined) pieces.push(`Output:\n${formatValue(tool.output)}`);
  return pieces.join("\n\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return truncate(value, 4_000);
  try {
    return truncate(JSON.stringify(value, null, 2) ?? String(value), 4_000);
  } catch {
    return String(value);
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** Turn a stored message back into the panel's view model. */
export function toChatMessage(message: AgentMessage, latestCheckpointTurn: string | undefined): Message {
  const tools: ToolNote[] = [];
  for (const part of message.parts) {
    if (part.type === "tool-call") {
      tools.push({ id: part.id, name: part.name, status: "start", input: part.input });
    } else if (part.type === "tool-result") {
      const index = tools.findIndex((tool) => tool.id === part.id && tool.status === "start");
      const note: ToolNote = {
        id: part.id,
        name: part.name,
        status: "end",
        ...(index >= 0 && tools[index]?.input !== undefined ? { input: tools[index]!.input } : {}),
        output: part.output,
        ...(part.isError ? { detail: "The tool failed." } : {})
      };
      if (index >= 0) tools[index] = note;
      else tools.push(note);
    }
  }
  const error = message.parts.find((part): part is AgentErrorPart => part.type === "error");
  const stopped = error?.code === "stopped";
  const approvals: Approval[] = message.parts
    .filter((part): part is AgentApprovalPart => part.type === "approval")
    .map((part) => ({
      id: part.approvalId,
      turnId: part.turnId,
      name: part.name,
      input: part.input,
      status: part.status
    }));
  const pending = approvals.some((approval) => approval.status === "pending");
  const usage = message.usage ? usageNote(message.usage) : undefined;
  const undoAvailable = Boolean(message.turnId && message.turnId === latestCheckpointTurn);
  return {
    id: message.id,
    role: message.role,
    text: messageText(message),
    mode: message.mode,
    guidance: message.parts.filter((part) => part.type === "guidance").map((part) => part.text).join("\n") || undefined,
    tools,
    ...(approvals.length > 0 ? { approvals } : {}),
    ...(message.context ? { context: message.context } : {}),
    ...(message.usage
      ? {
          usage: {
            inputTokens: message.usage.inputTokens,
            outputTokens: message.usage.outputTokens,
            contextLength: message.usage.contextLength
          }
        }
      : {}),
    ...(message.model
      ? {
          model: message.model.connectionLabel
            ? `${message.model.connectionLabel} · ${message.model.name ?? message.model.modelId}`
            : (message.model.name ?? message.model.modelId)
        }
      : {}),
    ...(error && !stopped
      ? {
          failed: true,
          retryable: false,
          note: error.message,
          errorCode: error.code,
          ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {})
        }
      : error
        ? { note: error.message }
        : pending
          ? { note: "Waiting for your approval." }
          : usage
            ? { note: usage }
            : {}),
    ...(message.turnId ? { turnId: message.turnId, changed: undoAvailable ? 1 : 0, undoAvailable } : {})
  };
}
