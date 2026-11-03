import { describe, expect, test } from "bun:test";
import {
  FAST_BUDGET_MS,
  SUITE_BUDGET_MS,
  budgetVerdict,
  formatSummary,
  parseBunTest,
  parseQuarantine
} from "../../../scripts/verify-summary.mjs";

// Every secret below is assembled at runtime so this file never contains a key-shaped
// string that the repository secret scan would flag.
function joinParts(...parts: string[]): string {
  return parts.join("");
}

describe("verify summary", () => {
  test("parses the bun test counts, defaulting skips to zero", () => {
    expect(parseBunTest(" 1042 pass\n 0 fail\nRan 1042 tests across 118 files. [8.79s]\n")).toEqual({
      pass: 1042,
      fail: 0,
      skip: 0
    });
    expect(parseBunTest(" 1 pass\n 1 skip\n 0 fail\nRan 2 tests across 1 file.\n")).toEqual({
      pass: 1,
      fail: 0,
      skip: 1
    });
  });

  test("missing counts stay null, never guessed", () => {
    expect(parseBunTest("")).toEqual({ pass: null, fail: null, skip: 0 });
    expect(parseBunTest(" 3 pass\n")).toEqual({ pass: 3, fail: null, skip: 0 });
  });

  test("parses the quarantined count from either quarantine outcome", () => {
    expect(parseQuarantine("[quarantine] within the T028 gate: 0 quarantined, none past removal\n")).toBe(0);
    expect(parseQuarantine("[quarantine] gate failed: 2 entries, 1 expired, 0 malformed\n")).toBe(2);
    expect(parseQuarantine("unrelated output\n")).toBeNull();
  });

  test("formats passing and failing runs with durations and roll-ups", () => {
    const rows = [
      { name: "lint", ok: true, ms: 1200, code: 0 },
      { name: "test", ok: false, ms: 9300, code: 1 },
      { name: "build", ok: false, ms: 0, code: null }
    ];
    const out = formatSummary(rows, { pass: 1041, fail: 1, skip: 0 }, 0);
    expect(out).toContain("[verify] summary");
    expect(out).toContain("ok   lint");
    expect(out).toContain("FAIL test");
    expect(out).toContain("not run");
    expect(out).toContain("tests: 1041 pass, 1 fail, 0 skip · quarantined: 0");
    expect(out).toContain("[verify] result: FAIL (1 failed, 1 not run)");
  });

  test("formats a clean run and unknown counts without guessing", () => {
    const out = formatSummary([{ name: "lint", ok: true, ms: 800, code: 0 }], { pass: null, fail: null, skip: 0 }, null);
    expect(out).toContain("[verify] result: PASS");
    expect(out).toContain("tests: ? pass, ? fail, 0 skip · quarantined: ?");
  });

  test("a green run within budget reports the budget and passes", () => {
    const rows = [{ name: "lint", ok: true, ms: 800, code: 0 }];
    const out = formatSummary(rows, { pass: 1, fail: 0, skip: 0 }, 0, { totalMs: 9_000, testMs: 1_200 });
    expect(out).toContain("[verify] budget: within 5m00s fast / 20m00s suite");
    expect(out).toContain("[verify] result: PASS");
  });

  test("a green run over budget fails with the breach named", () => {
    const rows = [{ name: "lint", ok: true, ms: 800, code: 0 }];
    const out = formatSummary(rows, { pass: 1, fail: 0, skip: 0 }, 0, {
      totalMs: FAST_BUDGET_MS + 1,
      testMs: 1_200
    });
    expect(out).toContain("[verify] budget: FAIL (total 5m01s > 5m00s fast budget)");
    expect(out).toContain("[verify] result: FAIL (over budget)");
  });

  test("the summary carries a custom tag for non-verify runs", () => {
    const rows = [{ name: "smoke", ok: true, ms: 800, code: 0 }];
    const out = formatSummary(rows, { pass: 1, fail: 0, skip: 0 }, 0, undefined, "release");
    expect(out).toContain("[release] summary");
    expect(out).toContain("[release]   ok   smoke");
    expect(out).toContain("[release] tests: 1 pass, 0 fail, 0 skip · quarantined: 0");
    expect(out).toContain("[release] result: PASS");
    expect(out).not.toContain("[verify]");
  });

  test("budget verdicts cover suite breaches and missing suite timings", () => {
    expect(budgetVerdict(9_000, SUITE_BUDGET_MS + 1).ok).toBe(false);
    expect(budgetVerdict(9_000, SUITE_BUDGET_MS + 1).line).toContain("suite 20m01s > 20m00s suite budget");
    expect(budgetVerdict(FAST_BUDGET_MS, SUITE_BUDGET_MS)).toEqual({
      ok: true,
      line: "[verify] budget: within 5m00s fast / 20m00s suite (total 5m00s, suite 20m00s)"
    });
    expect(budgetVerdict(9_000, null).ok).toBe(true);
  });

  test("the summary never echoes captured output, even key-shaped text", () => {
    const secret = `${joinParts("sk", "-", "or-v1")}-${joinParts("Q7mZ2vN8pR4sT6xY9aB3cD5eF", "7gH1jK2")}`;
    const tests = parseBunTest(` 1 pass\n 0 fail\nconsole error leaked ${secret}\n`);
    const out = formatSummary([{ name: "test", ok: true, ms: 500, code: 0 }], tests, 0);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(joinParts("Q7mZ2vN8pR4sT6xY9aB3cD5eF"));
    expect(out).toContain("tests: 1 pass, 0 fail, 0 skip");
  });
});
