/// <reference types="bun" />
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ConnectionSummary } from "@ai-book-studio/core/providers/types";
import { createPkce } from "@ai-book-studio/core/providers/openrouter";

const registered = typeof document === "undefined";
if (registered) GlobalRegistrator.register({ url: "http://localhost" });
await import("fake-indexeddb/auto");
const { BrowserCredentialVault } = await import("../../src/storage/credentials");
const { OPENROUTER_PKCE_KEY, cancelOpenRouterFlow, handleOpenRouterCallback, startOpenRouterFlow } = await import(
  "../../src/runtime/openrouter"
);

const original = {
  fetch: globalThis.fetch,
  open: window.open,
  close: window.close,
  opener: window.opener
};

afterEach(() => {
  globalThis.fetch = original.fetch;
  window.open = original.open;
  window.close = original.close;
  Object.defineProperty(window, "opener", { value: original.opener, configurable: true });
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
});

afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

describe("browser OpenRouter sign-in", () => {
  test("the callback exchanges the code, stores the key and messages the opener", async () => {
    await new BrowserCredentialVault().clear();
    const pkce = await createPkce();
    sessionStorage.setItem(OPENROUTER_PKCE_KEY, JSON.stringify(pkce));
    window.history.replaceState({}, "", `/?openrouter=callback&code=code123&state=${pkce.state}`);

    const posted: Array<{ data: unknown; origin: string }> = [];
    const opener = {
      closed: false,
      postMessage: (data: unknown, origin: string) => posted.push({ data, origin })
    };
    Object.defineProperty(window, "opener", { value: opener, configurable: true });
    window.close = mock(() => {});

    const fetchMock = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ key: "sk-or-v1-browser-test-key" }),
      text: async () => ""
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const connection = await handleOpenRouterCallback();

    expect(connection?.provider).toBe("openrouter");
    expect(connection?.kind).toBe("openrouter-oauth");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await new BrowserCredentialVault().get(connection!.id))?.secret).toBe("sk-or-v1-browser-test-key");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.data).toMatchObject({ type: "openrouter", connection });
    expect(posted[0]?.origin).toBe(window.location.origin);
    expect(sessionStorage.getItem(OPENROUTER_PKCE_KEY)).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("the popup flow resolves from a same-origin message", async () => {
    const popup = { closed: false, close: mock(() => {}) };
    let opened = "";
    window.open = ((url: string) => {
      opened = String(url);
      return popup as unknown as Window;
    }) as typeof window.open;

    const flow = startOpenRouterFlow();
    for (let attempt = 0; attempt < 100 && !opened; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(opened).not.toBe("");
    const state = new URL(opened).searchParams.get("state");
    expect(state).toBeTruthy();

    const connection: ConnectionSummary = {
      id: "conn_browser000099",
      provider: "openrouter",
      label: "OpenRouter",
      kind: "openrouter-oauth",
      createdAt: "2026-10-25T12:00:00.000Z"
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "openrouter", state, connection }
      })
    );

    await expect(flow).resolves.toEqual(connection);
  });

  test("cancelling the popup rejects the pending flow", async () => {
    const popup = { closed: false, close: mock(() => { popup.closed = true; }) };
    window.open = (() => popup as unknown as Window) as typeof window.open;

    const flow = startOpenRouterFlow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelOpenRouterFlow();

    await expect(flow).rejects.toMatchObject({ message: "Sign-in cancelled." });
  });
});
