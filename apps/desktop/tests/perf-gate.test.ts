import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  chapterText,
  exceedsRegression,
  mulberry32,
  type PerfActual,
  type PerfBaseline
} from "../../../scripts/perf-check";

const BASELINE_PATH = new URL("../../../scripts/perf-baseline.json", import.meta.url);

function baseline(overrides: Partial<PerfBaseline> = {}): PerfBaseline {
  return {
    openMs: 30,
    switchMs: 0.25,
    saveMs: 15,
    bundleBytes: 770_000,
    bundleGzipBytes: 227_000,
    welcomeMs: 140,
    ...overrides
  };
}

function actual(overrides: Partial<PerfActual> = {}): PerfActual {
  return { ...baseline(), words: 250_000, chapters: 120, ...overrides };
}

describe("performance gate", () => {
  test("the synthetic prose is deterministic", () => {
    expect(chapterText(mulberry32(7), 90)).toBe(chapterText(mulberry32(7), 90));
    expect(chapterText(mulberry32(7), 90)).not.toBe(chapterText(mulberry32(8), 90));
  });

  test("book open fails at double, not below", () => {
    expect(exceedsRegression(actual({ openMs: 60 }), baseline()).open).toBe(true);
    expect(exceedsRegression(actual({ openMs: 59.99 }), baseline()).open).toBe(false);
  });

  test("the bundle fails past twenty percent, not at it", () => {
    expect(exceedsRegression(actual({ bundleBytes: 924_001 }), baseline()).bundle).toBe(true);
    expect(exceedsRegression(actual({ bundleBytes: 924_000 }), baseline()).bundle).toBe(false);
  });

  test("reported-only timings never gate", () => {
    const gate = exceedsRegression(
      actual({ switchMs: 10_000, saveMs: 10_000, welcomeMs: 10_000, bundleGzipBytes: 10_000_000 }),
      baseline()
    );
    expect(gate).toEqual({ open: false, bundle: false });
  });

  test("the committed baseline is complete and positive", () => {
    const committed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PerfBaseline;
    for (const key of ["openMs", "switchMs", "saveMs", "bundleBytes", "bundleGzipBytes", "welcomeMs"] as const) {
      expect(typeof committed[key]).toBe("number");
      expect(committed[key]).toBeGreaterThan(0);
    }
  });
});
