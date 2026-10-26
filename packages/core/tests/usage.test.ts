import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@ai-book-studio/core/providers/types";
import {
  ceilingWarning,
  estimateCost,
  formatCost,
  formatUsd,
  summarizeUsage,
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
});
