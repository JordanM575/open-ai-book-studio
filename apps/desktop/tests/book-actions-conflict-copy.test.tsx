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

function mockStudio(edit: (bookId: string, changes: Record<string, { from: unknown; to: unknown }>) => Promise<unknown>) {
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

  test("after a save that kept one field and applied another, changing the applied one back is still saved", async () => {
    const afterFirst = bookSchema.parse({ id: BOOK.id, title: "The Salt Causeway", description: "Their words.", createdAt: NOW, updatedAt: NOW });
    const afterSecond = bookSchema.parse({ id: BOOK.id, title: BOOK.title, description: "Their words.", createdAt: NOW, updatedAt: NOW });
    const edit = mock(async (_bookId: string, changes: Record<string, { from: unknown; to: unknown }>) =>
      "title" in changes && changes.title?.to === BOOK.title
        ? { ok: true, data: { status: "saved", book: afterSecond } }
        : { ok: true, data: { status: "conflict", book: afterFirst, savedAs: COPY, fields: ["description"] } }
    );
    mockStudio(edit);
    const { body, onOpenChange } = renderDialog();

    // The rename lands; the description clashes with an outside edit and becomes a copy.
    testing.fireEvent.change(body.getByTestId("book-title"), { target: { value: "The Salt Causeway" } });
    testing.fireEvent.change(body.getByTestId("book-description"), { target: { value: "My words." } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));
    await testing.waitFor(() => body.getByTestId("book-settings-conflict"));

    // The author takes the title back and keeps what is on disk for the description.
    testing.fireEvent.change(body.getByTestId("book-title"), { target: { value: BOOK.title } });
    testing.fireEvent.change(body.getByTestId("book-description"), { target: { value: "Their words." } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));

    await testing.waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    // The second save starts from the title the first one saved, so the change back is sent and not dropped.
    const second = edit.mock.calls[1]?.[1];
    expect(second?.title).toEqual({ from: "The Salt Causeway", to: BOOK.title });
    await testing.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("a field the author left alone follows the book a conflicting save returned, so a retry sends only what was edited", async () => {
    const theirs = bookSchema.parse({
      id: BOOK.id,
      title: "Their Title",
      description: "Their words.",
      createdAt: NOW,
      updatedAt: NOW
    });
    const edit = mock(async (_bookId: string, changes: Record<string, { from: unknown; to: unknown }>) =>
      "description" in changes && changes.description?.to === "My words."
        ? { ok: true, data: { status: "conflict", book: theirs, savedAs: COPY, fields: ["description"] } }
        : { ok: true, data: { status: "saved", book: theirs } }
    );
    mockStudio(edit);
    const { body, onOpenChange } = renderDialog();

    // Another writer changed the title and the description; the author edits only the description.
    testing.fireEvent.change(body.getByTestId("book-description"), { target: { value: "My words." } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));
    await testing.waitFor(() => body.getByTestId("book-settings-conflict"));
    // The title the author never touched now shows the other writer's.
    expect((body.getByTestId("book-title") as HTMLInputElement).value).toBe("Their Title");

    testing.fireEvent.change(body.getByTestId("book-description"), { target: { value: "My words, revised." } });
    testing.fireEvent.click(body.getByTestId("save-book-settings"));

    await testing.waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    // The retry sends the description the author edited and leaves the title alone.
    const second = edit.mock.calls[1]?.[1] ?? {};
    expect(Object.keys(second)).toEqual(["description"]);
    expect(second.description).toEqual({ from: "Their words.", to: "My words, revised." });
    await testing.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
