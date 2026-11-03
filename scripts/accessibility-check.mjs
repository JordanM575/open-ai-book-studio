#!/usr/bin/env node
/**
 * Spec 012 T016 accessibility gate. Synthetic, isolated and credentials-free: it serves the
 * built web app over loopback, walks the welcome, library, workspace, chat, settings,
 * Story Bible and conflict views at four widths in headless Chromium, and fails on any
 * critical or serious axe finding. Lesser findings are reported, never gated. Focus order
 * for the editor and the chat composer is asserted through real Tab presses.
 *
 *   node scripts/accessibility-check.mjs   (run `bun run build:web` first)
 */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { capturePage, createRunDir } from "./failure-artifacts.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "apps", "web", "dist");
if (!existsSync(resolve(dist, "index.html"))) {
  console.error("[a11y] No web build found. Run `bun run build:web` first.");
  process.exit(2);
}

const SIZES = [
  { width: 393, height: 852 },
  { width: 744, height: 1133 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 }
];

import { FAILING_IMPACTS, summarizeAxe } from "./accessibility-gate.mjs";

export { FAILING_IMPACTS, summarizeAxe };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function serve() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(dist, relative);
    if (!file.startsWith(dist) || !existsSync(file)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return server;
}

async function describeFocus(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "body";
    return (
      element.getAttribute("data-testid") ??
      `${element.tagName}.${((element.getAttribute("aria-label") ?? element.textContent ?? "").slice(0, 30))}`
    );
  });
}

/** Tab from the top and confirm a control is reachable without a trap. */
async function focusReaches(page, match, limit) {
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await describeFocus(page);
    if (match(focused)) return { reached: true, stops: i + 1 };
  }
  return { reached: false, stops: limit };
}

async function closeDialog(page) {
  // One dialog at a time: a closing menu can overlap the dialog that replaced it.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const done = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      if (dialogs.length !== 1) return false;
      const button = [...dialogs[0].querySelectorAll("button")].find((entry) =>
        /^(done|close|cancel)$/i.test((entry.textContent ?? "").trim())
      );
      if (!button) return "stuck";
      button.click();
      return true;
    });
    if (done === true) break;
    if (done === "stuck") {
      const fingerprint = await page.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')].map((dialog) =>
          [...dialog.querySelectorAll("button,[data-testid]")]
            .map((entry) => entry.getAttribute("data-testid") ?? (entry.textContent ?? "").trim().slice(0, 24))
            .join(",")
        ).join(" || ")
      );
      throw new Error(`the dialog offered no Done or Close: ${fingerprint}`);
    }
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 10_000 });
}

async function scan(page, view, width) {
  console.log(`[a11y] scanning ${view} @${width}`);
  const results = await new AxeBuilder({ page }).analyze();
  return { view, width, violations: results.violations ?? [] };
}

/** Click the first visible control in the list; narrow screens move actions into menus. */
async function clickFirstVisible(page, testids) {
  for (const testid of testids) {
    const locator = page.locator(`[data-testid="${testid}"]`);
    if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
      await locator.first().click();
      return testid;
    }
  }
  return null;
}

async function openChat(page) {
  if ((await page.locator('[data-testid="chat-panel"]').count()) > 0) return;
  if (!(await clickFirstVisible(page, ["toggle-chat", "mobile-agent"]))) {
    throw new Error("no chat control");
  }
  await page.waitForSelector('[data-testid="chat-panel"]');
}

async function closeChat(page) {
  if ((await page.locator('[data-testid="chat-panel"]').count()) === 0) return;
  // Prefer the sheet's own close: the open sheet covers the bottom nav that toggled it.
  const closer = page.locator('[aria-label="Close the writing agent"]');
  if ((await closer.count()) > 0) {
    await closer.first().click();
  } else if (!(await clickFirstVisible(page, ["toggle-chat", "mobile-agent"]))) {
    throw new Error("no chat toggle");
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-panel"]'), null, {
    timeout: 10_000
  });
}

async function openSettings(page) {
  if (!(await clickFirstVisible(page, ["open-settings"]))) {
    await page.click('[data-testid="mobile-more"]');
    if (!(await clickFirstVisible(page, ["more-settings"]))) throw new Error("no settings control");
  }
  await page.waitForSelector('[data-testid="theme-dark"]');
}

