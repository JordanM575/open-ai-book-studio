/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { bookSchema } from "@ai-book-studio/core/schema";
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
 * A title or description edit that clashes with an outside change keeps the author's version as a
 * conflict copy. The dialog says which fields it covers and shows the copy, because nothing else in
 * the library lists conflict copies; the book on disk shows the other writer's values.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK: BookSummary = {
  id: "book_ca000001",
  title: "The Salt Road",
  description: "A crossing at low tide.",
  stage: "drafting",
  chapterCount: 2,
  wordCount: 120,
  updatedAt: NOW
};
const COPY = "books/book_ca000001/conflicts/book.conflict-external-edit.d.json";

function mockStudio(edit: () => Promise<unknown>) {
  const reveal = mock(() => Promise.resolve({ ok: true, data: null }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { edit: mock(edit), delete: mock(() => Promise.resolve({ ok: true, data: null })) },
    conflicts: { reveal }
  };
  return reveal;
}

function renderDialog() {
  const onNotice = mock((_error: unknown) => {});
  const onSaved = mock((_book: unknown) => {});
  const onOpenChange = mock((_open: boolean) => {});
  testing.render(React.createElement(BookActionsDialog, { book: BOOK, onOpenChange, onSaved, onDeleted: () => {}, onNotice }));
  return { onNotice, onSaved, onOpenChange, body: testing.within(document.body) };
}

describe("the book settings dialog when an edit clashes with an outside one", () => {
  test("stays open, names the fields kept as a copy and shows the copy", async () => {
    const outside = bookSchema.parse({ id: BOOK.id, title: "The Salt Road", description: "Their words.", createdAt: NOW, updatedAt: NOW });
    const reveal = mockStudio(() =>
      Promise.resolve({ ok: true, data: { status: "conflict", book: outside, savedAs: COPY, fields: ["description"] } })
    );
    const { body, onSaved, onOpenChange, onNotice } = renderDialog();

    testing.fireEvent.change(body.getByTestId("book-description"), { target: { value: "My words." } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));

    const note = await testing.waitFor(() => body.getByTestId("book-settings-conflict"));
    // The library shows the other writer's description; the note says where the author's went.
    expect(onSaved).toHaveBeenCalledTimes(1);
    const shown = onSaved.mock.calls[0]?.[0] as { description?: string } | undefined;
    expect(shown?.description).toBe("Their words.");
    expect(note.textContent).toContain("The description");
    expect(note.textContent).toContain("separate copy");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();

    testing.fireEvent.click(body.getByRole("button", { name: "Show the copy" }));
    await testing.waitFor(() => expect(reveal).toHaveBeenCalledWith(BOOK.id, COPY));
    // The footer button that said Cancel now says Close.
    expect(body.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("a saved edit closes the dialog with no note", async () => {
    mockStudio(() => Promise.resolve({ ok: true, data: { status: "saved", book: bookSchema.parse({ id: BOOK.id, title: "New", createdAt: NOW, updatedAt: NOW }) } }));
    const { body, onOpenChange } = renderDialog();

    testing.fireEvent.change(body.getByTestId("book-title"), { target: { value: "New" } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));

    await testing.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body.queryByTestId("book-settings-conflict")).toBeNull();
  });
});
