#!/usr/bin/env node
/**
 * Spec 012 T017 visual baselines. Synthetic, isolated and credentials-free: it serves the
 * built web app over loopback, captures the welcome, library, workspace, chat, settings,
 * Story Bible and conflict views at four widths in four variants (light, dark, reduced
 * motion, reduced transparency) in headless Chromium, and fails when any capture differs
 * from its committed baseline beyond a hair of pixels. No retries: a mismatch fails
 * immediately (FR-026). Baselines update only through the explicit command, and the new
 * files appear in the diff for review (FR-027).
 *
 *   node scripts/visual-check.mjs                    compare against scripts/visual-baseline/
 *   node scripts/visual-check.mjs --update-baseline   recapture every baseline; review the diff
 *
 * Baselines are machine-rendered (fonts, anti-aliasing); a new machine or Electron upgrade
 * re-accepts them with the update command.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { capturePage, createRunDir } from "./failure-artifacts.mjs";
import { diffPixels, exceedsThreshold } from "./visual-compare.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "apps", "web", "dist");
const BASELINE_DIR = resolve(root, "scripts", "visual-baseline");
if (!existsSync(resolve(dist, "index.html"))) {
  console.error("[visual] No web build found. Run `bun run build:web` first.");
  process.exit(2);
}

const SIZES = [
  { width: 393, height: 852 },
  { width: 744, height: 1133 },
  { width: 1024, height: 700 },
  { width: 1440, height: 900 }
];

const VARIANTS = [
  { name: "light", colorScheme: "light", reducedMotion: "no-preference", transparency: false },
  { name: "dark", colorScheme: "dark", reducedMotion: "no-preference", transparency: false },
  { name: "motion", colorScheme: "light", reducedMotion: "reduce", transparency: false },
  { name: "transparency", colorScheme: "light", reducedMotion: "no-preference", transparency: true }
];

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

/** Click the first visible control; narrow screens move actions into menus. */
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

async function openChapter(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="chapter-item"]').length > 0,
    null,
    { timeout: 10_000 }
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const items = page.locator('[data-testid="chapter-item"]');
    for (let i = 0, count = await items.count(); i < count; i += 1) {
      if (await items.nth(i).isVisible()) {
        await items.nth(i).click();
        const closer = page.locator('[aria-label="Close chapters"]');
        if ((await closer.count()) > 0) {
          await page.mouse.click((page.viewportSize()?.width ?? 1024) - 30, 300);
        }
        return;
      }
    }
    const toggle = page.locator('[data-testid="mobile-chapters"]');
    if ((await toggle.count()) === 0 || !(await toggle.first().isVisible())) {
      throw new Error("no visible chapter row and no usable rail toggle");
    }
    await toggle.first().click();
    await page.waitForTimeout(400);
  }
  throw new Error("no visible chapter row");
}

async function openChat(page) {
  if ((await page.locator('[data-testid="chat-panel"]').count()) > 0) return;
  if (!(await clickFirstVisible(page, ["toggle-chat", "mobile-agent"]))) throw new Error("no chat control");
  await page.waitForSelector('[data-testid="chat-panel"]');
}

async function closeChat(page) {
  if ((await page.locator('[data-testid="chat-panel"]').count()) === 0) return;
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

async function closeDialog(page) {
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
    if (done === "stuck") throw new Error("the dialog offered no Done, Close or Cancel");
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 10_000 });
}

async function masks(page) {
  // Save times and the random library identity never gate a visual baseline.
  const masked = [];
  for (const testid of ["save-status", "library-root"]) {
    const locator = page.locator(`[data-testid="${testid}"]`);
    if ((await locator.count()) > 0) masked.push(locator.first());
  }
  return masked;
}

async function capture(page, name) {
  await page.waitForTimeout(500);
  return page.screenshot({ animations: "disabled", caret: "hide", mask: await masks(page) });
}

async function walkSize(browser, port, size, variant, shots, runDir) {
  const context = await browser.newContext({
    viewport: size,
    colorScheme: variant.colorScheme,
    reducedMotion: variant.reducedMotion
  });
  const page = await context.newPage();
  const captureState = await capturePage(page);
  if (variant.transparency) {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }]
    });
  }
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="web-welcome"]');
    shots.push({ view: "welcome", png: await capture(page, "welcome") });

    await page.click('[data-testid="use-browser-storage"]');
    await page.waitForSelector('[data-testid="library-view"]');
    shots.push({ view: "library", png: await capture(page, "library") });

    const created = await page.evaluate(async () => {
      const book = await window.studio.books.create({ title: "Visual Check" });
      if (!book.ok) throw new Error(book.error.message);
      const chapter = await window.studio.chapters.create(book.data.id, {
        title: "One",
        content: "Visual check prose.\n"
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
    shots.push({ view: "workspace", png: await capture(page, "workspace") });

    await openChat(page);
    shots.push({ view: "chat", png: await capture(page, "chat") });
    await closeChat(page);

    await openSettings(page);
    shots.push({ view: "settings", png: await capture(page, "settings") });
    await closeDialog(page);

    await openStoryBible(page);
    shots.push({ view: "story-bible", png: await capture(page, "story-bible") });
    await closeDialog(page);

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
    shots.push({ view: "conflict", png: await capture(page, "conflict") });
    await captureState.discard();
  } catch (error) {
    const artifacts = await captureState.save(runDir, `visual-${variant.name}-${size.width}`);
    console.error(
      `[visual] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const update = process.argv.includes("--update-baseline");
  const server = serve();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  const runDir = await createRunDir("visual");
  const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-visual-"));
  let failed = false;
  try {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const shots = [];
        await walkSize(browser, port, size, variant, shots, runDir);
        for (const { view, png } of shots) {
          const name = `${view}@${size.width}.png`;
          const baselinePath = join(BASELINE_DIR, variant.name, name);
          if (update) {
            await mkdir(join(BASELINE_DIR, variant.name), { recursive: true });
            await writeFile(baselinePath, png);
            console.log(`[visual] baseline ${variant.name}/${name}`);
            continue;
          }
          let expected;
          try {
            expected = await readFile(baselinePath);
          } catch {
            console.error(`[visual] FAIL ${variant.name}/${name}: no baseline (run with --update-baseline)`);
            failed = true;
            continue;
          }
          const { width, height, different } = diffPixels(expected, png);
          if (exceedsThreshold(different, width, height)) {
            const actualPath = join(temp, `${variant.name}-${name}`);
            await writeFile(actualPath, png);
            console.error(
              `[visual] FAIL ${variant.name}/${name}: ${different} of ${width * height} pixels differ (actual: ${actualPath})`
            );
            failed = true;
          } else {
            console.log(`[visual] ok   ${variant.name}/${name} (${different} pixels)`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
    if (!failed) await rm(temp, { recursive: true, force: true });
    else console.error(`[visual] failing captures kept under ${temp}`);
  }
  if (failed) {
    console.error("[visual] visual gate failed");
    process.exit(1);
  }
  console.log("[visual] within the T017 gate: every capture matches its baseline");
}

await main();
