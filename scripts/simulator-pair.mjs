#!/usr/bin/env node
/**
 * Shows the phone and tablet studio builds together, ready for a second macOS desktop.
 *
 *   node scripts/simulator-pair.mjs
 *
 * Both are real simulator windows: the iPhone 17 Pro and the iPad mini run side by side and stay
 * tappable. Simulator remembers whatever windows it had open, and it shows each device only once,
 * so a remembered empty window is closed first; launching each device then gives one window each.
 *
 * Requirements: macOS, Xcode with those simulators, and System Events permission to control the
 * computer. Anything missing is reported instead of worked around silently. With a second desktop
 * already created, `node scripts/simulator-pair-to-space.mjs` moves the open pair onto it.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developerDir = process.env.DEVELOPER_DIR ?? "/Applications/Xcode.app/Contents/Developer";
const PHONE = "iPhone 17 Pro";
const TABLET = "iPad mini";
const PHONE_LEFT = 40;
const TOP = 26;

function fail(message) {
  console.error(`[pair] ${message}`);
  process.exit(1);
}

function applescript(script) {
  const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 20_000 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "osascript failed");
  return result.stdout.trim();
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const deviceName = /^(iPhone|iPad)/;

/** Names of the Simulator device windows; Simulator's empty slots are never devices. */
function parseWindows(text) {
  return text
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/g, ""))
    .filter((name) => deviceName.test(name));
}

/** Waits for the Simulator device windows while Simulator brings them up. */
async function waitForWindows() {
  let error = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const names = parseWindows(
        applescript(`tell application "System Events" to tell process "Simulator" to get name of every window`)
      );
      if (names.length > 0) return { names, error: null };
    } catch (failure) {
      error = failure.message;
    }
    await sleep(250);
  }
  return { names: [], error };
}

async function main() {
  const available = spawnSync("/usr/bin/xcrun", ["simctl", "list", "devices", "available"], {
    encoding: "utf8",
    env: { ...process.env, DEVELOPER_DIR: developerDir }
  });
  if (available.status !== 0) fail(`simctl is unavailable: ${(available.stderr || available.stdout).trim()}`);
  if (!available.stdout.includes(PHONE) || !available.stdout.includes(TABLET)) {
    fail(`Both "${PHONE}" and "${TABLET}" simulators must be installed in this Xcode.`);
  }

  for (const device of ["iphone", "ipad"]) {
    const launched = spawnSync("bash", [resolve(root, "apps/mobile/scripts/run-sim.sh"), device, "--no-build"], {
      encoding: "utf8",
      env: { ...process.env, DEVELOPER_DIR: developerDir }
    });
    if (launched.status !== 0) fail(`Launching the ${device} failed: ${launched.stderr.trim()}`);
  }

  // Simulator restores last session's windows, including empty slots that can occupy a device.
  applescript(`tell application "Simulator" to activate`);
  const { error } = await waitForWindows();
  const openDevices = (await waitForWindows()).names;
  const stale = openDevices.filter((name) => !name.includes(PHONE) && !name.includes(TABLET));
  for (const name of stale) {
    applescript(`
tell application "System Events" to tell process "Simulator"
  set closing to first window whose name is "${name}"
  click (first button of closing whose subrole is "AXCloseButton")
end tell`);
    await sleep(700);
  }
  if (stale.length > 0) {
    for (const device of ["iphone", "ipad"]) {
      const relaunched = spawnSync("bash", [resolve(root, "apps/mobile/scripts/run-sim.sh"), device, "--no-build"], {
        encoding: "utf8",
        env: { ...process.env, DEVELOPER_DIR: developerDir }
      });
      if (relaunched.status !== 0) fail(`Launching the ${device} again failed: ${relaunched.stderr.trim()}`);
    }
  }

  const names = (await waitForWindows()).names;
  for (const wanted of [PHONE, TABLET]) {
    if (!names.some((name) => name.includes(wanted))) {
      fail(
        error
          ? `System Events could not read Simulator's windows (${error}). Allow it under System Settings ▸ Privacy & Security ▸ Accessibility.`
          : `Simulator has no ${wanted} window. Open it from Window ▸ ${wanted}, then run this again.`
      );
    }
  }

  applescript(`
tell application "System Events" to tell process "Simulator"
  set frontmost to true
  set phone to first window whose name contains "${PHONE}"
  set position of phone to {${PHONE_LEFT}, ${TOP}}
end tell`);
  await sleep(500);

  const report = applescript(`
tell application "System Events" to tell process "Simulator"
  set lines to {}
  repeat with deviceWindow in windows
    set end of lines to (name of deviceWindow) & " at " & (item 1 of (position of deviceWindow)) & "," & (item 2 of (position of deviceWindow))
  end repeat
  return lines as text
end tell`);
  console.log(`[pair] ${report.replace(/\n/g, " · ")}`);

  try {
    if (Number(applescript(`tell application "System Events" to get count of desktops`)) < 2) {
      console.warn("[pair] Only one desktop exists right now. Add a Space in Mission Control (＋ at the top) to give the pair its own desktop, then run `node scripts/simulator-pair-to-space.mjs`.");
    } else {
      console.log("[pair] Ctrl+→ moves to the pair's desktop; Ctrl+← returns to your work.");
    }
  } catch {
    console.warn("[pair] Could not read the desktop count; System Events may need permission.");
  }
}

main().catch((error) => fail(error.message));
