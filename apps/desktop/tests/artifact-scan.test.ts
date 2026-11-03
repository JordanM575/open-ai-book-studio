import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { nameFinding, scanPaths, type ScanFinding } from "../../../scripts/artifact-scan";

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

function classes(findings: ScanFinding[]): string[] {
  return findings.map((finding) => finding.class).sort();
}

function files(findings: ScanFinding[]): string[] {
  return findings.map((finding) => finding.file).sort();
}

async function fixtureDir(entries: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "abs-scan-"));
  cleanups.push(dir);
  for (const [name, content] of Object.entries(entries)) {
    const path = join(dir, name);
    await mkdir(join(dir, dirname(name)), { recursive: true });
    await writeFile(path, content);
  }
  return dir;
}

function runCli(dir: string): { code: number | null; out: string; err: string } {
  const result = spawnSync("bun", ["scripts/artifact-scan.ts", dir], {
    cwd: join(import.meta.dir, "..", "..", ".."),
    encoding: "utf8"
  });
  return {
    code: result.status,
    out: result.stdout?.toString() ?? "",
    err: result.stderr?.toString() ?? ""
  };
}

/**
 * Spec 009 T003: the release-artifact scan names the file and the class for
 * credentials, environment files, source maps and manuscript-like content, and
 * never prints a matching value. Publication blocks on any finding.
 */
describe("artifact scan", () => {
  test("a clean tree reports no findings", async () => {
    const dir = await fixtureDir({
      "app.js": "console.log(\"hello\");\n",
      "styles.css": "body { color: black; }\n",
      "data.json": JSON.stringify({ version: "0.1.0" })
    });
    expect(await scanPaths([dir])).toEqual([]);
  });

  test("a secret is named by class and line, never printed", async () => {
    const dir = await fixtureDir({ "bundle.js": `const key = "${SECRET}";\nconsole.log("hi");\n` });
    const findings = await scanPaths([dir]);
    expect(classes(findings)).toEqual(["secret"]);
    expect(findings[0]?.line).toBe(1);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });

  test("environment files, source maps and map references are refused", async () => {
    const dir = await fixtureDir({
      ".env": "API_KEY=abc\n",
      ".env.local": "TOKEN=xyz\n",
      "bundle.js.map": "{}",
      "app.js": "//# sourceMappingURL=app.js.map\n"
    });
    const findings = await scanPaths([dir]);
    expect(classes(findings)).toEqual([
      "environment file",
      "environment file",
      "source map",
      "source-map reference"
    ]);
  });

  test("library and manuscript content is refused by name and by directory", async () => {
    const dir = await fixtureDir({
      "book.json": JSON.stringify({ id: "book_x", title: "Leaked" }),
      "0001-the-door.md": "---\nid: ch_x\n---\nThe hall was cold.\n",
      ".studio/drafts/x.md": "unsaved prose\n",
      "credentials.json": "{}",
      "id_rsa": "key-bytes\n"
    });
    const findings = await scanPaths([dir]);
    expect(classes(findings)).toEqual([
      "credential file",
      "credential file",
      "library content",
      "manuscript file",
      "manuscript file"
    ]);
    expect(files(findings).some((file) => file.includes(".studio"))).toBe(true);
  });

  test("a tarball is extracted and scanned with archive-qualified paths", async () => {
    const staged = await fixtureDir({
      "bundle.js": `const key = "${SECRET}";\n`,
      "0002-the-gate.md": "Morning came slowly.\n"
    });
    const tarball = join(tmpdir(), `abs-scan-tar-${Date.now().toString(36)}.tar.gz`);
    cleanups.push(tarball);
    const packed = spawnSync("tar", ["-czf", tarball, "-C", staged, "."]);
    expect(packed.status).toBe(0);
    const findings = await scanPaths([tarball]);
    expect(classes(findings)).toEqual(["manuscript file", "secret"]);
    expect(files(findings).every((file) => file.startsWith(`${tarball}!`))).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });

  test("opaque containers are name-checked and missing paths are unreadable", async () => {
    const dir = await fixtureDir({ "app.dmg": "binary-bytes\n" });
    expect(await scanPaths([dir])).toEqual([]);
    const missing = await scanPaths([join(dir, "nope")]);
    expect(classes(missing)).toEqual(["unreadable"]);
  });

  test("nameFinding covers the forbidden shapes", () => {
    expect(nameFinding("a/.env")).toBe("environment file");
    expect(nameFinding("a/bundle.js.map")).toBe("source map");
    expect(nameFinding("a/book.json")).toBe("library content");
    expect(nameFinding("a/0001-x.md")).toBe("manuscript file");
    expect(nameFinding("a/.studio/b")).toBe("manuscript file");
    expect(nameFinding("a/app.js")).toBeNull();
  });

  test("the CLI exits clean or refusing without printing values", async () => {
    const clean = await fixtureDir({ "app.js": "console.log(1);\n" });
    const cleanRun = runCli(clean);
    expect(cleanRun.code).toBe(0);
    expect(cleanRun.out).toContain("clean");

    const dirty = await fixtureDir({ "bundle.js": `const key = "${SECRET}";\n` });
    const dirtyRun = runCli(dirty);
    expect(dirtyRun.code).toBe(1);
    expect(dirtyRun.out).toContain("secret");
    expect(dirtyRun.out).not.toContain(SECRET);
    expect(dirtyRun.err).not.toContain(SECRET);

    const usage = spawnSync("bun", ["scripts/artifact-scan.ts"], {
      cwd: join(import.meta.dir, "..", "..", ".."),
      encoding: "utf8"
    });
    expect(usage.status).toBe(2);
  });
});
