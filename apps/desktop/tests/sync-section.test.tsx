/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let SyncSection!: typeof import("@ai-book-studio/app/components/SyncSection").SyncSection;

beforeAll(async () => {
  testing = await mountDom();
  ({ SyncSection } = await import("@ai-book-studio/app/components/SyncSection"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

function renderSection(extra: Record<string, unknown> = {}) {
  const calls: { save: unknown[][]; check: unknown[][]; close: unknown[][]; notice: unknown[][] } = {
    save: [],
    check: [],
    close: [],
    notice: []
  };
  testing.render(
    React.createElement(SyncSection, {
      deviceName: "studio-mac",
      settings: { checkIntervalMinutes: 15, lastScanAt: "2026-11-03T12:00:00.000Z" },
      unsupported: false,
      busy: false,
      onSaveInterval: async (...args: unknown[]) => void calls.save.push(args),
      onCheck: async () => {
        calls.check.push([]);
        return { dirty: false };
      },
      onCloseSettings: () => void calls.close.push([]),
      onNotice: (...args: unknown[]) => void calls.notice.push(args),
      ...extra
    })
  );
  return { body: testing.within(document.body), calls };
}

/**
 * Spec 016 T007: the sync settings section. The copy names the folder provider, never an
 * account, and the interval editor refuses anything outside the main-process range.
 */
describe("sync settings section", () => {
  test("shows the device, the last scan and the provider copy", async () => {
    const { body } = renderSection();
    await body.findByTestId("sync-device");
    expect(body.getByTestId("sync-device").textContent).toContain("studio-mac");
    expect(body.getByTestId("sync-last-scan").textContent).toContain("Last checked");
    expect(body.getByText(/not a studio account/i)).toBeDefined();
  });

  test("saving a new interval sends minutes", async () => {
    const { body, calls } = renderSection();
    const input = (await body.findByTestId("sync-interval")) as HTMLInputElement;
    expect(input.value).toBe("15");
    testing.fireEvent.change(input, { target: { value: "30" } });
    testing.fireEvent.click(body.getByTestId("sync-interval-save"));
    await testing.waitFor(() => expect(calls.save).toEqual([[30]]));
  });

  test("an out-of-range interval keeps the save disabled", async () => {
    const { body } = renderSection();
    const input = (await body.findByTestId("sync-interval")) as HTMLInputElement;
    testing.fireEvent.change(input, { target: { value: "0" } });
    expect((body.getByTestId("sync-interval-save") as HTMLButtonElement).disabled).toBe(true);
    testing.fireEvent.change(input, { target: { value: "5000" } });
    expect((body.getByTestId("sync-interval-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a clean check says everything matches and stays open", async () => {
    const { body, calls } = renderSection();
    await body.findByTestId("sync-check");
    testing.fireEvent.click(body.getByTestId("sync-check"));
    await body.findByTestId("sync-checked-note");
    expect(body.getByTestId("sync-checked-note").textContent).toBe("Everything matches.");
    expect(calls.close).toEqual([]);
  });

  test("a dirty check closes settings for the review", async () => {
    const { body, calls } = renderSection({
      onCheck: async () => {
        calls.check.push([]);
        return { dirty: true };
      }
    });
    await body.findByTestId("sync-check");
    testing.fireEvent.click(body.getByTestId("sync-check"));
    await testing.waitFor(() => expect(calls.close).toHaveLength(1));
  });

  test("an unsupported shell hides the interval editor", async () => {
    const { body } = renderSection({ unsupported: true, settings: null });
    await body.findByText(/lives in the desktop app/i);
    expect(body.queryByTestId("sync-interval")).toBeNull();
  });
});
