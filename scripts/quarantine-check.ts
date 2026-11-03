#!/usr/bin/env bun
/**
 * Spec 012 T028 quarantine gate. Reads the ledger table in `docs/QUARANTINE.md` and fails on
 * any entry past its removal date or any malformed row. Dates are compared as calendar days;
 * the entry point passes the real current day, while tests pass fixed days (FR-013: tests
 * never depend on the current time).
 *
 *   bun run quarantine:check
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER_PATH = resolve(root, "docs", "QUARANTINE.md");

export interface QuarantineEntry {
  id: string;
  test: string;
  owner: string;
  reason: string;
  quarantined: string;
  removeBy: string;
}

export interface QuarantineResult {
  entries: QuarantineEntry[];
  expired: QuarantineEntry[];
  problems: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Parse the ledger table; every malformed row is a problem, never silently skipped. */
export function validateLedger(text: string, today: string): QuarantineResult {
  const problems: string[] = [];
  const entries: QuarantineEntry[] = [];
  const seen = new Set<string>();
  const rows = text.split("\n").filter((line) => /^\|.*\|\s*$/.test(line));
  if (rows.length < 2) {
    problems.push("the ledger table is missing its header");
    return { entries, expired: [], problems };
  }
  for (const row of rows.slice(2)) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6 || cells.every((cell) => cell === "" || /^-+$/.test(cell))) continue;
    const [id, test, owner, reason, quarantined, removeBy] = cells as [string, string, string, string, string, string];
    const label = id || "(unnamed row)";
    if (!id) problems.push(`${label}: missing ID`);
    else if (seen.has(id)) problems.push(`${label}: duplicate ID`);
    else seen.add(id);
    if (!test) problems.push(`${label}: missing test reference`);
    if (!owner) problems.push(`${label}: missing owner`);
    if (!reason) problems.push(`${label}: missing reason`);
    if (!isRealDate(quarantined)) problems.push(`${label}: bad quarantined date ${quarantined}`);
    if (!isRealDate(removeBy)) problems.push(`${label}: bad removal date ${removeBy}`);
    entries.push({ id, test, owner, reason, quarantined, removeBy });
  }
  const expired = entries.filter(
    (entry) => isRealDate(entry.removeBy) && isRealDate(today) && entry.removeBy < today
  );
  return { entries, expired, problems };
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const text = await readFile(LEDGER_PATH, "utf8");
  const { entries, expired, problems } = validateLedger(text, today);
  for (const problem of problems) console.error(`[quarantine] problem: ${problem}`);
  for (const entry of expired) {
    console.error(`[quarantine] expired: ${entry.id} (${entry.test}) was due ${entry.removeBy}; fix it or remove the row`);
  }
  if (problems.length > 0 || expired.length > 0) {
    console.error(`[quarantine] gate failed: ${entries.length} entries, ${expired.length} expired, ${problems.length} malformed`);
    process.exit(1);
  }
  console.log(`[quarantine] within the T028 gate: ${entries.length} quarantined, none past removal`);
}

if (import.meta.main) {
  await main();
}
