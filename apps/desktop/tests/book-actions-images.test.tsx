/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { ImageExportResult, Result } from "@ai-book-studio/core/ipc";
import type { BookSummary } from "@ai-book-studio/core/schema";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let BookActionsDialog!: typeof import("@ai-book-studio/app/components/BookActionsDialog").BookActionsDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ BookActionsDialog } = await import("@ai-book-studio/app/components/BookActionsDialog"));
});

afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Spec 002 FR-050: the book's actions in the library export every image as a JPEG. The note
 * names the folder and the count, says plainly when there is nothing to export, lists what was
 * skipped, and stays quiet when the author cancels the picker.
 */

const BOOK: BookSummary = {
  id: "book_fx000001",
  title: "The Salt Road",
  description: "A crossing at low tide.",
  stage: "drafting",
  chapterCount: 2,
  wordCount: 120,
  updatedAt: "2026-11-03T00:00:00.000Z"
};

const FOLDER = "/Users/author/Desktop/the-salt-road-images";

type ExportImages = (bookId: string) => Promise<Result<ImageExportResult>>;

function stubStudio(exportImages: ExportImages, platform = "darwin") {
  const calls = mock(exportImages);
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform,
    books: {
      exportImages: calls,
      update: mock(() => Promise.resolve({ ok: true, data: {} })),
      delete: mock(() => Promise.resolve({ ok: true, data: { trashedAt: "2026-11-03T00:00:00.000Z" } }))
    }
  };
  return calls;
}

function answer(result: ImageExportResult): ExportImages {
  return () => Promise.resolve({ ok: true, data: result });
}

function renderDialog() {
  const onNotice = mock((_error: unknown) => {});
  const dialog = (book: BookSummary | null) =>
    React.createElement(BookActionsDialog, {
      book,
      onOpenChange: () => {},
      onSaved: () => {},
      onDeleted: () => {},
      onNotice
    });
  const view = testing.render(dialog(BOOK));
  return {
    onNotice,
    body: testing.within(document.body),
    rerender: (book: BookSummary | null) => view.rerender(dialog(book))
  };
}

/** Clicks Export images and waits until the export has finished and the button is back. */
async function exportAndSettle(body: ReturnType<typeof renderDialog>["body"]): Promise<HTMLElement> {
  testing.fireEvent.click(body.getByRole("button", { name: "Export images" }));
  await testing.waitFor(() => {
    const button = body.getByTestId("export-images") as HTMLButtonElement;
    expect(button.textContent).toBe("Export images");
    expect(button.disabled).toBe(false);
  });
  return body.getByTestId("export-images-note");
}

