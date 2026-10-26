#!/usr/bin/env node
/**
 * Captures the real renderer at a chosen window size using a throwaway profile and library.
 *
 *   bun run build
 *   node scripts/capture.mjs 393x852 /tmp/iphone.png
 *   node scripts/capture.mjs 744x1133 /tmp/ipad-mini.png
 *   node scripts/capture.mjs 744x1133 /tmp/ipad-touch.png "" --coarse
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "desktop");
const builtMain = join(appDir, "out", "main", "index.cjs");
const appRequire = createRequire(join(appDir, "package.json"));
const electronPath = appRequire("electron");

if (!existsSync(builtMain)) {
  console.error("[capture] No build found. Run `bun run build` first.");
  process.exit(1);
}

const size = process.argv[2] ?? "393x852";
if (!/^\d{3,4}x\d{3,4}$/.test(size)) {
  console.error("[capture] Size must look like 393x852.");
  process.exit(1);
}

const output = resolve(process.argv[3] ?? join(tmpdir(), `ai-book-studio-${size}.png`));
const click = process.argv[4] ?? "";
const coarsePointer = process.argv.includes("--coarse");
const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-capture-"));
const profile = join(temp, "profile");
const libraryRoot = join(temp, "library");
const bookId = "book_capture01";
const chapterId = "ch_capture01";
const now = new Date().toISOString();

const book = {
  schemaVersion: 1,
  id: bookId,
  title: "The Salt Road",
  description: "A crossing at low tide, and the people who wait for it.",
  stage: "drafting",
  createdAt: now,
  updatedAt: now
};

const chapter = `---
id: ${chapterId}
title: The Door
order: 1
version: 1
createdAt: ${now}
updatedAt: ${now}
---

The hall was cold when Mara came down. The door stood open, and the sea had left a line of salt across the floor.

She set the lamp on the table and listened. Somewhere below, the tide was turning.
`;

await mkdir(profile, { recursive: true });
await mkdir(join(libraryRoot, "books", bookId, "chapters"), { recursive: true });
await writeFile(join(profile, "studio.json"), `${JSON.stringify({ libraryRoot }, null, 2)}\n`);
await writeFile(join(libraryRoot, "books", bookId, "book.json"), `${JSON.stringify(book, null, 2)}\n`);
await writeFile(join(libraryRoot, "books", bookId, "chapters", "0001-the-door.md"), chapter);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// This shell may carry a fetch proxy installed for the coding agent itself. The app must not
// inherit it: the proxy authorises the agent's own traffic, not the app's, and every provider
// request would come back as an unauthorised refusal that has nothing to do with the app.
delete env.NODE_OPTIONS;
for (const key of Object.keys(env)) if (key.startsWith("HEADROOM_")) delete env[key];
env.STUDIO_TEST = "1";
env.STUDIO_HEADLESS = "1";
env.STUDIO_CAPTURE = output;
env.STUDIO_CAPTURE_CLICK = click;
env.STUDIO_WINDOW_SIZE = size;
env.STUDIO_USER_DATA = profile;
if (coarsePointer) env.STUDIO_COARSE_POINTER = "1";
else delete env.STUDIO_COARSE_POINTER;

console.log(`[capture] ${size}${coarsePointer ? " · coarse pointer" : ""} → ${output}`);
const child = spawn(electronPath, [appDir], { cwd: appDir, env, stdio: "inherit" });

let finished = false;
const finish = async (code) => {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearInterval(poll);
  await rm(temp, { recursive: true, force: true }).catch(() => {});
  child.kill("SIGKILL");
  process.exit(code);
};

// The screenshot is written before the app asks to exit. Electron can close its window
// without terminating the main process, so a complete file is the success signal here.
const poll = setInterval(() => {
  void stat(output)
    .then((info) => {
      if (info.size > 0) void finish(0);
    })
    .catch(() => {});
}, 250);

const timer = setTimeout(() => {
  console.error("[capture] Timed out after 60s.");
  void finish(1);
}, 60_000);

child.on("exit", (code) => {
  void finish(code ?? 1);
});
