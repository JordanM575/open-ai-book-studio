import type { BrowserWindow } from "electron";
import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Studio } from "./studio";

/**
 * The hidden smoke run.
 *
 * `scripts/smoke.mjs` starts the built app with a throwaway profile and library, a window parked
 * off-screen, and `STUDIO_SMOKE=1`. This module drives the real renderer through that window,
 * checks the parts that unit tests cannot see (the preload bridge, the views, autosave to disk),
 * prints one line per check, and exits with a status code.
 *
 * It is a development aid, not a test suite: `pnpm test` covers the library in process.
 */

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Redact a failure line before it is written to an artifact file.
 *
 * Smoke prose is synthetic, but renderer errors can echo storage paths or tokens, so the same
 * value-shaped patterns the shared `failure-artifacts.mjs` helper guards are masked here too.
 * This stays a duplicate on purpose: the smoke bundle cannot import the script helper.
 */
const REDACT_PATTERNS: RegExp[] = [
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
const REDACT_REPLACEMENTS: string[] = [
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

function redactLine(line: string): string {
  let result = String(line ?? "");
  for (let index = 0; index < REDACT_PATTERNS.length; index += 1) {
    try {
      const pattern = REDACT_PATTERNS[index];
      const replacement = REDACT_REPLACEMENTS[index];
      if (pattern === undefined || replacement === undefined) break;
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    } catch {
      return "[redacted]";
    }
  }
  return result;
}

function windowState(win: BrowserWindow): string {
  const contents = win.webContents;
  return `destroyed=${win.isDestroyed()} contentsDestroyed=${contents.isDestroyed()} crashed=${contents.isCrashed()} url=${contents.getURL()}`;
}

/**
 * An evaluate that never hangs silently: if the renderer stops answering, the check fails with
 * the window state instead of burning the whole run's timeout. Packaged-only wedges (a dead
 * renderer, a destroyed window) surface here with something to act on.
 */
async function evaluate<T>(win: BrowserWindow, script: string, timeout = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return (await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`the renderer did not answer within ${timeout}ms (${windowState(win)})`)),
          timeout
        );
      })
    ])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitUntil(predicate: () => Promise<boolean>, description: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function inPage(expression: string): string {
  return `(() => { try { return Boolean(${expression}); } catch { return false; } })()`;
}

/**
 * Read a zip's entries without a dependency.
 *
 * The central directory is scanned for each file's name and local header, then the entry is
 * inflated. A DOCX is a zip, so this is how the check reads the document a reader would open
 * rather than what the writer thought it wrote.
 */
function unzip(bytes: Buffer, inflateRaw: (input: Uint8Array) => Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("the zip has no central directory");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressed);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRaw(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function runSmoke(win: BrowserWindow, studio: Studio): Promise<void> {
  const checks: Check[] = [];
  const check = async (name: string, run: () => Promise<string | void>): Promise<void> => {
    try {
      const detail = await run();
      checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
      console.log(`[smoke] ok    ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checks.push({ name, ok: false, detail });
      console.error(`[smoke] FAIL  ${name} — ${detail}`);
    }
  };

  const rendererErrors: string[] = [];

  try {
    win.webContents.on("console-message", (_event, _level, message) => {
      rendererErrors.push(redactLine(message));
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[smoke] render process gone: ${details.reason}`);
    });
    win.webContents.on("unresponsive", () => {
      console.error("[smoke] renderer unresponsive");
    });
    win.webContents.on("responsive", () => {
      console.error("[smoke] renderer responsive again");
    });
    win.on("closed", () => {
      console.error("[smoke] window closed mid-run");
    });
    await check("the test window stayed hidden", async () => {
      if (win.isVisible()) throw new Error("the window is visible");
      return "never shown, parked off-screen";
    });

    await check("the preload bridge is exposed", async () => {
      const shape = await evaluate<string>(
        win,
        `(() => {
          const api = window.studio;
          if (!api) return "missing";
          const missing = ["library", "books", "chapters", "conflicts", "drafts", "menu", "providers", "connections", "usage", "agent"].filter((key) => !(key in api));
          if (missing.length) return \`missing: \${missing.join(", ")}\`;
          const missingAgent = ["start", "stop", "undoLast", "approve", "threads"].filter((key) => !(key in api.agent));
          return missingAgent.length ? \`missing agent: \${missingAgent.join(", ")}\` : "library, books, chapters, conflicts, drafts, menu, providers, connections, usage, agent";
        })()`
      );
      if (shape !== "library, books, chapters, conflicts, drafts, menu, providers, connections, usage, agent") throw new Error(shape);
      return shape;
    });

    await check("the library lists the fixture book", async () => {
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="library-view"]')`)),
        "the library view"
      );
      const title = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="book-card"]')?.innerText ?? ""`
      );
      if (!title.includes("Smoke Test Book")) throw new Error(`card read: ${JSON.stringify(title)}`);
      return "Smoke Test Book";
    });

    await check("the library shows the location health line", async () => {
      const line = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="location-health"]')?.innerText ?? ""`
      );
      if (!line.includes("Ready")) throw new Error(`health line read: ${JSON.stringify(line)}`);
      return line;
    });

    await check("opening a book shows the manuscript", async () => {
      await evaluate<boolean>(
        win,
        `(() => {
          const card = document.querySelector('[data-testid="book-card"]');
          if (!card) return false;
          card.click();
          return true;
        })()`
      );
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="manuscript-editor"]')`)),
        "the manuscript editor"
      );
      const rail = await evaluate<string>(win, `document.querySelector('[data-testid="chapter-rail"]')?.innerText ?? ""`);
      if (!rail.includes("The Light")) throw new Error(`rail read: ${JSON.stringify(rail)}`);
      const prose = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="manuscript-text"]')?.value ?? ""`
      );
      if (!prose.includes("lighthouse keeper")) throw new Error(`editor read: ${JSON.stringify(prose.slice(0, 80))}`);
      return "chapter rail and prose loaded";
    });

    await check("the model picker opens without a connection", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="open-model-picker"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the model picker button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`(document.body.innerText || "").includes("No provider is connected yet")`)),
        "the empty model picker"
      );
      // An author with no key must be able to reach the place where a key is added.
      const settingsOpener = await evaluate<boolean>(
        win,
        inPage(`document.querySelector('[data-testid="open-provider-settings"]')`)
      );
      if (!settingsOpener) throw new Error("the empty model picker offered no way to open Settings");
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Cancel");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the model picker had no Cancel button");
      return "explained that a connection comes first, with a way to add one";
    });

    await check("the writing agent panel opens", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="toggle-chat"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the chat toggle was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="chat-panel"]')`)),
        "the writing agent panel"
      );
      const copy = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="chat-panel"]')?.innerText ?? ""`
      );
      if (!copy.includes("Ask for a scene")) throw new Error(`panel read: ${JSON.stringify(copy.slice(0, 120))}`);
      const turnModel = await evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="agent-turn-model"]')`));
      if (!turnModel) throw new Error("the one-off model control was not found");
      const openedTurnPicker = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="agent-turn-model"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!openedTurnPicker) throw new Error("the one-off model picker did not open");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`(document.body.innerText || "").includes("Model for this turn")`)),
        "the one-off model picker"
      );
      const closedTurnPicker = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Cancel");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closedTurnPicker) throw new Error("the one-off model picker had no Cancel button");
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[aria-label="Close the writing agent"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the agent panel had no close button");
      return "empty state explained the agent";
    });

    await check("the Story Bible opens", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="open-story-bible"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Story Bible button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`(document.body.innerText || "").includes("Story Bible")`)),
        "the Story Bible dialog"
      );
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Cancel");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the Story Bible had no Cancel button");
      return "book fields, cast and memories in one place";
    });

    await check("an unsaved edit offers save or keep writing", async () => {
      const marker = `A hidden review check typed this ${Date.now()}.`;
      const opened = await evaluate<boolean>(
        win,
        `(() => {
          const el = document.querySelector('[data-testid="manuscript-text"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(el, el.value + "\\n\\n" + ${JSON.stringify(marker)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          const review = document.querySelector('[data-testid="review-manuscript"]');
          if (!review) return false;
          review.click();
          return true;
        })()`
      );
      if (!opened) throw new Error("the editor or the Review manuscript button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="review-dialog"]')`)),
        "the save choice"
      );
      const copy = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-dialog"]')?.innerText ?? ""`
      );
      if (!copy.includes("Save and continue") || !copy.includes("Keep writing")) {
        throw new Error(`choice read: ${JSON.stringify(copy.slice(0, 120))}`);
      }
      const kept = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-dialog"] button')].find((item) => item.textContent?.trim() === "Keep writing");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!kept) throw new Error("the save choice had no Keep writing button");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(
              `!document.querySelector('[data-testid="review-dialog"]') && !document.querySelector('[data-testid="review-report"]')`
            )
          ),
        "the choice to close"
      );
      const prose = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="manuscript-text"]')?.value ?? ""`
      );
      if (!prose.includes(marker)) throw new Error("Keep writing did not leave the typed text untouched");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="save-status"]')?.textContent ?? "").includes("Saved")`)
          ),
        "the autosave to settle"
      );
      return "Keep writing left the typed text untouched";
    });

    await check("the manuscript review reports on saved text", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="review-manuscript"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Review manuscript button was not found");
      // The dialog shell renders while the run is still reading, so wait for the report body
      // itself: the word-count definition and coverage only render with a finished report.
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(
              `(document.querySelector('[data-testid="review-report"]')?.innerText ?? "").includes("Studio word count")`
            )
          ),
        "the manuscript review report"
      );
      const copy = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-report"]')?.innerText ?? ""`
      );
      if (!copy.includes("Studio word count") || !copy.includes("Coverage")) {
        throw new Error(`report read: ${JSON.stringify(copy.slice(0, 160))}`);
      }
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Close");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the manuscript review report had no Close button");
      return "run scope, studio counts, coverage and definitions over the fixture book";
    });

    await check("a changed chapter marks the review stale", async () => {
      const marker = `A hidden review check changed this ${Date.now()}.`;
      const typed = await evaluate<boolean>(
        win,
        `(() => {
          const el = document.querySelector('[data-testid="manuscript-text"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(el, el.value + "\\n\\n" + ${JSON.stringify(marker)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`
      );
      if (!typed) throw new Error("the editor was not found");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="save-status"]')?.textContent ?? "").includes("Saved")`)
          ),
        "the edited chapter to save"
      );
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="review-manuscript"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Review manuscript button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="review-stale"]')`)),
        "the stale report"
      );
      const stale = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-report"]')?.innerText ?? ""`
      );
      if (!stale.includes("This report is stale") || !stale.includes("The Light")) {
        throw new Error(`stale read: ${JSON.stringify(stale.slice(0, 160))}`);
      }
      const again = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Run again");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!again) throw new Error("the stale report offered no new run");
      // Wait for a new report generation: the run meta carries the fresh completion time,
      // so it can only match once the new run replaces the stale one. The dialog shell also
      // renders while the new run is reading, so the shell alone proves nothing.
      const staleMeta = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-run-meta"]')?.textContent ?? ""`
      );
      try {
        await waitUntil(
          () =>
            evaluate<boolean>(
              win,
              inPage(
                `(() => { const meta = document.querySelector('[data-testid="review-run-meta"]')?.textContent ?? ""; return meta !== "" && meta !== ${JSON.stringify(staleMeta)}; })()`
              )
            ),
          "the fresh report"
        );
      } catch {
        const state = await evaluate<string>(
          win,
          `document.querySelector('[data-testid="review-report"]')?.innerText.slice(0, 300) ?? "no report element"`
        );
        throw new Error(`the fresh report never replaced the stale one; dialog showed: ${state}`);
      }
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Close");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the fresh report had no Close button");
      return "stale report named The Light, then a new run replaced it";
    });

    await check("Settings opens from the workspace", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="open-settings"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Settings button was not found in the workspace header");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="theme-dark"]')`)),
        "the Settings dialog"
      );
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="about"]')?.textContent ?? "").includes("0.1.0")`)
          ),
        "the build metadata in About"
      );
      const copy = await evaluate<string>(win, `document.querySelector('[role="dialog"]')?.innerText ?? ""`);
      if (
        !copy.includes("Appearance") ||
        !copy.includes("Provider connections") ||
        !copy.includes("Library") ||
        !copy.includes("About")
      ) {
        throw new Error(`settings read: ${JSON.stringify(copy.slice(0, 160))}`);
      }
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent?.trim() === "Done");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the Settings dialog had no Done button");
      return "appearance, providers, library and build information in one place";
    });

    await check("a failed turn keeps its request for retry", async () => {
      const opened = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="toggle-chat"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!opened) throw new Error("the chat toggle was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="chat-panel"]')`)),
        "the writing agent panel"
      );

      const marker = `Retry this request ${Date.now()}.`;
      const typed = await evaluate<boolean>(
        win,
        `(() => {
          const box = document.querySelector('[data-testid="chat-input"]');
          if (!box) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(box, ${JSON.stringify(marker)});
          box.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`
      );
      if (!typed) throw new Error("the chat input was not found");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            `(() => { const button = document.querySelector('[data-testid="chat-send"]'); return Boolean(button && !button.disabled); })()`
          ),
        "the send button to enable"
      );
      const sent = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="chat-send"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!sent) throw new Error("the send button was not found");

      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="agent-retry-request"]')`)),
        "the retry action after a failed turn"
      );
      const copy = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="chat-panel"]')?.innerText ?? ""`
      );
      if (!copy.includes(marker)) {
        throw new Error(`the failed request was not preserved: ${JSON.stringify(copy.slice(0, 160))}`);
      }

      const retried = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="agent-retry-request"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!retried) throw new Error("the retry action was not clickable");
      await delay(2000);
      const after = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="chat-panel"]')?.innerText ?? ""`
      );
      if (!after.includes(marker)) throw new Error("retry dropped the original request");
      if (!after.includes("Retry request")) throw new Error("retry was not offered again after the second failure");

      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[aria-label="Close the writing agent"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the agent panel had no close button");
      return "prompt preserved; retry stays available";
    });

    await check("the chat can start a new conversation and show history", async () => {
      const opened = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="toggle-chat"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!opened) throw new Error("the chat toggle was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="chat-panel"]')`)),
        "the writing agent panel"
      );

      const started = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="agent-new-thread"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!started) throw new Error("the new-conversation button was not found");

      const history = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="agent-history"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!history) throw new Error("the conversation history button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[role="dialog"]')`)),
        "the conversation history dialog"
      );
      const copy = await evaluate<string>(win, `document.querySelector('[role="dialog"]')?.innerText ?? ""`);
      if (!copy.includes("Conversations") || !copy.includes("No earlier conversations yet")) {
        throw new Error(`the history dialog did not explain the empty state: ${JSON.stringify(copy.slice(0, 160))}`);
      }

      await evaluate<boolean>(
        win,
        `(() => {
          const close = document.querySelector('[role="dialog"] button[aria-label="Close"]');
          if (!close) return false;
          close.click();
          return true;
        })()`
      );
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[aria-label="Close the writing agent"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the agent panel had no close button");
      return "new conversation and history dialog";
    });

    await check("typing is saved to disk", async () => {
      const target = await evaluate<{ bookId: string; chapterId: string } | null>(
        win,
        `(async () => {
          const books = await window.studio.books.list();
          if (!books.ok || !books.data[0]) return null;
          const opened = await window.studio.books.open(books.data[0].id);
          if (!opened.ok) return null;
          const chapter = opened.data.chapters[0];
          return chapter ? { bookId: books.data[0].id, chapterId: chapter.id } : null;
        })()`
      );
      const library = studio.library;
      if (!target || !library) throw new Error("no chapter is available to type into");

      const { bookId, chapterId } = target;
      const before = await library.readChapter(bookId, chapterId);
      const marker = `A hidden run wrote this line ${Date.now()}.`;
      const typed = await evaluate<boolean>(
        win,
        `(() => {
          const el = document.querySelector('[data-testid="manuscript-text"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(el, el.value + "\\n\\n" + ${JSON.stringify(marker)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`
      );
      if (!typed) throw new Error("the editor was not found");

      await waitUntil(async () => {
        const chapter = await library.readChapter(bookId, chapterId);
        return chapter.content.includes(marker);
      }, "the autosave to reach the disk");

      const after = await library.readChapter(bookId, chapterId);
      if (after.version <= before.version) throw new Error(`version did not move (${before.version} → ${after.version})`);

      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="save-status"]')?.textContent ?? "").includes("Saved")`)
          ),
        "the save status to settle"
      );
      return `version ${before.version} → ${after.version}, status Saved`;
    });

    await check("undo survives a chapter switch", async () => {
      const rows = await evaluate<string[]>(
        win,
        `[...document.querySelectorAll('[data-testid="chapter-row"]')].map((row) => row.getAttribute('data-chapter-id') ?? '')`
      );
      if (rows.length < 2) throw new Error(`only ${rows.length} chapter row(s)`);

      await evaluate<boolean>(
        win,
        `(() => {
          document.querySelectorAll('[data-testid="chapter-row"]')[1]?.click();
          return true;
        })()`
      );
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="manuscript-text"]')?.value ?? "").includes("colder corridor")`)
          ),
        "the second chapter"
      );

      await evaluate<boolean>(
        win,
        `(() => {
          document.querySelectorAll('[data-testid="chapter-row"]')[0]?.click();
          return true;
        })()`
      );
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="manuscript-text"]')?.value ?? "").includes("lighthouse keeper")`)
          ),
        "the first chapter"
      );
      const before = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="manuscript-text"]')?.value ?? ""`
      );
      if (!before.includes("A hidden run wrote this line")) throw new Error("the typed marker is missing");

      const undone = await evaluate<boolean>(
        win,
        `(() => {
          const textarea = document.querySelector('[data-testid="manuscript-text"]');
          if (!textarea) return false;
          textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
          return true;
        })()`
      );
      if (!undone) throw new Error("the manuscript textarea was not found");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`!(document.querySelector('[data-testid="manuscript-text"]')?.value ?? "").includes("A hidden run wrote this line")`)
          ),
        "the undo to remove the typed marker"
      );
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="save-status"]')?.textContent ?? "").includes("Saved")`)
          ),
        "the undo to save"
      );
      return "the typed marker was undone after returning to the chapter";
    });

    await check("an external edit can be refreshed without losing the session", async () => {
      const library = studio.requireLibrary();
      const book = (await library.listBooks())[0];
      if (!book) throw new Error("the smoke book disappeared");
      const detail = await library.readBook(book.id);
      const chapter = detail.chapters[0];
      if (!chapter) throw new Error("the smoke chapter disappeared");
      const path = join(library.root, "books", book.id, "chapters", chapter.path);

      // Let the local-save grace period pass, then write as another editor would.
      await delay(2200);
      const raw = await readFile(path, "utf8");
      await writeFile(path, `${raw}\n\nAn external editor added this line.\n`, "utf8");

      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="external-change"]')`)),
        "the external-change banner"
      );
      const refreshed = await evaluate<boolean>(
        win,
        `(() => {
          const banner = document.querySelector('[data-testid="external-change"]');
          const button = [...(banner?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === "Refresh");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!refreshed) throw new Error("the external-change banner had no Refresh button");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="manuscript-text"]')?.value ?? "").includes("external editor")`)
          ),
        "the refreshed manuscript"
      );
      return "banner, refresh and the external line";
    });

    await check("a chapter can move with the keyboard", async () => {
      const before = await evaluate<string[]>(
        win,
        `[...document.querySelectorAll('[data-testid="chapter-row"]')].map((row) => row.getAttribute('data-chapter-id') ?? '')`
      );
      if (before.length < 2) throw new Error(`only ${before.length} chapter row(s)`);
      const dispatched = await evaluate<boolean>(
        win,
        `(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true, altKey: true, bubbles: true }));
          return true;
        })()`
      );
      if (!dispatched) throw new Error("the keyboard shortcut could not be dispatched");
      await waitUntil(async () => {
        const after = await evaluate<string[]>(
          win,
          `[...document.querySelectorAll('[data-testid="chapter-row"]')].map((row) => row.getAttribute('data-chapter-id') ?? '')`
        );
        return after[0] === before[1] && after[1] === before[0];
      }, "the chapter order to change");

      const book = (await studio.requireLibrary().listBooks())[0];
      if (!book) throw new Error("the smoke book disappeared");
      const detail = await studio.requireLibrary().readBook(book.id);
      if (detail.chapters[0]?.id !== before[1]) throw new Error("the file order did not follow the shortcut");
      return "⌘⌥↓ moved The Light below The Door";
    });

    await check("a chapter can be dragged to a new position", async () => {
      const before = await evaluate<string[]>(
        win,
        `[...document.querySelectorAll('[data-testid="chapter-row"]')].map((row) => row.getAttribute('data-chapter-id') ?? '')`
      );
      if (before.length < 2) throw new Error(`only ${before.length} chapter row(s)`);
      const dropped = await evaluate<boolean>(
        win,
        `(async () => {
          const items = document.querySelectorAll('[data-testid="chapter-item"]');
          const source = items[1];
          const target = items[0];
          if (!source || !target) return false;
          const data = new DataTransfer();
          source.dispatchEvent(new DragEvent("dragstart", { dataTransfer: data, bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
          target.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
          target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
          return true;
        })()`
      );
      if (!dropped) throw new Error("the chapter items were not found");
      await waitUntil(async () => {
        const after = await evaluate<string[]>(
          win,
          `[...document.querySelectorAll('[data-testid="chapter-row"]')].map((row) => row.getAttribute('data-chapter-id') ?? '')`
        );
        return after[0] === before[1] && after[1] === before[0];
      }, "the dragged chapter order");

      const book = (await studio.requireLibrary().listBooks())[0];
      if (!book) throw new Error("the smoke book disappeared");
      const detail = await studio.requireLibrary().readBook(book.id);
      if (detail.chapters[0]?.id !== before[1]) throw new Error("the file order did not follow the drag");
      return "the second chapter was dragged to the top";
    });

    await check("the format dialog shows an approximate preview", async () => {
      const clicked = await evaluate<boolean>(
        win,
        `(() => { const button = document.querySelector('[data-testid="format-book"]'); if (!button) return false; button.click(); return true; })()`
      );
      if (!clicked) throw new Error("the format control was not on screen");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`!!document.querySelector('[data-testid="format-preview"]')`)),
        "the format preview"
      );
      const disclosure = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="format-disclosure"]')?.innerText ?? ""`
      );
      if (!disclosure.includes("Approximate preview")) {
        throw new Error(`disclosure read: ${JSON.stringify(disclosure)}`);
      }
      await evaluate<boolean>(
        win,
        `(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true; })()`
      );
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`!document.querySelector('[data-testid="format-preview"]')`)),
        "the format dialog to close"
      );
      return "preview with disclosure";
    });

    await check("the manuscript exports to Word with its illustration", async () => {
      const bookId = await evaluate<string | null>(
        win,
        `(() => { const el = document.querySelector('[data-testid="book-card"]'); return el ? null : null; })()`
      );
      void bookId;
      // The export button lives in the workspace header, and the hook sends the file to a folder
      // the check can read rather than to a save dialog.
      const clicked = await evaluate<boolean>(
        win,
        `(() => { const button = document.querySelector('[data-testid="export-docx"]'); if (!button) return false; button.click(); return true; })()`
      );
      if (!clicked) throw new Error("the export control was not on screen");
      const folder = process.env.STUDIO_EXPORT_PATH;
      if (!folder) throw new Error("STUDIO_EXPORT_PATH is not set");
      let file = "";
      await waitUntil(async () => {
        const { readdir } = await import("node:fs/promises");
        const names = await readdir(folder).catch(() => [] as string[]);
        const found = names.find((name) => name.endsWith(".docx"));
        if (!found) return false;
        file = join(folder, found);
        return true;
      }, "the exported file");

      // A DOCX is a zip. The text is in document.xml and the picture is under word/media.
      const bytes = await readFile(file);
      if (bytes.subarray(0, 2).toString("latin1") !== "PK") throw new Error("the file is not a zip");
      const { inflateRawSync } = await import("node:zlib");
      const entries = unzip(bytes, inflateRawSync);
      const document = entries.get("word/document.xml")?.toString("utf8") ?? "";
      if (!/<w:t[^>]*>/.test(document)) throw new Error("the document has no text runs");
      const media = [...entries.keys()].filter((name) => name.startsWith("word/media/"));
      if (media.length === 0) throw new Error("the illustration is not in the file");
      const words = (document.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).length;
      return `${media.length} image${media.length === 1 ? "" : "s"}, ${words} text runs`;
    });

    await check("the manuscript exports to Markdown", async () => {
      // The Word export above may still be finishing, and both controls stay disabled until it does.
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`!document.querySelector('[data-testid="export-markdown"]').disabled`)),
        "the Markdown export control"
      );
      const clicked = await evaluate<boolean>(
        win,
        `(() => { const button = document.querySelector('[data-testid="export-markdown"]'); if (!button) return false; button.click(); return true; })()`
      );
      if (!clicked) throw new Error("the Markdown export control was not on screen");
      const folder = process.env.STUDIO_EXPORT_PATH;
      if (!folder) throw new Error("STUDIO_EXPORT_PATH is not set");
      let file = "";
      await waitUntil(async () => {
        const found = (await readdir(folder).catch(() => [] as string[])).find((name) => name.endsWith(".md"));
        if (!found) return false;
        file = join(folder, found);
        return true;
      }, "the exported Markdown file");
      const text = await readFile(file, "utf8");
      const chapters = (text.match(/^## /gm) ?? []).length;
      if (chapters === 0) throw new Error("the Markdown file has no chapter headings");
      return `${chapters} chapter heading${chapters === 1 ? "" : "s"}, ${text.length} characters`;
    });

    await check("the whole library exports as an archive", async () => {
      const result = await evaluate<{ ok: boolean; path?: string; error?: string }>(
        win,
        `(async () => {
          try {
            const exported = await window.studio.library.exportArchive();
            if (!exported.ok) return { ok: false, error: exported.error.message };
            return { ok: true, path: exported.data.path, entries: exported.data.entryCount };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })()`
      );
      if (!result.ok || !result.path) throw new Error(result.error ?? "the export failed");
      const bytes = await readFile(result.path);
      if (bytes.subarray(0, 2).toString("latin1") !== "PK") throw new Error("the archive is not a zip");
      const { inflateRawSync } = await import("node:zlib");
      const entries = unzip(bytes, inflateRawSync);
      const book = [...entries.keys()].find((name) => name.endsWith("book.json"));
      if (!book) throw new Error("the archive has no book");
      const manifest = entries.get(book)?.toString("utf8") ?? "";
      if (!/"id"/.test(manifest)) throw new Error("the book in the archive has no id");
      return `${entries.size} entries, ${book.split("/").slice(-2).join("/")}`;
    });

    await check("a book can be renamed and moved to the trash", async () => {
      const back = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[aria-label="Back to library"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!back) throw new Error("the back button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="book-actions"]')`)),
        "the library book actions"
      );

      const opened = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="book-actions"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!opened) throw new Error("the book actions button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="book-title"]')`)),
        "the book settings dialog"
      );

      const renamed = await evaluate<boolean>(
        win,
        `(() => {
          const field = document.querySelector('[data-testid="book-title"]');
          if (!field) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(field, "Smoke Test Book Renamed");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          const save = document.querySelector('[data-testid="save-book-settings"]');
          if (!save) return false;
          save.click();
          return true;
        })()`
      );
      if (!renamed) throw new Error("the rename field was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`(document.body.innerText || "").includes("Smoke Test Book Renamed")`)),
        "the renamed book card"
      );

      const reopened = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="book-actions"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!reopened) throw new Error("the book actions button was not found after renaming");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="delete-book"]')`)),
        "the delete action"
      );
      await evaluate(win, `document.querySelector('[data-testid="delete-book"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="confirm-delete-book"]')`)),
        "the delete confirmation"
      );
      await evaluate(win, `document.querySelector('[data-testid="confirm-delete-book"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelectorAll('[data-testid="book-card"]').length === 0`)),
        "the book to leave the library"
      );
      return "renamed, then moved to the trash";
    });

    await check("an empty book reports insufficient evidence", async () => {
      const creating = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "New book");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!creating) throw new Error("the New book button was not found");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(
              `[...document.querySelectorAll('[role="dialog"] button')].some((item) => item.textContent?.trim() === "Create book")`
            )
          ),
        "the new book dialog"
      );
      const created = await evaluate<boolean>(
        win,
        `(() => {
          const dialog = [...document.querySelectorAll('[role="dialog"]')].find((entry) => (entry.textContent ?? "").includes("Create book"));
          const field = dialog?.querySelector("input");
          const create = [...(dialog?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === "Create book");
          if (!field || !create) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(field, "Smoke Empty Book");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          create.click();
          return true;
        })()`
      );
      if (!created) throw new Error("the new book dialog could not be completed");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="workspace-view"]')`)),
        "the empty book workspace"
      );
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="review-manuscript"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Review manuscript button was not found");
      // Wait for the verdict copy, not the dialog shell: the shell renders while reading.
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(
              `(document.querySelector('[data-testid="review-report"]')?.innerText ?? "").includes("Not enough saved text to review")`
            )
          ),
        "the insufficient-evidence report"
      );
      const copy = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-report"]')?.innerText ?? ""`
      );
      if (!copy.includes("Not enough saved text to review")) {
        throw new Error(`report read: ${JSON.stringify(copy.slice(0, 160))}`);
      }
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Close");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the report had no Close button");
      return "a book with no readable chapters says so instead of reporting no findings";
    });

    await check("a slow run can be cancelled before analysis", async () => {
      const prepared = await evaluate<{ ok: boolean; error?: string }>(
        win,
        `(async () => {
          try {
            const books = await window.studio.books.list();
            if (!books.ok || !books.data[0]) return { ok: false, error: "no book is open" };
            const created = await window.studio.chapters.create(books.data[0].id, { title: "Long" });
            if (!created.ok) return { ok: false, error: created.error.message };
            const chapter = created.data;
            const saved = await window.studio.chapters.save({
              bookId: books.data[0].id,
              chapterId: chapter.id,
              content: ("word ".repeat(3000000) + "\\n"),
              baseVersion: chapter.version,
              baseHash: chapter.hash
            });
            if (!saved.ok) return { ok: false, error: saved.error.message };
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })()`
      );
      if (!prepared.ok) throw new Error(prepared.error ?? "the long chapter could not be written");
      const clicked = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="review-manuscript"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!clicked) throw new Error("the Review manuscript button was not found");
      // The retained report revalidates against the new chapter and turns stale; a new
      // run starts from Run again, which reads the long chapter on a cancellable path.
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="review-stale"]')`)),
        "the stale report"
      );
      const restarted = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Run again");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!restarted) throw new Error("the stale report offered no new run");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="review-cancel-run"]')`)),
        "the running review with its cancel control"
      );
      const cancelled = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[data-testid="review-cancel-run"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!cancelled) throw new Error("the running review had no cancel control");
      // The stress chapter is 3M words; on a slow machine the stopped state can take
      // well past the default window to render after the abort lands. The assertion is
      // unchanged: only the stopped state passes, never a completed report.
      try {
        await waitUntil(
          () =>
            evaluate<boolean>(
              win,
              inPage(`(document.querySelector('[data-testid="review-report"]')?.innerText ?? "").includes("Partial results are discarded")`)
            ),
          "the stopped run",
          60_000
        );
      } catch {
        const state = await evaluate<string>(
          win,
          `document.querySelector('[data-testid="review-report"]')?.innerText.slice(0, 300) ?? "no report element"`
        );
        throw new Error(`the stopped state never rendered; the report shows: ${state}`);
      }
      const body = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="review-report"]')?.innerText ?? ""`
      );
      if (body.includes("Studio word count")) throw new Error("the cancelled run still produced a report");
      const closed = await evaluate<boolean>(
        win,
        `(() => {
          const button = [...document.querySelectorAll('[data-testid="review-report"] button')].find((item) => item.textContent?.trim() === "Close");
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!closed) throw new Error("the stopped run had no Close button");
      return "Cancel run discarded the slow read before any analysis";
    });

    // Spec 029 T013: the macOS reference journey over a synthetic fixture. The hidden
    // run answers the native picker with STUDIO_IMPORT_PATH, then drives the real
    // preview, split, confirm and result UI. The book appears only after publication.
    const fixturePath = process.env.STUDIO_IMPORT_PATH ?? "";
    const snapshotTree = async (root: string): Promise<Map<string, string>> => {
      const files = new Map<string, string>();
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
          else files.set(rel, createHash("sha256").update(await readFile(join(dir, entry.name))).digest("hex"));
        }
      };
      await walk(root, "");
      return files;
    };
    let libraryBefore: Map<string, string> | null = null;
    let fixtureBefore = "";
    let cardsBefore = 0;

    await check("manuscript import previews the synthetic fixture without publishing", async () => {
      if (!fixturePath) throw new Error("STUDIO_IMPORT_PATH is not set for the hidden run");
      const library = studio.library;
      if (!library) throw new Error("no library is open for the import journey");
      fixtureBefore = await readFile(fixturePath, "utf8");
      libraryBefore = await snapshotTree(library.root);
      const back = await evaluate<boolean>(
        win,
        `(() => {
          const button = document.querySelector('[aria-label="Back to library"]');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      if (!back) throw new Error("the back button was not found");
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="import-manuscript"]')`)),
        "the manuscript import action"
      );
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(
              `document.querySelectorAll('[data-testid="book-card"]').length > 0 || (document.body.innerText ?? "").includes("No books yet")`
            )
          ),
        "the library book list to settle"
      );
      cardsBefore = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      await evaluate(win, `document.querySelector('[data-testid="import-manuscript"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="import-preview-dialog"]')`)),
        "the import preview"
      );
      const preview = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="import-preview-dialog"]')?.innerText ?? ""`
      );
      for (const expected of ["manuscript.txt", "The lighthouse keeper counted the gulls.", "Lines 1 to 6"]) {
        if (!preview.includes(expected)) throw new Error(`preview read: ${JSON.stringify(preview.slice(0, 200))}`);
      }
      const cards = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      if (cards !== cardsBefore) throw new Error(`a book appeared before confirmation (${cardsBefore} → ${cards})`);
      const tree = await snapshotTree(library.root);
      if (tree.size !== libraryBefore.size) throw new Error("choosing and previewing wrote to the library");
      return "full fixture text, source name and line range; no book, no writes";
    });

    await check("confirming the preview publishes exactly one complete book", async () => {
      const edited = await evaluate<boolean>(
        win,
        `(() => {
          const title = document.querySelector('[data-testid="import-book-title"]');
          const split = document.querySelector('[data-testid="import-new-split"]');
          const add = document.querySelector('[data-testid="import-add-split"]');
          if (!(title instanceof HTMLInputElement) || !(split instanceof HTMLInputElement) || !add) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(title, "Smoke Import");
          title.dispatchEvent(new Event("input", { bubbles: true }));
          setter.call(split, "5");
          split.dispatchEvent(new Event("input", { bubbles: true }));
          add.click();
          return true;
        })()`
      );
      if (!edited) throw new Error("the title and split controls were not found");
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`(document.querySelector('[data-testid="import-chapter-lines-2"]')?.textContent ?? "").includes("Lines 5 to 6")`)
          ),
        "the split preview"
      );
      await evaluate(win, `document.querySelector('[data-testid="import-confirm"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="import-result-dialog"]')`)),
        "the import result"
      );
      const result = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="import-result-dialog"]')?.innerText ?? ""`
      );
      for (const expected of ["manuscript.txt", "Smoke Import", "Lines 1 to 4", "Lines 5 to 6", "were not imported"]) {
        if (!result.includes(expected)) throw new Error(`result read: ${JSON.stringify(result.slice(0, 200))}`);
      }
      await evaluate(win, `document.querySelector('[data-testid="import-result-close"]').click()`);
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`[...document.querySelectorAll('[data-testid="book-card"]')].some((card) => (card.textContent ?? "").includes("Smoke Import"))`)
          ),
        "the imported book card"
      );
      const cards = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      if (cards !== cardsBefore + 1) throw new Error(`expected one new book card, saw ${cardsBefore} → ${cards}`);
      return "report, then one new card for Smoke Import";
    });

    await check("the published book matches the confirmed mapping on disk", async () => {
      const published = await evaluate<{ ok: boolean; error?: string } | null>(
        win,
        `(async () => {
          try {
            const books = await window.studio.books.list();
            if (!books.ok) return null;
            const match = books.data.find((book) => book.title === "Smoke Import");
            if (!match) return { ok: false, error: "the imported book is not listed" };
            const opened = await window.studio.books.open(match.id);
            if (!opened.ok) return { ok: false, error: opened.error.message };
            const chapters = opened.data.chapters;
            if (chapters.length !== 2) return { ok: false, error: chapters.length + " chapters" };
            if (chapters[0].title !== "Chapter 1" || chapters[1].title !== "Chapter 2") {
              return { ok: false, error: "chapter titles changed" };
            }
            if (chapters[0].content !== "The lighthouse keeper counted the gulls.\\n\\nBy evening the count was wrong again.\\n") {
              return { ok: false, error: "chapter 1 body changed" };
            }
            if (chapters[1].content !== "The light was the only thing that still agreed with him.\\nDawn came grey and gull-less.\\n") {
              return { ok: false, error: "chapter 2 body changed" };
            }
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })()`
      );
      if (!published) throw new Error("the book list could not be read");
      if (!published.ok) throw new Error(published.error ?? "the published book is wrong");
      return "two chapters with the confirmed titles and bodies";
    });

    await check("the fixture and the rest of the library are unchanged", async () => {
      const library = studio.library;
      const before = libraryBefore;
      if (!library || !before) throw new Error("no library snapshot to compare against");
      const fixtureAfter = await readFile(fixturePath, "utf8");
      if (fixtureAfter !== fixtureBefore) throw new Error("the source fixture changed");
      const after = await snapshotTree(library.root);
      const added = [...after.keys()].filter((path) => !before.has(path));
      const changed = [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path));
      const removed = [...before.keys()].filter((path) => !after.has(path));
      const fresh = added.filter((path) => path.startsWith("books/") && path.split("/").length > 2);
      const firstFresh = fresh[0];
      if (firstFresh === undefined) throw new Error("no published book directory appeared");
      const freshRoot = firstFresh.split("/").slice(0, 2).join("/");
      const stray = added.filter((path) => !path.startsWith(`${freshRoot}/`) && path !== "library.json" && !path.startsWith(".studio/"));
      if (stray.length > 0) throw new Error(`unexpected new files: ${stray.slice(0, 3).join(", ")}`);
      if (removed.length > 0) throw new Error(`files disappeared: ${removed.slice(0, 3).join(", ")}`);
      const touched = changed.filter((path) => !path.startsWith(`${freshRoot}/`) && path !== "library.json" && !path.startsWith(".studio/"));
      if (touched.length > 0) throw new Error(`existing files changed: ${touched.slice(0, 3).join(", ")}`);
      return `one new book directory, fixture identical, ${changed.length} derived file(s) refreshed`;
    });

    // D-183: the same journey for a synthetic Word document. The picker is answered with
    // the DOCX fixture; the checks take their own baselines, read the heading chapters and
    // the loss report, and compare the published bodies with the preview exactly.
    const docxPath = process.env.STUDIO_IMPORT_DOCX_PATH ?? "";
    const wordChapters = [
      ["The Harbour", "The keeper **counted** the boats.\n\n- Rope\n- Lamp oil\n"],
      ["The Storm", "Rain came *sideways*.\n\nnorth\nsouth\n\nA picture follows.\n"]
    ];
    const fileHash = async (path: string): Promise<string> =>
      createHash("sha256").update(await readFile(path)).digest("hex");
    let wordLibraryBefore: Map<string, string> | null = null;
    let wordFixtureBefore = "";
    let wordCardsBefore = 0;

    await check("a Word manuscript previews heading chapters and its losses without publishing", async () => {
      if (!docxPath) throw new Error("STUDIO_IMPORT_DOCX_PATH is not set for the hidden run");
      const library = studio.library;
      if (!library) throw new Error("no library is open for the Word import journey");
      process.env.STUDIO_IMPORT_PATH = docxPath;
      wordFixtureBefore = await fileHash(docxPath);
      wordLibraryBefore = await snapshotTree(library.root);
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`document.querySelector('[data-testid="import-manuscript"]') && !document.querySelector('[data-testid="import-manuscript"]').disabled`)
          ),
        "the manuscript import action"
      );
      wordCardsBefore = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      await evaluate(win, `document.querySelector('[data-testid="import-manuscript"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="import-loss"]')`)),
        "the Word import preview"
      );
      const seen = await evaluate<{ book: string; chapters: string[][]; loss: string[] }>(
        win,
        `(() => {
          const value = (id) => document.querySelector('[data-testid="' + id + '"]');
          const chapters = [];
          for (let order = 1; value('import-chapter-title-' + order); order += 1) {
            chapters.push([value('import-chapter-title-' + order).value, value('import-chapter-body-' + order).textContent]);
          }
          return {
            book: value('import-book-title')?.value ?? "",
            chapters,
            loss: [...document.querySelectorAll('[data-testid^="import-loss-"]')].map((item) => item.getAttribute('data-testid'))
          };
        })()`
      );
      if (seen.book !== "Smoke Voyage") throw new Error(`the book title read ${JSON.stringify(seen.book)}`);
      if (JSON.stringify(seen.chapters) !== JSON.stringify(wordChapters)) {
        throw new Error(`the preview read ${JSON.stringify(seen.chapters)}`);
      }
      for (const kind of ["table", "image", "footnote"]) {
        if (!seen.loss.includes(`import-loss-${kind}`)) throw new Error(`the loss report lacks ${kind}: ${seen.loss.join(", ")}`);
      }
      const cards = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      if (cards !== wordCardsBefore) throw new Error(`a book appeared before confirmation (${wordCardsBefore} → ${cards})`);
      const tree = await snapshotTree(library.root);
      if (tree.size !== wordLibraryBefore.size) throw new Error("choosing and previewing a Word document wrote to the library");
      return "two heading chapters with exact bodies; table, image and footnote listed; no writes";
    });

    await check("confirming the Word preview publishes exactly those chapters", async () => {
      await evaluate(win, `document.querySelector('[data-testid="import-confirm"]').click()`);
      await waitUntil(
        () => evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="import-result-dialog"]')`)),
        "the Word import result"
      );
      const result = await evaluate<string>(
        win,
        `document.querySelector('[data-testid="import-result-dialog"]')?.innerText ?? ""`
      );
      for (const expected of ["manuscript.docx", "Smoke Voyage", "The Harbour", "The Storm", "1 table", "1 image", "1 footnote"]) {
        if (!result.includes(expected)) throw new Error(`result read: ${JSON.stringify(result.slice(0, 300))}`);
      }
      await evaluate(win, `document.querySelector('[data-testid="import-result-close"]').click()`);
      await waitUntil(
        () =>
          evaluate<boolean>(
            win,
            inPage(`[...document.querySelectorAll('[data-testid="book-card"]')].some((card) => (card.textContent ?? "").includes("Smoke Voyage"))`)
          ),
        "the imported Word book card"
      );
      const cards = await evaluate<number>(win, `document.querySelectorAll('[data-testid="book-card"]').length`);
      if (cards !== wordCardsBefore + 1) throw new Error(`expected one new book card, saw ${wordCardsBefore} → ${cards}`);
      const published = await evaluate<{ ok: boolean; error?: string; chapters?: string[][] } | null>(
        win,
        `(async () => {
          const books = await window.studio.books.list();
          if (!books.ok) return null;
          const match = books.data.find((book) => book.title === "Smoke Voyage");
          if (!match) return { ok: false, error: "the imported Word book is not listed" };
          const opened = await window.studio.books.open(match.id);
          if (!opened.ok) return { ok: false, error: opened.error.message };
          return { ok: true, chapters: opened.data.chapters.map((chapter) => [chapter.title, chapter.content]) };
        })()`
      );
      if (!published) throw new Error("the book list could not be read");
      if (!published.ok) throw new Error(published.error ?? "the published Word book is wrong");
      if (JSON.stringify(published.chapters) !== JSON.stringify(wordChapters)) {
        throw new Error(`published ${JSON.stringify(published.chapters)}`);
      }
      return "result report with the loss list, one new card, the previewed bodies on disk";
    });

    await check("the Word fixture and the rest of the library are unchanged", async () => {
      const library = studio.library;
      const before = wordLibraryBefore;
      if (!library || !before) throw new Error("no library snapshot to compare against");
      if ((await fileHash(docxPath)) !== wordFixtureBefore) throw new Error("the Word fixture changed");
      const after = await snapshotTree(library.root);
      const added = [...after.keys()].filter((path) => !before.has(path));
      const removed = [...before.keys()].filter((path) => !after.has(path));
      const freshRoots = new Set(added.filter((path) => path.startsWith("books/")).map((path) => path.split("/").slice(0, 2).join("/")));
      if (freshRoots.size !== 1) throw new Error(`expected one new book directory, saw ${freshRoots.size}`);
      const [freshRoot] = [...freshRoots];
      const outside = (path: string): boolean =>
        !path.startsWith(`${freshRoot}/`) && path !== "library.json" && !path.startsWith(".studio/");
      const stray = added.filter(outside);
      if (stray.length > 0) throw new Error(`unexpected new files: ${stray.slice(0, 3).join(", ")}`);
      if (removed.length > 0) throw new Error(`files disappeared: ${removed.slice(0, 3).join(", ")}`);
      const touched = [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path) && outside(path));
      if (touched.length > 0) throw new Error(`existing files changed: ${touched.slice(0, 3).join(", ")}`);
      process.env.STUDIO_IMPORT_PATH = fixturePath;
      return "one new book directory, Word fixture identical by hash";
    });

  } finally {
    await finish(win, checks, rendererErrors);
  }
}

async function finish(win: BrowserWindow, checks: Check[], rendererErrors: string[]): Promise<void> {
  const passed = checks.filter((entry) => entry.ok).length;
  const ok = passed === checks.length && checks.length > 0;
  console.log(`[smoke] ${passed}/${checks.length} checks passed`);
  if (!ok) {
    try {
      const runDir = join(tmpdir(), `ai-book-studio-smoke-${process.pid}`);
      await mkdir(runDir, { recursive: true });
      const shot = join(runDir, "smoke-failure.png");
      await writeFile(shot, await win.webContents.capturePage().then((image) => image.toPNG()));
      const log = join(runDir, "smoke-console.log");
      await writeFile(log, `${rendererErrors.map((line) => redactLine(line)).join("\n")}\n`, "utf8");
      console.error(`[smoke] artifacts: ${shot} ${log}`);
    } catch (error) {
      console.error(`[smoke] artifact capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`[smoke] result ${JSON.stringify({ ok, checks })}`);
  app.exit(ok ? 0 : 1);
}
