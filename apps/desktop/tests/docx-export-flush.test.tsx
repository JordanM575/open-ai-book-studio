/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";
import type { ManuscriptExportReceipt, Result } from "@ai-book-studio/core/ipc";
import { ambientStatus } from "@ai-book-studio/core/agent/ambient";

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
 * Spec 035 T004: the DOCX journey flushes pending editor input before the main
 * process reads the saved book. Typing a dirty line and then exporting must save
 * first and export second, and the author sees the saved-file note.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_fx000001";
const OTHER_BOOK = "book_fx000002";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `000${order}-x.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: "d".repeat(64)
  };
}

const CHAPTER_A = chapter("ch_fx000001", "First", 1, "First line.\n");
const CHAPTER_B = chapter("ch_fx000002", "Other", 1, "Other line.\n");

type SaveReply = { ok: true; data: { status: "saved"; chapter: Chapter } } | { ok: false; error: { code: "io"; message: string } };

function mockWorkspace(order: string[], saveReply: SaveReply = { ok: true, data: { status: "saved", chapter: CHAPTER_A } }) {
  const detail = (id = BOOK) => ({
    book: bookSchema.parse({ id, title: id === BOOK ? "Flushed" : "Other book", createdAt: NOW, updatedAt: NOW }),
    chapters: [id === BOOK ? CHAPTER_A : CHAPTER_B],
    chapterReadIssues: []
  });
  const onNotice = mock((_error: unknown) => {});
  const open = mock((id: string) => Promise.resolve({ ok: true, data: detail(id) }));
  const save = mock((_input: unknown) => {
    order.push("save");
    return Promise.resolve(saveReply);
  });
  const exportDocx = mock((_bookId: string): Promise<Result<ManuscriptExportReceipt | null>> => {
    order.push("export");
    return Promise.resolve({ ok: true, data: { path: "/synthetic/exports/flushed.docx", warnings: [] } });
  });
  const exportMarkdown = mock((_bookId: string): Promise<Result<ManuscriptExportReceipt | null>> =>
    Promise.resolve({ ok: true, data: { path: "/synthetic/exports/flushed.md", warnings: [] } }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open,
      update: mock(() => Promise.resolve({ ok: true, data: detail().book })),
      exportDocx,
      exportMarkdown
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER_A })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
    drafts: { set: mock(() => Promise.resolve({ ok: true, data: null })), clear: mock(() => Promise.resolve({ ok: true, data: null })), onFlushRequest: mock(() => () => {}) },
    recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: {
      onEvent: mock(() => () => {}),
      ambient: mock(() =>
        Promise.resolve({
          ok: true,
          data: ambientStatus({
            book: { id: BOOK, title: "Flushed", stage: "drafting" },
            chapters: [{ id: CHAPTER_A.id, title: "First", order: 1, wordCount: 2 }]
          })
        })
      )
    },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({ ok: true, data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] } }))
    }
  };
  const component = (bookId: string) =>
    React.createElement(WorkspaceView, {
      bookId,
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    });
  const view = testing.render(component(BOOK));
  return { onNotice, save, exportDocx, exportMarkdown, view, component };
}

describe("docx export flush", () => {
  test("pending editor input is saved before the export runs", async () => {
    const order: string[] = [];
    const mocks = mockWorkspace(order);
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "First line edited.\n" } });
    testing.fireEvent.click(view.getByTestId("export-docx"));

    await testing.waitFor(() => {
      expect(mocks.exportDocx).toHaveBeenCalledTimes(1);
    });
    expect(mocks.save.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(order[0]).toBe("save");
    expect(order).toContain("export");
    expect(order.indexOf("save")).toBeLessThan(order.indexOf("export"));
    await testing.waitFor(() => {
      expect(view.getByText("Saved flushed.docx")).toBeTruthy();
    });
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a chapter whose latest text did not save is not exported, and the author is told", async () => {
    const order: string[] = [];
    const mocks = mockWorkspace(order, { ok: false, error: { code: "io", message: "The disk is full." } });
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "Words that will not save.\n" } });
    testing.fireEvent.click(view.getByTestId("export-docx"));

    await testing.waitFor(() => {
      expect(mocks.onNotice).toHaveBeenCalledTimes(1);
    });
    const notice = mocks.onNotice.mock.calls[0]?.[0];
    // The same words the Format dialog uses for the same failed save.
    expect(notice instanceof Error ? notice.message : String(notice)).toBe(
      "Your latest change couldn't be saved, so nothing was exported. The disk is full."
    );
    expect(mocks.exportDocx).not.toHaveBeenCalled();
    expect(order).toEqual(["save"]);
    expect(view.queryByText("Saved flushed.docx")).toBeNull();
  });
});

type ExportReply = Result<ManuscriptExportReceipt | null>;
const warningReceipt: ExportReply = {
  ok: true, data: { path: "/synthetic/book-A.export", warnings: ["Synthetic Book A image was omitted."] }
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.each(["docx", "markdown"] as const)("%s export view ownership", (format) => {
  const exporter = (setup: ReturnType<typeof mockWorkspace>) => format === "docx" ? setup.exportDocx : setup.exportMarkdown;
  const begin = async (setup: ReturnType<typeof mockWorkspace>) => {
    await testing.waitFor(() => expect(setup.view.getByTestId("manuscript-text")).toBeTruthy());
    testing.fireEvent.click(setup.view.getByTestId(`export-${format}`));
    await testing.waitFor(() => expect(exporter(setup)).toHaveBeenCalledTimes(1));
  };
  const changeBook = async (setup: ReturnType<typeof mockWorkspace>, id: string) => {
    setup.view.rerender(setup.component(id));
    await testing.waitFor(() => expect(setup.view.getByText(id === BOOK ? "Flushed" : "Other book")).toBeTruthy());
  };

  test("completed warnings clear on a book change and on a new cancelled attempt", async () => {
    const setup = mockWorkspace([]);
    exporter(setup).mockResolvedValue(warningReceipt);
    await begin(setup);
    await testing.waitFor(() => expect(setup.view.getByText("Synthetic Book A image was omitted.")).toBeTruthy());
    exporter(setup).mockResolvedValue({ ok: true, data: null });
    testing.fireEvent.click(setup.view.getByTestId(`export-${format}`));
    await testing.waitFor(() => expect(exporter(setup)).toHaveBeenCalledTimes(2));
    expect(setup.view.queryByText("Saved book-A.export")).toBeNull();
    exporter(setup).mockResolvedValue(warningReceipt);
    await testing.waitFor(() => expect(setup.view.getByTestId(`export-${format}`)).toHaveProperty("disabled", false));
    testing.fireEvent.click(setup.view.getByTestId(`export-${format}`));
    await testing.waitFor(() => expect(setup.view.getByText("Saved book-A.export")).toBeTruthy());
    await changeBook(setup, OTHER_BOOK);
    expect(setup.view.queryByText("Saved book-A.export")).toBeNull();
    expect(setup.view.queryByText("Synthetic Book A image was omitted.")).toBeNull();
  });

  test("a late receipt is ignored even after A → B → A", async () => {
    const setup = mockWorkspace([]);
    const old = deferred<ExportReply>();
    exporter(setup).mockReturnValue(old.promise);
    await begin(setup);
    await changeBook(setup, OTHER_BOOK);
    await changeBook(setup, BOOK);
    await testing.act(async () => old.resolve(warningReceipt));
    expect(setup.view.queryByText("Saved book-A.export")).toBeNull();
    expect(setup.view.queryByText("Synthetic Book A image was omitted.")).toBeNull();
  });

  test.each(["success", "error"] as const)("old %s cannot unlock or replace a new book's pending export", async (outcome) => {
    const setup = mockWorkspace([]);
    const old = deferred<ExportReply>();
    const next = deferred<ExportReply>();
    exporter(setup).mockImplementation((id) => id === BOOK ? old.promise : next.promise);
    await begin(setup);
    await changeBook(setup, OTHER_BOOK);
    testing.fireEvent.click(setup.view.getByTestId(`export-${format}`));
    await testing.waitFor(() => expect(exporter(setup)).toHaveBeenCalledTimes(2));
    await testing.act(async () => {
      if (outcome === "success") old.resolve(warningReceipt);
      else old.reject(new Error("Old book export failed"));
    });
    expect(setup.view.getByTestId(`export-${format}`)).toHaveProperty("disabled", true);
    expect(setup.view.queryByText("Saved book-A.export")).toBeNull();
    expect(setup.onNotice).not.toHaveBeenCalled();
    await testing.act(async () => next.resolve({ ok: true, data: { path: "/synthetic/book-B.export", warnings: [] } }));
    expect(setup.view.getByText("Saved book-B.export")).toBeTruthy();
    expect(setup.view.getByTestId(`export-${format}`)).toHaveProperty("disabled", false);
  });

  test("an unmounted export cannot deliver a late error notice", async () => {
    const setup = mockWorkspace([]);
    const old = deferred<ExportReply>();
    exporter(setup).mockReturnValue(old.promise);
    await begin(setup);
    setup.view.unmount();
    await testing.act(async () => old.reject(new Error("Old book export failed")));
    expect(setup.onNotice).not.toHaveBeenCalled();
  });

  test("a save finishing after navigation cannot dispatch the old export", async () => {
    const setup = mockWorkspace([]);
    const save = deferred<SaveReply>();
    setup.save.mockReturnValue(save.promise);
    await testing.waitFor(() => expect(setup.view.getByTestId("manuscript-text")).toBeTruthy());
    testing.fireEvent.change(setup.view.getByTestId("manuscript-text"), { target: { value: "Pending old-book edit." } });
    testing.fireEvent.click(setup.view.getByTestId(`export-${format}`));
    await testing.waitFor(() => expect(setup.save).toHaveBeenCalled());
    await changeBook(setup, OTHER_BOOK);
    await testing.act(async () => save.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER_A } }));
    expect(exporter(setup)).not.toHaveBeenCalled();
  });
});
