/**
 * Shared failure artifacts for the Playwright and Electron smoke runs (spec 012 T027).
 * On a failing run the driver saves a screenshot, a Playwright trace (browser runs) and the
 * redacted page console, and logs every path. On a passing run everything is discarded, so a
 * green run leaves nothing behind. Secrets and key-shaped strings are redacted with the same
 * patterns as `packages/core/src/providers/redact.ts`; `apps/desktop/tests/failure-artifacts.test.ts`
 * asserts the two stay in lockstep.
 *
 * Usable from Node ESM scripts and from Electron CJS (`require()` of this module works because
 * it has no top-level await).
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PATTERNS = [
  /\bsk-or-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /([?&](?:api[_-]?key|key|access_token|code|refresh_token)=)[^&\s"']+/gi,
  /("(?:apiKey|api_key|access_token|refresh_token|secret|password)"\s*:\s*")[^"]+/gi,
  /\b[A-Fa-f0-9]{64,}\b/g
];

const REPLACEMENTS = [
  "sk-or-[redacted]",
  "sk-ant-[redacted]",
  "sk-[redacted]",
  "AIza[redacted]",
  "Bearer [redacted]",
  "Basic [redacted]",
  "$1[redacted]",
  "$1[redacted]",
  "[redacted-token]"
];

/** Redact key-shaped strings from one log line. Never throws. */
export function redactLine(value) {
  let result = String(value ?? "");
  for (let i = 0; i < PATTERNS.length; i += 1) {
    try {
      result = result.replace(PATTERNS[i], REPLACEMENTS[i]);
    } catch {
      return "[redacted]";
    }
  }
  return result;
}

/** A temp directory for one run's failure artifacts. Logged, never committed. */
export async function createRunDir(prefix) {
  return mkdtemp(join(tmpdir(), `${prefix}-failure-`));
}

/**
 * Capture a Playwright page: console errors, page errors and a trace. Call `save()` on
 * failure (writes screenshot, trace and console log, returns their paths) or `discard()`
 * on success. The trace starts immediately so the failure itself is always recorded.
 */
export async function capturePage(page, maxErrors = 50) {
  const errors = [];
  const onConsole = (message) => {
    if (message.type() === "error" && errors.length < maxErrors) errors.push(redactLine(message.text()));
  };
  const onPageError = (error) => {
    if (errors.length < maxErrors) errors.push(redactLine(error?.message ?? String(error)));
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  let tracing = false;
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true });
    tracing = true;
  } catch {
    tracing = false;
  }
  return {
    errors,
    async save(dir, name) {
      const safe = name.replace(/[^a-z0-9-]+/gi, "-");
      const screenshot = join(dir, `${safe}.png`);
      const consoleLog = join(dir, `${safe}.console.log`);
      let trace;
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      await writeFile(consoleLog, errors.length > 0 ? `${errors.join("\n")}\n` : "(no page errors)\n");
      if (tracing) {
        trace = join(dir, `${safe}.trace.zip`);
        await page.context().tracing.stop({ path: trace }).catch(() => undefined);
      }
      return { screenshot, consoleLog, trace };
    },
    async discard() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      if (tracing) await page.context().tracing.stop().catch(() => undefined);
    }
  };
}
