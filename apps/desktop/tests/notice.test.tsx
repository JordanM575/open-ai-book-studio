/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let Notice!: typeof import("@ai-book-studio/ui/notice").Notice;

beforeAll(async () => {
  testing = await mountDom();
  ({ Notice } = await import("@ai-book-studio/ui/notice"));
});

afterAll(async () => {
  await unmountDom();
});

afterEach(() => {
  testing.cleanup();
});

function renderNotice(props: Parameters<typeof Notice>[0]) {
  return testing.render(React.createElement(Notice, props));
}

function renderWithCapturedTimers(props: Parameters<typeof Notice>[0]) {
  const delays: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const captureTimeout = (...args: Parameters<typeof globalThis.setTimeout>) => {
    delays.push(Number(args[1] ?? 0));
    return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
  };

  globalThis.setTimeout = captureTimeout as typeof globalThis.setTimeout;
  try {
    return { view: renderNotice(props), delays };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

const severities = [
  { severity: "info", icon: "Information", role: "status" },
  { severity: "warning", icon: "Warning", role: "alert" },
  { severity: "danger", icon: "Danger", role: "alert" }
] as const;

describe("Notice", () => {
  for (const { severity, icon, role } of severities) {
    test(`shows the ${severity} notice with its clear icon`, () => {
      const view = renderNotice({
        message: "The connection needs attention.",
        severity,
        onDismiss: () => {}
      });

      expect(view.getByRole(role).textContent).toContain("The connection needs attention.");
      expect(view.getByRole("img", { name: icon })).toBeDefined();
    });
  }

  test("keeps existing callers on the transient warning default", () => {
    const { view, delays } = renderWithCapturedTimers({
      message: "The operation could not be completed.",
      onDismiss: () => {}
    });

    expect(view.getByRole("alert").textContent).toContain("The operation could not be completed.");
    expect(view.getByRole("img", { name: "Warning" })).toBeDefined();
    expect(delays).toContain(9000);
  });

  test("does not schedule an auto-dismiss timer for danger notices", () => {
    const { view, delays } = renderWithCapturedTimers({
      message: "Your unsaved changes may be lost.",
      severity: "danger",
      onDismiss: () => {}
    });

    expect(view.getByRole("alert").textContent).toContain("Your unsaved changes may be lost.");
    expect(delays).not.toContain(9000);
  });

  test("renders at most two actions in the supplied safe-first order", () => {
    const clicked: string[] = [];
    const view = renderNotice({
      message: "A chapter has changed on disk.",
      severity: "danger",
      onDismiss: () => {},
      actions: [
        { label: "Keep disk", onClick: () => clicked.push("keep disk") },
        { label: "Open both", onClick: () => clicked.push("open both") },
        { label: "Extra action", onClick: () => clicked.push("extra") }
      ]
    });

    const withinNotice = testing.within(view.getByRole("alert"));
    expect(withinNotice.getByRole("button", { name: "Keep disk" })).toBeDefined();
    expect(withinNotice.getByRole("button", { name: "Open both" })).toBeDefined();
    expect(withinNotice.queryByRole("button", { name: "Extra action" })).toBeNull();
    testing.fireEvent.click(withinNotice.getByRole("button", { name: "Keep disk" }));
    testing.fireEvent.click(withinNotice.getByRole("button", { name: "Open both" }));
    expect(clicked).toEqual(["keep disk", "open both"]);
  });
});
