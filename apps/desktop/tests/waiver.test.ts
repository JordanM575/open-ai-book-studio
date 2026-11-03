import { describe, expect, test } from "bun:test";
import { validateLedger } from "../../../scripts/waiver-check";

const HEADER = [
  "# Waiver ledger",
  "",
  "## Ledger",
  "",
  "| ID | Gate | Reason | Owner | Waived | Expires |",
  "|----|------|--------|-------|--------|---------|"
].join("\n");

function row(id: string, gate: string, reason: string, owner: string, waived: string, expires: string): string {
  return `| ${id} | ${gate} | ${reason} | ${owner} | ${waived} | ${expires} |`;
}

describe("waiver ledger", () => {
  test("an empty ledger passes", () => {
    const result = validateLedger(`${HEADER}\n`, "2026-11-04");
    expect(result).toEqual({ entries: [], expired: [], problems: [] });
  });

  test("a live waiver passes with its fields intact", () => {
    const text = `${HEADER}\n${row("W-001", "visual", "new runner renders differently", "J. Author", "2026-11-01", "2026-11-20")}\n`;
    const result = validateLedger(text, "2026-11-04");
    expect(result.problems).toEqual([]);
    expect(result.expired).toEqual([]);
    expect(result.entries).toEqual([
      {
        id: "W-001",
        gate: "visual",
        reason: "new runner renders differently",
        owner: "J. Author",
        waived: "2026-11-01",
        expires: "2026-11-20"
      }
    ]);
  });

  test("an expired waiver fails with its identity", () => {
    const text = `${HEADER}\n${row("W-001", "visual", "new runner renders differently", "J. Author", "2026-10-01", "2026-10-31")}\n`;
    const result = validateLedger(text, "2026-11-04");
    expect(result.problems).toEqual([]);
    expect(result.expired.map((entry) => entry.id)).toEqual(["W-001"]);
  });

  test("malformed rows name every defect", () => {
    const text = [
      HEADER,
      row("", "visual", "no id", "J. Author", "2026-11-01", "2026-11-20"),
      row("W-002", "", "no gate", "J. Author", "2026-11-01", "2026-11-20"),
      row("W-003", "smoke", "", "", "someday", "2026-13-40"),
      row("W-003", "smoke", "second live row for one gate", "J. Author", "2026-11-01", "2026-11-20")
    ].join("\n");
    const result = validateLedger(text, "2026-11-04");
    expect(result.problems).toContain("(unnamed row): missing ID");
    expect(result.problems).toContain("W-002: missing gate");
    expect(result.problems).toContain("W-003: missing reason");
    expect(result.problems).toContain("W-003: missing owner");
    expect(result.problems).toContain("W-003: bad waived date someday");
    expect(result.problems).toContain("W-003: bad expiry date 2026-13-40");
    expect(result.problems).toContain("W-003: duplicate live waiver for gate smoke");
  });

  test("a missing table header fails instead of passing silently", () => {
    const result = validateLedger("# Waiver ledger\n\nNo table here.\n", "2026-11-04");
    expect(result.problems).toEqual(["the ledger table is missing its header"]);
  });
});
