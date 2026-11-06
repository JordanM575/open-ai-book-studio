/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { buildMetadata } from "@ai-book-studio/core/build";
import type { StudioError } from "@ai-book-studio/core/ipc";
import { asSchemaRefusal, buildSupportSummary, mustCompatible, SchemaRefusalError } from "@ai-book-studio/app/lib/schema-refusal";

let testing!: typeof import("@testing-library/react/pure");
let SchemaRefusalDialog!: typeof import("@ai-book-studio/app/components/SchemaRefusalDialog").SchemaRefusalDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ SchemaRefusalDialog } = await import("@ai-book-studio/app/components/SchemaRefusalDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

const newerSchemaError = (message: string): StudioError => ({ code: "newer-schema", message });

/**
 * Spec 009 T029: a library written by a newer build refuses before any write and
 * offers a local, reviewable support summary — no manuscript text, no
 * credentials, no automatic transmission.
 */
describe("schema refusal contract", () => {
  test("a newer-schema failure maps to a refusal carrying only the detected schema", () => {
    const refusal = asSchemaRefusal(
      newerSchemaError("books/demo/book.json was written by a newer version of Open Book Studio (schema 2). Update the app.")
    );
    expect(refusal).toEqual({ detectedSchema: 2 });
  });

  test("a newer-schema failure without a schema number still refuses", () => {
    expect(asSchemaRefusal(newerSchemaError("Newer files."))).toEqual({ detectedSchema: null });
  });

  test("other failures are not refusals", () => {
    expect(asSchemaRefusal({ code: "invalid", message: "Nope." })).toBeNull();
  });

  test("mustCompatible passes data through and throws refusal or plain errors", async () => {
    await expect(mustCompatible(Promise.resolve({ ok: true as const, data: 7 }))).resolves.toBe(7);
    const refusal = mustCompatible(
      Promise.resolve({ ok: false as const, error: newerSchemaError("x (schema 3).") })
    );
    await expect(refusal).rejects.toBeInstanceOf(SchemaRefusalError);
    await refusal.catch((error: SchemaRefusalError) => expect(error.detectedSchema).toBe(3));
    await expect(
      mustCompatible(Promise.resolve({ ok: false as const, error: { code: "invalid", message: "Bad file." } }))
    ).rejects.toThrow("Bad file.");
  });

  test("the support summary carries build identity and outcome, never paths or prose", () => {
    const build = buildMetadata("desktop", { platform: "darwin", arch: "arm64" });
    const summary = buildSupportSummary(build, 2);
    expect(summary).toContain("support summary");
    expect(summary).toContain("Nothing is sent");
    expect(summary).toContain(`supports ${build.schemaVersion}`);
    expect(summary).toContain("these files use 2");
    expect(summary).toContain("refused before any write");
    expect(summary).not.toContain("books/");
    expect(summary).not.toContain("/tmp/");
  });
});

// Mirror App: Back unmounts the dialog and returns to the library.
function BackProbe({ onExit }: { onExit: () => void }) {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;
  return React.createElement(SchemaRefusalDialog, {
    detectedSchema: null,
    onBack: () => {
      onExit();
      setOpen(false);
    }
  });
}

describe("SchemaRefusalDialog", () => {
  function mockStudio() {
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      app: {
        info: mock(async () => ({
          ok: true,
          data: buildMetadata("desktop", { platform: "darwin", arch: "arm64" })
        }))
      }
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: mock(async () => {}) }
    });
  }

  function renderDialog(onBack: () => void = () => {}) {
    testing.render(React.createElement(SchemaRefusalDialog, { detectedSchema: 2, onBack }));
  }

  test("names the mismatch, the next step and the no-migration guarantee", async () => {
    mockStudio();
    renderDialog();
    const body = testing.within(document.body);
    expect(await body.findByTestId("schema-refusal")).toBeDefined();
    expect(await body.findByTestId("schema-refusal-summary")).toBeDefined();
    expect(body.getByText(/update to open this book/i)).toBeDefined();
    expect(body.getByText(/schema 2.*supports schema 1/i)).toBeDefined();
    expect(body.getByText(/newer build that wrote them/i)).toBeDefined();
    expect(body.getByText(/older build does not change your library files/i)).toBeDefined();
    expect(body.getAllByText(/stays on this device/i).length).toBe(2);
  });

  test("copy writes the reviewable summary and confirms", async () => {
    mockStudio();
    renderDialog();
    const body = testing.within(document.body);
    await body.findByTestId("schema-refusal-summary");
    testing.fireEvent.click(body.getByTestId("schema-refusal-copy"));
    const studio = (globalThis as unknown as { window: { studio: { app: { info: { mock: { calls: unknown[][] } } } } } }).window.studio;
    expect(studio.app.info.mock.calls.length).toBe(1);
    const clipboard = (navigator as unknown as { clipboard: { writeText: { mock: { calls: string[][] } } } }).clipboard;
    expect(clipboard.writeText.mock.calls.length).toBe(1);
    expect(clipboard.writeText.mock.calls[0]?.[0]).toContain("support summary");
    expect(await body.findByText(/copied/i)).toBeDefined();
  });

  test("back returns without writing anything", () => {
    mockStudio();
    let backs = 0;
    testing.render(React.createElement(BackProbe, { onExit: () => { backs += 1; } }));
    testing.fireEvent.click(testing.within(document.body).getByTestId("schema-refusal-back"));
    expect(backs).toBe(1);
    expect(testing.within(document.body).queryByTestId("schema-refusal")).toBeNull();
  });
});
