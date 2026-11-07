/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { BookChanges, BookMeta, Chapter } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;

beforeAll(async () => {
  testing = await mountDom();
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * The Format dialog sends a save for every control change without waiting for the last one. Each save
 * is an edit against the settings the book had, so two quick changes must run one after the other,
 * the second starting from what the first returned and carrying only the field its control changed.
 * Started together they would both start from the original, and the second would look like another
 * writer's conflicting change; carrying the whole dialog would put back a field changed outside.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_fo000001";
const OTHER = "book_fo000002";

const CHAPTER: Chapter = {
  ...chapterMetaSchema.parse({ id: "ch_fo000001", title: "First", order: 1, createdAt: NOW, updatedAt: NOW }),
  content: "First line.\n",
  path: "0001-first.md",
  wordCount: 2,
  hash: "b".repeat(64)
};

type Pending = { bookId: string; changes: BookChanges; finish: () => void };

function mockWorkspace() {
  const book = bookSchema.parse({ id: BOOK, title: "The Salt Road", createdAt: NOW, updatedAt: NOW });
  // A second book, set to 13 pt so a save that starts from the wrong book shows in the sizes it sends.
  const other = bookSchema.parse({
    id: OTHER,
    title: "The Glass Tide",
    createdAt: NOW,
    updatedAt: NOW,
    settings: { manuscript: { bodyFontSize: 13 } }
  });
  const disks = new Map<string, BookMeta>([
    [BOOK, book],
    [OTHER, other]
  ]);
  const copies: { savedAs: string }[] = [];
  const pending: Pending[] = [];
  const calls: BookChanges[] = [];
  // A book on disk that merges like the library, field by field: a field the edit changed is applied
  // when the disk still holds what the edit started from, and is a conflict when the disk moved on;
  // a field the edit did not change keeps what the disk holds.
  const edit = mock(
    (bookId: string, changes: BookChanges) =>
      new Promise((resolve) => {
        calls.push(changes);
        pending.push({
          bookId,
          changes,
          finish: () => {
            let disk = disks.get(bookId) as BookMeta;
            const settings = changes.settings;
            const from = (settings?.from.manuscript ?? {}) as Record<string, unknown>;
            const to = (settings?.to.manuscript ?? {}) as Record<string, unknown>;
            const now = { ...(disk.settings.manuscript as Record<string, unknown>) };
            let clash = false;
            for (const key of Object.keys(to)) {
              if (to[key] === from[key]) continue;
              if (now[key] === from[key] || now[key] === to[key]) now[key] = to[key];
              else clash = true;
            }
            if (!clash) {
              disk = { ...disk, settings: { ...disk.settings, manuscript: now as typeof disk.settings.manuscript } };
              disks.set(bookId, disk);
              resolve({ ok: true, data: { status: "saved", book: disk } });
              return;
            }
            const savedAs = `books/${bookId}/conflicts/book.conflict-external-edit.d.json`;
            copies.push({ savedAs });
            resolve({ ok: true, data: { status: "conflict", book: disk, savedAs, fields: ["settings"] } });
          }
        });
      })
  );
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open: mock((bookId: string) =>
        Promise.resolve({ ok: true, data: { book: disks.get(bookId), chapters: [CHAPTER], chapterReadIssues: [] } })
      ),
      edit
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER } }))
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [...copies] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
    drafts: {
      set: mock(() => Promise.resolve({ ok: true, data: null })),
      clear: mock(() => Promise.resolve({ ok: true, data: null })),
      onFlushRequest: mock(() => () => {})
    },
    recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: { onEvent: mock(() => () => {}), ambient: mock(async () => ({ ok: true, data: null })) },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({
        ok: true,
        data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }
      }))
    }
  };
  const workspace = (bookId: string) =>
    React.createElement(WorkspaceView, {
      bookId,
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    });
  const view = testing.render(workspace(BOOK));
  /** A change made outside the studio: it lands on disk with no save from this window. */
  const outside = (manuscript: Record<string, unknown>): void => {
    const disk = disks.get(BOOK) as BookMeta;
    disks.set(BOOK, { ...disk, settings: { ...disk.settings, manuscript: { ...disk.settings.manuscript, ...manuscript } } });
  };
  const diskOf = (id: string = BOOK): BookMeta => disks.get(id) as BookMeta;
  const showBook = (bookId: string): void => view.rerender(workspace(bookId));
  return { calls, pending, onNotice, disk: () => diskOf(), diskOf, outside, showBook };
}

