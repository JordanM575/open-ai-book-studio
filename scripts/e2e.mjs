#!/usr/bin/env node
/**
 * Every end-to-end check in one place.
 *
 * The unit tests cover the library in process. This runs the things that only fail when a real
 * app, a real browser and a real second process are involved, in the order a person would meet
 * them:
 *
 *   smoke       the built desktop app, driven through its own renderer
 *   web         the browser build, over its own storage
 *   audit       the real window, for dead ends and missing controls
 *   glasses     the 600x600 page for Meta Ray-Ban Display, in a browser at that size
 *   ambient     the ambient agent over the control plane and the toolkit
 *   plugins     a folder of TypeScript tools, loaded by the built app
 *   bridge      the phone's half: a separate process speaking to the app over the LAN
 *
 *   bun run e2e            build, then run everything
 *   bun run e2e --no-build trust the current build
 *   bun run e2e smoke web  run only the checks named
 *
 * A live check needs keys and costs money, so it is not here. `bun run live:check` is its own gate.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const CHECKS = [
  { id: "smoke", script: "scripts/smoke.mjs", what: "the built app, through its own renderer" },
  { id: "web", script: "scripts/web-smoke.mjs", what: "the browser build and its storage" },
  { id: "audit", script: "scripts/ui-audit.mjs", what: "the real window, for dead ends" },
  { id: "glasses", script: "scripts/glasses-check.mjs", what: "the 600x600 page for the glasses" },
  { id: "ambient", script: "scripts/ambient-check.mjs", what: "the ambient agent and the toolkit" },
  { id: "plugins", script: "scripts/plugin-probe.mjs", what: "a plugin folder in the built app" },
  { id: "bridge", script: "scripts/bridge-probe.mjs", what: "the phone's half, from another process" }
];

const argv = process.argv.slice(2);
const build = !argv.includes("--no-build");
const requested = argv.filter((argument) => !argument.startsWith("--"));
const unknown = requested.filter((id) => !CHECKS.some((check) => check.id === id));
if (unknown.length > 0) {
  console.error(`[e2e] Unknown check${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  console.error(`[e2e] Known: ${CHECKS.map((check) => check.id).join(", ")}`);
  process.exit(1);
}
const selection = requested.length > 0 ? CHECKS.filter((check) => requested.includes(check.id)) : CHECKS;

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.on("close", (code) => resolveRun(code ?? 1));
    child.on("error", () => resolveRun(1));
  });
}

if (build) {
  console.log("[e2e] building the desktop app, the web build and the toolkit…");
  const built = await run("bun", ["run", "build"]);
  if (built !== 0) {
    console.error("[e2e] the desktop build failed, so there is nothing to check");
    process.exit(1);
  }
  const web = await run("bun", ["run", "build:web"]);
  if (web !== 0) {
    console.error("[e2e] the web build failed");
    process.exit(1);
  }
  const toolkit = await run("bun", ["run", "toolkit:build"]);
  if (toolkit !== 0) {
    console.error("[e2e] the toolkit build failed");
    process.exit(1);
  }
}

const results = [];
for (const check of selection) {
  const script = join(root, check.script);
  if (!existsSync(script)) {
    results.push({ ...check, ok: false, detail: "the script is missing" });
    continue;
  }
  console.log(`\n[e2e] ── ${check.id}: ${check.what}`);
  const started = Date.now();
  const code = await run(process.execPath, [script]);
  results.push({
    ...check,
    ok: code === 0,
    detail: code === 0 ? `${Math.round((Date.now() - started) / 100) / 10}s` : `exit ${code}`
  });
}

console.log("\n[e2e] ── summary");
for (const result of results) {
  console.log(`[e2e] ${result.ok ? "ok   " : "FAIL "} ${result.id.padEnd(8)} ${result.what} — ${result.detail}`);
}
const failed = results.filter((result) => !result.ok);
console.log(
  failed.length === 0
    ? `[e2e] ${results.length}/${results.length} passed`
    : `[e2e] ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`
);
process.exit(failed.length === 0 ? 0 : 1);
