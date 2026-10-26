#!/usr/bin/env node
/**
 * Runs the built web app in a hidden Chromium window with a throwaway profile.
 *
 *   bun run build:web
 *   node scripts/web-smoke.mjs
 *
 * It opens browser storage, writes a book and chapter, saves prose, reopens it and reports
 * one line per check. No author profile or library is touched.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "web", "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("[web-smoke] No web build found. Run `bun run build:web` first.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(dist, relative);
  if (!file.startsWith(dist) || !existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-web-smoke-"));
const profile = join(temp, "profile");
const resultPath = join(temp, "result.json");
const appDir = join(root, "scripts", "web-smoke");
const electron = createRequire(join(root, "apps", "desktop", "package.json"))("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.WEB_SMOKE_URL = url;
env.WEB_SMOKE_PROFILE = profile;
env.WEB_SMOKE_RESULT = resultPath;

console.log(`[web-smoke] hidden run · ${url}`);
const child = spawn(electron, [appDir], { cwd: root, env, stdio: "inherit" });

let finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearInterval(poll);
  child.kill("SIGKILL");
  await rm(temp, { recursive: true, force: true }).catch(() => {});
  server.close();
  process.exit(code);
}

async function collect() {
  try {
    const info = await stat(resultPath);
    if (info.size === 0) return;
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    for (const check of result.checks) {
      console.log(`[web-smoke] ${check.ok ? "ok  " : "FAIL"} ${check.name} — ${check.detail}`);
    }
    if (result.consoleErrors.length > 0) {
      for (const message of result.consoleErrors) console.error(`[web-smoke] page error: ${message}`);
    }
    const passed = result.checks.filter((check) => check.ok).length;
    console.log(`[web-smoke] ${passed}/${result.checks.length} checks passed`);
    await finish(result.ok ? 0 : 1);
  } catch {
    // The child is still writing or has not finished yet.
  }
}

const poll = setInterval(() => void collect(), 250);
const timer = setTimeout(() => {
  console.error("[web-smoke] Timed out after 60s.");
  void finish(1);
}, 60_000);
child.on("exit", () => void collect().then(() => finish(1)));
