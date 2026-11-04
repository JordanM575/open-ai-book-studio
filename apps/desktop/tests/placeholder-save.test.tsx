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
 * Spec 028 T007: saving over a chapter whose file is present but unreadable
 * (an online-only placeholder) never overwrites and never fails raw. The real
 * workspace drives the save through the editor's autosave; the placeholder
 * banner offers the three choices: the saved copy (open both), loading the
 * version on disk once it downloads (keep disk), and the untouched editor
 * text (keep mine).
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_ph000001";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `000${order}-${title.toLowerCase()}.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: "b".repeat(64)
  };
}

const CHAPTER_A = chapter("ch_ph000001", "First", 1, "First line.\n");

const PLACEHOLDER_CONFLICT = {
  bookId: BOOK,
  chapterId: CHAPTER_A.id,
  chapterTitle: "First",
  savedAs: "books/book_ph000001/conflicts/0001-first.conflict-placeholder.device1.2026-11-03.md",
  reason: "placeholder",
  diskVersion: 1,
  localVersion: 2
};

function mockWorkspace() {
  const detail = () => ({
    book: bookSchema.parse({ id: BOOK, title: "Placeholder", createdAt: NOW, updatedAt: NOW }),
    chapters: [CHAPTER_A],
    chapterReadIssues: []
  });
  const save = mock((_input: unknown) =>
    Promise.resolve({ ok: true, data: { status: "conflict", conflict: PLACEHOLDER_CONFLICT } })
  );
  const reveal = mock((_bookId: string, _savedAs: string) => Promise.resolve({ ok: true, data: null }));
  const open = mock(() => Promise.resolve({ ok: true, data: detail() }));
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { open },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER_A })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal },
    drafts: {
      set: mock(() => Promise.resolve({ ok: true, data: null })),
      clear: mock(() => Promise.resolve({ ok: true, data: null })),
      onFlushRequest: mock(() => () => {})
    },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: {
      onEvent: mock(() => () => {}),
      ambient: mock(() =>
        Promise.resolve({
          ok: true,
          data: ambientStatus({
            book: { id: BOOK, title: "Placeholder", stage: "drafting" },
            chapters: [{ id: CHAPTER_A.id, title: "First", order: 1, wordCount: 2 }]
          })
        })
      )
    },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({
        ok: true,
        data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }
      }))
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
  return { save, reveal, open, onNotice };
}

describe("placeholder save block", () => {
  test("a save over an unreadable chapter shows the placeholder banner with both actions", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "First line edited.\n" } });
    await testing.waitFor(
      () => {
        expect(view.getByText("This chapter is not downloaded yet")).toBeTruthy();
      },
      { timeout: 5000 }
    );
    expect(
      view.getByText(
        "The file on disk could not be read. It may still be downloading, so your text was kept as a separate copy instead of overwriting it."
      )
    ).toBeTruthy();
    expect(view.getByTitle(PLACEHOLDER_CONFLICT.savedAs).textContent ?? "").toContain("conflict-placeholder");

    testing.fireEvent.click(view.getByText("Show the saved copy"));
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(mocks.reveal.mock.calls[0]).toEqual([BOOK, PLACEHOLDER_CONFLICT.savedAs]);

    const opens = mocks.open.mock.calls.length;
    testing.fireEvent.click(view.getByText("Load the version on disk"));
    await testing.waitFor(() => {
      expect(mocks.open.mock.calls.length).toBeGreaterThan(opens);
    });
  });

  test("the author's text stays in the editor after the block", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "First line edited.\n" } });
    await testing.waitFor(
      () => {
        expect(view.getByText("This chapter is not downloaded yet")).toBeTruthy();
      },
      { timeout: 5000 }
    );

    const textarea = view.getByTestId("manuscript-text") as HTMLTextAreaElement;
    expect(textarea.value).toBe("First line edited.\n");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });
});
