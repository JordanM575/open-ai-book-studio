/**
 * Waiver-aware release verdict (spec 012 T023).
 *
 * Pure decision logic behind `scripts/release.ts` and the Gitea release job: given the gates
 * that failed, the waiver ledger text and today, decide whether the release is blocked. A
 * failed gate proceeds only with a live waiver that names it; an expired or malformed
 * ledger blocks everything. Only gate names, waiver IDs and dates flow through here —
 * never build output, prose or credentials.
 */
import { validateLedger } from "./waiver-check";

export interface GateResult {
  name: string;
  ok: boolean;
}

export interface WaivedGate {
  gate: string;
  waiver: string;
}

export interface ReleaseDecision {
  blocked: boolean;
  passed: string[];
  waived: WaivedGate[];
  unwaived: string[];
  problems: string[];
}

export function decide(gates: GateResult[], waiversText: string, today: string): ReleaseDecision {
  const { entries, expired, problems } = validateLedger(waiversText, today);
  const passed = gates.filter((gate) => gate.ok).map((gate) => gate.name);
  const failed = gates.filter((gate) => !gate.ok).map((gate) => gate.name);
  const live = new Map(entries.filter((entry) => !expired.includes(entry)).map((entry) => [entry.gate, entry.id]));
  const waived: WaivedGate[] = [];
  const unwaived: string[] = [];
  for (const gate of failed) {
    const waiver = live.get(gate);
    if (waiver === undefined) unwaived.push(gate);
    else waived.push({ gate, waiver });
  }
  return { blocked: unwaived.length > 0 || expired.length > 0 || problems.length > 0, passed, waived, unwaived, problems };
}

export function formatDecision(decision: ReleaseDecision): string {
  const lines = ["[release] verdict"];
  for (const gate of decision.passed) lines.push(`[release]   ok   ${gate}`);
  for (const { gate, waiver } of decision.waived) lines.push(`[release]   waived ${gate} (${waiver})`);
  for (const gate of decision.unwaived) lines.push(`[release]   FAIL ${gate} (no live waiver)`);
  for (const problem of decision.problems) lines.push(`[release]   problem: ${problem}`);
  lines.push(
    `[release] result: ${decision.blocked ? `BLOCKED (${decision.unwaived.length} unwaived)` : `GO (${decision.waived.length} waived)`}`
  );
  return lines.join("\n");
}
