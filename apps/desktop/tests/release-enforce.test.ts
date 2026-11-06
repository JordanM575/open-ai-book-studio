import { describe, expect, test } from "bun:test";
import { decide, formatDecision } from "../../../scripts/release-enforce";
import {
  buildRecord,
  diffCapabilityBlocks,
  findDesktopArtifact,
  parseVerifyGates,
  sha256Hex
} from "../../../scripts/release";

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

const GATES = [{ name: "test", ok: true }, { name: "visual", ok: false }];

describe("release enforcement", () => {
  test("a clean run goes with nothing waived", () => {
    const decision = decide([{ name: "test", ok: true }], `${HEADER}\n`, "2026-11-04");
    expect(decision).toEqual({ blocked: false, passed: ["test"], waived: [], unwaived: [], problems: [] });
    expect(formatDecision(decision)).toContain("[release] result: GO (0 waived)");
  });

  test("a failed gate with a live waiver proceeds and names the waiver", () => {
    const text = `${HEADER}\n${row("W-001", "visual", "runner renders differently", "J. Author", "2026-11-01", "2026-11-20")}\n`;
    const decision = decide(GATES, text, "2026-11-04");
    expect(decision.blocked).toBe(false);
    expect(decision.waived).toEqual([{ gate: "visual", waiver: "W-001" }]);
    const out = formatDecision(decision);
    expect(out).toContain("waived visual (W-001)");
    expect(out).toContain("[release] result: GO (1 waived)");
  });

  test("a failed gate without a waiver blocks", () => {
    const decision = decide(GATES, `${HEADER}\n`, "2026-11-04");
    expect(decision.blocked).toBe(true);
    expect(decision.unwaived).toEqual(["visual"]);
    expect(formatDecision(decision)).toContain("[release] result: BLOCKED (1 unwaived)");
  });

  test("an expired waiver blocks even when it names the gate", () => {
    const text = `${HEADER}\n${row("W-001", "visual", "runner renders differently", "J. Author", "2026-10-01", "2026-10-31")}\n`;
    const decision = decide(GATES, text, "2026-11-04");
    expect(decision.blocked).toBe(true);
    expect(decision.unwaived).toEqual(["visual"]);
    expect(decision.waived).toEqual([]);
  });

  test("a malformed ledger blocks a clean run", () => {
    const decision = decide([{ name: "test", ok: true }], "# Waiver ledger\n", "2026-11-04");
    expect(decision.blocked).toBe(true);
    expect(decision.problems).toEqual(["the ledger table is missing its header"]);
  });
});

describe("release record helpers", () => {
  test("parses the fast command summary into gate verdicts", () => {
    const output = [
      "[verify] summary",
      "[verify]   ok   lint (0.4s)",
      "[verify]   FAIL test (8.8s (exit 1))",
      "[verify]   --   build (not run)",
      "[verify] tests: 1041 pass, 1 fail, 0 skip · quarantined: 0"
    ].join("\n");
    expect(parseVerifyGates(output)).toEqual([
      { name: "lint", ok: true },
      { name: "test", ok: false },
      { name: "build", ok: false }
    ]);
    expect(parseVerifyGates("unrelated log\n")).toEqual([]);
  });

  test("finds the packaged desktop bundle, else the newest directory", () => {
    expect(findDesktopArtifact(["Open Book Studio.app", "mac-arm64", "latest.yml"])).toBe("Open Book Studio.app");
    expect(findDesktopArtifact(["linux-unpacked", "latest.yml"])).toBe("linux-unpacked");
    expect(findDesktopArtifact(["latest.yml"])).toBeNull();
    expect(findDesktopArtifact([])).toBeNull();
  });

  test("diffs capability blocks and names the baseline", () => {
    expect(diffCapabilityBlocks(null, "- a: yes")).toBe("no previous release record; this is the baseline");
    expect(diffCapabilityBlocks("- a: yes", "- a: yes")).toBe("unchanged since the previous record");
    const diff = diffCapabilityBlocks("- a: yes\n- b: no", "- a: yes\n- b: yes");
    expect(diff).toContain("< - b: no");
    expect(diff).toContain("> - b: yes");
  });

  test("the record renders exactly its structured inputs", () => {
    const record = buildRecord({
      version: "0.1.0",
      commit: "abc123",
      schemaVersion: 1,
      date: "2026-11-04",
      gates: [
        { name: "lint", ok: true },
        { name: "visual", ok: false }
      ],
      waived: [{ gate: "visual", waiver: "W-001" }],
      artifacts: [{ path: "release/web.tar.gz", sha256: "0".repeat(64) }],
      capabilityDiff: "unchanged since the previous record"
    });
    expect(record).toContain("# Release 0.1.0 (abc123)");
    expect(record).toContain("- lint: pass");
    expect(record).toContain("- visual: FAIL (waived by W-001)");
    expect(record).toContain("Signed: no");
    expect(record).toContain("- release/web.tar.gz\n  sha256 " + "0".repeat(64));
    expect(record).toContain("unchanged since the previous record");
    expect(record).toContain("Pending (spec 012 T025)");
    expect(sha256Hex(new TextEncoder().encode("bytes"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
