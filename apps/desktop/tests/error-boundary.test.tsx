/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let ErrorBoundary!: typeof import("@ai-book-studio/app/components/ErrorBoundary").ErrorBoundary;

beforeAll(async () => {
  testing = await mountDom();
  ({ ErrorBoundary } = await import("@ai-book-studio/app/components/ErrorBoundary"));
});

afterAll(async () => {
  await unmountDom();
});

afterEach(() => {
  testing.cleanup();
});

function Boom(): React.ReactNode {
  throw new Error("The workspace view crashed.");
}

describe("ErrorBoundary", () => {
  test("renders children untouched when nothing throws", () => {
    testing.render(
      React.createElement(ErrorBoundary, null, React.createElement("p", null, "A quiet library."))
    );
    expect(testing.within(document.body).getByText("A quiet library.")).toBeDefined();
    expect(testing.within(document.body).queryByTestId("error-screen")).toBeNull();
  });

  test("a throwing view becomes a recoverable screen with reload", () => {
    const onReload = mock(() => {});
    // React logs the caught error; the screen is what the author sees.
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      testing.render(React.createElement(ErrorBoundary, { onReload }, React.createElement(Boom)));
    } finally {
      console.error = originalError;
    }

    const screen = testing.within(document.body).getByTestId("error-screen");
    expect(screen.textContent).toContain("Something went wrong");
    const reload = testing.within(document.body).getByTestId("error-reload");
    expect(reload.textContent).toBe("Reload studio");
    testing.fireEvent.click(reload);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
