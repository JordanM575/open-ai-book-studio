/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { NO_MATTER, matterHash, newMatterSection, type BookMatter } from "@ai-book-studio/core/matter";
import { bookSchema, chapterMetaSchema, manuscriptSettingsSchema, type BookMeta, type Chapter } from "@ai-book-studio/core/schema";
import { ambientStatus } from "@ai-book-studio/core/agent/ambient";

let testing!: typeof import("@testing-library/react/pure");
let FormatDialog!: typeof import("@ai-book-studio/app/components/FormatDialog").FormatDialog;
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;
let axe!: typeof import("axe-core");

beforeAll(async () => {
  testing = await mountDom();
  ({ FormatDialog } = await import("@ai-book-studio/app/components/FormatDialog"));
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
  axe = (await import("axe-core")).default;
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/*
 * Spec 035 T010–T012, D-169: the Format dialog's front and back matter. The author adds, edits,
 * reorders by keyboard and removes sections and turns the generated title page on or off; the
 * preview follows the export order; every save carries the version and hash of the matter it
 * started from; and opening or closing the dialog never writes matter on its own. Synthetic only.
 */

const NOW = "2026-11-04T09:00:00.000Z";
const BOOK = "book_fmatter01";

const CHAPTERS: Chapter[] = [
  {
    ...chapterMetaSchema.parse({ id: "ch_fmatter01", title: "The Door", order: 1, createdAt: NOW, updatedAt: NOW }),
    content: "The hall was cold.\n",
    path: "0001-the-door.md",
    wordCount: 4,
    hash: "b".repeat(64)
  }
];

const SAVED: BookMatter = {
  version: 4,
  titlePage: true,
  author: "Ana Reyes",
  subtitle: "",
  sections: [
    newMatterSection("copyright", "mat_dlg00001", "All rights reserved."),
    newMatterSection("dedication", "mat_dlg00002", "For Ana."),
    newMatterSection("about-the-author", "mat_dlg00003", "Ana lives by the sea.")
  ]
};

function bookWith(fields: Record<string, unknown> = {}): BookMeta {
  return bookSchema.parse({ id: BOOK, title: "The Salt Road", description: "A crossing at low tide.", createdAt: NOW, updatedAt: NOW, ...fields });
}

type SaveMatter = (input: { bookId: string; matter: BookMatter; baseVersion: number; baseHash: string }) => Promise<unknown>;

function render(book: BookMeta, options: { saveMatter?: SaveMatter } = {}) {
  const saveMatter = mock(
    options.saveMatter ??
      (async (input: Parameters<SaveMatter>[0]) => ({
        ok: true,
        data: { status: "saved", book: { ...book, matter: { ...input.matter, version: input.baseVersion + 1 } } }
      }))
  );
  const exportDocx = mock(async () => ({ ok: true, data: "/tmp/out/the-salt-road.docx" }));
  const reveal = mock(async () => ({ ok: true, data: null }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { saveMatter, exportDocx },
    conflicts: { reveal }
  };
  const onBookSaved = mock((_book: BookMeta) => {});
  const onNotice = mock((_error: unknown) => {});
  const props = {
    onClose: () => {},
    bookId: BOOK,
    bookTitle: book.title,
    book,
    onBookSaved,
    onNotice,
    settings: manuscriptSettingsSchema.parse({}),
    chapters: CHAPTERS,
    onSaveSettings: async () => {},
    onFlush: async () => null
  };
  const result = testing.render(React.createElement(FormatDialog, { ...props, open: true }));
  const view = testing.within(document.body);
  const close = () => result.rerender(React.createElement(FormatDialog, { ...props, open: false }));
  const reopen = () => result.rerender(React.createElement(FormatDialog, { ...props, open: true }));
  return { view, saveMatter, exportDocx, reveal, onBookSaved, onNotice, close, reopen };
}

/** The visible names of the sections in one side's list, in order. */
function names(view: ReturnType<typeof testing.within>, side: "Front matter" | "Back matter"): string[] {
  const list = view.queryByRole("region", { name: side });
  if (!list) return [];
  return testing.within(list).queryAllByRole("listitem").map((item) => item.querySelector("span")?.textContent ?? "");
}

describe("front and back matter in the Format dialog", () => {
  test("opening, toggling the title page off and on, and closing writes nothing", async () => {
    const { view, saveMatter, close } = render(bookWith({ frontMatter: { dedication: "For those who wait." } }));
    const titlePage = view.getByRole("checkbox", { name: "Title page" }) as HTMLInputElement;
    expect(titlePage.checked).toBe(true);
    testing.fireEvent.click(titlePage);
    testing.fireEvent.click(titlePage);
    close();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(saveMatter).not.toHaveBeenCalled();
  });

  test("a new section saves with the version and hash of the matter it started from", async () => {
    const book = bookWith();
    const { view, saveMatter, onBookSaved, close } = render(book);
    testing.fireEvent.change(view.getByLabelText("New section"), { target: { value: "dedication" } });
    testing.fireEvent.click(view.getByRole("button", { name: "Add section" }));
    testing.fireEvent.change(view.getByLabelText("Text"), { target: { value: "For Ana." } });
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "Ana Reyes" } });
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input.bookId).toBe(BOOK);
    expect(input.baseVersion).toBe(0);
    expect(input.baseHash).toBe(await matterHash(null));
    expect(input.matter).toMatchObject({ titlePage: true, author: "Ana Reyes", sections: [{ kind: "dedication", position: "front", title: "", text: "For Ana." }] });
    expect(input.matter.sections[0]?.id).toMatch(/^mat_[0-9a-f]{12}$/);
    await testing.waitFor(() => expect(onBookSaved).toHaveBeenCalledTimes(1));
  });

  test("two changes made before the dialog renders both land", async () => {
    const { view, saveMatter, close } = render(bookWith());
    const add = view.getByRole("button", { name: "Add section" });
    const author = view.getByLabelText("Author") as HTMLInputElement;
    // Outside act, in one task, as an automation tool can: React has not re-rendered in between.
    add.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(author, "Ana Reyes");
    author.dispatchEvent(new Event("input", { bubbles: true }));
    await testing.waitFor(() => expect(names(view, "Front matter")).toEqual(["Copyright"]));
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input.matter).toMatchObject({ author: "Ana Reyes", sections: [{ kind: "copyright" }] });
  });

  test("a change saves itself shortly after the author stops, from the saved version", async () => {
    const book = bookWith({ matter: SAVED });
    const { view, saveMatter } = render(book);
    testing.fireEvent.change(view.getByLabelText("Subtitle"), { target: { value: "A tidewater tale" } });
    testing.fireEvent.change(view.getByLabelText("Subtitle"), { target: { value: "A tidewater tale, told twice" } });
    expect(saveMatter).not.toHaveBeenCalled();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input.baseVersion).toBe(4);
    expect(input.baseHash).toBe(await matterHash(SAVED));
    expect(input.matter.subtitle).toBe("A tidewater tale, told twice");
  });

  test("sections move by keyboard, across the chapters at a side's end, and keep focus", async () => {
    const { view, saveMatter, close } = render(bookWith({ matter: SAVED }));
    expect(names(view, "Front matter")).toEqual(["Copyright", "Dedication"]);
    expect((view.getByRole("button", { name: "Move Copyright up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Move About the author down" }) as HTMLButtonElement).disabled).toBe(true);

    const down = view.getByRole("button", { name: "Move Copyright down" });
    down.focus();
    testing.fireEvent.click(down);
    expect(names(view, "Front matter")).toEqual(["Dedication", "Copyright"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move Copyright down");

    // The last front section moves on into the back matter.
    testing.fireEvent.click(view.getByRole("button", { name: "Move Copyright down" }));
    expect(names(view, "Front matter")).toEqual(["Dedication"]);
    expect(names(view, "Back matter")).toEqual(["Copyright", "About the author"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move Copyright down");

    // And the first back section moves up into the front matter; focus stays on its button.
    const up = view.getByRole("button", { name: "Move Copyright up" });
    up.focus();
    testing.fireEvent.click(up);
    expect(names(view, "Front matter")).toEqual(["Dedication", "Copyright"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move Copyright up");

    const preview = view.getByTestId("format-preview").textContent ?? "";
    const order = ["The Salt Road", "Ana Reyes", "For Ana.", "All rights reserved.", "The Door", "About the author", "Ana lives by the sea."].map((text) => preview.indexOf(text));
    expect(order.every((position, index) => position >= 0 && (index === 0 || position > (order[index - 1] ?? 0)))).toBe(true);
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input.matter.sections.map((section) => `${section.position}:${section.id}`)).toEqual([
      "front:mat_dlg00002",
      "front:mat_dlg00001",
      "back:mat_dlg00003"
    ]);
  });

  test("reopening while the closing save runs shows what that save wrote, not the older book", async () => {
    let finish!: () => void;
    const book = bookWith({ matter: SAVED });
    const { view, saveMatter, close, reopen } = render(book, {
      saveMatter: (input) =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: { status: "saved", book: { ...book, matter: { ...input.matter, version: 5 } } } });
        })
    });
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "A. Reyes" } });
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    // The workspace has not heard about the save yet, so the book it passes still has version 4.
    reopen();
    finish();
    await testing.waitFor(() => expect((view.getByLabelText("Author") as HTMLInputElement).value).toBe("A. Reyes"));
    testing.fireEvent.change(view.getByLabelText("Subtitle"), { target: { value: "Told twice" } });
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(2));
    const [input] = saveMatter.mock.calls[1] as [Parameters<SaveMatter>[0]];
    expect(input.baseVersion).toBe(5);
    expect(input.matter).toMatchObject({ author: "A. Reyes", subtitle: "Told twice" });
  });

  test("emptying the matter while its first save is under way saves the empty matter too", async () => {
    let finish!: () => void;
    const book = bookWith();
    const calls: Array<Parameters<SaveMatter>[0]> = [];
    const { view, close } = render(book, {
      saveMatter: (input) => {
        calls.push(input);
        if (calls.length > 1) return Promise.resolve({ ok: true, data: { status: "saved", book: { ...book, matter: { ...input.matter, version: 2 } } } });
        return new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: { status: "saved", book: { ...book, matter: { ...input.matter, version: 1 } } } });
        });
      }
    });
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "A" } });
    await testing.waitFor(() => expect(calls).toHaveLength(1), { timeout: 2000 });
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "" } });
    finish();
    close();
    await testing.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.baseVersion).toBe(1);
    expect(calls[1]?.matter.author).toBe("");
  });

  test("removing a section asks first, and keeping it changes nothing", async () => {
    const { view, saveMatter, close } = render(bookWith({ matter: SAVED }));
    testing.fireEvent.click(view.getByRole("button", { name: "Remove Dedication" }));
    expect(view.getByText(/Remove Dedication and its text from the book\?/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Keep section");
    testing.fireEvent.click(view.getByRole("button", { name: "Keep section" }));
    expect(names(view, "Front matter")).toEqual(["Copyright", "Dedication"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove Dedication");
    testing.fireEvent.click(view.getByRole("button", { name: "Remove Dedication" }));
    testing.fireEvent.click(view.getByRole("button", { name: "Remove section" }));
    expect(names(view, "Front matter")).toEqual(["Copyright"]);
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input.matter.sections.map((section) => section.id)).toEqual(["mat_dlg00001", "mat_dlg00003"]);
  });

  test("the preview shows the book's original title page until matter changes it", () => {
    const { view } = render(bookWith());
    const titlePage = view.getByTestId("format-preview-title-page").textContent ?? "";
    expect(titlePage).toContain("The Salt Road");
    expect(titlePage).toContain("A crossing at low tide.");
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "Ana Reyes" } });
    const generated = view.getByTestId("format-preview-title-page").textContent ?? "";
    expect(generated).toContain("Ana Reyes");
    expect(generated).not.toContain("A crossing at low tide.");
    testing.fireEvent.click(view.getByRole("checkbox", { name: "Title page" }));
    expect(view.queryByTestId("format-preview-title-page")).toBeNull();
  });

  test("an author the title page already has is listed as not placed, with nothing to add", () => {
    const { view } = render(bookWith({ matter: SAVED, frontMatter: { author: "A. Reyes" } }));
    expect(view.getByTestId("matter-legacy").textContent).toContain("author: not placed");
    expect(view.queryByRole("button", { name: "Add to front and back matter" })).toBeNull();
  });

  test("older front matter is listed with where it would go, and added only when the author asks", async () => {
    const record = { subtitle: "A tidewater tale", dedication: "For those who wait.", colophon: "Set in Garamond." };
    const { view, saveMatter, close } = render(bookWith({ frontMatter: record }));
    const notice = view.getByTestId("matter-legacy");
    expect(notice.textContent).toContain("subtitle: title page subtitle");
    expect(notice.textContent).toContain("dedication: Dedication, front matter");
    expect(notice.textContent).toContain("colophon: not placed");
    expect(saveMatter).not.toHaveBeenCalled();

    testing.fireEvent.click(view.getByRole("button", { name: "Add to front and back matter" }));
    expect(names(view, "Front matter")).toEqual(["Dedication"]);
    expect((view.getByLabelText("Subtitle") as HTMLInputElement).value).toBe("A tidewater tale");
    expect(view.getByTestId("matter-legacy").textContent).not.toContain("dedication:");
    expect(view.getByTestId("matter-legacy").textContent).toContain("colophon");
    expect(view.queryByRole("button", { name: "Add to front and back matter" })).toBeNull();
    close();
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    expect(record).toEqual({ subtitle: "A tidewater tale", dedication: "For those who wait.", colophon: "Set in Garamond." });
  });

  test("a conflict shows the newer matter and says where the author's version went", async () => {
    const newer: BookMatter = { ...SAVED, version: 5, author: "A. Reyes" };
    const savedAs = "books/book_fmatter01/conflicts/front-and-back-matter.conflict-newer-version.json";
    const conflict = async () => ({ ok: true, data: { status: "conflict", reason: "newer-version", savedAs, book: bookWith({ matter: newer }) } });
    const open = render(bookWith({ matter: SAVED }), { saveMatter: conflict });
    testing.fireEvent.change(open.view.getByLabelText("Author"), { target: { value: "Someone" } });
    await testing.waitFor(() => expect(open.view.getByRole("alert").textContent).toContain(savedAs), { timeout: 2000 });
    expect((open.view.getByLabelText("Author") as HTMLInputElement).value).toBe("A. Reyes");
    expect(open.onNotice).not.toHaveBeenCalled();
    // The newer matter is on screen; the author's own version is one action away, as for a chapter.
    testing.fireEvent.click(open.view.getByRole("button", { name: "Show the saved copy" }));
    expect(open.reveal).toHaveBeenCalledWith(BOOK, savedAs);
    testing.cleanup();

    // A save made as the dialog closes reports through the workspace, and the dialog says it again on reopening.
    const closing = render(bookWith({ matter: SAVED }), { saveMatter: conflict });
    testing.fireEvent.change(closing.view.getByLabelText("Author"), { target: { value: "Someone" } });
    closing.close();
    await testing.waitFor(() => expect(closing.onNotice).toHaveBeenCalledTimes(1));
    expect(String(closing.onNotice.mock.calls[0]?.[0])).toContain(savedAs);
    closing.reopen();
    expect(closing.view.getByRole("alert").textContent).toContain(savedAs);
  });

  test("matter the studio cannot read is reported and cannot be edited", () => {
    const { view } = render(bookWith({ matter: { sections: "not a list" } }));
    expect(view.getByRole("alert").textContent).toContain("could not be read");
    expect(view.queryByRole("checkbox", { name: "Title page" })).toBeNull();
    expect(view.queryByRole("button", { name: "Add section" })).toBeNull();
  });

  test("an export saves waiting matter first, and exports nothing when that save fails", async () => {
    const saved = render(bookWith({ matter: SAVED }));
    testing.fireEvent.change(saved.view.getByLabelText("Author"), { target: { value: "A. Reyes" } });
    testing.fireEvent.click(saved.view.getByTestId("format-export"));
    await testing.waitFor(() => expect(saved.exportDocx).toHaveBeenCalledTimes(1));
    expect(saved.saveMatter).toHaveBeenCalledTimes(1);
    testing.cleanup();

    const failing = render(bookWith({ matter: SAVED }), {
      saveMatter: async () => ({ ok: false, error: { code: "io", message: "The disk is full." } })
    });
    testing.fireEvent.change(failing.view.getByLabelText("Author"), { target: { value: "A. Reyes" } });
    testing.fireEvent.click(failing.view.getByTestId("format-export"));
    await testing.waitFor(() =>
      expect(failing.view.getByTestId("format-export-error").textContent).toBe(
        "The front and back matter could not be saved, so nothing was exported."
      )
    );
    expect(failing.exportDocx).not.toHaveBeenCalled();
    expect(failing.view.getByTestId("matter-error").textContent).toBe("The disk is full.");
  });

  test("the matter controls pass axe's structural rules", async () => {
    const { view } = render(bookWith({ matter: SAVED, frontMatter: { colophon: "Set in Garamond." } }));
    testing.fireEvent.click(view.getByRole("button", { name: "Remove Dedication" }));
    // happy-dom has no layout, so contrast and target size stay with the browser checks.
    const results = await axe.run(view.getByTestId("format-matter"), {
      runOnly: {
        type: "rule",
        values: ["label", "button-name", "select-name", "list", "listitem", "aria-allowed-attr", "aria-required-attr", "aria-valid-attr", "aria-valid-attr-value", "duplicate-id-aria", "form-field-multiple-labels", "nested-interactive"]
      }
    });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(" | ")}`)).toEqual([]);
    expect(results.passes.length).toBeGreaterThan(5);
  });

  test("an empty book offers every kind with its starting text", () => {
    const { view } = render(bookWith({ matter: NO_MATTER }));
    const kinds = [...(view.getByLabelText("New section") as HTMLSelectElement).options].map((option) => option.textContent);
    expect(kinds).toEqual(["Copyright", "Disclaimer", "Dedication", "Epigraph", "Acknowledgements", "About the author", "Other page"]);
    testing.fireEvent.click(view.getByRole("button", { name: "Add section" }));
    expect((view.getByLabelText("Text") as HTMLTextAreaElement).value).toBe(`Copyright © ${new Date().getFullYear()}\nAll rights reserved.`);
  });

  test("a book switched in place gets its own matter, and the last book's change still saves to it", async () => {
    const other = bookSchema.parse({ id: "book_fmatter02", title: "The Other Book", createdAt: NOW, updatedAt: NOW });
    const first = bookWith({ matter: SAVED });
    const books = new Map([first, other].map((book) => [book.id, book]));
    let finish!: () => void;
    const saveMatter = mock(
      (input: Parameters<SaveMatter>[0]) =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: { status: "saved", book: { ...first, matter: { ...input.matter, version: 5 } } } });
        })
    );
    const ok = (data: unknown) => mock(() => Promise.resolve({ ok: true, data }));
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      platform: "darwin",
      books: {
        open: mock((bookId: string) => Promise.resolve({ ok: true, data: { book: books.get(bookId), chapters: CHAPTERS, chapterReadIssues: [] } })),
        update: ok(first),
        saveMatter
      },
      chapters: { create: ok(CHAPTERS[0]), reorder: ok({ status: "saved", chapters: CHAPTERS }), move: ok({ status: "saved", chapters: CHAPTERS }), delete: ok(null), save: ok({ status: "saved", chapter: CHAPTERS[0] }) },
      conflicts: { list: ok([]), reveal: ok(null) },
      drafts: { set: ok(null), clear: ok(null), onFlushRequest: mock(() => () => {}) },
      images: { list: ok({ manifest: { images: [] } }) },
      library: { onChange: mock(() => () => {}) },
      agent: {
        onEvent: mock(() => () => {}),
        ambient: ok(ambientStatus({ book: { id: BOOK, title: "The Salt Road", stage: "drafting" }, chapters: [{ id: "ch_fmatter01", title: "The Door", order: 1, wordCount: 4 }] }))
      },
      voice: { connections: ok([]), speakers: mock(async () => ({ available: false, connectionLabel: null, endpoint: null, model: null, voices: [] })) }
    };
    const props = {
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice: () => {},
      onSchemaRefusal: () => {}
    };
    const result = testing.render(React.createElement(WorkspaceView, { ...props, bookId: first.id }));
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getByTestId("format-book")).toBeTruthy());
    testing.fireEvent.click(view.getByTestId("format-book"));
    await testing.waitFor(() => expect((view.getByLabelText("Author") as HTMLInputElement).value).toBe("Ana Reyes"));
    testing.fireEvent.change(view.getByLabelText("Author"), { target: { value: "A. Reyes" } });

    // A drift review opens another book in the same workspace while the change is waiting.
    result.rerender(React.createElement(WorkspaceView, { ...props, bookId: other.id }));
    await testing.waitFor(() => expect(view.getByRole("heading", { level: 1, name: "The Other Book" })).toBeTruthy());
    await testing.waitFor(() => expect(saveMatter).toHaveBeenCalledTimes(1));
    const [input] = saveMatter.mock.calls[0] as [Parameters<SaveMatter>[0]];
    expect(input).toMatchObject({ bookId: first.id, baseVersion: 4, matter: { author: "A. Reyes" } });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.getByRole("heading", { level: 1, name: "The Other Book" })).toBeTruthy();
    await testing.waitFor(() => expect((view.getByLabelText("Author") as HTMLInputElement).value).toBe(""));
    expect(view.queryAllByTestId("matter-section")).toHaveLength(0);
  });
});
