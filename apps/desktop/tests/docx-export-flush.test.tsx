/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";
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

type SaveReply = { ok: true; data: { status: "saved"; chapter: Chapter } } | { ok: false; error: { code: "io"; message: string } };

function mockWorkspace(order: string[], saveReply: SaveReply = { ok: true, data: { status: "saved", chapter: CHAPTER_A } }) {
  const detail = () => ({
    book: bookSchema.parse({ id: BOOK, title: "Flushed", createdAt: NOW, updatedAt: NOW }),
    chapters: [CHAPTER_A],
    chapterReadIssues: []
  });
  const onNotice = mock((_error: unknown) => {});
  const open = mock(() => Promise.resolve({ ok: true, data: detail() }));
  const save = mock((_input: unknown) => {
    order.push("save");
    return Promise.resolve(saveReply);
  });
  const exportDocx = mock((_bookId: string) => {
    order.push("export");
    return Promise.resolve({ ok: true, data: "/tmp/exports/flushed.docx" });
  });
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open,
      update: mock(() => Promise.resolve({ ok: true, data: detail().book })),
      exportDocx
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER_A })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
    drafts: { set: mock(() => Promise.resolve({ ok: true, data: null })), clear: mock(() => Promise.resolve({ ok: true, data: null })) },
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
  testing.render(
    React.createElement(WorkspaceView, {
      bookId: BOOK,
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    })
  );
  return { onNotice, save, exportDocx };
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
    expect(notice instanceof Error ? notice.message : String(notice)).toContain("nothing was exported");
    expect(notice instanceof Error ? notice.message : String(notice)).toContain("The disk is full.");
    expect(mocks.exportDocx).not.toHaveBeenCalled();
    expect(order).toEqual(["save"]);
    expect(view.queryByText("Saved flushed.docx")).toBeNull();
  });
});
