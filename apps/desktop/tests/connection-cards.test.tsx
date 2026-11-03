/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let SettingsDialog!: typeof import("@ai-book-studio/app/components/SettingsDialog").SettingsDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ SettingsDialog } = await import("@ai-book-studio/app/components/SettingsDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Connection card behavior (spec 012 T012): every connection lists with its
 * kind, tests on demand, shows its models, and removes only after an explicit
 * confirm. All actions stay keyboard-reachable.
 */

const NOW = "2026-11-03T00:00:00.000Z";

const KEY_CONN = {
  id: "conn_test000001",
  provider: "openai",
  label: "Test key",
  kind: "api-key",
  createdAt: NOW
};

const OAUTH_CONN = {
  id: "conn_test000002",
  provider: "openrouter",
  label: "jordan@example.com",
  kind: "openrouter-oauth",
  createdAt: NOW
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface CardMocks {
  test: ReturnType<typeof mock>;
  models: ReturnType<typeof mock>;
  remove: ReturnType<typeof mock>;
  list: ReturnType<typeof mock>;
}

function mockSettings(conns: unknown[], hooks: { test?: (id: string) => Promise<unknown>; remove?: (id: string) => Promise<unknown> } = {}): CardMocks {
  let current = [...conns];
  const test = mock((id: string) =>
    hooks.test ? hooks.test(id) : Promise.resolve({ ok: true, data: { message: "Connected." } })
  );
  const models = mock((_id: string) =>
    Promise.resolve({
      ok: true,
      data: {
        models: [
          { id: "spark", name: "Spark", contextLength: 128000 },
          { id: "flash", name: "Flash", contextLength: 32000 }
        ],
        fetchedAt: NOW
      }
    })
  );
  const remove = mock((id: string) => {
    if (hooks.remove) return hooks.remove(id);
    current = current.filter((conn) => (conn as { id: string }).id !== id);
    return Promise.resolve({ ok: true, data: null });
  });
  const list = mock(() => Promise.resolve({ ok: true, data: current }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    providers: { list: mock(async () => ({ ok: true, data: [] })), models },
    connections: {
      list,
      status: mock(async () => ({ ok: true, data: { available: true, backend: "Synthetic keychain", detail: "", connections: current.length } })),
      test,
      remove,
      addKey: mock(async () => ({ ok: true, data: null })),
      startOpenRouter: mock(async () => ({ ok: true, data: null })),
      cancelOpenRouter: mock(async () => ({ ok: true, data: null }))
    },
    library: { current: mock(async () => ({ ok: true, data: null })) },
    app: { info: mock(async () => ({ ok: false, error: { code: "internal", message: "Synthetic." } })) },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({
        ok: true,
        data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }
      }))
    }
  };
  return { test, models, remove, list };
}

function renderSettings() {
  testing.render(
    React.createElement(SettingsDialog, {
      open: true,
      onOpenChange: () => {},
      onNotice: () => {},
      theme: { choice: "light" as const, set: () => {} }
    })
  );
  return testing.within(document.body);
}

async function openCards(view: ReturnType<typeof testing.within>, count: number) {
  await testing.waitFor(
    () => {
      expect(view.getAllByTestId("connection-card")).toHaveLength(count);
    },
    { timeout: 2000 }
  );
}

describe("connection cards", () => {
  test("every connection lists with its kind copy", async () => {
    mockSettings([KEY_CONN, OAUTH_CONN]);
    const view = renderSettings();
    await openCards(view, 2);
    const cards = view.getAllByTestId("connection-card");
    expect(cards[0]?.textContent ?? "").toContain("Test key");
    expect(cards[0]?.textContent ?? "").toContain("API key");
    expect(cards[1]?.textContent ?? "").toContain("jordan@example.com");
    expect(cards[1]?.textContent ?? "").toContain("Signed in with OpenRouter");
  });

  test("Test runs on demand and disables the card while checking", async () => {
    const gate = deferred<unknown>();
    const mocks = mockSettings([KEY_CONN], { test: () => gate.promise });
    const view = renderSettings();
    await openCards(view, 1);

    testing.fireEvent.click(view.getByTestId("connection-test"));
    expect(mocks.test).toHaveBeenCalledTimes(1);
    expect(mocks.test.mock.calls[0]?.[0]).toBe("conn_test000001");
    expect(view.getByTestId("connection-test")).toHaveProperty("disabled", true);
    expect(view.getByTestId("connection-models")).toHaveProperty("disabled", true);

    gate.resolve({ ok: true, data: { message: "Connected." } });
    await testing.waitFor(() => {
      expect(view.getByTestId("connection-test")).toHaveProperty("disabled", false);
    });
    expect(view.getByTestId("connection-status").textContent ?? "").toContain("Connected");
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  test("Models lists the connection catalogue with context sizes", async () => {
    const mocks = mockSettings([KEY_CONN]);
    const view = renderSettings();
    await openCards(view, 1);

    testing.fireEvent.click(view.getByTestId("connection-models"));
    expect(mocks.models).toHaveBeenCalledTimes(1);
    expect(mocks.models.mock.calls[0]?.[0]).toBe("conn_test000001");
    await testing.waitFor(() => {
      expect(view.getByText("Spark")).toBeTruthy();
    });
    expect(view.getByText("128k")).toBeTruthy();
    expect(view.getByText("Flash")).toBeTruthy();
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  test("Remove asks first and only then forgets the connection", async () => {
    const mocks = mockSettings([KEY_CONN, OAUTH_CONN]);
    const view = renderSettings();
    await openCards(view, 2);

    // The destructive action hides behind an explicit confirm step.
    expect(view.queryByTestId("connection-remove-confirm")).toBeNull();
    testing.fireEvent.click(view.getAllByTestId("connection-remove")[0]!);
    expect(view.getByTestId("connection-remove-confirm")).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();

    testing.fireEvent.click(view.getByTestId("connection-remove-confirm"));
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0]?.[0]).toBe("conn_test000001");
    await testing.waitFor(() => {
      expect(view.getAllByTestId("connection-card")).toHaveLength(1);
    });
    expect(view.getByTestId("connection-card").textContent ?? "").toContain("jordan@example.com");
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  test("card actions are keyboard-focusable", async () => {
    mockSettings([KEY_CONN]);
    const view = renderSettings();
    await openCards(view, 1);

    for (const testid of ["connection-test", "connection-models", "connection-remove"]) {
      const button = view.getByTestId(testid);
      expect(button.tagName).toBe("BUTTON");
      (button as HTMLElement).focus();
      expect(document.activeElement).toBe(button);
    }
  });
});
