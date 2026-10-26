import type { BrowserWindow } from "electron";
import { app } from "electron";
import { readFile, writeFile } from "node:fs/promises";
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

async function evaluate<T>(win: BrowserWindow, script: string): Promise<T> {
  return (await win.webContents.executeJavaScript(script, true)) as T;
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

  try {
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
      const escape = await evaluate<boolean>(win, inPage(`document.querySelector('[data-testid="open-provider-settings"]')`));
      if (!escape) throw new Error("the empty model picker offered no way to open Settings");
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

  } finally {
    finish(checks);
  }
}

function finish(checks: Check[]): void {
  const passed = checks.filter((entry) => entry.ok).length;
  const ok = passed === checks.length && checks.length > 0;
  console.log(`[smoke] ${passed}/${checks.length} checks passed`);
  console.log(`[smoke] result ${JSON.stringify({ ok, checks })}`);
  app.exit(ok ? 0 : 1);
}
