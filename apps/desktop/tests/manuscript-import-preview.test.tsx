/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import {
  importManuscriptInputSchema,
  validateSource,
  type SourceRefusal,
  type ValidatedSource
} from "@ai-book-studio/core/manuscript-import";
import type {
  ConfirmedImportMapping,
  ImportPreviewInput
} from "@ai-book-studio/app/components/ImportPreviewDialog";

let testing!: typeof import("@testing-library/react/pure");
let ImportPreviewDialog!: typeof import("@ai-book-studio/app/components/ImportPreviewDialog").ImportPreviewDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ ImportPreviewDialog } = await import("@ai-book-studio/app/components/ImportPreviewDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * The import preview contract (spec 029 T007): the author sees the full text,
 * edits titles and split points, gets honest copy for unsupported input, and
 * nothing reaches the library before an explicit confirm.
 */

const TEXT = "One.\nTwo.\n\nThree.\nFour.\n\nFive.\nSix.\n";

function validatedSource(): ValidatedSource {
  const result = validateSource({ fileName: "Road.txt", bytes: new TextEncoder().encode(TEXT) });
  if (result.status !== "validated") throw new Error("Synthetic fixture must validate.");
  return result;
}

function renderPreview(input: ImportPreviewInput) {
  const onConfirm = mock((_mapping: ConfirmedImportMapping) => {});
  const onCancel = mock(() => {});
  testing.render(
    React.createElement(ImportPreviewDialog, { open: true, input, onConfirm, onCancel })
  );
  return { onConfirm, onCancel };
}

function bodyText(order: number): string {
  return (
    testing.within(document.body).getByTestId(`import-chapter-body-${order}`).textContent ?? ""
  );
}

describe("ImportPreviewDialog", () => {
  test("shows every chapter body in full", () => {
    renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    expect(view.getByTestId("import-book-title")).toBeTruthy();
    // Whole-file default: one chapter holding the complete canonical text.
    expect(bodyText(1)).toBe("One.\nTwo.\n\nThree.\nFour.\n\nFive.\nSix.\n");
    expect(view.getByTestId("import-chapter-lines-1").textContent ?? "").toContain("Lines 1 to 8");
  });

  test("editing the book and chapter titles reaches the confirmed mapping", () => {
    const { onConfirm } = renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-book-title"), { target: { value: "The Long Road" } });
    testing.fireEvent.change(view.getByTestId("import-chapter-title-1"), { target: { value: "Beginnings" } });
    testing.fireEvent.click(view.getByTestId("import-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const mapping = onConfirm.mock.calls[0]?.[0] as ConfirmedImportMapping;
    expect(mapping.bookTitle).toBe("The Long Road");
    expect(mapping.chapters).toEqual([
      { title: "Beginnings", content: "One.\nTwo.\n\nThree.\nFour.\n\nFive.\nSix.\n" }
    ]);
  });

  test("adding a split divides the text into exact chapter ranges", () => {
    const { onConfirm } = renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-new-split"), { target: { value: "4" } });
    testing.fireEvent.click(view.getByTestId("import-add-split"));
    expect(view.getByTestId("import-chapter-lines-1").textContent ?? "").toContain("Lines 1 to 3");
    expect(view.getByTestId("import-chapter-lines-2").textContent ?? "").toContain("Lines 4 to 8");
    expect(bodyText(1)).toBe("One.\nTwo.\n");
    expect(bodyText(2)).toBe("Three.\nFour.\n\nFive.\nSix.\n");
    testing.fireEvent.click(view.getByTestId("import-confirm"));
    const mapping = onConfirm.mock.calls[0]?.[0] as ConfirmedImportMapping;
    expect(mapping.bookTitle).toBe("Road");
    expect(mapping.chapters).toEqual([
      { title: "Chapter 1", content: "One.\nTwo.\n" },
      { title: "Chapter 2", content: "Three.\nFour.\n\nFive.\nSix.\n" }
    ]);
  });

  test("moving a split point re-derives chapters from the same source bytes", () => {
    renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-new-split"), { target: { value: "4" } });
    testing.fireEvent.click(view.getByTestId("import-add-split"));
    testing.fireEvent.change(view.getByTestId("import-split-2"), { target: { value: "6" } });
    expect(view.getByTestId("import-chapter-lines-1").textContent ?? "").toContain("Lines 1 to 5");
    expect(view.getByTestId("import-chapter-lines-2").textContent ?? "").toContain("Lines 6 to 8");
    expect(bodyText(1)).toBe("One.\nTwo.\n\nThree.\nFour.\n");
    expect(bodyText(2)).toBe("Five.\nSix.\n");
  });

  test("removing a split returns the text to one chapter", () => {
    const { onConfirm } = renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-new-split"), { target: { value: "4" } });
    testing.fireEvent.click(view.getByTestId("import-add-split"));
    expect(view.getByTestId("import-chapter-body-2")).toBeTruthy();
    testing.fireEvent.click(view.getByTestId("import-remove-split-2"));
    expect(view.queryByTestId("import-chapter-body-2")).toBeNull();
    expect(bodyText(1)).toBe("One.\nTwo.\n\nThree.\nFour.\n\nFive.\nSix.\n");
    testing.fireEvent.click(view.getByTestId("import-confirm"));
    const confirmed = onConfirm.mock.calls[0]?.[0];
    if (!confirmed) throw new Error("confirm never fired");
    expect((confirmed as ConfirmedImportMapping).chapters).toHaveLength(1);
  });

  test("unsupported input shows honest copy and only a close action", () => {
    const refusal: SourceRefusal = {
      status: "refused",
      reason: "unsupported-extension",
      message: "“notes.pdf” is not a supported manuscript file. Choose a .txt, .md or .markdown file."
    };
    const { onConfirm, onCancel } = renderPreview({ kind: "refusal", refusal });
    const view = testing.within(document.body);
    expect(view.getByTestId("import-refusal").textContent ?? "").toContain(".txt");
    expect(view.queryByTestId("import-confirm")).toBeNull();
    expect(view.queryByTestId("import-chapter-body-1")).toBeNull();
    testing.fireEvent.click(view.getByTestId("import-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("cancel never confirms, even after edits", () => {
    const { onConfirm, onCancel } = renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-book-title"), { target: { value: "Edited" } });
    testing.fireEvent.click(view.getByTestId("import-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("confirm is the only path that reports a mapping", () => {
    const { onConfirm } = renderPreview({ kind: "source", source: validatedSource() });
    expect(onConfirm).not.toHaveBeenCalled();
    testing.fireEvent.click(testing.within(document.body).getByTestId("import-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const mapping = onConfirm.mock.calls[0]?.[0] as ConfirmedImportMapping;
    expect(mapping.bookTitle).toBe("Road");
    expect(mapping.chapters).toHaveLength(1);
  });

  test("the confirmed mapping satisfies the IPC input contract with no path", () => {
    const { onConfirm } = renderPreview({ kind: "source", source: validatedSource() });
    const view = testing.within(document.body);
    testing.fireEvent.change(view.getByTestId("import-new-split"), { target: { value: "4" } });
    testing.fireEvent.click(view.getByTestId("import-add-split"));
    testing.fireEvent.click(view.getByTestId("import-confirm"));
    const mapping = onConfirm.mock.calls[0]?.[0] as ConfirmedImportMapping;
    expect(Object.keys(mapping).sort()).toEqual(["bookTitle", "chapters"]);
    const parsed = importManuscriptInputSchema.safeParse(mapping);
    expect(parsed.success).toBe(true);
  });

  test("the preview component never touches the library", async () => {
    const source = await Bun.file(
      new URL("../../../packages/app/src/components/ImportPreviewDialog.tsx", import.meta.url)
    ).text();
    expect(source).not.toContain("core/library");
    expect(source).not.toContain("core/ipc");
    expect(source).not.toContain("Library");
  });
});
