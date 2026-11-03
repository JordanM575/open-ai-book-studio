import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkRelease } from "../../../scripts/release/check.mjs";
import { buildRecordObject } from "../../../scripts/release/record.mjs";

const root = join(import.meta.dir, "..", "..", "..");
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// Assembled at runtime so this file never contains a key-shaped string that the
// repository secret scan would flag.
function joinParts(...parts: string[]): string {
  return parts.join("");
}
const SECRET = joinParts("sk-", "or-v1-") + joinParts("Q7mZ2vN8pR4sT6xY9aB3cD5eF", "7gH1jK2");

function validRecord() {
  return buildRecordObject({
    version: "0.1.0",
    commit: "abc123",
    schema: 1,
    platform: "mac",
    arch: "arm64",
    artifacts: [{ name: "app.tar.gz", sha256: "0".repeat(64), bytes: 4 }],
    gates: ["typecheck"],
    signing: { status: "unsigned" }
  });
}

function runCli(args: string[]): { code: number | null; out: string; err: string } {
  const result = spawnSync("node", [join(root, "scripts", "release", "check.mjs"), ...args], {
    cwd: root,
    encoding: "utf8"
  });
  return {
    code: result.status,
    out: result.stdout?.toString() ?? "",
    err: result.stderr?.toString() ?? ""
  };
}

/**
 * Spec 009 T004: the release checklist compares the record's SHA-256, version
 * and commit with the served artifact and the About values. A mismatch names
 * the field, never file contents, and the check fails.
 */
describe("release checklist", () => {
  test("matching bytes, version and commit all agree", () => {
    const results = checkRelease({
      record: validRecord(),
      artifactName: "app.tar.gz",
      artifactSha256: "0".repeat(64),
      artifactBytes: 4,
      about: { version: "0.1.0", commit: "abc123", signingStatus: "unsigned" }
    });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.name).sort()).toEqual(["bytes", "commit", "sha256", "signing", "version"]);
  });

  test("each mismatch names its field", () => {
    const record = validRecord();
    const tampered = checkRelease({
      record,
      artifactName: "app.tar.gz",
      artifactSha256: "f".repeat(64),
      artifactBytes: 4,
      about: { version: "0.1.0", commit: "abc123" }
    });
    expect(tampered.find((result) => result.name === "sha256")?.ok).toBe(false);

    const renamed = checkRelease({
      record,
      artifactName: "other.tar.gz",
      artifactSha256: "0".repeat(64),
      artifactBytes: 4,
      about: {}
    });
    expect(renamed).toEqual([
      { name: "artifact", ok: false, detail: "other.tar.gz is not listed in the record" }
    ]);

    const drifted = checkRelease({
      record,
      artifactName: "app.tar.gz",
      artifactSha256: "0".repeat(64),
      artifactBytes: 4,
      about: { version: "0.2.0", commit: "def456", signingStatus: "signed" }
    });
    const byName = new Map(drifted.map((result) => [result.name, result]));
    expect(byName.get("version")?.ok).toBe(false);
    expect(byName.get("commit")?.ok).toBe(false);
    expect(byName.get("signing")?.ok).toBe(false);
    expect(byName.get("sha256")?.ok).toBe(true);
  });

  test("a record that fails its own schema check fails the checklist", () => {
    const results = checkRelease({
      record: { ...validRecord(), artifacts: [] },
      artifactName: "app.tar.gz",
      artifactSha256: "0".repeat(64),
      artifactBytes: 4,
      about: {}
    });
    expect(results.length).toBe(1);
    expect(results[0]?.ok).toBe(false);
  });

  test("the CLI verifies a real record against real bytes end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-check-"));
    cleanups.push(dir);
    const artifact = join(dir, "app.tar.gz");
    await writeFile(artifact, `served bytes ${SECRET}\n`);
    const recordPath = join(dir, "record.json");
    const written = spawnSync(
      "node",
      [
        join(root, "scripts", "release", "record.mjs"),
        "--dir", dir,
        "--out", recordPath,
        "--version", "0.1.0",
        "--commit", "abc123",
        "--schema", "1"
      ],
      { cwd: root, encoding: "utf8" }
    );
    expect(written.status).toBe(0);

    const good = runCli(["--record", recordPath, "--artifact", artifact, "--version", "0.1.0", "--commit", "abc123"]);
    expect(good.code).toBe(0);
    expect(good.out).toContain("agree with the record");

    await writeFile(artifact, `tampered bytes ${SECRET}\n`);
    const bad = runCli(["--record", recordPath, "--artifact", artifact, "--version", "0.1.0", "--commit", "abc123"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("MISMATCH sha256");
    expect(bad.out).not.toContain(SECRET);
    expect(bad.err).not.toContain(SECRET);

    const drifted = runCli(["--record", recordPath, "--artifact", artifact, "--version", "9.9.9", "--commit", "abc123"]);
    expect(drifted.code).toBe(1);
    expect(drifted.out).toContain("MISMATCH version");
  });

  test("the CLI refuses unusable inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-check-bad-"));
    cleanups.push(dir);
    expect(runCli([]).code).toBe(2);
    expect(runCli(["--record", join(dir, "missing.json"), "--artifact", join(dir, "missing.tgz")]).code).toBe(3);
  });
});
