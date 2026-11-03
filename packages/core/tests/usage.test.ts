import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@ai-book-studio/core/providers/types";
import {
  ceilingWarning,
  estimateCost,
  formatCost,
  formatUsd,
  monthlySpend,
  monthlyWarning,
  summarizeUsage,
  turnCostWarning,
  usageRecordSchema,
  type UsageRecord
} from "@ai-book-studio/core/providers/usage";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: "2026-10-24T12:00:00.000Z",
    bookId: "book_usage00001",
    provider: "openrouter",
    connectionId: "conn_usage00001",
    modelId: "openai/gpt-5-mini",
    inputTokens: 1000,
    outputTokens: 200,
    cachedInputTokens: 0,
    costUsd: 0.0042,
    costBasis: "reported",
    steps: 3,
    ...overrides
  };
}

const model: ModelInfo = {
  id: "openai/gpt-5-mini",
  name: "GPT-5 Mini",
  contextLength: 400_000,
  supportsTools: true,
  supportsImages: true,
  inputPricePerMillion: 0.25,
  outputPricePerMillion: 2
};

describe("usage", () => {
  test("never shows a known cost as zero when it is unknown", () => {
    expect(formatCost({ costUsd: null, costBasis: "unknown" })).toBe("—");
    expect(formatCost({ costUsd: null, costBasis: "reported" })).toBe("—");
    expect(formatCost({ costUsd: 0.5, costBasis: "unknown" })).toBe("—");
  });

  test("a usage record keeps the author-facing connection label", () => {
    const parsed = usageRecordSchema.parse(record({ connectionLabel: "My OpenRouter" }));

    expect(parsed.connectionLabel).toBe("My OpenRouter");
  });

  test("labels estimated, reported and plan costs differently", () => {
    expect(formatCost({ costUsd: 0.00123, costBasis: "reported" })).toBe("$0.0012");
    expect(formatCost({ costUsd: 0.00123, costBasis: "estimated" })).toBe("~$0.0012");
    expect(formatCost({ costUsd: 0, costBasis: "plan" })).toBe("Included in your plan");
  });

  test("formats small and large dollar amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00042)).toBe("$0.0004");
    expect(formatUsd(0.042)).toBe("$0.042");
    expect(formatUsd(4.2)).toBe("$4.20");
    expect(formatUsd(-1)).toBe("—");
  });

  test("sums turns and counts unknown costs without pretending they are free", () => {
    const summary = summarizeUsage([
      record(),
      record({ costUsd: 0.0058, outputTokens: 300 }),
      record({ costUsd: null, costBasis: "unknown", inputTokens: 500 }),
      record({ costUsd: 0.001, costBasis: "estimated" })
    ]);
    expect(summary.turns).toBe(4);
    expect(summary.inputTokens).toBe(3500);
    expect(summary.outputTokens).toBe(900);
    expect(summary.costUsd).toBe(0.011);
    expect(summary.unknownCostTurns).toBe(1);
    expect(summary.estimatedCostTurns).toBe(1);
  });

  test("estimates a cost only when prices are known", () => {
    expect(estimateCost(model, 1_000_000, 1_000_000)).toBe(2.25);
    expect(estimateCost({ ...model, inputPricePerMillion: null }, 1, 1)).toBeNull();
  });

  test("warns before and at a spending ceiling", () => {
    expect(ceilingWarning(1, null)).toBeNull();
    expect(ceilingWarning(1, 10)).toBeNull();
    expect(ceilingWarning(8, 10)?.level).toBe("approaching");
    expect(ceilingWarning(10, 10)?.level).toBe("reached");
    expect(ceilingWarning(12, 10)?.message).toContain("reached");
  });

  test("a per-turn warning needs a set ceiling and a priced turn", () => {
    const priced = { costUsd: 0.5, costBasis: "reported" } as const;
    expect(turnCostWarning(priced, null)).toBeNull();
    expect(turnCostWarning(priced, 0)).toBeNull();
    expect(turnCostWarning(priced, Number.NaN)).toBeNull();
    expect(turnCostWarning({ costUsd: null, costBasis: "unknown" }, 1)).toBeNull();
    expect(turnCostWarning({ costUsd: 5, costBasis: "unknown" }, 1)).toBeNull();
    expect(turnCostWarning({ costUsd: 5, costBasis: "plan" }, 1)).toBeNull();
    expect(turnCostWarning(priced, 10)).toBeNull();
  });

  test("a per-turn warning names the turn and its limit", () => {
    expect(turnCostWarning({ costUsd: 8, costBasis: "estimated" }, 10)?.level).toBe("approaching");
    const reached = turnCostWarning({ costUsd: 12, costBasis: "reported" }, 10);
    expect(reached?.level).toBe("reached");
    expect(reached?.message).toContain("This turn cost");
    expect(reached?.message).toContain("per-turn limit");
  });

  test("monthly spend counts only the current UTC month", () => {
    const now = new Date("2026-11-15T12:00:00.000Z");
    const spend = monthlySpend(
      [
        record({ at: "2026-11-01T00:00:00.000Z", costUsd: 1.5, costBasis: "reported" }),
        record({ at: "2026-10-31T23:59:59.000Z", costUsd: 100, costBasis: "reported" }),
        record({ at: "2026-11-20T00:00:00.000Z", costUsd: 0.5, costBasis: "estimated" }),
        record({ at: "2026-11-21T00:00:00.000Z", costUsd: null, costBasis: "unknown" }),
        record({ at: "not-a-date", costUsd: 50, costBasis: "reported" })
      ],
      now
    );
    expect(spend.totalUsd).toBe(2);
    expect(spend.unknownCostTurns).toBe(1);
    expect(spend.estimatedCostTurns).toBe(1);
    expect(monthlySpend([], now)).toEqual({ totalUsd: 0, unknownCostTurns: 0, estimatedCostTurns: 0 });
  });

  test("a monthly warning is a level, never a limit, and admits the lower bound", () => {
    expect(monthlyWarning({ totalUsd: 1, unknownCostTurns: 0, estimatedCostTurns: 0 }, null)).toBeNull();
    expect(monthlyWarning({ totalUsd: 1, unknownCostTurns: 0, estimatedCostTurns: 0 }, 0)).toBeNull();
    expect(monthlyWarning({ totalUsd: 1, unknownCostTurns: 0, estimatedCostTurns: 0 }, 10)).toBeNull();
    const approaching = monthlyWarning({ totalUsd: 8, unknownCostTurns: 0, estimatedCostTurns: 1 }, 10);
    expect(approaching?.level).toBe("approaching");
    expect(approaching?.message).toContain("monthly warning level");
    expect(approaching?.message).not.toContain("lower bound");
    const reached = monthlyWarning({ totalUsd: 12, unknownCostTurns: 2, estimatedCostTurns: 0 }, 10);
    expect(reached?.level).toBe("reached");
    expect(reached?.message).toContain("lower bound");
  });
});
