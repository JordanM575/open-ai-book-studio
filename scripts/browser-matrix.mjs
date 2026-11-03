#!/usr/bin/env node
/**
 * Run the real-browser storage harness in Playwright's Chromium.
 *
 *   node scripts/browser-matrix.mjs
 *
 * Builds `apps/web/check`, serves it over localhost, runs the OPFS/conflict/archive/IndexedDB checks
 * in a headless browser and exits non-zero on any failure or page error. No author profile or library
 * is used; the page creates and removes temporary browser libraries.
 */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { capturePage, createRunDir } from "./failure-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkDir = join(root, "apps", "web", "check");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const build = spawnSync("bun", ["--filter", "@ai-book-studio/web", "build:check"], {
  cwd: root,
  stdio: "inherit"
});
if (build.status !== 0) process.exit(build.status ?? 1);

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(checkDir, relative);
  if (!file.startsWith(checkDir) || !existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const engines = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit]
];
let allPassed = true;
let chromiumPassed = true;
const strict = process.argv.includes("--strict");

for (const [name, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const capture = await capturePage(page);
  const errors = capture.errors;
  const runDir = await createRunDir("matrix");

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.dataset.complete === "true", null, { timeout: 60_000 });

    const checks = await page.$$eval("#checks li", (items) =>
      items.map((item) => ({
        name: item.querySelector("strong")?.textContent ?? "check",
        detail: item.querySelector("span")?.textContent ?? "",
        ok: item.classList.contains("pass")
      }))
    );
    for (const check of checks) {
      console.log(`[matrix] ${name} ${check.ok ? "ok  " : "FAIL"} ${check.name} — ${check.detail}`);
    }

    const originCheck = checks.find((check) => check.name.includes("origin storage opens"));
    let restartCheck;
    if (originCheck && !originCheck.ok) {
      restartCheck = {
        name: "OPFS survives a page restart",
        detail: "skipped: origin storage unavailable",
        ok: false
      };
    } else {
      const restartPage = await context.newPage();
      const restartCapture = await capturePage(restartPage);
      try {
        await restartPage.goto(`http://127.0.0.1:${port}/restart.html`, { waitUntil: "domcontentloaded" });
        try {
          await restartPage.waitForFunction(() => document.body.dataset.complete === "true", null, {
            timeout: 60_000
          });
        } catch {
          await restartPage.waitForTimeout(250);
          await restartPage.waitForFunction(() => document.body.dataset.complete === "true", null, {
            timeout: 60_000
          });
        }
        const found = await restartPage.$$eval("#checks li", (items) =>
          items.map((item) => ({
            name: item.querySelector("strong")?.textContent ?? "check",
            detail: item.querySelector("span")?.textContent ?? "",
            ok: item.classList.contains("pass")
          }))
        );
        restartCheck = found[0];
        if (!restartCheck) throw new Error("The restart page produced no check.");
      } catch (error) {
        restartCheck = {
          name: "OPFS survives a page restart",
          detail: error instanceof Error ? error.message : String(error),
          ok: false
        };
      } finally {
        for (const error of restartCapture.errors) errors.push(error);
        await restartCapture.discard();
        await restartPage.close();
      }
    }
    checks.push(restartCheck);
    console.log(
      `[matrix] ${name} ${restartCheck.ok ? "ok  " : "FAIL"} ${restartCheck.name} — ${restartCheck.detail}`
    );

    if (errors.length > 0) {
      for (const error of errors) console.error(`[matrix] ${name} page error: ${error}`);
    }
    const passed = checks.filter((check) => check.ok).length;
    const result = await page.evaluate(() => document.body.dataset.result);
    const ok = result === "pass" && errors.length === 0 && restartCheck.ok;
    console.log(`[matrix] ${name} ${passed}/${checks.length} checks passed${ok ? "" : " (finding)"}`);
    if (!ok) {
      const artifacts = await capture.save(runDir, `matrix-${name.toLowerCase()}`);
      console.error(
        `[matrix] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
      );
      allPassed = false;
      if (name === "Chromium") chromiumPassed = false;
    } else {
      await capture.discard();
    }
  } catch (error) {
    const artifacts = await capture.save(runDir, `matrix-${name.toLowerCase()}`);
    console.error(
      `[matrix] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
    );
    console.error(`[matrix] ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    allPassed = false;
    if (name === "Chromium") chromiumPassed = false;
  } finally {
    await browser.close();
  }
}

server.close();
console.log(`[matrix] ${strict ? "strict: all engines required" : "Chromium is the required gate; other engines are findings"}`);
process.exitCode = (strict ? allPassed : chromiumPassed) ? 0 : 1;
