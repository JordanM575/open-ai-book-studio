import { describe, expect, test } from "bun:test";
import { OPENROUTER_KEYS_PAGE_URL } from "@ai-book-studio/core/providers/links";
import { createBrowserStudioApi } from "../src/runtime/browser-api";
import { BrowserLibraries } from "../src/runtime/browser-libraries";

/**
 * The browser build's side of 011 FR-013 and FR-007. The browser is its own shell, so the revocation
 * link opens in a new tab, still only from the shared allow-list. A model id is refused plainly,
 * because the browser build cannot run the writing agent that would use it.
 */

function api() {
  return createBrowserStudioApi(new BrowserLibraries());
}

/** Stand in for the page's window for one call, then put back whatever was there. */
async function withWindow<T>(stub: { open: (...args: unknown[]) => unknown }, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: stub });
  try {
    return await run();
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

describe("browser pages opened on request", () => {
  test("opens only OpenRouter's keys page, in a new tab that cannot reach back", async () => {
    const studio = api();
    const opened: unknown[][] = [];
    const stub = {
      open: (...args: unknown[]) => {
        opened.push(args);
        return null;
      }
    };

    await withWindow(stub, async () => {
      expect(await studio.app.openLink(OPENROUTER_KEYS_PAGE_URL)).toEqual({ ok: true, data: null });
      for (const url of ["https://example.com/", `${OPENROUTER_KEYS_PAGE_URL}?x=1`, "javascript:alert(1)"]) {
        const refused = await studio.app.openLink(url as typeof OPENROUTER_KEYS_PAGE_URL);
        expect(refused.ok).toBe(false);
      }
    });

    expect(opened).toEqual([["https://openrouter.ai/settings/keys", "_blank", "noopener,noreferrer"]]);
  });

  test("a model id is refused plainly, naming the desktop app", async () => {
    expect(await api().providers.addModel("conn_webtest0001", "vendor/model")).toEqual({
      ok: false,
      error: {
        code: "invalid",
        message: "Entering a model id is available in the desktop app. The browser build cannot run the writing agent yet."
      }
    });
  });
});
