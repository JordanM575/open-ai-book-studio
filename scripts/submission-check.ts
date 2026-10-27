#!/usr/bin/env bun
/**
 * Local submission readiness check. It reads the tracked tree; it never publishes, pushes or calls a
 * provider. Run `bun run submission:check` before switching the repository to public.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const REQUIRED = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "docs/TOOLKIT.md",
  "docs/KEYCHAIN.md",
  "hackathon/EVENT.md",
  "hackathon/PLAN.md",
  "hackathon/SUBMISSION.md",
  "samples/README.md",
  "video/script.md",
  "video/storyboard.md",
  "video/motion/index.html"
];

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OpenRouter/OpenAI-style key", pattern: /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

export interface SampleProblem {
  book: string;
  problem: string;
}

/** Validate the committed sample library without opening it through the app (which creates .studio). */
export async function inspectSample(root: string): Promise<SampleProblem[]> {
  const problems: SampleProblem[] = [];
  const sample = join(root, "samples", "the-salt-road");
  const books = join(sample, "books");
  if (!existsSync(books)) return [{ book: "sample", problem: "samples/the-salt-road/books is missing" }];
  if (existsSync(join(sample, ".studio"))) {
    problems.push({ book: "sample", problem: "the sample commits a .studio profile; it must not" });
  }
  if (existsSync(join(sample, "library.json"))) {
    problems.push({ book: "sample", problem: "the sample commits a derived library.json; it must not" });
  }
  for (const entry of await readdir(books, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const bookRoot = join(books, entry.name);
    try {
      const book = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as {
        id?: unknown;
        title?: unknown;
      };
      if (book.id !== entry.name) problems.push({ book: entry.name, problem: "book.id does not match the folder" });
      if (typeof book.title !== "string" || !book.title.trim()) {
        problems.push({ book: entry.name, problem: "book.title is empty" });
      }
      const chapters = await readdir(join(bookRoot, "chapters"));
      if (chapters.filter((name) => name.endsWith(".md")).length < 2) {
        problems.push({ book: entry.name, problem: "fewer than two chapters" });
      }
      const manifest = JSON.parse(await readFile(join(bookRoot, "images.json"), "utf8")) as {
        images?: Array<{ fileName?: unknown; sha256?: unknown; bytes?: unknown }>;
      };
      if (!Array.isArray(manifest.images) || manifest.images.length < 2) {
        problems.push({ book: entry.name, problem: "the image manifest has fewer than two images" });
      }
      for (const image of manifest.images ?? []) {
        if (typeof image.fileName !== "string") {
          problems.push({ book: entry.name, problem: "an image record has no fileName" });
          continue;
        }
        const path = join(bookRoot, "images", image.fileName);
        if (!existsSync(path)) {
          problems.push({ book: entry.name, problem: `missing image ${image.fileName}` });
          continue;
        }
        const bytes = await readFile(path);
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (hash !== image.sha256) problems.push({ book: entry.name, problem: `${image.fileName} hash mismatch` });
        if (bytes.byteLength !== image.bytes) problems.push({ book: entry.name, problem: `${image.fileName} size mismatch` });
      }
    } catch (error) {
      problems.push({ book: entry.name, problem: (error as Error).message });
    }
  }
  if (problems.length === 0 && (await readdir(books)).length === 0) {
    problems.push({ book: "sample", problem: "the sample has no books" });
  }
  return problems;
}

const DUMMY = /test|example|dummy|1234567890|abcdef|000000/i;

export function secretProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      if (DUMMY.test(match[0])) continue;
      problems.push(`${file}: possible ${name}`);
      break;
    }
  }
  return problems;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? process.cwd());
  const problems: string[] = [];
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  /*
   * Either branch is a submission branch: `meta-hackathon` in the working repository, `main` in the
   * published one. What matters is that the tree is the submitted state, not the branch's name.
   */
  if (branch !== "meta-hackathon" && branch !== "main") {
    problems.push(`branch is ${branch}; expected meta-hackathon or main`);
  }
  const dirty = git(root, ["status", "--porcelain"]);
  if (dirty) problems.push(`working tree is not clean:\n${dirty}`);

  for (const path of REQUIRED) {
    if (!existsSync(join(root, path))) problems.push(`missing ${path}`);
  }

  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const path of tracked) {
    if (
      /(^|\/)\.env(?:\.(?:local|production|development|test))?$/.test(path) ||
      /(^|\/)credentials\.json$/.test(path) ||
      /(^|\/)userData\//.test(path) ||
      /(^|\/)release\//.test(path) ||
      /(^|\/)\.studio\//.test(path) ||
      /(^|\/)library\.json$/.test(path)
    ) {
      problems.push(`forbidden tracked path: ${path}`);
    }
  }

  for (const path of tracked) {
    if (!/\.(?:md|txt|json|ts|tsx|mjs|js|yml|yaml|toml|css|html)$/i.test(path)) continue;
    let text: string;
    try {
      text = await readFile(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (text.length > 2_000_000) continue;
    problems.push(...secretProblems(path, text));
  }

  for (const issue of await inspectSample(root)) {
    problems.push(`${issue.book}: ${issue.problem}`);
  }

  if (problems.length > 0) {
    console.error(`[submission] ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("[submission] Not ready. Fix these before making the repository public.");
    process.exit(1);
  }

  const count = git(root, ["rev-list", "--count", "HEAD"]);
  console.log("[submission] ready");
  console.log(`  branch      ${branch}`);
  console.log(`  commit      ${git(root, ["rev-parse", "--short", "HEAD"])} (${count} commits)`);
  console.log(`  tracked     ${tracked.length} files`);
  console.log("  sample      samples/the-salt-road valid");
  console.log("  next        clean clone: bun install && bun run verify && bun run smoke");
  console.log("  next        check repository and video links in a private window");
  console.log(`  root        ${relative(process.cwd(), root) || "."}`);
}

if (import.meta.main) {
  await main();
}
