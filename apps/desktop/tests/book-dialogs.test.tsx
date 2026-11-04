/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { BookSummary, SearchHit } from "@ai-book-studio/core/schema";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let SearchDialog!: typeof import("@ai-book-studio/app/components/SearchDialog").SearchDialog;
let BookActionsDialog!: typeof import("@ai-book-studio/app/components/BookActionsDialog").BookActionsDialog;
let NewBookDialog!: typeof import("@ai-book-studio/app/components/NewBookDialog").NewBookDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ SearchDialog } = await import("@ai-book-studio/app/components/SearchDialog"));
  ({ BookActionsDialog } = await import("@ai-book-studio/app/components/BookActionsDialog"));
  ({ NewBookDialog } = await import("@ai-book-studio/app/components/NewBookDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/*
 * The three book dialogs an author meets from the library and the workspace: search a book, rename
 * or delete it, and create one. The bridge is a stub; what is checked is what the author sees and
 * what each dialog asks the main process to do.
 */

const BOOK_ID = "book_dialogs01";

function studio(books: Record<string, unknown>): void {
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = { books };
}

/** A bridge call that stays pending until the test settles it, to see the busy state. */
function pending<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function view() {
  return testing.within(document.body);
}

/** The message of the first error a dialog handed to its notice callback. */
function noticed(onNotice: { mock: { calls: unknown[][] } }): string {
  const error = onNotice.mock.calls[0]?.[0];
  return error instanceof Error ? error.message : String(error);
}

const HITS: SearchHit[] = [
  { chapterId: "ch_dialogs01", chapterTitle: "The Tide", order: 1, line: 3, text: "The salt road was under water." },
  { chapterId: "ch_dialogs02", chapterTitle: "The Crossing", order: 2, line: 12, text: "Salt dried white on her boots." }
];

describe("search this book", () => {
  test("starts with a hint, searches for the trimmed words and lists every matching line", async () => {
    const search = mock(async () => ({ ok: true, data: HITS }));
    studio({ search });
    const onOpenChapter = mock((_chapterId: string) => {});
    const onClose = mock(() => {});
    testing.render(React.createElement(SearchDialog, { open: true, bookId: BOOK_ID, onClose, onOpenChapter }));

    const page = view();
    expect(page.getByText("Search finds lines, not whole paragraphs.")).toBeTruthy();
    const button = page.getByRole("button", { name: "Search" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    testing.fireEvent.change(page.getByRole("textbox", { name: "Search this book" }), { target: { value: "  salt  " } });
    expect(button.disabled).toBe(false);
    testing.fireEvent.click(button);

    await testing.waitFor(() => expect(page.getByText("2 matches")).toBeTruthy());
    expect(search).toHaveBeenCalledWith(BOOK_ID, "salt");
    const first = page.getByRole("button", { name: /Chapter 1 · The Tide · line 3/ });
    expect(first.textContent).toContain("The salt road was under water.");
    expect(page.getByRole("button", { name: /Chapter 2 · The Crossing · line 12/ })).toBeTruthy();

    testing.fireEvent.click(first);
    expect(onOpenChapter).toHaveBeenCalledWith("ch_dialogs01");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("says when nothing matches, and counts a single match as one", async () => {
    const search = mock(async (_bookId: string, query: string) => ({
      ok: true,
      data: query === "lantern" ? [] : HITS.slice(0, 1)
    }));
    studio({ search });
    testing.render(
      React.createElement(SearchDialog, { open: true, bookId: BOOK_ID, onClose: () => {}, onOpenChapter: () => {} })
    );
    const page = view();
    const input = page.getByRole("textbox", { name: "Search this book" });

    testing.fireEvent.change(input, { target: { value: "lantern" } });
    testing.fireEvent.submit(input.closest("form") as HTMLFormElement);
    await testing.waitFor(() => expect(page.getByText("No matches for “lantern”.")).toBeTruthy());
    expect(page.queryByText("Search finds lines, not whole paragraphs.")).toBeNull();

    testing.fireEvent.change(input, { target: { value: "salt" } });
    testing.fireEvent.submit(input.closest("form") as HTMLFormElement);
    await testing.waitFor(() => expect(page.getByText("1 match")).toBeTruthy());
  });

  test("shows the search running, and why it failed when it does", async () => {
    const call = pending<unknown>();
    studio({ search: mock(() => call.promise) });
    testing.render(
      React.createElement(SearchDialog, { open: true, bookId: BOOK_ID, onClose: () => {}, onOpenChapter: () => {} })
    );
    const page = view();
    testing.fireEvent.change(page.getByRole("textbox", { name: "Search this book" }), { target: { value: "salt" } });
    testing.fireEvent.click(page.getByRole("button", { name: "Search" }));

    const running = await page.findByRole("button", { name: "Searching…" });
    expect((running as HTMLButtonElement).disabled).toBe(true);
    await testing.act(async () => {
      call.settle({ ok: false, error: { code: "not-found", message: "That book is no longer in the library." } });
    });
    await testing.waitFor(() => expect(page.getByText("That book is no longer in the library.")).toBeTruthy());
    expect(page.queryByRole("button", { name: /Chapter/ })).toBeNull();
    expect((page.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("opening it again starts a fresh search", async () => {
    studio({ search: mock(async () => ({ ok: true, data: HITS })) });
    const props = { bookId: BOOK_ID, onClose: () => {}, onOpenChapter: () => {} };
    const rendered = testing.render(React.createElement(SearchDialog, { ...props, open: true }));
    const page = view();
    testing.fireEvent.change(page.getByRole("textbox", { name: "Search this book" }), { target: { value: "salt" } });
    testing.fireEvent.click(page.getByRole("button", { name: "Search" }));
    await testing.waitFor(() => expect(page.getByText("2 matches")).toBeTruthy());

    rendered.rerender(React.createElement(SearchDialog, { ...props, open: false }));
    rendered.rerender(React.createElement(SearchDialog, { ...props, open: true }));
    expect((page.getByRole("textbox", { name: "Search this book" }) as HTMLInputElement).value).toBe("");
    expect(page.getByText("Search finds lines, not whole paragraphs.")).toBeTruthy();
    expect(page.queryByText("2 matches")).toBeNull();
  });
});

const SUMMARY: BookSummary = {
  id: BOOK_ID,
  title: "The Salt Road",
  description: "A road that floods twice a day.",
  stage: "drafting",
  chapterCount: 2,
  wordCount: 1478,
  updatedAt: "2026-11-03T00:00:00.000Z"
};

function bookSettings(books: Record<string, unknown>) {
  studio(books);
  const handlers = {
    onOpenChange: mock((_open: boolean) => {}),
    onSaved: mock((_book: unknown) => {}),
    onDeleted: mock((_bookId: string) => {}),
    onNotice: mock((_error: unknown) => {})
  };
  testing.render(React.createElement(BookActionsDialog, { book: SUMMARY, ...handlers }));
  return { page: view(), ...handlers };
}

describe("book settings", () => {
  test("shows the book as it is and saves a trimmed rename", async () => {
    const updated = { ...SUMMARY, title: "The Salt Road, Again" };
    const update = mock(async () => ({ ok: true, data: updated }));
    const { page, onSaved, onOpenChange } = bookSettings({ update });
    const title = page.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(title.value).toBe("The Salt Road");
    const about = page.getByRole("textbox", { name: /What is it about/ }) as HTMLTextAreaElement;
    expect(about.value).toBe("A road that floods twice a day.");

    testing.fireEvent.change(title, { target: { value: "  The Salt Road, Again  " } });
    testing.fireEvent.change(about, { target: { value: " A road that floods. " } });
    testing.fireEvent.click(page.getByRole("button", { name: "Save changes" }));

    await testing.waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(update).toHaveBeenCalledWith(BOOK_ID, { title: "The Salt Road, Again", description: "A road that floods." });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("a book cannot be saved without a title, and Cancel saves nothing", () => {
    const update = mock(async () => ({ ok: true, data: SUMMARY }));
    const { page, onOpenChange } = bookSettings({ update });
    testing.fireEvent.change(page.getByRole("textbox", { name: "Title" }), { target: { value: "   " } });
    expect((page.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);

    testing.fireEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(update).not.toHaveBeenCalled();
  });

  test("a rename that fails is reported and the dialog stays open to try again", async () => {
    const update = mock(async () => ({ ok: false, error: { code: "io", message: "The book folder is read-only." } }));
    const { page, onNotice, onSaved, onOpenChange } = bookSettings({ update });
    testing.fireEvent.click(page.getByRole("button", { name: "Save changes" }));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(noticed(onNotice)).toBe("The book folder is read-only.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await testing.waitFor(() =>
      expect((page.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false)
    );
  });

  test("delete asks first: keeping the book backs out, confirming moves it to the trash", async () => {
    const call = pending<unknown>();
    const remove = mock(() => call.promise);
    const { page, onDeleted, onOpenChange } = bookSettings({ delete: remove });
    expect(page.getByText(/It moves to/).textContent).toContain(".studio/trash/books");

    testing.fireEvent.click(page.getByRole("button", { name: "Delete book…" }));
    testing.fireEvent.click(page.getByRole("button", { name: "Keep it" }));
    expect(page.queryByRole("button", { name: "Delete book" })).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    testing.fireEvent.click(page.getByRole("button", { name: "Delete book…" }));
    testing.fireEvent.click(page.getByRole("button", { name: "Delete book" }));
    expect(((await page.findByRole("button", { name: "Moving…" })) as HTMLButtonElement).disabled).toBe(true);
    expect(remove).toHaveBeenCalledWith(BOOK_ID);

    await testing.act(async () => {
      call.settle({ ok: true, data: { trashedAt: "2026-11-03T00:00:00.000Z" } });
    });
    await testing.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(BOOK_ID));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("a delete that fails is reported and can be tried again", async () => {
    const remove = mock(async () => ({ ok: false, error: { code: "io", message: "The trash folder could not be written." } }));
    const { page, onNotice, onDeleted } = bookSettings({ delete: remove });
    testing.fireEvent.click(page.getByRole("button", { name: "Delete book…" }));
    testing.fireEvent.click(page.getByRole("button", { name: "Delete book" }));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(noticed(onNotice)).toBe("The trash folder could not be written.");
    expect(onDeleted).not.toHaveBeenCalled();
    await testing.waitFor(() =>
      expect((page.getByRole("button", { name: "Delete book" }) as HTMLButtonElement).disabled).toBe(false)
    );
  });
});

function newBook(books: Record<string, unknown>) {
  studio(books);
  const handlers = {
    onOpenChange: mock((_open: boolean) => {}),
    onCreated: mock(async (_bookId: string) => {}),
    onNotice: mock((_error: unknown) => {})
  };
  testing.render(React.createElement(NewBookDialog, { open: true, ...handlers }));
  return { page: view(), ...handlers };
}

describe("new book", () => {
  test("creates the book from the trimmed title and line, then hands over its id", async () => {
    const call = pending<unknown>();
    const create = mock(() => call.promise);
    const { page, onCreated } = newBook({ create });
    const button = page.getByRole("button", { name: "Create book" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    testing.fireEvent.change(page.getByRole("textbox", { name: "Title" }), { target: { value: "  The Lighthouse  " } });
    testing.fireEvent.change(page.getByRole("textbox", { name: /What is it about/ }), {
      target: { value: " A keeper and her letters. " }
    });
    testing.fireEvent.click(button);
    expect(((await page.findByRole("button", { name: "Creating…" })) as HTMLButtonElement).disabled).toBe(true);
    expect(create).toHaveBeenCalledWith({ title: "The Lighthouse", description: "A keeper and her letters." });

    await testing.act(async () => {
      call.settle({ ok: true, data: { id: "book_created01", title: "The Lighthouse" } });
    });
    await testing.waitFor(() => expect(onCreated).toHaveBeenCalledWith("book_created01"));
  });

  test("a book that cannot be created is reported and the form can be sent again", async () => {
    const create = mock(async () => ({ ok: false, error: { code: "invalid", message: "Choose a library folder first." } }));
    const { page, onNotice, onCreated } = newBook({ create });
    testing.fireEvent.change(page.getByRole("textbox", { name: "Title" }), { target: { value: "The Lighthouse" } });
    testing.fireEvent.click(page.getByRole("button", { name: "Create book" }));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(noticed(onNotice)).toBe("Choose a library folder first.");
    expect(onCreated).not.toHaveBeenCalled();
    await testing.waitFor(() =>
      expect((page.getByRole("button", { name: "Create book" }) as HTMLButtonElement).disabled).toBe(false)
    );
  });

  test("Cancel closes without creating anything", () => {
    const create = mock(async () => ({ ok: true, data: { id: "book_created01" } }));
    const { page, onOpenChange } = newBook({ create });
    testing.fireEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(create).not.toHaveBeenCalled();
  });
});
