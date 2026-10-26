import type { ContextBreakdown } from "./agent/context";
import type { CostBasis } from "./providers/usage";

export interface AgentTurnInput {
  bookId: string;
  /** The chapter the author is looking at. The agent may still read or edit others. */
  chapterId?: string | null;
  prompt: string;
  /** Continue this conversation. Omit to start a new one. */
  threadId?: string | null;
  /**
   * A one-off connection and model for this turn. The book default is unchanged; the runtime
   * validates the model and records it on the stored turn.
   */
  model?: { connectionId: string; modelId: string };
  /**
   * Keep the turn running when the window closes and notify the author when it finishes. The
   * desktop main process owns the turn either way; this flag makes the intent explicit.
   */
  background?: boolean;
  /**
   * Plain text of earlier turns, used only when a new thread starts without stored history.
   * A stored thread is the source of truth once it exists.
   */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
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

/** The model a turn actually ran with, independent of what is selected now. */
export interface AgentTurnModel {
  provider: string;
  modelId: string;
  connectionLabel: string;
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
  | { type: "error"; turnId: string; code: string; message: string; changed?: number; undoAvailable?: boolean };
