import type { ContextBreakdown } from "./agent/context";
import type { CostBasis } from "./providers/usage";
import type { AgentMode } from "./agent/messages";

export interface AgentTurnInput {
  bookId: string;
  /** The chapter the author is looking at. The agent may still read or edit others. */
  chapterId?: string | null | undefined;
  prompt: string;
  /**
   * The permission level of this turn. Required so a turn can never run on an
   * assumed level; callers that predate modes send `edit`, which preserves
   * the previous full-tool behavior until the composer chooses otherwise.
   */
  mode: AgentMode;
  /**
   * Optional one-turn guidance, sent with the prompt and stored with the
   * turn. Bounded at the schema; oversize input is rejected, never
   * truncated, and nothing carries it into the next turn.
   */
  guidance?: string | undefined;
  /** Continue this conversation. Omit to start a new one. */
  threadId?: string | null | undefined;
  /**
   * A one-off connection and model for this turn. The book default is unchanged; the runtime
   * validates the model and records it on the stored turn.
   */
  model?: { connectionId: string; modelId: string } | undefined;
  /**
   * Keep the turn running when the window closes and notify the author when it finishes. The
   * desktop main process owns the turn either way; this flag makes the intent explicit.
   */
  background?: boolean | undefined;
  /**
   * Plain text of earlier turns, used only when a new thread starts without stored history.
   * A stored thread is the source of truth once it exists.
   */
  history?: Array<{ role: "user" | "assistant"; text: string }> | undefined;
}

export interface AgentTurnStarted {
  turnId: string;
  /** The conversation that now contains this turn. */
  threadId: string;
}

/** The answer to a turn, for a caller that waited for it rather than watching the stream. */
export interface AgentTurnResult {
  turnId: string;
  threadId: string;
  /** What the agent said. Empty when the turn was stopped. */
  text: string;
  /** How many chapters the turn changed. */
  changed: number;
  /** The turn's cost, when the provider reported one. */
  costUsd?: number | null;
  /** True when the author stopped the turn. */
  stopped?: boolean;
}

/** What one undo of an agent turn did. */
export interface AgentUndoResult {
  /** Chapters put back the way the turn found them. */
  restored: number;
  /** Chapters left as they are, because they changed during or after the turn or could not be put back. */
  skipped: number;
  /**
   * Conflict copies undo kept before restoring a chapter someone else wrote in during the turn.
   * Present only when there is one.
   */
  kept?: Array<{ chapterId: string; title: string; savedAs: string }>;
  /** One sentence for each chapter that did not simply go back, naming it. Present only when there is one. */
  notes?: string[];
}

/** The model a turn actually ran with, independent of what is selected now. */
export interface AgentTurnModel {
  provider: string;
  modelId: string;
  connectionLabel: string;
  /** The catalogue's display name, so the conversation can name the model in plain words. */
  name?: string;
}

export type AgentEvent =
  | { type: "text"; turnId: string; delta: string }
  | { type: "reasoning"; turnId: string; delta: string }
  | {
      type: "tool";
      turnId: string;
      id: string;
      name: string;
      status: "start" | "end";
      detail?: string;
      input?: unknown;
      output?: unknown;
    }
  | { type: "approval"; turnId: string; approvalId: string; name: string; input: unknown }
  | {
      type: "done";
      turnId: string;
      text: string;
      model: AgentTurnModel;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      costBasis: CostBasis;
      contextLength: number | null;
      context: ContextBreakdown;
      changed?: number;
      undoAvailable?: boolean;
    }
  | { type: "stopped"; turnId: string; changed?: number; undoAvailable?: boolean }
  | { type: "error"; turnId: string; code: string; message: string; changed?: number; undoAvailable?: boolean; retryAfterSeconds?: number };