describe("changing a format control twice before the first save returns", () => {
  test("runs the saves in turn, each from the settings the one before returned, and keeps the last choice", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const font = (await testing.waitFor(() => view.getByLabelText("Font"))) as HTMLSelectElement;
    testing.fireEvent.change(font, { target: { value: "Georgia" } });
    testing.fireEvent.change(font, { target: { value: "Garamond" } });

    // The second change waits for the first to come back.
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.calls).toHaveLength(1);

    mocks.pending[0]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(2));
    // It starts from what the first save returned, so it is an edit on top of it and not a clash.
    expect(mocks.calls[1]?.settings?.from.manuscript.bodyFont).toBe("Georgia");
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFont).toBe("Garamond");
    mocks.pending[1]?.finish();

    await testing.waitFor(() => expect(mocks.disk().settings.manuscript.bodyFont).toBe("Garamond"));
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a save waiting its turn carries only its own field, so a field changed outside meanwhile is kept", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const font = (await testing.waitFor(() => view.getByLabelText("Font"))) as HTMLSelectElement;
    // The book starts at 12 pt; another window moves it to 14 pt.
    expect((view.getByLabelText("Size") as HTMLSelectElement).value).toBe("12");
    testing.fireEvent.change(font, { target: { value: "Georgia" } });
    testing.fireEvent.change(font, { target: { value: "Garamond" } });
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));

    // The size is changed in another window while the first save is still out.
    mocks.outside({ bodyFontSize: 14 });
    mocks.pending[0]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(2));

    // The second save changes the font only: the size stays what the disk holds, not what the dialog showed.
    expect(mocks.calls[1]?.settings?.from.manuscript.bodyFontSize).toBe(14);
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFontSize).toBe(14);
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFont).toBe("Garamond");
    mocks.pending[1]?.finish();

    await testing.waitFor(() => expect(mocks.disk().settings.manuscript.bodyFont).toBe("Garamond"));
    expect(mocks.disk().settings.manuscript.bodyFontSize).toBe(14);
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a format change that clashes with an outside one keeps the author's copy and shows it as a saved copy", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));
    expect(view.queryByText(/saved cop/)).toBeNull();

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const font = (await testing.waitFor(() => view.getByLabelText("Font"))) as HTMLSelectElement;
    testing.fireEvent.change(font, { target: { value: "Georgia" } });
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));

    // Another writer changed the same font first.
    mocks.outside({ bodyFont: "Arial" });
    mocks.pending[0]?.finish();

    await testing.waitFor(() => expect(mocks.onNotice).toHaveBeenCalledTimes(1));
    const notice = mocks.onNotice.mock.calls[0]?.[0];
    expect(notice instanceof Error ? notice.message : "").toContain("format settings");
    // The other writer's font stays, and the copy is listed so it can be shown in the folder.
    expect(mocks.disk().settings.manuscript.bodyFont).toBe("Arial");
    await testing.waitFor(() => expect(view.getByText(/1 saved copy/)).toBeTruthy());
    // The banner sits behind the open dialog, so it is out of the accessibility tree until that closes.
    expect(view.getByRole("button", { name: "Show in folder", hidden: true })).toBeTruthy();
  });

  test("a queued change to a field another writer changed meanwhile is a clash, not a write over it", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const font = (await testing.waitFor(() => view.getByLabelText("Font"))) as HTMLSelectElement;
    const size = view.getByLabelText("Size") as HTMLSelectElement;
    expect(size.value).toBe("12");
    // The author changes the font and then the size; the size save waits for the font save.
    testing.fireEvent.change(font, { target: { value: "Georgia" } });
    testing.fireEvent.change(size, { target: { value: "13" } });
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));

    // Another writer sets the size to 14 while the font save is still out.
    mocks.outside({ bodyFontSize: 14 });
    mocks.pending[0]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(2));

    // The size change still starts from the 12 the author saw, so the merge sees both sides changed it.
    expect(mocks.calls[1]?.settings?.from.manuscript.bodyFontSize).toBe(12);
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFontSize).toBe(13);
    mocks.pending[1]?.finish();

    await testing.waitFor(() => expect(mocks.onNotice).toHaveBeenCalledTimes(1));
    // The other writer's size stays, the author's font landed, and the author's size is a saved copy.
    expect(mocks.disk().settings.manuscript.bodyFontSize).toBe(14);
    expect(mocks.disk().settings.manuscript.bodyFont).toBe("Georgia");
    await testing.waitFor(() => expect(view.getByText(/1 saved copy/)).toBeTruthy());
  });

  test("a change made while an earlier one is saved and a later one waits starts from the author's own last choice", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const size = (await testing.waitFor(() => view.getByLabelText("Size"))) as HTMLSelectElement;
    expect(size.value).toBe("12");
    // 12 to 13 goes out; 14 waits behind it.
    testing.fireEvent.change(size, { target: { value: "13" } });
    testing.fireEvent.change(size, { target: { value: "14" } });
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));

    // The 13 is acknowledged, and the 14 save starts. The dialog must keep showing the author's 14.
    mocks.pending[0]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(2));
    expect(size.value).toBe("14");

    // A third change, while the 14 is still out, starts from that 14 and not from the acknowledged 13.
    testing.fireEvent.change(size, { target: { value: "11" } });
    mocks.pending[1]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(3));
    expect(mocks.calls[2]?.settings?.from.manuscript.bodyFontSize).toBe(14);
    expect(mocks.calls[2]?.settings?.to.manuscript.bodyFontSize).toBe(11);
    mocks.pending[2]?.finish();

    // Nothing the author did clashed with their own earlier choice, and the dialog follows the saved size.
    await testing.waitFor(() => expect(mocks.disk().settings.manuscript.bodyFontSize).toBe(11));
    await testing.waitFor(() => expect(size.value).toBe("11"));
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a change queued after the workspace moved to another book is saved in that book, from its own settings", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));

    testing.fireEvent.click(view.getByRole("button", { name: "Format book" }));
    const font = (await testing.waitFor(() => view.getByLabelText("Font"))) as HTMLSelectElement;
    const size = view.getByLabelText("Size") as HTMLSelectElement;
    expect(size.value).toBe("12");
    // A format save for the first book is still out when the workspace moves to the second one.
    testing.fireEvent.change(font, { target: { value: "Georgia" } });
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(1));
    mocks.showBook(OTHER);
    await testing.waitFor(() => expect((view.getByLabelText("Size") as HTMLSelectElement).value).toBe("13"));

    // The author changes the second book's font; it waits behind the first book's save.
    testing.fireEvent.change(view.getByLabelText("Font"), { target: { value: "Arial" } });
    mocks.pending[0]?.finish();
    await testing.waitFor(() => expect(mocks.calls).toHaveLength(2));

    // The first book's save landed in the first book, and the second book's change starts from the second book.
    expect(mocks.pending[0]?.bookId).toBe(BOOK);
    expect(mocks.pending[1]?.bookId).toBe(OTHER);
    expect(mocks.calls[1]?.settings?.from.manuscript.bodyFontSize).toBe(13);
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFontSize).toBe(13);
    expect(mocks.calls[1]?.settings?.to.manuscript.bodyFont).toBe("Arial");
    // The first book's answer did not replace the second book on screen.
    expect((view.getByLabelText("Size") as HTMLSelectElement).value).toBe("13");
    mocks.pending[1]?.finish();

    await testing.waitFor(() => expect(mocks.diskOf(OTHER).settings.manuscript.bodyFont).toBe("Arial"));
    expect(mocks.diskOf(BOOK).settings.manuscript.bodyFont).toBe("Georgia");
    expect(mocks.diskOf(BOOK).settings.manuscript.bodyFontSize).toBe(12);
    expect(mocks.diskOf(OTHER).settings.manuscript.bodyFontSize).toBe(13);
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });
});
