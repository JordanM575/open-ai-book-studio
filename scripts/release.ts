#!/usr/bin/env bun
/**
 * Spec 012 T023 release gate. Runs the full suite, packaged end-to-end and artifact checks,
 * and blocks on any failing gate without a live waiver.
 *
 * Order: clean tree → `bun run verify` (fast gates plus both bundles) → desktop smoke,
 * web smoke and packaged smoke against those exact artifacts → web/desktop archives with
 * checksums → artifact scan → waiver-aware verdict → release record. Promotion reuses the
 * exact artifacts; nothing rebuilds between staging and the demo (013 FR-032).
 *
 * Only versions, commits, checksums, gate names and waiver IDs reach the log and the
 * record — never build output, prose or credentials. Signing, notarisation and
 * auto-update stay out entirely (D-115, deferred). The manual checklist is T025.
 *
 *   bun run release
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitiesFor, type BuildCapability, type BuildTarget } from "../packages/core/src/build";
import { decide, formatDecision, type GateResult } from "./release-enforce";
import { formatSummary, parseBunTest, parseQuarantine } from "./verify-summary.mjs";
import { LEDGER_PATH as WAIVER_LEDGER } from "./waiver-check";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_DIR = resolve(root, "release");
const RECORD_DIR = resolve(root, "releases");

interface StageResult {
  name: string;
  ok: boolean;
  ms: number;
  code: number | null;
}

const stageRows: StageResult[] = [];

function run(
  label: string,
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): { ok: boolean; output: string; ms: number; code: number | null } {
  console.log(`[release] stage: ${label}`);
  const start = Date.now();
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output) process.stdout.write(output);
  const code = result.status ?? (result.error ? 1 : 0);
  stageRows.push({ name: label, ok: code === 0, ms: Date.now() - start, code });
  return { ok: code === 0, output: output.length > 262_144 ? output.slice(-131_072) : output, ms: Date.now() - start, code };
}

/** Scrape the per-gate verdicts the fast command prints. Unknown lines are ignored, never guessed. */
export function parseVerifyGates(output: string): GateResult[] {
  const gates: GateResult[] = [];
  for (const line of output.split("\n")) {
    const ok = line.match(/\[verify\]\s+ok\s+(\S+)/);
    if (ok?.[1]) {
      gates.push({ name: ok[1], ok: true });
      continue;
    }
    const failed = line.match(/\[verify\]\s+(?:FAIL|--)\s+(\S+)/);
    if (failed?.[1]) gates.push({ name: failed[1], ok: false });
  }
  return gates;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  return sha256Hex(await readFile(path));
}

/** Pick the packaged desktop app inside the release directory: a bundle first, else the newest directory. */
export function findDesktopArtifact(names: string[]): string | null {
  const bundle = names.find((name) => name.endsWith(".app"));
  if (bundle) return bundle;
  const dirs = names.filter((name) => !name.includes("."));
  if (dirs.length === 0) return null;
  return dirs.sort()[dirs.length - 1] ?? null;
}

function capabilityBlock(target: BuildTarget): string {
  return capabilitiesFor(target)
    .map((capability: BuildCapability) => `- ${capability.id}: ${capability.available ? "yes" : `no — ${capability.reason ?? "unavailable"}`}`)
    .join("\n");
}

/** Line diff of the capability block against the previous record; null when there is no previous record. */
export function diffCapabilityBlocks(previous: string | null, current: string): string {
  if (previous === null) return "no previous release record; this is the baseline";
  const before = new Set(previous.split("\n"));
  const after = new Set(current.split("\n"));
  const added = [...after].filter((line) => !before.has(line));
  const removed = [...before].filter((line) => !after.has(line));
  if (added.length === 0 && removed.length === 0) return "unchanged since the previous record";
  return [...removed.map((line) => `< ${line}`), ...added.map((line) => `> ${line}`)].join("\n");
}

export interface ReleaseRecordInput {
  version: string;
  commit: string;
  schemaVersion: number;
  date: string;
  gates: GateResult[];
  waived: Array<{ gate: string; waiver: string }>;
  artifacts: Array<{ path: string; sha256: string }>;
  capabilityDiff: string;
}

export function buildRecord(input: ReleaseRecordInput): string {
  const gateLines = input.gates.map((gate) => {
    const waiver = input.waived.find((entry) => entry.gate === gate.name);
    return `- ${gate.name}: ${gate.ok ? "pass" : `FAIL${waiver ? ` (waived by ${waiver.waiver})` : " (blocking)"}`}`;
  });
  const waiverLines =
    input.waived.length === 0
      ? "none"
      : input.waived.map((entry) => `- ${entry.waiver} covers ${entry.gate}`).join("\n");
  const artifactLines = input.artifacts.map((artifact) => `- ${artifact.path}\n  sha256 ${artifact.sha256}`).join("\n");
  return [
    `# Release ${input.version} (${input.commit})`,
    "",
    `Date: ${input.date}`,
    `Schema: ${input.schemaVersion}`,
    "Signed: no — unsigned build, shared only with informed testers (D-115 deferred).",
    "",
    "## Gates",
    "",
    ...gateLines,
    "",
    "## Waivers",
    "",
    waiverLines,
    "",
    "## Artifacts",
    "",
    artifactLines,
    "",
    "## Capability differences",
    "",
    input.capabilityDiff,
    "",
    "<!-- capabilities:start -->",
    "### desktop",
    "",
    capabilityBlock("desktop"),
    "",
    "### web",
    "",
    capabilityBlock("web"),
    "<!-- capabilities:end -->",
    "",
    "## Manual checklist",
    "",
    "Pending (spec 012 T025): docs/DEPLOYMENT.md appendix — desktop launch, fixture book,",
    "agent panel, web welcome, tier disclosure, no studio-owned traffic, unsigned label.",
    ""
  ].join("\n");
}

