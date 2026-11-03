import { describe, expect, test } from "bun:test";
import type { ImportManuscriptInput } from "@ai-book-studio/core/manuscript-import";
import { createBrowserStudioApi } from "../../src/runtime/browser-api";
import { BrowserLibraries } from "../../src/runtime/browser-libraries";

// Spec 029 T016: the browser and mobile targets cannot meet the manuscript
// import contract yet — every web port publishes with copy+delete instead of
// an atomic rename (directory-port.ts moveDirectory), so staged publication
// could leave a visible partial book. These tests pin the honest refusal on
// both import channels: a typed failure naming the desktop app, never a
// throw, and no library state touched. See
// specs/029-manuscript-import/research/browser-mobile-import.md.

const DESKTOP_COPY = "Manuscript import is available in the desktop app.";

function api() {
  const libraries = new BrowserLibraries();
  return { libraries, studio: createBrowserStudioApi(libraries) };
}

describe("browser manuscript import stays unavailable", () => {
  test("picking a source refuses with desktop-app copy", async () => {
    const { libraries, studio } = api();
    const result = await studio.books.pickImportSource();
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid", message: DESKTOP_COPY }
    });
    expect(libraries.service).toBeNull();
  });

  test("publishing a mapping refuses without touching the library", async () => {
    const { libraries, studio } = api();
    const input: ImportManuscriptInput = {
      bookTitle: "Refused book",
      chapters: [{ title: "Chapter One", content: "Body that must never land." }]
    };
    const result = await studio.books.importManuscript(input);
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid", message: DESKTOP_COPY }
    });
    expect(libraries.service).toBeNull();
    expect(libraries.port).toBeNull();
  });

  test("the refusal names the desktop app so the author knows where to go", async () => {
    const { studio } = api();
    const picked = await studio.books.pickImportSource();
    const published = await studio.books.importManuscript({
      bookTitle: "Elsewhere",
      chapters: [{ title: "One", content: "x" }]
    });
    for (const result of [picked, published]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("desktop app");
    }
  });
});
