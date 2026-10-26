#!/usr/bin/env node
/**
 * The live check, driven through the real app.
 *
 * The Meta key lives in the operating system's keychain, through the app's own vault. So the
 * check runs inside the app, against the app's own stored connection, and the key is never on a
 * command line where a shell history would keep it.
 *
 * The app runs with a throwaway profile that carries a copy of the stored credentials and no
 * library at all, so the author's own book is never opened. The check itself copies the committed
 * sample into a temporary folder, works there, and deletes it.
 *
 *   bun run build
 *   node scripts/live-check.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appDir = join(root, "apps", "desktop");
const builtMain = join(appDir, "out", "main", "index.cjs");

if (!existsSync(builtMain)) {
  console.error("[live] No build found. Run `bun run build` first.");
  process.exit(1);
}

const temp = await mkdtemp(join(homedir(), ".ai-book-studio-live-"));
const profile = join(temp, "profile");
await mkdir(profile, { recursive: true });

// The stored credentials, copied so the app finds the connection without opening anything else.
const defaultProfile = join(homedir(), "Library", "Application Support", "AI Book Studio");
const credentials = join(defaultProfile, "credentials.json");
if (existsSync(credentials)) {
  await copyFile(credentials, join(profile, "credentials.json"));
  console.log("[live] the stored connections were copied into a throwaway profile");
} else {
  console.error("[live] There is no stored Meta connection yet.");
  console.error("[live] Open AI Book Studio, add the Meta connection in Settings, and run this again.");
  await rm(temp, { recursive: true, force: true });
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.STUDIO_TEST = "1";
env.STUDIO_HEADLESS = "1";
env.STUDIO_LIVE_CHECK = "1";
env.STUDIO_USER_DATA = profile;

const electronPath = createRequire(join(appDir, "package.json"))("electron");
const child = spawn(electronPath, [appDir], { cwd: appDir, env, stdio: ["inherit", "pipe", "inherit"] });

let buffer = "";
let reported = null;
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.startsWith("[live] result ")) {
      try {
        reported = JSON.parse(line.slice("[live] result ".length));
      } catch {
        reported = null;
      }
    }
  }
});

const timer = setTimeout(() => {
  console.error("[live] The check did not finish in time; stopping the app.");
  child.kill("SIGKILL");
}, 600_000);

child.on("close", async () => {
  clearTimeout(timer);
  await rm(temp, { recursive: true, force: true });
  if (!reported) {
    console.error("[live] The app did not report a result.");
    process.exit(1);
  }
  const results = reported.map((result) => ({ ...result }));
  const failed = results.filter((result) => result.outcome === "failed");
  const blocked = results.filter((result) => result.outcome === "blocked");
  console.log("");
  console.log(`[live] ${results.length - failed.length - blocked.length} passed, ${blocked.length} blocked, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
});
