/**
 * Pure helpers behind `scripts/verify.mjs` (spec 012 T004).
 *
 * The fast command streams every gate's own output for diagnosis, then prints one summary.
 * The summary carries counts only — gate names, durations, exit codes, pass/fail/skip and the
 * quarantined count. It never echoes captured output lines, so no credential or manuscript text
 * can leak through it; redaction stays each gate's own job.
 */

/** Counts scraped from `bun test` output. Missing numbers stay null, never guessed. */
export function parseBunTest(output) {
  const pick = (pattern) => {
    const match = output.match(pattern);
    return match ? Number.parseInt(match[1], 10) : null;
  };
  return {
    pass: pick(/^ *(\d+) pass$/m),
    fail: pick(/^ *(\d+) fail$/m),
    skip: pick(/^ *(\d+) skip$/m) ?? 0
  };
}

/** Fast-command budgets (spec 012 T029, FR-024/FR-025): the whole fast command must finish
 * within 5 minutes and the suite gate within 20 minutes on the reference machine. */
export const FAST_BUDGET_MS = 5 * 60 * 1000;
export const SUITE_BUDGET_MS = 20 * 60 * 1000;

function fmtDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

/** Budget verdict from measured milliseconds; pure so tests can use synthetic durations. */
export function budgetVerdict(totalMs, testMs, tag = "verify") {
  const breaches = [];
  if (totalMs > FAST_BUDGET_MS) breaches.push(`total ${fmtDuration(totalMs)} > ${fmtDuration(FAST_BUDGET_MS)} fast budget`);
  if ((testMs ?? 0) > SUITE_BUDGET_MS) breaches.push(`suite ${fmtDuration(testMs ?? 0)} > ${fmtDuration(SUITE_BUDGET_MS)} suite budget`);
  if (breaches.length > 0) return { ok: false, line: `[${tag}] budget: FAIL (${breaches.join("; ")})` };
  return {
    ok: true,
    line: `[${tag}] budget: within ${fmtDuration(FAST_BUDGET_MS)} fast / ${fmtDuration(SUITE_BUDGET_MS)} suite (total ${fmtDuration(totalMs)}, suite ${fmtDuration(testMs ?? 0)})`
  };
}

/** Quarantined count scraped from `quarantine:check` output. Null when unrecognised. */
export function parseQuarantine(output) {
  const ok = output.match(/\[quarantine\] within the T028 gate: (\d+) quarantined/);
  if (ok) return Number.parseInt(ok[1], 10);
  const failed = output.match(/\[quarantine\] gate failed: (\d+) entries/);
  if (failed) return Number.parseInt(failed[1], 10);
  return null;
}

function formatCount(value) {
  return value === null ? "?" : String(value);
}

/**
 * One line per gate plus the test/quarantine roll-up. Rows carry
 * { name, ok, ms, code } where ok is false for failed or unreached gates.
 * Timing { totalMs, testMs } adds the T029 budget line and can fail an otherwise
 * green run; omit it only when no clock was kept.
 */
export function formatSummary(rows, tests, quarantined, timing, tag = "verify") {
  const lines = [`[${tag}] summary`];
  for (const row of rows) {
    const state = row.ok ? "ok  " : row.code === null ? "--  " : "FAIL";
    const seconds = (row.ms / 1000).toFixed(row.ms < 10_000 ? 1 : 0);
    const rowTiming = row.code === null ? "not run" : `${seconds}s${row.ok ? "" : ` (exit ${row.code})`}`;
    lines.push(`[${tag}]   ${state} ${row.name} (${rowTiming})`);
  }
  const failed = rows.filter((row) => !row.ok && row.code !== null).length;
  const unrun = rows.filter((row) => row.code === null).length;
  lines.push(
    `[${tag}] tests: ${formatCount(tests.pass)} pass, ${formatCount(tests.fail)} fail, ${tests.skip} skip · quarantined: ${formatCount(quarantined)}`
  );
  const budget = timing ? budgetVerdict(timing.totalMs, timing.testMs, tag) : null;
  if (budget) lines.push(budget.line);
  if (failed > 0) lines.push(`[${tag}] result: FAIL (${failed} failed${unrun > 0 ? `, ${unrun} not run` : ""})`);
  else if (budget && !budget.ok) lines.push(`[${tag}] result: FAIL (over budget)`);
  else lines.push(`[${tag}] result: PASS`);
  return lines.join("\n");
}
