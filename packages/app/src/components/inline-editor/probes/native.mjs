/** Focused hidden Chromium fidelity probes. No app, profile, service, keychain or server. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../../../..");
const temporary = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "inline-editor-probe-"));
let browser;
const failures = [];
const results = [];
const nativeSelectionLimits = [];
try {
  const bundle = join(temporary, "fixture.js");
  execFileSync("bun", ["build", join(root, "apps/desktop/tests/inline-editor-native-fixture.tsx"), "--target=browser", "--format=iife", `--outfile=${bundle}`], { cwd: root, stdio: "pipe" });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 }, reducedMotion: "reduce" });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(String(error)));
  await page.setContent('<main><h1>Synthetic editor probe</h1><div id="controls"></div><aside aria-label="Review"><button id="finding">Finding details</button></aside><div id="editor"></div><button id="after">After editor</button></main>');
  await page.addStyleTag({ content: await readFile(join(root, "packages/ui/src/styles/tokens.generated.css"), "utf8") });
  await page.addStyleTag({ content: 'body { margin: 20px; color: var(--foreground); background: var(--manuscript-bg); } #editor { width: 720px; max-width: 100%; } .cm-scroller { max-height: 360px; } button { min-height: 44px; }' });
  await page.addScriptTag({ content: await readFile(bundle, "utf8") });
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.inlineProbe[method](...args), { method, args });
  const span = (findingId, from, to, body, extra = {}) => ({ runId: "r", findingId, evidenceId: "e", spanId: "s", category: "clarity", from, to, quote: body.slice(from, to), ...extra });
  const probe = async (name, task) => { await task(); results.push(name); console.log(`PASS ${name}`); };
  const content = page.locator(".cm-content");

  await probe("exact Markdown/LF/UTF-16, bidi/combining/ZWJ and backward native selection", async () => {
    const body = '# Heading\n\nA😀 café 👩‍💻 שלום 123.\nline  \n\nend\n';
    await api("mount", body, [span("a", 12, 20, body)]);
    assert.equal((await api("snapshot")).body, body);
    assert.equal(await api("selection", 20, 13), false);
    await api("selection", 20, 12);
    assert.equal((await api("snapshot")).selectedText, body.slice(12, 20));
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), body.slice(12, 20));
    assert.equal(await api("show"), "applied");
    assert.equal((await api("state")).changes.length, 0);
    // Exact scalar-safe partial graphemes stay exact in the model and clipboard. Chromium
    // may collapse its native painted selection; retain this limitation in the evidence.
    for (const [from, to] of [
      [body.indexOf("́"), body.indexOf("́") + 1],
      [body.indexOf("‍"), body.indexOf("‍") + 1],
      [body.indexOf("שלום"), body.indexOf("שלום") + 4]
    ]) {
      await api("selection", from, to);
      assert.equal((await api("snapshot")).selectedText, body.slice(from, to));
      const native = await page.evaluate(() => window.getSelection()?.toString());
      const copied = await content.evaluate((element) => {
        const clipboardData = new DataTransfer();
        element.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
        return clipboardData.getData("text/plain");
      });
      assert.equal(copied, body.slice(from, to));
      assert.equal((await api("snapshot")).selectedText, body.slice(from, to));
      if (native !== copied) nativeSelectionLimits.push({ from, to, expected: copied, native });
    }
  });

  await probe("native typing, literal newline (no auto-indent), custom undo/redo and save delegation", async () => {
    await api("mount", "  verse");
    await api("selection", 7, 7);
    await page.keyboard.press("Enter");
    await page.keyboard.type("next");
    assert.equal((await api("snapshot")).body, "  verse\nnext");
    await page.keyboard.press("Meta+z");
    assert.equal((await api("snapshot")).body, "  verse");
    await page.keyboard.press("Meta+Shift+z");
    assert.equal((await api("snapshot")).body, "  verse\nnext");
    await page.keyboard.press("Control+s");
    assert.deepEqual((await api("state")).commands, ["undo", "redo", "save"]);
    assert.equal((await api("state")).changes.filter((change) => !change.recordHistory).length, 2);
  });

  await probe("clipboard event normalization and transcript insertion use isolated custom undo units", async () => {
    await api("mount", "before after");
    await api("selection", 7, 7);
    await content.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "“line”\r\nverse  \r\n\r\n\r\nend ");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    assert.equal((await api("snapshot")).body, 'before "line"\nverse  \n\nend after');
    await page.keyboard.press("Meta+z");
    assert.equal((await api("snapshot")).body, "before after");
    await api("selection", 7, 7);
    await api("dictation", "  spoken\nwords  ");
    assert.equal((await api("snapshot")).body, "before spoken words after");
    await page.keyboard.press("Meta+z");
    assert.equal((await api("snapshot")).body, "before after");
  });

  await probe("native Chromium IME commit/cancel and composition-time replacement refusal", async () => {
    await api("mount", "prefix ");
    await api("selection", 7, 7);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    assert.equal((await api("snapshot")).composing, true);
    assert.equal(await api("dictation", "must not insert"), false);
    assert.equal(await api("replace", "must not replace"), false);
    await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "日本" });
    await page.waitForFunction(() => !window.inlineProbe.snapshot().composing);
    assert.equal((await api("snapshot")).body, "prefix 日本");
    await api("selection", 9, 9);
    await cdp.send("Input.imeSetComposition", { text: "仮", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    await page.waitForFunction(() => !window.inlineProbe.snapshot().composing);
    assert.equal((await api("snapshot")).body, "prefix 日本");
    assert.deepEqual((await api("state")).composition, [true, false, true, false]);
    await cdp.detach();
  });

  await probe("complete overlap click/keyboard/return journey, native caret and drag remain usable", async () => {
    const body = "alpha beta gamma delta\nalpha beta gamma delta\n";
    await api("mount", body, [span("a", 0, 10, body), span("b", 6, 16, body), span("c", 7, 9, body), span("a", 23, 33, body, { spanId: "second" })]);
    assert.equal(await api("show"), "applied");
    // Hit the rendered three-way overlap's center without any inserted interactive DOM.
    const triple = page.locator(".inline-review-mark").filter({ hasText: /^et$/ }).first();
    await triple.click();
    assert.deepEqual((await api("state")).inspections.at(-1).choices.map((item) => item.findingId), ["a", "b", "c"]);
    assert.equal((await api("snapshot")).selectedText, "");
    assert.equal(await content.evaluate((element) => document.activeElement === element), true);
    await page.getByRole("button", { name: "Next evidence", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal((await api("state")).inspections.at(-1).active.findingId, "b");
    await page.getByRole("button", { name: "Inspect evidence", exact: true }).click();
    assert.equal((await api("snapshot")).selectedText, body.slice(6, 16));
    assert.equal(await content.evaluate((element) => document.activeElement === element), true);
    await api("command", "return");
    assert.equal(await page.locator("#finding").evaluate((element) => document.activeElement === element), true);
    const beforeDrag = (await api("state")).inspections.length;
    const box = await content.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 5, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 10, { steps: 12 });
    await page.mouse.up();
    assert.ok((await api("snapshot")).selectedText.length > 0);
    assert.equal((await api("state")).inspections.length, beforeDrag);
    assert.equal(await page.locator(".inline-review-mark[tabindex]").count(), 0);
    assert.equal((await api("state")).changes.length, 0);
  });

  await probe("immediate mark invalidation before parent notification, no native history stack", async () => {
    const body = "alpha beta\n";
    await api("mount", body, [span("a", 0, 5, body)]);
    await api("show");
    await api("selection", 0, 0);
    await page.keyboard.type("X");
    assert.equal(await page.locator(".inline-review-mark").count(), 0);
    assert.deepEqual((await api("state")).invalidationCounts, [0]);
    await page.keyboard.press("Meta+z");
    assert.equal((await api("snapshot")).body, body);
    assert.equal(await page.locator(".inline-review-mark").count(), 0);
    // Host is still pending; identical text is not enough.
    assert.equal(await api("show"), "stale");
    await page.keyboard.press("Meta+z");
    assert.equal((await api("snapshot")).body, body);
  });

  await probe("hide/filter preserve text and focus, async source ABA cannot select", async () => {
    const body = "alpha beta gamma\n";
    await api("mount", body, [span("a", 0, 10, body), span("b", 6, 16, body)]);
    await api("show");
    await api("command", "next");
    await page.locator("#finding").focus();
    const focused = await page.evaluate(() => document.activeElement?.id);
    await api("visibility", [], false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), focused);
    assert.equal((await api("state")).statuses.at(-1), "filtered");
    await api("visibility", null, true);
    assert.equal(await page.locator(".inline-review-mark").count(), 0);
    await api("visibility", null, false);
    assert.ok(await page.locator(".inline-review-mark").count() > 0);
    await api("defer");
    const pending = api("show");
    await page.waitForFunction(() => document.querySelectorAll(".inline-review-mark").length === 0);
    await api("sourceChange", { available: false });
    await api("sourceChange", { available: true });
    await api("release");
    assert.equal(await pending, "superseded");
    assert.equal(await page.locator(".inline-review-mark").count(), 0);
    assert.equal((await api("state")).changes.length, 0);
  });

  await probe("offscreen evidence scroll, one unbroken long line and 200% reflow", async () => {
    const body = `${"synthetic line\n".repeat(700)}${"x".repeat(20000)}\ntarget passage\n`;
    const from = body.indexOf("target passage");
    await api("mount", body, [span("end", from, from + 14, body)]);
    await api("show");
    await api("command", "inspect");
    await page.waitForFunction(() => (document.querySelector(".cm-scroller")?.scrollTop ?? 0) > 0);
    assert.equal((await api("snapshot")).selectedText, "target passage");
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "target passage");
    await page.evaluate(() => { document.body.style.zoom = "2"; });
    await page.setViewportSize({ width: 1024, height: 700 });
    assert.equal((await api("snapshot")).body, body);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => { document.body.style.zoom = "1"; });
  });

  await probe("light/dark tokens, forced colors and reduced motion preserve non-color marks", async () => {
    const body = "marked words\n";
    await api("mount", body, [span("a", 0, 6, body)]);
    await api("show");
    const colors = [];
    for (const dark of [false, true]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value ? "dark" : "light"; }, dark);
      const style = await page.locator(".inline-review-mark").evaluate((element) => ({ line: getComputedStyle(element).textDecorationLine, style: getComputedStyle(element).textDecorationStyle }));
      assert.deepEqual(style, { line: "underline", style: "dotted" });
      colors.push(await page.locator(".inline-review-mark").evaluate((element) => getComputedStyle(element).textDecorationColor));
    }
    assert.notEqual(colors[0], colors[1]);
    await context.pages()[0].emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    assert.equal(await page.locator(".inline-review-mark").evaluate((element) => getComputedStyle(element).textDecorationLine), "underline");
    assert.equal(await page.locator(".cm-scroller").evaluate((element) => getComputedStyle(element).scrollBehavior), "auto");
    await page.emulateMedia({ forcedColors: "none" });
    await api("selection", 0, 0);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#after").evaluate((element) => document.activeElement === element), true);
  });

  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ chromium: browser.version(), probes: results.length, pageErrors: failures, nativeSelectionLimits }, null, 2));
  await api("destroy");
  await context.close();
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