async function openStoryBible(page) {
  if (!(await clickFirstVisible(page, ["open-story-bible"]))) {
    await page.click('[data-testid="mobile-more"]');
    if (!(await clickFirstVisible(page, ["more-story-bible"]))) throw new Error("no story bible control");
  }
  await page.waitForSelector('[role="dialog"]');
}

/** Click the visible chapter row, opening the narrow-screen rail drawer when needed. */
async function openChapter(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="chapter-item"]').length > 0,
    null,
    { timeout: 10_000 }
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const items = page.locator('[data-testid="chapter-item"]');
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      if (await items.nth(i).isVisible()) {
        await items.nth(i).click();
        // The drawer panel covers its own backdrop center, so dismiss via the exposed edge.
        const closer = page.locator('[aria-label="Close chapters"]');
        if ((await closer.count()) > 0) {
          const width = page.viewportSize()?.width ?? 1024;
          await page.mouse.click(width - 30, 300);
        }
        return;
      }
    }
    const toggle = page.locator('[data-testid="mobile-chapters"]');
    if ((await toggle.count()) === 0 || !(await toggle.first().isVisible())) {
      const state = await page.evaluate(() => {
        const rail = document.querySelector('[data-testid="chapter-rail"]');
        return JSON.stringify({
          items: document.querySelectorAll('[data-testid="chapter-item"]').length,
          rail: rail ? getComputedStyle(rail).display : "absent",
          parent: rail && rail.parentElement ? getComputedStyle(rail.parentElement).display : "absent"
        });
      });
      throw new Error(`no visible chapter row and no usable rail toggle (${state})`);
    }
    await toggle.first().click();
    await page.waitForTimeout(400);
  }
  throw new Error("no visible chapter row");
}

