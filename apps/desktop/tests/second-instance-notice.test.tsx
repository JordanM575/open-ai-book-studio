/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let App!: typeof import("@ai-book-studio/app").default;

beforeAll(async () => {
  testing = await mountDom();
  ({ default: App } = await import("@ai-book-studio/app"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

const NOTICE = "AI Book Studio is already open. The second copy closed without opening your library.";

/** Just enough bridge for the shell to reach the welcome screen, with the second-copy signal in hand. */
function mockStudio() {
  const listeners = new Set<() => void>();
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    app: {
      onSecondInstance: (callback: () => void) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      }
    },
    library: { current: async () => ({ ok: true, data: null }) },
    sync: { onDrift: () => () => {} },
    menu: { onOpenLibrary: () => () => {} },
    platform: "darwin"
  };
  return {
    refuseSecondCopy: () => {
      for (const listener of [...listeners]) listener();
    },
    listening: () => listeners.size
  };
}

/** Spec 002 FR-069: the open studio tells the author when a second copy was refused. */
describe("a refused second copy", () => {
  test("shows the notice in the notice area, and Dismiss removes it", async () => {
    const bridge = mockStudio();
    testing.render(React.createElement(App));
    const body = testing.within(document.body);
    await body.findByTestId("welcome-view");
    expect(body.queryByRole("alert")).toBeNull();

    testing.act(() => bridge.refuseSecondCopy());
    const notice = await body.findByRole("alert");
    expect(notice.textContent).toContain(NOTICE);

    testing.fireEvent.click(testing.within(notice).getByRole("button", { name: "Dismiss" }));
    expect(body.queryByRole("alert")).toBeNull();
    expect(body.getByTestId("welcome-view")).toBeDefined();
  });

  test("a refusal reported while the library is still opening shows once it has opened", async () => {
    const bridge = mockStudio();
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    const studio = (globalThis as unknown as { window: { studio: { library: { current: () => Promise<unknown> } } } }).window.studio;
    studio.library.current = async () => {
      await opened;
      return { ok: true, data: null };
    };
    testing.render(React.createElement(App));
    const body = testing.within(document.body);
    await body.findByText("Opening your library…");

    testing.act(() => bridge.refuseSecondCopy());
    await testing.act(async () => open());
    expect((await body.findByRole("alert")).textContent).toContain(NOTICE);
  });

  test("the studio stops listening when it closes", async () => {
    const bridge = mockStudio();
    testing.render(React.createElement(App));
    await testing.within(document.body).findByTestId("welcome-view");
    expect(bridge.listening()).toBe(1);
    testing.cleanup();
    expect(bridge.listening()).toBe(0);
  });
});
