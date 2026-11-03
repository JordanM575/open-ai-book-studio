export interface BunTestCounts {
  pass: number | null;
  fail: number | null;
  skip: number;
}
export interface VerifyRow {
  name: string;
  ok: boolean;
  ms: number;
  code: number | null;
}
export declare function parseBunTest(output: string): BunTestCounts;
export declare function parseQuarantine(output: string): number | null;
export interface VerifyTiming {
  totalMs: number;
  testMs: number | null;
}
export interface BudgetVerdict {
  ok: boolean;
  line: string;
}
export declare const FAST_BUDGET_MS: number;
export declare const SUITE_BUDGET_MS: number;
export declare function budgetVerdict(totalMs: number, testMs: number | null, tag?: string): BudgetVerdict;
export declare function formatSummary(
  rows: VerifyRow[],
  tests: BunTestCounts,
  quarantined: number | null,
  timing?: VerifyTiming,
  tag?: string
): string;
