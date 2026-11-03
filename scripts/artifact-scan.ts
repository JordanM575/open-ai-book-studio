#!/usr/bin/env bun
/**
 * Spec 009 T003. Scans release artifacts for credentials, environment files, source maps
 * and manuscript-like content. Fails with the file and the class, never the matching value.
 *
 * Directories are walked in place. `.tar.gz`/`.tgz` archives are extracted to a temporary
 * directory and scanned as trees; opaque containers (dmg, zip, executables) get file-name
 * checks only, because their bytes need platform tooling — the staged-tree scan of the exact
 * bytes that went into them is the control for those. Publication runs this over the artifact
 * directory and blocks on any finding.
 *
 *   bun scripts/artifact-scan.ts release/
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { secretShapes } from "../packages/core/src/providers/redact";

export type ScanClass =
  | "secret"
  | "environment file"
  | "source map"
  | "source-map reference"
  | "library content"
  | "manuscript file"
  | "credential file"
  | "unreadable";

export interface ScanFinding {
  /** Path relative to the scanned root, or the archive path plus `!` plus the inner path. */
  file: string;
  class: ScanClass;
  /** 1-based line number for content findings; omitted for name findings. Never a value. */
  line?: number;
}

/** File names that must never ship, matched against the basename (lowercased). */
const FORBIDDEN_NAMES: Array<{ test: (name: string) => boolean; class: ScanClass }> = [
  { test: (name) => name === ".env" || name.startsWith(".env."), class: "environment file" },
  { test: (name) => name.endsWith(".map"), class: "source map" },
  {
    test: (name) => name.endsWith(".pem") || name.endsWith(".key") || name === "id_rsa",
    class: "credential file"
  },
  {
    test: (name) => name.includes("credential") || name.includes("credentials"),
    class: "credential file"
  },
  {
    test: (name) =>
      ["book.json", "library.json", "images.json", "threads.json", "drafts.json"].includes(name),
    class: "library content"
  },
  { test: (name) => /^\d{4}-.*\.md$/.test(name), class: "manuscript file" }
];

/** Directory names that must never ship anywhere inside served bytes. */
const FORBIDDEN_DIRS = new Set([".studio", "chapters", "conflicts", "threads", "drafts"]);

/** Opaque containers: name-checked, never content-scanned here. */
const OPAQUE_ARCHIVES = [".dmg", ".zip", ".exe", ".pkg", ".AppImage"];

/** Content over this size is name-checked only; hashing-sized bundles stay scannable. */
const CONTENT_LIMIT_BYTES = 8 * 1024 * 1024;

const SOURCE_MAP_REFERENCE = /sourceMappingURL=/;

export function nameFinding(relativePath: string): ScanClass | null {
  const segments = relativePath.split("/");
  if (segments.some((segment) => FORBIDDEN_DIRS.has(segment))) return "manuscript file";
  const name = (segments.at(-1) ?? "").toLowerCase();
  for (const { test, class: found } of FORBIDDEN_NAMES) {
    if (test(name)) return found;
  }
  return null;
}

function contentFindings(relativePath: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const shapes = secretShapes();
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const secret = shapes.some(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(line);
    });
    if (secret) {
      findings.push({ file: relativePath, class: "secret", line: index + 1 });
      continue;
    }
    if (SOURCE_MAP_REFERENCE.test(line)) {
      findings.push({ file: relativePath, class: "source-map reference", line: index + 1 });
    }
  }
  return findings;
}

function isBinary(sample: Uint8Array): boolean {
  return sample.includes(0);
}

async function scanTree(root: string, prefix: string, findings: ScanFinding[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    findings.push({ file: prefix === "" ? "." : prefix, class: "unreadable" });
    return;
  }
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    const display = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (FORBIDDEN_DIRS.has(entry.name)) {
        findings.push({ file: display, class: "manuscript file" });
        continue;
      }
      await scanTree(absolute, display, findings);
      continue;
    }
    if (!entry.isFile()) continue;
    const named = nameFinding(display);
    if (named) {
      findings.push({ file: display, class: named });
      continue;
    }
    const snapshot = await stat(absolute).catch(() => null);
    if (!snapshot?.isFile() || snapshot.size > CONTENT_LIMIT_BYTES) continue;
    const bytes = await readFile(absolute).catch(() => null);
    if (!bytes) {
      findings.push({ file: display, class: "unreadable" });
      continue;
    }
    if (isBinary(bytes.subarray(0, 8192))) continue;
    findings.push(...contentFindings(display, new TextDecoder().decode(bytes)));
  }
}

async function scanTarball(archive: string, display: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const scratch = await mkdtemp(join(tmpdir(), "abs-scan-"));
  try {
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", scratch]);
    if (extracted.status !== 0) {
      return [{ file: display, class: "unreadable" }];
    }
    const inner: ScanFinding[] = [];
    await scanTree(scratch, "", inner);
    for (const finding of inner) {
      findings.push({ ...finding, file: `${display}!${finding.file}` });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return findings;
}

function isTarball(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

function isOpaqueArchive(path: string): boolean {
  const lower = path.toLowerCase();
  return OPAQUE_ARCHIVES.some((extension) => lower.endsWith(extension));
}

async function scanFile(absolute: string, display: string): Promise<ScanFinding[]> {
  const named = nameFinding(display);
  if (named) return [{ file: display, class: named }];
  if (isTarball(absolute)) return scanTarball(absolute, display);
  if (isOpaqueArchive(absolute)) return [];
  const snapshot = await stat(absolute).catch(() => null);
  if (!snapshot?.isFile() || snapshot.size > CONTENT_LIMIT_BYTES) return [];
  const bytes = await readFile(absolute).catch(() => null);
  if (!bytes) return [{ file: display, class: "unreadable" }];
  if (isBinary(bytes.subarray(0, 8192))) return [];
  return contentFindings(display, new TextDecoder().decode(bytes));
}

/**
 * Scans files and directories. Tarballs are extracted to a scratch directory and
 * scanned as trees; findings inside them are reported as `archive!inner/path`.
 * Only names, classes and line numbers reach the findings — never file contents.
 */
export async function scanPaths(paths: string[]): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  for (const input of paths) {
    const absolute = resolve(input);
    const snapshot = await stat(absolute).catch(() => null);
    if (!snapshot) {
      findings.push({ file: input, class: "unreadable" });
      continue;
    }
    if (snapshot.isDirectory()) {
      const inner: ScanFinding[] = [];
      await scanTree(absolute, "", inner);
      for (const finding of inner) {
        findings.push({ ...finding, file: finding.file === "." ? input : `${input}/${finding.file}` });
      }
      continue;
    }
    findings.push(...(await scanFile(absolute, input)));
  }
  return findings;
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2).filter((token) => !token.startsWith("-"));
  if (paths.length === 0) {
    process.stderr.write("usage: bun scripts/artifact-scan.ts <artifact-or-dir> [...]\n");
    process.exit(2);
  }
  const findings = await scanPaths(paths);
  for (const finding of findings) {
    process.stdout.write(
      finding.line === undefined
        ? `${finding.file}: ${finding.class}\n`
        : `${finding.file}:${finding.line}: ${finding.class}\n`
    );
  }
  if (findings.length > 0) {
    process.stderr.write(
      `[artifact-scan] refusing publication: ${findings.length} forbidden artifact finding(s)\n`
    );
    process.exit(1);
  }
  process.stdout.write("[artifact-scan] clean\n");
}

const invokedAsScript = (() => {
  try {
    return resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  await main();
}
