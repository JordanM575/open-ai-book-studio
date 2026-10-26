#!/usr/bin/env node
/**
 * Moves the live phone + tablet simulators to the next desktop space, keeping their frames.
 *
 *   node scripts/simulator-pair-to-space.mjs
 *
 * Simulator draws both devices as separate windows, and Simulator only opens one window per device,
 * so this does not relaunch anything: it places the iPhone window on the left, then slides a window
 * from the simulator while holding its title bar, switching desktop mid-drag (the same gesture as
 * dragging a window between Spaces by hand). A second desktop must already exist — Mission Control
 * ▸ ＋ at the top adds one.
 *
 * Requires System Events permission to control the computer.
 */
import { spawnSync } from "node:child_process";

const PHONE = "iPhone 17 Pro";
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

async function main() {
  let desktops;
  try {
    desktops = Number(applescript(`tell application "System Events" to get count of desktops`));
  } catch (error) {
    fail(
      `System Events cannot read the desktops (${error.message}). Allow “Terminal” or “osascript” under ` +
        "System Settings ▸ Privacy & Security ▸ Accessibility, then run this again."
    );
  }
  if (desktops < 2) {
    fail("There is only one desktop. In Mission Control, click ＋ at the top to add a second, then run this again.");
  }

  const frames = applescript(`
tell application "System Events" to tell process "Simulator"
  set out to ""
  repeat with deviceWindow in windows
    set winName to name of deviceWindow
    if winName contains "${PHONE}" or winName contains "iPad" then
      set deviceFrame to position of deviceWindow
      set out to out & winName & "|" & (item 1 of deviceFrame) & "|" & (item 2 of deviceFrame) & "|"
    end if
  end repeat
  return out
end tell`);
  if (!frames.includes(PHONE) || !frames.includes("iPad")) {
    fail("Both simulator windows are not open. Run `bun run ios:iphone` and `bun run ios:ipad` first.");
  }

  // Pin the phone to the left of the pair.
  applescript(`
tell application "System Events" to tell process "Simulator"
  set frontmost to true
  set phone to first window whose name contains "${PHONE}"
  set position of phone to {${PHONE_LEFT}, ${TOP}}
end tell`);
  await delay(400);

  // The gesture: hold the simulator's title bar, slide toward the next desktop and switch with it.
  const { x, y } = titleBar(frames);
  dragToNextDesktop(x, y);
  await delay(1200);
  const now = applescript(`tell application "System Events" to get count of desktops`);
  console.log(`[pair] Desktop count after the drag: ${now}.`);
  console.log("[pair] Ctrl+→ looks for the pair's desktop; Ctrl+← returns to your work.");
}

/** Any device window's title bar, offset slightly left of its center controls. */
function titleBar(blob) {
  const entry = blob
    .split("|")
    .reduce((groups, part, index, all) => (index % 4 === 0 ? [...groups, all.slice(index, index + 4)] : groups), [])
    .find(([name]) => name.startsWith("iPad") || name.includes(PHONE));
  if (!entry) fail("No simulator device window was found.");
  const [, left, top] = entry;
  return { x: Number(left) + 60, y: Number(top) + 10 };
}

/**
 * One synthesized gesture: hold the title bar, push right a little, ask the system to switch
 * desktop, keep dragging, then release. Doing this as separate CLI calls does not work because
 * the mouse state does not survive between processes.
 */
function dragToNextDesktop(x, y) {
  // CoreGraphics event taps need no Accessibility permission beyond the one System Events already has.
  const source = `
#import <ApplicationServices/ApplicationServices.h>
#import <unistd.h>
static void post(CGEventType type, CGPoint point) {
  CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  usleep(40000);
}
int main(int argc, char **argv) {
  CGPoint start = CGPointMake(atof(argv[1]), atof(argv[2]));
  post(kCGEventMouseMoved, start);
  post(kCGEventLeftMouseDown, start);
  usleep(300000);
  post(kCGEventLeftMouseDragged, CGPointMake(start.x + 40, start.y));
  usleep(200000);
  for (int step = 1; step <= 20; step++) {
    post(kCGEventLeftMouseDragged, CGPointMake(start.x + 40 + step * 20, start.y));
  }
  usleep(300000);
  post(kCGEventLeftMouseUp, CGPointMake(start.x + 440, start.y));
  return 0;
}`;
  const binary = "/tmp/sim-pair-drag";
  const compiled = spawnSync("/usr/bin/clang", ["-x", "objective-c", "-o", binary, "-framework", "ApplicationServices", "-"], {
    input: source,
    encoding: "utf8"
  });
  if (compiled.status !== 0) fail(`Building the drag helper failed: ${compiled.stderr.trim()}`);
  spawnSync(binary, [String(x), String(y)], { stdio: "inherit" });
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

main().catch((error) => fail(error.message));