describe("Export images in the book's actions", () => {
  test("names the folder and the count after the images are saved", async () => {
    const calls = stubStudio(
      answer({
        status: "saved",
        folder: FOLDER,
        files: ["01-the-door.jpg", "02-the-gate.jpg", "cover.jpg"],
        skipped: []
      })
    );
    const { body, onNotice } = renderDialog();
    const note = await exportAndSettle(body);
    expect(note.textContent).toBe("Saved 3 images to the-salt-road-images");
    expect(note.getAttribute("role")).toBe("status");
    expect(calls).toHaveBeenCalledWith(BOOK.id);
    expect(onNotice).not.toHaveBeenCalled();
  });

  test("lists each skipped image with its reason beside the count", async () => {
    stubStudio(
      answer({
        status: "saved",
        folder: FOLDER,
        files: ["01-the-door.jpg"],
        skipped: [{ name: "02-the-gate.jpg", reason: "The WebP image could not be converted to JPEG." }]
      })
    );
    const { body } = renderDialog();
    const note = await exportAndSettle(body);
    expect(testing.within(note).getByText("Saved 1 image to the-salt-road-images · 1 skipped")).toBeDefined();
    expect(testing.within(note).getByRole("listitem").textContent).toBe(
      "02-the-gate.jpg · The WebP image could not be converted to JPEG."
    );
  });

  test("says plainly when the book has no images", async () => {
    stubStudio(answer({ status: "empty" }));
    const { body } = renderDialog();
    const note = await exportAndSettle(body);
    expect(note.textContent).toBe("This book has no images yet. Nothing was exported.");
  });

  test("says that nothing was written when no image could be converted", async () => {
    stubStudio(
      answer({
        status: "unconverted",
        skipped: [{ name: "01-the-door.jpg", reason: "The WebP image could not be converted to JPEG." }]
      })
    );
    const { body } = renderDialog();
    const note = await exportAndSettle(body);
    expect(testing.within(note).getByText("None of the images could be converted to JPEG. Nothing was written.")).toBeDefined();
    expect(testing.within(note).getAllByRole("listitem")).toHaveLength(1);
  });

  test("a cancelled picker says nothing", async () => {
    stubStudio(answer({ status: "cancelled" }));
    const { body, onNotice } = renderDialog();
    const note = await exportAndSettle(body);
    expect(note.textContent).toBe("");
    expect(onNotice).not.toHaveBeenCalled();
  });

  test("a refused export reaches the notice with the main process's words", async () => {
    const message = "“the-salt-road-images” already exists in that folder. Choose another folder, or rename the existing one first. Nothing was written.";
    stubStudio(() => Promise.resolve({ ok: false, error: { code: "invalid", message } }));
    const { body, onNotice } = renderDialog();
    const note = await exportAndSettle(body);
    expect(note.textContent).toBe("");
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0]?.[0]).toMatchObject({ message });
  });

  test("holds Save and Delete while the export runs", async () => {
    let finish!: (result: Result<ImageExportResult>) => void;
    stubStudio(() => new Promise((resolve) => (finish = resolve)));
    const { body } = renderDialog();
    testing.fireEvent.click(body.getByRole("button", { name: "Export images" }));
    await testing.waitFor(() => expect(body.getByTestId("export-images").textContent).toBe("Exporting…"));
    expect((body.getByTestId("export-images") as HTMLButtonElement).disabled).toBe(true);
    expect((body.getByTestId("save-book-settings") as HTMLButtonElement).disabled).toBe(true);
    expect((body.getByTestId("delete-book") as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true, data: { status: "saved", folder: FOLDER, files: ["cover.jpg"], skipped: [] } });
    await testing.waitFor(() => expect(body.getByTestId("export-images-note").textContent).toBe("Saved 1 image to the-salt-road-images"));
    await testing.waitFor(() => expect((body.getByTestId("delete-book") as HTMLButtonElement).disabled).toBe(false));
    expect((body.getByTestId("save-book-settings") as HTMLButtonElement).disabled).toBe(false);
  });

  test("a refusal that arrives after the dialog closed still reaches the notice", async () => {
    let finish!: (result: Result<ImageExportResult>) => void;
    stubStudio(() => new Promise((resolve) => (finish = resolve)));
    const { body, onNotice, rerender } = renderDialog();
    testing.fireEvent.click(body.getByRole("button", { name: "Export images" }));
    await testing.waitFor(() => expect(body.getByTestId("export-images").textContent).toBe("Exporting…"));
    rerender(null);
    await testing.waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    const message = "The studio is not allowed to write in that folder. Nothing was written.";
    finish({ ok: false, error: { code: "io", message } });
    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(onNotice.mock.calls[0]?.[0]).toMatchObject({ message });
  });

  test("the browser build does not offer it", () => {
    const calls = stubStudio(answer({ status: "empty" }), "web");
    const { body } = renderDialog();
    expect(body.getByRole("dialog").textContent).toContain("Rename this book, or move the whole folder to the library trash.");
    expect(body.queryByRole("button", { name: "Export images" })).toBeNull();
    expect(body.queryByTestId("export-images-note")).toBeNull();
    expect(calls).not.toHaveBeenCalled();
  });
});
