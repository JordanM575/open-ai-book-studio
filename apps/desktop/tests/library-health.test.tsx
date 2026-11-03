/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let LibraryView!: typeof import("@ai-book-studio/app/views/LibraryView").LibraryView;

beforeAll(async () => {
  testing = await mountDom();
  ({ LibraryView } = await import("@ai-book-studio/app/views/LibraryView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Spec 028 T005: the library list shows the location health line. The line
 * carries the derived state label and author copy; a failed check reports
 * through onNotice and leaves no stale line behind.
 */

interface HealthData {
  state: string;
  label: string;
  count: number;
  severity: "info" | "warning" | "danger";
  message: string;
  action: { id: string; label: string; safe: true };
}

const READY: HealthData = {
  state: "ready",
  label: "Ready",
  count: 0,
  severity: "info",
  message: "This location is ready.",
  action: { id: "continue", label: "Continue working", safe: true }
};

const NOT_DOWNLOADED: HealthData = {
  state: "not-downloaded",
  label: "Not downloaded",
  count: 2,
  severity: "danger",
  message: "2 files are still online-only. The studio cannot read them; open them to download before editing.",
  action: { id: "download-files", label: "Open files to download", safe: true }
};

function stubStudio(locationHealth: () => Promise<unknown>) {
  const onNotice = mock((_error: unknown) => {});
  const onOpenBook = mock((_bookId: string) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
    library: {
      importLegacy: mock(() => Promise.resolve({ ok: true, data: null })),
      exportArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      importArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      locationHealth,
      reveal: mock(() => Promise.resolve({ ok: true, data: null }))
    }
  };
  return { onNotice, onOpenBook };
}

function renderLibrary(
  mocks: { onNotice: ReturnType<typeof mock>; onOpenBook: ReturnType<typeof mock> },
  root = "/tmp/studio-library"
) {
  testing.render(
    React.createElement(LibraryView, {
      library: { root, deviceId: "device_test000001", deviceName: "Test device" },
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      onOpenBook: mocks.onOpenBook,
      onChooseLibrary: () => {},
      onLibraryImported: () => {},
      onNotice: mocks.onNotice
    })
  );
  return testing.within(document.body);
}

describe("library location health line", () => {
  test("a ready location shows the state label and copy", async () => {
    const mocks = stubStudio(() => Promise.resolve({ ok: true, data: READY }));
    renderLibrary(mocks);

    await testing.waitFor(() => {
      expect(testing.within(document.body).getByTestId("location-health")).toBeTruthy();
    });
    const line = testing.within(document.body).getByTestId("location-health");
    expect(line.textContent).toContain("Ready");
    expect(line.textContent).toContain("This location is ready.");
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a danger state marks the label destructive and names the count", async () => {
    const mocks = stubStudio(() => Promise.resolve({ ok: true, data: NOT_DOWNLOADED }));
    renderLibrary(mocks);

    await testing.waitFor(() => {
      expect(testing.within(document.body).getByTestId("location-health")).toBeTruthy();
    });
    const line = testing.within(document.body).getByTestId("location-health");
    expect(line.textContent).toContain("Not downloaded");
    expect(line.textContent).toContain("2 files are still online-only");
    const label = line.querySelector("span");
    expect(label?.className).toContain("text-destructive");
  });

  test("a failed check reports through onNotice and leaves no line", async () => {
    const mocks = stubStudio(() =>
      Promise.resolve({ ok: false, error: { code: "io", message: "Scan failed." } })
    );
    const view = renderLibrary(mocks);

    await testing.waitFor(() => expect(mocks.onNotice).toHaveBeenCalled());
    expect(view.queryByTestId("location-health")).toBeNull();
  });

  test("switching libraries refreshes the line instead of keeping the old state", async () => {
    const mocks = stubStudio(() => Promise.resolve({ ok: true, data: READY }));
    const rendered = testing.render(
      React.createElement(LibraryView, {
        library: { root: "/tmp/first", deviceId: "device_test000001", deviceName: "Test device" },
        theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
        onOpenBook: mocks.onOpenBook,
        onChooseLibrary: () => {},
        onLibraryImported: () => {},
        onNotice: mocks.onNotice
      })
    );
    await testing.waitFor(() => {
      expect(testing.within(document.body).getByTestId("location-health")).toBeTruthy();
    });

    (globalThis as unknown as { window: { studio: { library: { locationHealth: unknown } } } }).window.studio.library.locationHealth =
      () => Promise.resolve({ ok: true, data: NOT_DOWNLOADED });
    rendered.rerender(
      React.createElement(LibraryView, {
        library: { root: "/tmp/second", deviceId: "device_test000001", deviceName: "Test device" },
        theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
        onOpenBook: mocks.onOpenBook,
        onChooseLibrary: () => {},
        onLibraryImported: () => {},
        onNotice: mocks.onNotice
      })
    );

    await testing.waitFor(() => {
      const line = testing.within(document.body).queryByTestId("location-health");
      if (!line?.textContent?.includes("Not downloaded")) throw new Error("health line has not refreshed yet");
    });
  });
});