async function walkSize(browser, port, size, runDir) {
  const findings = [];
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  const capture = await capturePage(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="web-welcome"]');
    findings.push(await scan(page, "welcome", size.width));

    await page.click('[data-testid="use-browser-storage"]');
    await page.waitForSelector('[data-testid="library-view"]');
    findings.push(await scan(page, "library", size.width));

    const created = await page.evaluate(async () => {
      const book = await window.studio.books.create({ title: "Access Check" });
      if (!book.ok) throw new Error(book.error.message);
      const chapter = await window.studio.chapters.create(book.data.id, {
        title: "One",
        content: "Access check prose.\n"
      });
      if (!chapter.ok) throw new Error(chapter.error.message);
      return { bookId: book.data.id, chapterId: chapter.data.id };
    });
    await page.reload();
    await page.waitForSelector('[data-testid="library-view"]');
    await page.click('[data-testid="book-card"]');
    await page.waitForSelector('[data-testid="workspace-view"]');
    await openChapter(page);
    await page.waitForSelector('[data-testid="manuscript-text"]');
    findings.push(await scan(page, "workspace", size.width));

    await openChat(page);
    findings.push(await scan(page, "chat", size.width));
    await closeChat(page);

    await openSettings(page);
    findings.push(await scan(page, "settings", size.width));
    await closeDialog(page);

    await openStoryBible(page);
    findings.push(await scan(page, "story-bible", size.width));
    await closeDialog(page);

    // A stale bridge save: the first write commits, the second reuses the old base and
    // becomes the conflict copy the reopened workspace names.
    await page.evaluate(async (ids) => {
      const opened = await window.studio.books.open(ids.bookId);
      if (!opened.ok) throw new Error(opened.error.message);
      const chapter = opened.data.chapters.find((entry) => entry.id === ids.chapterId);
      const first = await window.studio.chapters.save({
        bookId: ids.bookId,
        chapterId: ids.chapterId,
        content: `${chapter.content}Other writer line.\n`,
        baseVersion: chapter.version,
        baseHash: chapter.hash
      });
      if (!first.ok || first.data.status !== "saved") throw new Error("the other writer could not save");
      const second = await window.studio.chapters.save({
        bookId: ids.bookId,
        chapterId: ids.chapterId,
        content: `${chapter.content}Stale writer line.\n`,
        baseVersion: chapter.version,
        baseHash: chapter.hash
      });
      if (!second.ok || second.data.status !== "conflict") throw new Error("the stale save did not conflict");
    }, created);
    await page.reload();
    await page.waitForSelector('[data-testid="library-view"]');
    // Opening the library reports the new conflict copy (016 acceptance scenario 2); close the
    // report before opening the book.
    await page.click('[data-testid="drift-done"]');
    await page.waitForSelector('[data-testid="drift-done"]', { state: "detached" });
    await page.click('[data-testid="book-card"]');
    await page.waitForSelector('[data-testid="workspace-view"]');
    await page.waitForFunction(
      () => /saved cop(y|ies) from earlier sync conflicts/.test(document.body.innerText ?? ""),
      null,
      { timeout: 10_000 }
    );
    findings.push(await scan(page, "conflict", size.width));
    await capture.discard();
  } catch (error) {
    const artifacts = await capture.save(runDir, `a11y-${size.width}`);
    console.error(
      `[a11y] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
    );
    throw error;
  } finally {
    await context.close();
  }
  return findings;
}

async function main() {
  const server = serve();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  const runDir = await createRunDir("a11y");
  const findings = [];
  try {
    for (const size of SIZES) {
      findings.push(...(await walkSize(browser, port, size, runDir)));
    }

    // Focus order for the editor and the composer, at desktop width.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const focusCapture = await capturePage(page);
    try {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="web-welcome"]');
      await page.click('[data-testid="use-browser-storage"]');
      await page.waitForSelector('[data-testid="library-view"]');
      await page.evaluate(async () => {
        const book = await window.studio.books.create({ title: "Focus Check" });
        await window.studio.chapters.create(book.data.id, { title: "One", content: "Focus prose.\n" });
      });
      await page.reload();
      await page.waitForSelector('[data-testid="library-view"]');
      await page.click('[data-testid="book-card"]');
      await page.waitForSelector('[data-testid="manuscript-text"]');
      const editor = await focusReaches(page, (focused) => focused === "manuscript-text", 20);
      await page.click('[data-testid="toggle-chat"]');
      await page.waitForSelector('[data-testid="chat-panel"]');
      const composer = await focusReaches(page, (focused) => focused === "chat-input", 40);
      const stops = [];
      await page.evaluate(() => document.body.focus());
      for (let i = 0; i < 60; i += 1) {
        await page.keyboard.press("Tab");
        stops.push(await describeFocus(page));
      }
      const trapped = new Set(stops.slice(50)).size <= 1;
      console.log(
        `[a11y] focus: editor ${editor.reached ? `reached in ${editor.stops}` : "UNREACHABLE"}, ` +
          `composer ${composer.reached ? `reached in ${composer.stops}` : "UNREACHABLE"}, ` +
          `trap ${trapped ? "DETECTED" : "none"}`
      );
      if (!editor.reached || !composer.reached || trapped) {
        process.exitCode = 1;
        const artifacts = await focusCapture.save(runDir, "a11y-focus");
        console.error(
          `[a11y] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
        );
      } else {
        await focusCapture.discard();
      }
    } catch (error) {
      const artifacts = await focusCapture.save(runDir, "a11y-focus");
      console.error(
        `[a11y] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
      );
      throw error;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  let failed = process.exitCode === 1;
  for (const finding of findings) {
    const { failing, reported } = summarizeAxe(finding.violations);
    const label = `${finding.view} @${finding.width}`;
    for (const violation of failing) {
      console.error(
        `[a11y] FAIL ${label} ${violation.impact} ${violation.id}: ${violation.help} ` +
          `(${(violation.nodes ?? []).length} nodes)`
      );
      for (const node of (violation.nodes ?? []).slice(0, 3)) {
        console.error(`[a11y]   ${(node.target ?? []).join(" ")}`);
      }
      failed = true;
    }
    for (const violation of reported) {
      console.log(
        `[a11y] note ${label} ${violation.impact ?? "minor"} ${violation.id}: ${violation.help} ` +
          `(${(violation.nodes ?? []).length} nodes)`
      );
    }
    if (failing.length === 0) console.log(`[a11y] ok   ${label} — no critical or serious findings`);
  }
  if (failed) {
    console.error("[a11y] accessibility gate failed");
    process.exit(1);
  }
  console.log("[a11y] within the T016 gate: no critical or serious findings, focus order held");
}

await main();
