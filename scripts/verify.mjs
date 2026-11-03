#!/usr/bin/env node
/**
 * The fast command (spec 012 T004): build-info, lint, typecheck, quarantine:check,
 * the Bun suite, the desktop bundle and the web bundle — then one summary.
 *
 * Every gate streams its own output for diagnosis and owns its own redaction. This runner
 * collects only exit codes, durations and the scraped counts in verify-summary.mjs, prints
 * the single summary, and exits with the first failed gate's code (or 1). Gates after a
 * failure are reported as not run, exactly like the `&&` chain this replaces.
 */
import { spawn } from "node:child_process";
import { budgetVerdict, formatSummary, parseBunTest, parseQuarantine } from "./verify-summary.mjs";

const GATES = [
  { name: "build:info", run: ["bun", "run", "build:info"] },
  { name: "lint", run: ["bun", "run", "lint"] },
  { name: "typecheck", run: ["bun", "run", "typecheck"] },
  { name: "quarantine:check", run: ["bun", "run", "quarantine:check"] },
  { name: "waiver:check", run: ["bun", "run", "waiver:check"] },
  { name: "test", run: ["bun", "test"] },
  { name: "build", run: ["bun", "run", "build"] },
  { name: "build:web", run: ["bun", "run", "build:web"] }
];

/** Stream a gate through while keeping a bounded tail for count scraping. */
function runGate(gate) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(gate.run[0], gate.run.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const collect = (chunk) => {
      process.stdout.write(chunk);
      tail += chunk.toString("utf8");
      if (tail.length > 262_144) tail = tail.slice(-131_072);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      tail += chunk.toString("utf8");
      if (tail.length > 262_144) tail = tail.slice(-131_072);
    });
    child.on("exit", (code) => {
      resolve({ name: gate.name, ok: code === 0, ms: Date.now() - start, code: code ?? 1, tail });
    });
    child.on("error", () => {
      resolve({ name: gate.name, ok: false, ms: Date.now() - start, code: 1, tail });
    });
  });
}

const startedAt = Date.now();
const rows = [];
let tests = { pass: null, fail: null, skip: 0 };
let quarantined = null;
let exitCode = 0;

for (const gate of GATES) {
  if (exitCode !== 0) {
    rows.push({ name: gate.name, ok: false, ms: 0, code: null });
    continue;
  }
  const result = await runGate(gate);
  rows.push({ name: result.name, ok: result.ok, ms: result.ms, code: result.code });
  if (gate.name === "test") tests = parseBunTest(result.tail);
  if (gate.name === "quarantine:check") quarantined = parseQuarantine(result.tail);
  if (!result.ok) exitCode = result.code;
}

const testRow = rows.find((row) => row.name === "test");
const timing = { totalMs: Date.now() - startedAt, testMs: testRow ? testRow.ms : null };
console.log(formatSummary(rows, tests, quarantined, timing));
if (exitCode === 0 && !budgetVerdict(timing.totalMs, timing.testMs).ok) exitCode = 1;
process.exit(exitCode);
