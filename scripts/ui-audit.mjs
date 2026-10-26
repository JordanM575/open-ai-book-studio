#!/usr/bin/env node
/**
 * Walks the real app and reports what an author would hit.
 *
 *   bun run build
 *   node scripts/ui-audit.mjs
 *
 * It drives the built renderer through the main flows with a throwaway profile and a fixture
 * library, then reports every dead end, missing control or console error it finds. Nothing
 * touches the author's own library, and no provider is called.
 *
 * Options:
 *   --width <n>    window width in CSS pixels (default 1440)
 *   --height <n>   window height in CSS pixels (default 900)
 *   --keep         keep the temporary profile and library for inspection
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import playwright from "playwright";

const { _electron } = playwright;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appDir = join(root, "apps", "desktop");
const builtMain = join(appDir, "out", "main", "index.cjs");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const width = Number(arg("width", "1440"));
const height = Number(arg("height", "900"));
const keep = process.argv.includes("--keep");

if (!existsSync(builtMain)) {
  console.error("[audit] No build found. Run `bun run build` first.");
  process.exit(1);
}

const fixture = join(root, "samples", "the-salt-road");
if (!existsSync(fixture)) {
  console.error("[audit] No sample library. Run `bun run film:fixture` first.");
  process.exit(1);
}

const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-audit-"));
const profile = join(temp, "profile");
const libraryRoot = join(temp, "library");
await cp(fixture, libraryRoot, { recursive: true });
await mkdir(profile, { recursive: true });
await writeFile(join(profile, "studio.json"), `${JSON.stringify({ libraryRoot }, null, 2)}\n`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// This shell may carry a fetch proxy installed for the coding agent itself. The app must not
// inherit it: the proxy authorises the agent's own traffic, not the app's, and every provider
// request would come back as an unauthorised refusal that has nothing to do with the app.
delete env.NODE_OPTIONS;
for (const key of Object.keys(env)) if (key.startsWith("HEADROOM_")) delete env[key];
env.STUDIO_TEST = "1";
env.STUDIO_HEADLESS = "1";
env.STUDIO_USER_DATA = profile;
env.STUDIO_WINDOW_SIZE = `${width}x${height}`;

const electronPath = createRequire(join(appDir, "package.json"))("electron");
const app = await _electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir, env });

const page = await app.firstWindow();
const problems = [];
const notes = [];

function problem(where, what) {
  problems.push(`${where}: ${what}`);
}

const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

async function waitFor(selector, timeout = 15_000) {
  try {
    await page.waitForSelector(selector, { state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
}

async function click(selector) {
  const clicked = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  return clicked;
}

async function text() {
  return page.evaluate(() => document.body.innerText || "");
}

async function closeDialogs() {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button[aria-label='Close']")) {
      (button).click();
    }
  });
  await page.waitForTimeout(250);
}

// The library.
if (!(await waitFor('[data-testid="library-view"]'))) {
  problem("library", "the library view never appeared");
} else {
  notes.push("library view opened");
}
if (!(await waitFor('[data-testid="book-card"]'))) {
  problem("library", "the sample book was not listed");
} else {
  notes.push("the sample book is listed");
}

// The workspace.
await click('[data-testid="book-card"]');
if (!(await waitFor('[data-testid="manuscript-editor"]'))) {
  problem("workspace", "opening a book did not show the manuscript");
} else {
  notes.push("the manuscript loaded");
}
if (!(await waitFor('[data-testid="chapter-rail"]'))) {
  problem("workspace", "the chapter rail is missing");
}

// The model picker with no connection.
await click('[data-testid="open-model-picker"]');
if (!(await waitFor("text=Connect a provider first"))) {
  const body = await text();
  if (!/no provider is connected/i.test(body)) {
    problem("model picker", "the empty state did not explain that a provider is needed");
  } else {
    notes.push("the model picker explained that a provider comes first");
  }
} else {
  notes.push("the model picker explained that a provider comes first");
}
const settingsButton = await page.locator('[data-testid="open-provider-settings"]').count();
if (settingsButton === 0) {
  problem("model picker", "no way to reach Settings from the empty state");
} else {
  notes.push("the model picker offers a way to Settings");
}
await closeDialogs();

// The writing agent panel.
await click('[data-testid="toggle-chat"]');
if (!(await waitFor('[data-testid="chat-panel"]'))) {
  problem("agent", "the writing agent panel did not open");
} else {
  notes.push("the writing agent panel opened");
}
const chatInput = await page.locator('[data-testid="chat-input"]').count();
if (chatInput === 0) problem("agent", "the agent panel has no message box");

// A turn with no model must not dead-end.
await page.evaluate(() => {
  const input = document.querySelector('[data-testid="chat-input"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, "Tighten this paragraph.");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(200);
await click('[data-testid="chat-send"]');
await page.waitForTimeout(2_500);
const agentBody = await text();
if (!/choose a model/i.test(agentBody)) {
  problem("agent", "sending with no model did not say a model is needed");
} else {
  notes.push("sending with no model explains that a model comes first");
}
const chooseModel = await page.locator('[data-testid="agent-request-model"]').count();
if (chooseModel === 0) {
  problem("agent", "a failed turn offers no way to choose a model");
} else {
  notes.push("a failed turn offers a way to choose a model");
}
const retryRequest = await page.locator('[data-testid="agent-retry-request"]').count();
if (retryRequest === 0) {
  problem("agent", "a failed turn lost the retry action, so the typed prompt is stranded");
} else {
  notes.push("a failed turn keeps the prompt available to retry");
}
await click('[data-testid="toggle-chat"]');
await page.waitForTimeout(250);

// The minimal mode: the agent in a strip, without the chat panel.
if (!(await waitFor('[data-testid="ambient-panel"]'))) {
  problem("ambient", "the minimal mode did not appear");
} else {
  notes.push("the minimal mode appears");
}
const ambientLine = await page.textContent('[data-testid="ambient-line"]');
if (!ambientLine || ambientLine.trim().length === 0) {
  problem("ambient", "the minimal mode says nothing about the book");
} else {
  notes.push("the minimal mode says where the author is");
}
await click('[data-testid="ambient-toggle"]');
if (!(await waitFor('[data-testid="ambient-action-read_aloud"]'))) {
  problem("ambient", "the minimal mode offers no actions");
} else {
  notes.push("the minimal mode offers its actions");
}
const ambientInput = await page.locator('[data-testid="ambient-input"]').count();
if (ambientInput === 0) {
  problem("ambient", "the minimal mode has no way to tell the agent something");
} else {
  notes.push("the minimal mode can be talked to");
}

// The Story Bible.
await click('[data-testid="open-story-bible"]');
if (!(await waitFor('[data-testid="save-story-bible"]'))) {
  problem("story bible", "the Story Bible did not open");
} else {
  notes.push("the Story Bible opened");
}
await closeDialogs();

// Settings from the workspace.
await click('[data-testid="open-settings"]');
if (!(await waitFor('[data-testid="theme-dark"]'))) {
  problem("settings", "Settings did not open from the workspace");
} else {
  notes.push("Settings opened from the workspace");
}
const settingsCopy = await page.evaluate(
  () => document.querySelector('[role="dialog"]')?.innerText ?? ""
);
for (const section of ["Appearance", "Provider connections", "Library", "About"]) {
  if (!settingsCopy.includes(section)) {
    problem("settings", `the Settings dialog is missing “${section}”`);
  }
}
await closeDialogs();

// Search.
await click('[data-testid="open-search"]');
if (!(await waitFor('[data-testid="search-input"]'))) {
  problem("search", "the search dialog did not open");
} else {
  notes.push("search opened");
}
await closeDialogs();

// The illustration dialog.
await click('[data-testid="open-illustration"]');
if (!(await waitFor('[data-testid="illustration-prompt"]'))) {
  problem("illustration", "the illustration dialog did not open");
} else {
  notes.push("the illustration dialog opened");
}
await closeDialogs();

// The agent's own panel: what it can do, how it is doing, and its plugins.
await click('[data-testid="open-agent"]');
if (!(await waitFor('[data-testid="agent-performance"]'))) {
  problem("agent panel", "the agent panel did not open");
} else {
  notes.push("the agent panel opened");
}
const agentPanel = await page.evaluate(
  () => document.querySelector('[role="dialog"]')?.innerText ?? ""
);
for (const section of ["Performance", "Plugins", "Tools"]) {
  if (!agentPanel.includes(section)) {
    problem("agent panel", `the agent panel is missing “${section}”`);
  }
}
if (!/provider does not report a prompt cache|of the prompt came from the cache/i.test(agentPanel)) {
  problem("agent panel", "the agent panel does not say what the prompt cache did");
} else {
  notes.push("the agent panel says what the cache did");
}
const pluginPicker = await page.locator('[data-testid="agent-choose-plugins"]').count();
if (pluginPicker === 0) {
  problem("agent panel", "there is no way to point the app at a plugin folder");
} else {
  notes.push("the agent panel offers a plugin folder");
}
const cacheOption = await page.locator('[data-testid="agent-cache-prefix"]').count();
if (cacheOption === 0) {
  problem("agent panel", "there is no way to turn the cacheable prefix on or off");
} else {
  notes.push("the agent panel offers the cache prefix option");
}
const toolSwitch = await page.locator('[data-testid^="agent-tool-"]').count();
if (toolSwitch === 0) {
  problem("agent panel", "no tool has a switch");
} else {
  notes.push("every tool has a switch");
}
await closeDialogs();

if (consoleErrors.length > 0) {
  for (const error of consoleErrors) problem("console", error);
}

// The narrow layout: the header actions collapse, so the phone path must still reach them.
const narrow = await page.evaluate(() => {
  const overflow = document.documentElement.scrollWidth - document.documentElement.innerWidth;
  const more = document.querySelector('[data-testid="mobile-more"]');
  return { overflow, more: Boolean(more) };
});
if (narrow.overflow > 1) {
  problem("narrow layout", `the workspace overflows by ${narrow.overflow}px`);
}
if (!narrow.more) {
  problem("narrow layout", "the narrow layout has no More sheet, so Settings is unreachable");
} else {
  notes.push("the narrow layout has a More sheet");
}

console.log("[audit] what worked");
for (const note of notes) console.log(`  ok   ${note}`);
if (problems.length > 0) {
  console.log("[audit] what needs attention");
  for (const item of problems) console.log(`  fix  ${item}`);
} else {
  console.log("[audit] no dead ends found");
}

await app.close().catch(() => {});
if (keep) {
  console.log(`[audit] kept ${temp}`);
} else {
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
process.exit(problems.length > 0 ? 1 : 0);
