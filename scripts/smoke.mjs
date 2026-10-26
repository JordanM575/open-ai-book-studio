#!/usr/bin/env node
/**
 * Starts the built app in a hidden, throwaway profile and runs the smoke checks in
 * `src/main/smoke.ts`. Nothing appears on screen: the window is parked off-screen, never shown,
 * the Dock icon is hidden, and the run uses its own settings file so your real library is untouched.
 *
 *   bun run smoke          # build, then run hidden
 *   bun run smoke:run      # run against the existing out/ build
 *   SMOKE_KEEP=1 bun run smoke:run   # keep the temp library for inspection
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "desktop");
const builtMain = join(appDir, "out", "main", "index.cjs");
const packaged = process.env.SMOKE_PACKAGED === "1";

// Electron belongs to the desktop workspace, not the root package.
const appRequire = createRequire(join(appDir, "package.json"));
const electronPath = appRequire("electron");

function packagedBinary() {
  const release = join(root, "release");
  if (!existsSync(release)) return null;
  for (const entry of readdirSync(release)) {
    const candidate = join(release, entry, "AI Book Studio.app", "Contents", "MacOS", "AI Book Studio");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const packagedApp = packaged ? packagedBinary() : null;
if (!packaged && !existsSync(builtMain)) {
  console.error("[smoke] No build found. Run `bun run build` first, or use `bun run smoke`.");
  process.exit(1);
}
if (packaged && !packagedApp) {
  console.error("[smoke] No packaged app found. Run `bun run package:dir` first.");
  process.exit(1);
}

const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-smoke-"));
const profile = join(temp, "profile");
const libraryRoot = join(temp, "library");
const bookId = "book_smoke0001";
const chapterId = "ch_smoke0001";
const now = new Date().toISOString();

const book = {
  schemaVersion: 1,
  id: bookId,
  title: "Smoke Test Book",
  description: "A fixture the hidden smoke run opens.",
  stage: "drafting",
  createdAt: now,
  updatedAt: now
};

const chapter = `---
id: ${chapterId}
title: The Light
order: 1
version: 1
createdAt: ${now}
updatedAt: ${now}
---

The lighthouse keeper counted the gulls and wrote the number in the margin.

By evening the count was wrong again, and the light was the only thing that still agreed with him.
`;

const chapterTwo = `---
id: ch_smoke0002
title: The Door
order: 2
version: 1
createdAt: ${now}
updatedAt: ${now}
---

The door opened onto a colder corridor.
`;

await mkdir(join(profile), { recursive: true });
await mkdir(join(libraryRoot, "books", bookId, "chapters"), { recursive: true });
await writeFile(join(profile, "studio.json"), `${JSON.stringify({ libraryRoot }, null, 2)}\n`);
await writeFile(join(libraryRoot, "books", bookId, "book.json"), `${JSON.stringify(book, null, 2)}\n`);
await writeFile(join(libraryRoot, "books", bookId, "chapters", "0001-the-light.md"), chapter);
await writeFile(join(libraryRoot, "books", bookId, "chapters", "0002-the-door.md"), chapterTwo);

const env = { ...process.env };
// T3 Code and some terminals export this; it would start Electron as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
// This shell may carry a fetch proxy installed for the coding agent itself. The app must not
// inherit it: the proxy authorises the agent's own traffic, not the app's, and every provider
// request would come back as an unauthorised refusal that has nothing to do with the app.
delete env.NODE_OPTIONS;
for (const key of Object.keys(env)) if (key.startsWith("HEADROOM_")) delete env[key];
env.STUDIO_TEST = "1";
env.STUDIO_HEADLESS = "1";
env.STUDIO_SMOKE = "1";
env.STUDIO_USER_DATA = profile;

console.log(`[smoke] ${packaged ? "packaged" : "hidden"} run · profile ${profile}`);
// stdout is piped so the runner can see the machine-readable result even when Electron's
// shutdown path stalls; every line is still echoed unchanged.
const child = packaged
  ? spawn(packagedApp, [], { cwd: root, env, stdio: ["inherit", "pipe", "inherit"] })
  : spawn(electronPath, [appDir], { cwd: appDir, env, stdio: ["inherit", "pipe", "inherit"] });

let reported = null;
let grace = null;
let buffered = "";

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  buffered += chunk.toString("utf8");
  let newline;
  while ((newline = buffered.indexOf("\n")) !== -1) {
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (!line.startsWith("[smoke] result ")) continue;
    try {
      reported = JSON.parse(line.slice("[smoke] result ".length));
    } catch {
      reported = null;
    }
    if (reported && !grace) {
      grace = setTimeout(() => {
        console.error("[smoke] The app reported a result but did not exit; stopping it.");
        child.kill("SIGKILL");
      }, 3_000);
    }
  }
});

const timer = setTimeout(() => {
  if (reported) console.error("[smoke] The app reported a result but did not exit; stopping it.");
  else console.error("[smoke] Timed out after 60s; stopping the run.");
  child.kill("SIGKILL");
}, 60_000);

child.on("exit", async (code, signal) => {
  clearTimeout(timer);
  if (grace) clearTimeout(grace);
  if (!process.env.SMOKE_KEEP) {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  } else {
    console.log(`[smoke] kept ${temp}`);
  }
  if (signal) {
    if (reported?.ok) {
      console.log("[smoke] reported checks passed; the app did not exit on its own.");
      process.exit(0);
    }
    console.error(`[smoke] Stopped by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? (reported?.ok ? 0 : 1));
});
