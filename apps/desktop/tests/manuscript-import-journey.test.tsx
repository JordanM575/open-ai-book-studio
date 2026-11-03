/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { validateSource, type ValidatedSource } from "@ai-book-studio/core/manuscript-import";
import type { ConfirmedImportMapping } from "@ai-book-studio/app/components/ImportPreviewDialog";

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
 * The manuscript import journey (spec 029 T011): choose, preview, confirm and
 * truthful outcomes. Choosing and previewing never write; confirming publishes
 * one complete book; cancelling before the commit adds nothing; the publish
 * cannot be cancelled into a lie.
 */

const TEXT = "One.\nTwo.\n\nThree.\nFour.\n";

function readySource(): ValidatedSource {
  const result = validateSource({ fileName: "Road.txt", bytes: new TextEncoder().encode(TEXT) });
  if (result.status !== "validated") throw new Error("Synthetic fixture must validate.");
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface JourneyMocks {
  pick: { promise: Promise<unknown>; resolve: (value: unknown) => void };
  publish: { promise: Promise<unknown>; resolve: (value: unknown) => void };
  pickImportSource: ReturnType<typeof mock>;
  importManuscript: ReturnType<typeof mock>;
  list: ReturnType<typeof mock>;
  onNotice: ReturnType<typeof mock>;
  onOpenBook: ReturnType<typeof mock>;
}

function mockStudio(platform: string): JourneyMocks {
  const pick = deferred<unknown>();
  const publish = deferred<unknown>();
  const pickImportSource = mock(() => pick.promise);
  const importManuscript = mock((_mapping: ConfirmedImportMapping) => publish.promise);
  const list = mock(() => Promise.resolve({ ok: true, data: [] }));
  const onNotice = mock((_error: unknown) => {});
  const onOpenBook = mock((_bookId: string) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform,
    books: { list, pickImportSource, importManuscript },
    library: {
      importLegacy: mock(() => Promise.resolve({ ok: true, data: null })),
      exportArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      importArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      locationHealth: mock(() =>
        Promise.resolve({
          ok: true,
          data: {
            state: "ready",
            label: "Ready",
            count: 0,
            severity: "info",
            message: "This location is ready.",
            action: { id: "continue", label: "Continue working", safe: true }
          }
        })
      ),
      reveal: mock(() => Promise.resolve({ ok: true, data: null }))
    }
  };
  return { pick, publish, pickImportSource, importManuscript, list, onNotice, onOpenBook };
}

function renderLibrary(mocks: JourneyMocks) {
  testing.render(
    React.createElement(LibraryView, {
      library: { root: "/tmp/studio-library", deviceId: "device_test000001", deviceName: "Test device" },
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      onOpenBook: mocks.onOpenBook,
      onChooseLibrary: () => {},
      onLibraryImported: () => {},
      onNotice: mocks.onNotice
    })
  );
  return testing.within(document.body);
}

async function openPreview(view: ReturnType<typeof testing.within>, mocks: JourneyMocks) {
  testing.fireEvent.click(view.getByTestId("import-manuscript"));
  mocks.pick.resolve({ ok: true, data: { status: "ready", source: readySource() } });
  await testing.waitFor(() => {
    expect(view.getByTestId("import-preview-dialog")).toBeTruthy();
  });
}

describe("manuscript import journey", () => {
  test("confirming publishes the confirmed mapping and refreshes the library", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    await openPreview(view, mocks);

    // The author sees the exact text, retitles the book and splits chapter 2 off at line 4.
    expect(view.getByTestId("import-chapter-body-1").textContent ?? "").toBe("One.\nTwo.\n\nThree.\nFour.\n");
    testing.fireEvent.change(view.getByTestId("import-book-title"), { target: { value: "The Long Road" } });
    testing.fireEvent.change(view.getByTestId("import-new-split"), { target: { value: "4" } });
    testing.fireEvent.click(view.getByTestId("import-add-split"));
    expect(mocks.importManuscript).not.toHaveBeenCalled();

    testing.fireEvent.click(view.getByTestId("import-confirm"));
    expect(mocks.importManuscript).toHaveBeenCalledTimes(1);
    const mapping = mocks.importManuscript.mock.calls[0]?.[0] as ConfirmedImportMapping;
    expect(mapping).toEqual({
      bookTitle: "The Long Road",
      chapters: [
        { title: "Chapter 1", content: "One.\nTwo.\n" },
        { title: "Chapter 2", content: "Three.\nFour.\n" }
      ]
    });

    mocks.publish.resolve({
      ok: true,
      data: {
        book: { id: "book_00000001", title: "The Long Road" },
        chapters: [
          { title: "Chapter 1", content: "One.\nTwo.\n" },
          { title: "Chapter 2", content: "Three.\nFour.\n" }
        ]
      }
    });
    await testing.waitFor(() => {
      expect(view.getByTitle("Imported The Long Road with 2 chapters.")).toBeTruthy();
    });
    expect(mocks.list.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.onOpenBook).not.toHaveBeenCalled();

    // The final result report names the source file, the committed counts, the
    // split mapping and the normalization, plus the explicit not-imported note.
    expect(view.getByTestId("import-result-dialog")).toBeTruthy();
    expect(view.getByTestId("import-result-source").textContent ?? "").toContain("Road.txt");
    expect(view.getByTestId("import-result-chapter-1").textContent ?? "").toContain("Chapter 1");
    expect(view.getByTestId("import-result-chapter-1").textContent ?? "").toContain("Lines 1 to 3");
    expect(view.getByTestId("import-result-chapter-2").textContent ?? "").toContain("Lines 4 to 5");
    expect(view.getByTestId("import-result-normalization").textContent ?? "").toContain("edge blank line");
    expect(view.getByTestId("import-result-not-imported").textContent ?? "").toContain("were not imported");
    testing.fireEvent.click(view.getByTestId("import-result-close"));
    expect(view.queryByTestId("import-result-dialog")).toBeNull();
  });

  test("the report counts the committed book, not the preview", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    await openPreview(view, mocks);

    testing.fireEvent.click(view.getByTestId("import-confirm"));
    // The library read back one more word than the mapping previewed.
    mocks.publish.resolve({
      ok: true,
      data: {
        book: { id: "book_00000001", title: "Road" },
        chapters: [{ title: "Chapter 1", content: "One.\nTwo.\n\nThree.\nFour.\nExtra.\n" }]
      }
    });
    await testing.waitFor(() => {
      expect(view.getByTitle("Imported Road with 1 chapter.")).toBeTruthy();
    });
    expect(view.getByTestId("import-result-chapter-1").textContent ?? "").toContain("5 words");
  });

  test("cancelling before the commit adds nothing and says so", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    await openPreview(view, mocks);

    testing.fireEvent.change(view.getByTestId("import-book-title"), { target: { value: "Edited" } });
    testing.fireEvent.click(view.getByTestId("import-cancel"));
    expect(mocks.importManuscript).not.toHaveBeenCalled();
    expect(view.queryByTestId("import-preview-dialog")).toBeNull();
    expect(view.getByTitle("Import cancelled. Nothing was added.")).toBeTruthy();
  });

  test("a refused source shows honest copy with only a close action", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    testing.fireEvent.click(view.getByTestId("import-manuscript"));
    mocks.pick.resolve({
      ok: true,
      data: { status: "refused", reason: "unsupported-extension", message: "“notes.pdf” is not supported." }
    });
    await testing.waitFor(() => {
      expect(view.getByTestId("import-refusal").textContent ?? "").toContain("not supported");
    });
    expect(view.queryByTestId("import-confirm")).toBeNull();
    testing.fireEvent.click(view.getByTestId("import-cancel"));
    expect(mocks.importManuscript).not.toHaveBeenCalled();
    expect(view.queryByTestId("import-preview-dialog")).toBeNull();
  });

  test("cancelling the picker is silent", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    testing.fireEvent.click(view.getByTestId("import-manuscript"));
    mocks.pick.resolve({ ok: true, data: { status: "cancelled" } });
    await testing.waitFor(() => {
      expect(view.queryByTestId("import-preview-dialog")).toBeNull();
    });
    expect(mocks.importManuscript).not.toHaveBeenCalled();
    expect(view.queryByTitle("Import cancelled. Nothing was added.")).toBeNull();
  });

  test("the publish cannot be cancelled into a lie", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    await openPreview(view, mocks);

    testing.fireEvent.click(view.getByTestId("import-confirm"));
    // While the publish resolves there is no cancel affordance: only the outcome speaks.
    expect(view.getByTestId("import-manuscript").textContent ?? "").toContain("Importing…");
    expect(view.getByTestId("import-manuscript")).toHaveProperty("disabled", true);
    mocks.publish.resolve({
      ok: true,
      data: {
        book: { id: "book_00000001", title: "Road" },
        chapters: [{ title: "Chapter 1", content: "One.\nTwo.\n\nThree.\nFour.\n" }]
      }
    });
    await testing.waitFor(() => {
      expect(view.getByTitle("Imported Road with 1 chapter.")).toBeTruthy();
    });
  });

  test("a failed publish reports the failure and clears progress", async () => {
    const mocks = mockStudio("darwin");
    const view = renderLibrary(mocks);
    await openPreview(view, mocks);

    testing.fireEvent.click(view.getByTestId("import-confirm"));
    mocks.publish.resolve({ ok: false, error: { code: "io", message: "The disk gave up." } });
    await testing.waitFor(() => {
      expect(mocks.onNotice).toHaveBeenCalledTimes(1);
    });
    expect(view.queryByTitle("Imported Road with 1 chapter.")).toBeNull();
  });

  test("the import action stays off non-macOS platforms", async () => {
    const mocks = mockStudio("web");
    const view = renderLibrary(mocks);
    await testing.waitFor(() => {
      expect(view.getByTestId("library-view")).toBeTruthy();
    });
    expect(view.queryByTestId("import-manuscript")).toBeNull();
  });
});
