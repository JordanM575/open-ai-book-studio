import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateRecord, buildRecordObject, hashArtifacts, publishRecord } from "../../../scripts/release/record.mjs";

const root = join(import.meta.dir, "..", "..", "..");
const script = join(root, "scripts", "release", "record.mjs");
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

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

function run(args: string[], cwd: string): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [script, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}

async function artifactDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "abs-record-"));
  cleanups.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

/**
 * Spec 009 T001: the machine-readable release record hashes exactly the served
 * files, carries version/commit/schema/platform/architecture/gates/signing
 * status, and refuses a mismatched file set. Only names, sizes and hashes reach
 * the record and the log — never file contents, prose or credentials.
 */
describe("release record", () => {
  test("writes a valid record for the served files", async () => {
    const dir = await artifactDir({
      "app-mac-arm64.zip": "zip-bytes-one",
      "app-mac-arm64.dmg": `dmg-bytes-two ${SECRET}`
    });
    const out = join(dir, "..", "record.json");
    cleanups.push(out);
    const result = run(
      ["--dir", dir, "--out", out, "--version", "0.1.0", "--commit", "abc123", "--schema", "1", "--gates", "typecheck,test"],
      root
    );
    expect(result.code).toBe(0);
    const record = JSON.parse(await Bun.file(out).text());
    expect(record).toMatchObject({
      schemaVersion: 1,
      version: "0.1.0",
      commit: "abc123",
      schema: 1,
      signing: { status: "unsigned" },
      unsigned: true,
      gates: ["typecheck", "test"]
    });
    expect(record.artifacts.map((artifact: { name: string }) => artifact.name)).toEqual([
      "app-mac-arm64.dmg",
      "app-mac-arm64.zip"
    ]);
    expect(record.artifacts).toContainEqual({
      name: "app-mac-arm64.dmg",
      sha256: sha256(`dmg-bytes-two ${SECRET}`),
      bytes: Buffer.byteLength(`dmg-bytes-two ${SECRET}`)
    });
    expect(validateRecord(record)).toEqual([]);
    expect(result.stdout).not.toContain(SECRET);
    expect(JSON.stringify(record)).not.toContain(SECRET);
  });

  test("refuses an empty or missing artifact directory", async () => {
    const empty = await mkdtemp(join(tmpdir(), "abs-record-empty-"));
    cleanups.push(empty);
    const refused = run(["--dir", empty, "--out", join(empty, "r.json"), "--version", "0.1.0", "--commit", "c", "--schema", "1"], root);
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain("[record]");
    const missing = run(
      ["--dir", join(empty, "nope"), "--out", join(empty, "r.json"), "--version", "0.1.0", "--commit", "c", "--schema", "1"],
      root
    );
    expect(missing.code).toBe(3);
  });

  test("refuses a file set that does not match --expect", async () => {
    const dir = await artifactDir({ "a.zip": "one", "b.zip": "two" });
    const args = (expectValue: string) => [
      "--dir", dir, "--out", join(dir, "r.json"), "--version", "0.1.0", "--commit", "c", "--schema", "1",
      "--expect", expectValue
    ];
    expect(run(args("a.zip"), root).code).toBe(3);
    expect(run(args("a.zip,b.zip,c.zip"), root).code).toBe(3);
    const exact = run(args("a.zip,b.zip"), root);
    expect(exact.code).toBe(0);
  });

  test("refuses a subdirectory inside the artifact directory", async () => {
    const dir = await artifactDir({ "a.zip": "one" });
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested", "x.txt"), "x");
    const result = run(
      ["--dir", dir, "--out", join(dir, "r.json"), "--version", "0.1.0", "--commit", "c", "--schema", "1"],
      root
    );
    expect(result.code).toBe(3);
  });

  test("refuses unusable arguments and bare signed claims", async () => {
    const dir = await artifactDir({ "a.zip": "one" });
    const base = ["--dir", dir, "--out", join(dir, "r.json"), "--commit", "c", "--schema", "1"];
    expect(run(base, root).code).toBe(2);
    expect(run([...base, "--version", "0.1.0", "--signing-status", "signed"], root).code).toBe(2);
    const signed = run(
      [...base, "--version", "0.1.0", "--signing-status", "signed", "--signing-identity", "Developer ID Application: Example"],
      root
    );
    expect(signed.code).toBe(0);
    const record = JSON.parse(await Bun.file(join(dir, "r.json")).text());
    expect(record.signing).toMatchObject({ status: "signed", identity: "Developer ID Application: Example" });
    expect(record.unsigned).toBe(false);
    expect(validateRecord(record)).toEqual([]);
  });

  test("validateRecord rejects malformed records", () => {
    const valid = buildRecordObject({
      version: "0.1.0",
      commit: "c",
      schema: 1,
      platform: "mac",
      arch: "arm64",
      artifacts: [{ name: "a.zip", sha256: "0".repeat(64), bytes: 3 }],
      gates: [],
      signing: { status: "unsigned" }
    });
    expect(validateRecord(valid)).toEqual([]);
    expect(validateRecord({ ...valid, version: "" }).length).toBeGreaterThan(0);
    expect(validateRecord({ ...valid, artifacts: [] }).length).toBeGreaterThan(0);
    expect(validateRecord({ ...valid, artifacts: [{ name: "a.zip", sha256: "zzz", bytes: 3 }] }).length).toBeGreaterThan(0);
    expect(validateRecord({ ...valid, unsigned: false }).length).toBeGreaterThan(0);
    expect(validateRecord({ ...valid, notarization: { status: "accepted" } }).length).toBeGreaterThan(0);
    expect(validateRecord(null).length).toBeGreaterThan(0);
  });

  test("refuses to replace a record that already exists and leaves it as it was", async () => {
    const dir = await artifactDir({ "app.zip": "bytes" });
    const folder = await mkdtemp(join(tmpdir(), "abs-record-out-"));
    cleanups.push(folder);
    const out = join(folder, "record.json");
    await writeFile(out, "the earlier record\n");
    const result = run(
      ["--dir", dir, "--out", out, "--version", "0.1.0", "--commit", "abc123", "--schema", "1"],
      root
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("refusing to replace the existing record");
    expect(await Bun.file(out).text()).toBe("the earlier record\n");
    expect(await readdir(folder)).toEqual(["record.json"]);
  });

  test("publishes the record without leaving a temporary file beside it", async () => {
    const dir = await artifactDir({ "app.zip": "bytes" });
    const folder = await mkdtemp(join(tmpdir(), "abs-record-out-"));
    cleanups.push(folder);
    const out = join(folder, "record.json");
    const result = run(
      ["--dir", dir, "--out", out, "--version", "0.1.0", "--commit", "abc123", "--schema", "1"],
      root
    );
    expect(result.code).toBe(0);
    expect(await readdir(folder)).toEqual(["record.json"]);
    expect(validateRecord(JSON.parse(await Bun.file(out).text()))).toEqual([]);
  });

  test("publishRecord never replaces what is already at the path", async () => {
    const folder = await mkdtemp(join(tmpdir(), "abs-record-out-"));
    cleanups.push(folder);
    const out = join(folder, "record.json");
    await publishRecord(out, "first\n");
    await expect(publishRecord(out, "second\n")).rejects.toThrow("refusing to replace");
    expect(await Bun.file(out).text()).toBe("first\n");
    expect(await readdir(folder)).toEqual(["record.json"]);
  });

  test("hashArtifacts sorts by name with sizes", async () => {
    const dir = await artifactDir({ "b.zip": "22", "a.zip": "1" });
    const artifacts = await hashArtifacts(dir);
    expect(artifacts).toEqual([
      { name: "a.zip", sha256: sha256("1"), bytes: 1 },
      { name: "b.zip", sha256: sha256("22"), bytes: 2 }
    ]);
  });
});
