#!/usr/bin/env bun
/**
 * Spec 012 T022 waiver gate. Reads the ledger table in `docs/WAIVERS.md` and fails on
 * any entry past its expiry date or any malformed row. Dates are compared as calendar days;
 * the entry point passes the real current day, while tests pass fixed days (FR-013: tests
 * never depend on the current time).
 *
 *   bun run waiver:check
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER_PATH = resolve(root, "docs", "WAIVERS.md");

export interface WaiverEntry {
  id: string;
  gate: string;
  reason: string;
  owner: string;
  waived: string;
  expires: string;
}

export interface WaiverResult {
  entries: WaiverEntry[];
  expired: WaiverEntry[];
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
export function validateLedger(text: string, today: string): WaiverResult {
  const problems: string[] = [];
  const entries: WaiverEntry[] = [];
  const seenIds = new Set<string>();
  const seenGates = new Set<string>();
  const rows = text.split("\n").filter((line) => /^\|.*\|\s*$/.test(line));
  if (rows.length < 2) {
    problems.push("the ledger table is missing its header");
    return { entries, expired: [], problems };
  }
  for (const row of rows.slice(2)) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6 || cells.every((cell) => cell === "" || /^-+$/.test(cell))) continue;
    const [id, gate, reason, owner, waived, expires] = cells as [string, string, string, string, string, string];
    const label = id || "(unnamed row)";
    if (!id) problems.push(`${label}: missing ID`);
    else if (seenIds.has(id)) problems.push(`${label}: duplicate ID`);
    else seenIds.add(id);
    if (!gate) problems.push(`${label}: missing gate`);
    else if (seenGates.has(gate)) problems.push(`${label}: duplicate live waiver for gate ${gate}`);
    else seenGates.add(gate);
    if (!reason) problems.push(`${label}: missing reason`);
    if (!owner) problems.push(`${label}: missing owner`);
    if (!isRealDate(waived)) problems.push(`${label}: bad waived date ${waived}`);
    if (!isRealDate(expires)) problems.push(`${label}: bad expiry date ${expires}`);
    entries.push({ id, gate, reason, owner, waived, expires });
  }
  const expired = entries.filter(
    (entry) => isRealDate(entry.expires) && isRealDate(today) && entry.expires < today
  );
  return { entries, expired, problems };
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const text = await readFile(LEDGER_PATH, "utf8");
  const { entries, expired, problems } = validateLedger(text, today);
  for (const problem of problems) console.error(`[waiver] problem: ${problem}`);
  for (const entry of expired) {
    console.error(`[waiver] expired: ${entry.id} (${entry.gate}) was due ${entry.expires}; fix the gate or remove the row`);
  }
  if (problems.length > 0 || expired.length > 0) {
    console.error(`[waiver] gate failed: ${entries.length} entries, ${expired.length} expired, ${problems.length} malformed`);
    process.exit(1);
  }
  console.log(`[waiver] within the T022 gate: ${entries.length} waived, none past expiry`);
}

if (import.meta.main) {
  await main();
}