function buildInfo(): { version: string; commit: string; schemaVersion: number } {
  const result = run("build-info", "bun", ["run", "build:info"]);
  const version = result.output.match(/^version: (.+)$/m)?.[1]?.trim() ?? "unknown";
  const commit = result.output.match(/^commit: (.+)$/m)?.[1]?.trim() ?? "unknown";
  const schemaVersion = Number.parseInt(result.output.match(/^schemaVersion: (.+)$/m)?.[1]?.trim() ?? "0", 10);
  return { version, commit, schemaVersion };
}

async function main(): Promise<void> {
  const dirty = spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).stdout.trim();
  if (dirty) {
    console.error("[release] BLOCKED: the tree is not clean; commit or set aside changes first:");
    console.error(dirty);
    process.exit(1);
  }

  const info = buildInfo();
  const gates: GateResult[] = [];

  const verify = run("verify", "bun", ["run", "verify"]);
  gates.push(...parseVerifyGates(verify.output));
  if (!verify.ok) gates.push({ name: "verify", ok: false });

  const freshBuild =
    gates.find((gate) => gate.name === "build")?.ok === true &&
    gates.find((gate) => gate.name === "build:web")?.ok === true;
  if (!freshBuild) {
    console.error("[release] BLOCKED: no fresh bundles to test; the build gates must pass unwaived.");
    process.exit(1);
  }

  const smoke = run("smoke", "bun", ["run", "smoke:run"]);
  gates.push({ name: "smoke", ok: smoke.ok });
  const webSmoke = run("web-smoke", "node", ["scripts/web-smoke.mjs"]);
  gates.push({ name: "web-smoke", ok: webSmoke.ok });
  const packaged = run("package", "bun", ["run", "package:dir"]);
  gates.push({ name: "package", ok: packaged.ok });
  if (packaged.ok) {
    const packagedSmoke = run("smoke:packaged", "bun", ["scripts/smoke.mjs"], { SMOKE_PACKAGED: "1" });
    gates.push({ name: "smoke:packaged", ok: packagedSmoke.ok });
  } else {
    gates.push({ name: "smoke:packaged", ok: false });
  }

  await mkdir(RELEASE_DIR, { recursive: true });
  const webTar = join(RELEASE_DIR, `ai-book-studio-web-${info.version}-${info.commit}.tar.gz`);
  const webTarRun = run("archive-web", "tar", ["-czf", webTar, "-C", resolve(root, "apps", "web"), "dist"]);
  const artifacts: Array<{ path: string; sha256: string }> = [];
  if (webTarRun.ok) artifacts.push({ path: webTar, sha256: await sha256File(webTar) });

  const names = await readdir(RELEASE_DIR);
  const desktopName = findDesktopArtifact(names.filter((name) => name !== basename(webTar)));
  let desktopTar = "";
  if (desktopName) {
    desktopTar = join(RELEASE_DIR, `ai-book-studio-desktop-${info.version}-${info.commit}.tar.gz`);
    const desktopTarRun = run("archive-desktop", "tar", ["-czf", desktopTar, "-C", RELEASE_DIR, desktopName]);
    if (desktopTarRun.ok) artifacts.push({ path: desktopTar, sha256: await sha256File(desktopTar) });
  }
  const scan = run("artifact-scan", "bun", ["run", "submission:check"]);
  gates.push({ name: "artifact-scan", ok: scan.ok });
  const releaseScan = run("release-artifact-scan", "bun", ["scripts/artifact-scan.ts", RELEASE_DIR]);
  gates.push({ name: "release-artifact-scan", ok: releaseScan.ok });

  const waiversText = await readFile(WAIVER_LEDGER, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const decision = decide(
    gates.map((gate) => ({ name: gate.name, ok: gate.ok })),
    waiversText,
    today
  );
  console.log(formatDecision(decision));
  const printSummary = (): void => {
    console.log(formatSummary(stageRows, parseBunTest(verify.output), parseQuarantine(verify.output), undefined, "release"));
  };
  if (decision.blocked) {
    printSummary();
    console.error("[release] BLOCKED: fix the unwaived gates or record waivers in docs/WAIVERS.md.");
    process.exit(1);
  }

  const records = (await readdir(RECORD_DIR).catch(() => [] as string[])).filter((name) => name.endsWith(".md")).sort();
  const last = records.length === 0 ? undefined : records[records.length - 1];
  const previous = last === undefined ? null : await readFile(join(RECORD_DIR, last), "utf8");
  const previousBlock = previous?.match(/<!-- capabilities:start -->([\s\S]*)<!-- capabilities:end -->/)?.[1]?.trim() ?? null;
  const currentBlock = `### desktop\n\n${capabilityBlock("desktop")}\n\n### web\n\n${capabilityBlock("web")}`;
  await mkdir(RECORD_DIR, { recursive: true });
  const recordPath = join(RECORD_DIR, `${info.version}-${info.commit}.md`);
  await writeFile(
    recordPath,
    buildRecord({
      version: info.version,
      commit: info.commit,
      schemaVersion: info.schemaVersion,
      date: today,
      gates,
      waived: decision.waived,
      artifacts,
      capabilityDiff: diffCapabilityBlocks(previousBlock, currentBlock)
    }),
    "utf8"
  );
  console.log(`[release] record: ${recordPath}`);
  console.log("[release] manual checklist stays pending (spec 012 T025): docs/DEPLOYMENT.md appendix.");
  printSummary();
}

if (import.meta.main) {
  await main();
}
