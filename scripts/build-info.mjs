#!/usr/bin/env node
/**
 * Print the version, commit and schema every artifact is built from.
 *
 * The root package.json is the single version source. The workspace packages must agree with it;
 * a mismatch fails here rather than producing two artifacts that call themselves different builds.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVars } from "./build-vars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let vars;
try {
  vars = buildVars();
} catch (error) {
  console.error(`[build:info] ${error instanceof Error ? error.message : String(error)}`);
  console.error("Set the same version in every package.json and try again.");
  process.exit(1);
}

const { version, commit } = vars;
let dirty = false;
try {
  dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
} catch {
  dirty = false;
}

const info = {
  target: process.env.BUILD_TARGET ?? "all",
  version,
  commit: commit || "unknown",
  schemaVersion: 1,
  dirty
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(info, null, 2));
} else {
  for (const [key, value] of Object.entries(info)) console.log(`${key}: ${value}`);
}
