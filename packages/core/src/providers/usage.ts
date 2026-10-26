import { z } from "zod";
import { providerIdSchema, type ModelInfo, type ProviderId } from "./types";

export const COST_BASES = ["reported", "estimated", "plan", "unknown"] as const;
export type CostBasis = (typeof COST_BASES)[number];

/**
 * One turn's usage, written once when the turn ends. Token counts are the totals across every
 * step of the turn, as the AI SDK reports them, not a sum of our own estimates.
 */
export const usageRecordSchema = z.object({
  at: z.string().datetime(),
  bookId: z.string().min(1),
  provider: providerIdSchema,
  connectionId: z.string().min(1),
  /** The author-facing connection name at the time of the turn. */
  connectionLabel: z.string().max(200).optional(),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  /**
   * Whether the provider reported its cache at all.
   *
   * `false` or absent means the provider measures no cache, which is different from a measured
   * cache of zero. The app must never show the second as the first (D-147).
   */
  cacheReported: z.boolean().optional(),
  /** `null` when the provider did not report a cost. Never zero as a stand-in for unknown. */
  costUsd: z.number().nonnegative().nullable(),
  costBasis: z.enum(COST_BASES),
  /** The model's context window at the time of the turn, when the catalogue reported one. */
  contextLength: z.number().int().positive().nullable().optional(),
  steps: z.number().int().nonnegative().default(1),
  requestId: z.string().max(200).optional()
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

export interface UsageSummary {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  /** Turns whose cost the provider did not report. The total is a lower bound when this is above zero. */
  unknownCostTurns: number;
  estimatedCostTurns: number;
}

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  const summary: UsageSummary = {
    turns: records.length,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    unknownCostTurns: 0,
    estimatedCostTurns: 0
  };
  for (const record of records) {
    summary.inputTokens += record.inputTokens;
    summary.outputTokens += record.outputTokens;
    summary.cachedInputTokens += record.cachedInputTokens;
    if (record.costUsd === null) {
      summary.unknownCostTurns += 1;
    } else {
      summary.costUsd += record.costUsd;
      if (record.costBasis === "estimated") summary.estimatedCostTurns += 1;
    }
  }
  summary.costUsd = roundUsd(summary.costUsd);
  return summary;
}

/** The interface never shows `$0.00` for a cost it does not know. */
export function formatCost(record: Pick<UsageRecord, "costUsd" | "costBasis">): string {
  if (record.costUsd === null || record.costBasis === "unknown") return "—";
  if (record.costBasis === "plan") return "Included in your plan";
  const amount = formatUsd(record.costUsd);
  return record.costBasis === "estimated" ? `~${amount}` : amount;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function estimateCost(model: ModelInfo, inputTokens: number, outputTokens: number): number | null {
  if (model.inputPricePerMillion === null || model.outputPricePerMillion === null) return null;
  const cost = (inputTokens * model.inputPricePerMillion + outputTokens * model.outputPricePerMillion) / 1_000_000;
  return roundUsd(cost);
}

export interface CeilingWarning {
  level: "approaching" | "reached";
  message: string;
}

/** D-116 hooks: a gentle warning at four fifths of the ceiling, a clear one at the ceiling. */
export function ceilingWarning(spentUsd: number, ceilingUsd: number | null): CeilingWarning | null {
  if (ceilingUsd === null || ceilingUsd <= 0) return null;
  if (spentUsd >= ceilingUsd) {
    return {
      level: "reached",
      message: `This book has reached its ${formatUsd(ceilingUsd)} spending limit. Raise it in settings to keep writing.`
    };
  }
  if (spentUsd >= ceilingUsd * 0.8) {
    return {
      level: "approaching",
      message: `This book has used ${formatUsd(spentUsd)} of its ${formatUsd(ceilingUsd)} spending limit.`
    };
  }
  return null;
}

export function isKnownProvider(value: string): value is ProviderId {
  return providerIdSchema.safeParse(value).success;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
