/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, type BookMeta } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
// Loaded in beforeAll, once the DOM exists.
let StoryBibleDialog!: typeof import("@ai-book-studio/app/components/StoryBibleDialog").StoryBibleDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ StoryBibleDialog } = await import("@ai-book-studio/app/components/StoryBibleDialog"));
});
afterAll(async () => {
  await unmountDom();
});
afterEach(() => testing.cleanup());

const BOOK_ID = "book_bible000001";
const NOW = "2026-11-03T00:00:00.000Z";

function bibleBook(): BookMeta {
  return bookSchema.parse({
    id: BOOK_ID,
    title: "The Salt Road",
    description: "A crossing at low tide.",
    createdAt: NOW,
    updatedAt: NOW,
    characters: [
      { id: "char_bible000001", name: "Mara", role: "Keeper", description: "Keeps the light.", motivations: "", notes: "" }
    ],
    memories: [{ id: "mem_bible000001", text: "The lighthouse went dark once.", importance: "high", createdAt: NOW, updatedAt: NOW }]
  });
}

function mockUpdate(result: unknown) {
  const update = mock(() => Promise.resolve(result));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    books: { update }
  };
  return update;
}

function renderDialog(book: BookMeta, handlers: { onSaved?: () => void; onClose?: () => void; onNotice?: (error: unknown) => void } = {}) {
  const onSaved = mock(handlers.onSaved ?? (() => {}));
  const onClose = mock(handlers.onClose ?? (() => {}));
  const onNotice = mock(handlers.onNotice ?? ((_error: unknown) => {}));
  testing.render(
    React.createElement(StoryBibleDialog, { open: true, book, onClose, onSaved, onNotice })
  );
  return { onSaved, onClose, onNotice };
}

describe("StoryBibleDialog", () => {
  test("stages character and memory edits and saves them together", async () => {
    const saved = { ...bibleBook(), title: "The Salt Road" };
    const update = mockUpdate({ ok: true, data: saved });
    const { onSaved, onClose } = renderDialog(bibleBook());

    testing.fireEvent.change(testing.within(document.body).getByPlaceholderText("Name") as HTMLInputElement, {
      target: { value: "Mara Voss" }
    });
    testing.fireEvent.change(testing.within(document.body).getByDisplayValue("The lighthouse went dark once.") as HTMLTextAreaElement, {
      target: { value: "The lighthouse went dark twice." }
    });
    testing.fireEvent.change(testing.within(document.body).getByLabelText("Importance") as HTMLSelectElement, {
      target: { value: "low" }
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));

    await testing.waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(update).toHaveBeenCalledWith(
      BOOK_ID,
      expect.objectContaining({
        characters: [
          {
            id: "char_bible000001",
            name: "Mara Voss",
            role: "Keeper",
            description: "Keeps the light.",
            motivations: "",
            notes: "",
          }
        ],
        memories: [expect.objectContaining({ text: "The lighthouse went dark twice.", importance: "low" })]
      })
    );
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  test("cancel discards a staged removal without writing", () => {
    const update = mockUpdate({ ok: true, data: bibleBook() });
    const { onClose } = renderDialog(bibleBook());

    testing.fireEvent.click(testing.within(document.body).getByLabelText("Remove Mara"));
    expect(testing.within(document.body).queryByDisplayValue("Mara")).toBeNull();
    testing.fireEvent.click(testing.within(document.body).getByText("Cancel"));

    expect(update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("a blank title disables saving", () => {
    const update = mockUpdate({ ok: true, data: bibleBook() });
    renderDialog(bibleBook());

    testing.fireEvent.change(testing.within(document.body).getByLabelText("Title") as HTMLInputElement, {
      target: { value: "   " }
    });
    expect((testing.within(document.body).getByTestId("save-story-bible") as HTMLButtonElement).disabled).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  test("a failed save keeps the dialog open and reports the error", async () => {
    const update = mockUpdate({ ok: false, error: { code: "io", message: "The disk gave up." } });
    const { onClose, onNotice } = renderDialog(bibleBook());

    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(testing.within(document.body).getByTestId("save-story-bible")).toBeTruthy();
  });
});
