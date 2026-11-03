import { describe, expect, test } from "bun:test";
import { validateLedger } from "../../../scripts/quarantine-check";

const HEADER = [
  "| ID | Test | Owner | Reason | Quarantined | Remove by |",
  "|----|------|-------|--------|-------------|-----------|"
].join("\n");

function ledger(...rows: string[]): string {
  return `${["# Quarantine ledger", "", HEADER, ...rows].join("\n")}\n`;
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

const GOOD = ["Q-001", "apps/desktop/tests/flaky.test.ts > retries", "sam", "GPU timing flakes on CI", "2026-10-01", "2026-10-31"];

describe("quarantine gate", () => {
  test("an empty ledger passes", () => {
    expect(validateLedger(ledger(), "2026-11-03")).toEqual({ entries: [], expired: [], problems: [] });
  });

  test("a live entry passes before its removal date", () => {
    const result = validateLedger(ledger(row(GOOD)), "2026-10-15");
    expect(result.problems).toEqual([]);
    expect(result.expired).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  test("an entry past its removal date fails", () => {
    const result = validateLedger(ledger(row(GOOD)), "2026-11-01");
    expect(result.problems).toEqual([]);
    expect(result.expired.map((entry) => entry.id)).toEqual(["Q-001"]);
  });

  test("malformed rows fail with named reasons", () => {
    const result = validateLedger(
      ledger(
        row(["", "some.test.ts > thing", "sam", "no id", "2026-10-01", "2026-10-31"]),
        row(["Q-002", "", "", "", "October", "2026-13-40"])
      ),
      "2026-10-15"
    );
    expect(result.problems).toEqual([
      "(unnamed row): missing ID",
      "Q-002: missing test reference",
      "Q-002: missing owner",
      "Q-002: missing reason",
      "Q-002: bad quarantined date October",
      "Q-002: bad removal date 2026-13-40"
    ]);
  });

  test("duplicate IDs fail", () => {
    const result = validateLedger(ledger(row(GOOD), row(GOOD)), "2026-10-15");
    expect(result.problems).toEqual(["Q-001: duplicate ID"]);
  });
});
