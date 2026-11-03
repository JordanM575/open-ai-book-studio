/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { buildMetadata } from "@ai-book-studio/core/build";
import type { BuildMetadata } from "@ai-book-studio/core/build";

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
 * Spec 009 T002: the unsigned path identifies itself in About. The dialog reads
 * the real build metadata shape, so the row the tester sees is the status the
 * app reports — not a hard-coded label.
 */
function mockStudio(info: { ok: true; data: BuildMetadata }) {
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    providers: { list: mock(async () => ({ ok: true, data: [] })) },
    connections: {
      list: mock(async () => ({ ok: true, data: [] })),
      status: mock(async () => ({ ok: true, data: { available: false, backend: "", detail: "", connections: 0 } })),
      test: mock(async () => ({ ok: true, data: { message: "Synthetic." } }))
    },
    library: { current: mock(async () => ({ ok: true, data: null })) },
    app: { info: mock(async () => info) },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({
        ok: true,
        data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }
      }))
    }
  };
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
}

describe("About signing status", () => {
  test("an unsigned build says Unsigned in About", async () => {
    mockStudio({ ok: true, data: buildMetadata("desktop", { platform: "darwin", arch: "arm64" }) });
    renderSettings();
    const view = testing.within(document.body);
    await testing.waitFor(
      () => {
        expect(view.getByTestId("about")).toBeTruthy();
      },
      { timeout: 2000 }
    );
    const about = view.getByTestId("about");
    expect(about.textContent).toContain("Signing");
    expect(about.textContent).toContain("Unsigned");
    expect(about.textContent).toContain("0.0.0-dev");
    expect(about.textContent).toContain("Architecture");
    expect(about.textContent).toContain("arm64");
  });

  test("an undetectable architecture is labelled Unknown, never verified", async () => {
    mockStudio({ ok: true, data: buildMetadata("web", { platform: "web", arch: "unknown" }) });
    renderSettings();
    const view = testing.within(document.body);
    await testing.waitFor(
      () => {
        expect(view.getByTestId("about").textContent ?? "").toContain("Architecture");
      },
      { timeout: 2000 }
    );
    const about = view.getByTestId("about");
    expect(about.textContent).toContain("Unknown");
    expect(about.textContent).not.toContain("arm64");
  });

  test("a signed build would name its identity instead", async () => {
    const signed: BuildMetadata = { ...buildMetadata("desktop"), signing: { status: "signed", identity: "Developer ID Application: Example" } };
    mockStudio({ ok: true, data: signed });
    renderSettings();
    const view = testing.within(document.body);
    await testing.waitFor(
      () => {
        expect(view.getByTestId("about").textContent ?? "").toContain("Signing");
      },
      { timeout: 2000 }
    );
    expect(view.getByTestId("about").textContent).toContain("Signed — Developer ID Application: Example");
  });
});
