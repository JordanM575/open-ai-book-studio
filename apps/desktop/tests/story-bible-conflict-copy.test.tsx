/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";

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
 * A Story Bible save that overlaps another writer keeps the author's version as a copy. The real
 * workspace has to lead the author to it: the dialog names what overlapped and offers the copy, and
 * the workspace lists its conflict copies again so the saved-copies banner offers it afterwards too.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_sb000001";
const COPY = `books/${BOOK}/conflicts/book.conflict-external-edit.device_1.2026-11-03T10-00-00-000Z.json`;

const CHAPTER: Chapter = {
  ...chapterMetaSchema.parse({ id: "ch_sb000001", title: "First", order: 1, createdAt: NOW, updatedAt: NOW }),
  content: "First line.\n",
  path: "0001-first.md",
  wordCount: 2,
  hash: "b".repeat(64)
};

function mockWorkspace() {
  const book = bookSchema.parse({ id: BOOK, title: "The Salt Road", outline: "Two sisters.", createdAt: NOW, updatedAt: NOW });
  // The other writer's outline is what the book shows once the save came back as a conflict.
  const theirs = { ...book, outline: "Three sisters." };
  let kept = false;
  const open = mock(() => Promise.resolve({ ok: true, data: { book, chapters: [CHAPTER], chapterReadIssues: [] } }));
  const edit = mock((_bookId: string, _changes: unknown) => {
    kept = true;
    return Promise.resolve({ ok: true, data: { status: "conflict", book: theirs, savedAs: COPY, fields: ["outline"] } });
  });
  const list = mock(() =>
    Promise.resolve({
      ok: true,
      data: kept
        ? [
            {
              bookId: BOOK,
              chapterId: "",
              chapterTitle: "book.conflict-external-edit.device_1.2026-11-03T10-00-00-000Z",
              savedAs: COPY,
              reason: "provider-conflict-copy",
              diskVersion: 0,
              localVersion: 0
            }
          ]
        : []
    })
  );
  const reveal = mock((_bookId: string, _savedAs: string) => Promise.resolve({ ok: true, data: null }));
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { open, edit },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER } }))
    },
    conflicts: { list, reveal },
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
  return { edit, list, reveal, onNotice };
}

describe("a Story Bible save that overlaps another writer", () => {
  test("names what overlapped, offers the copy, and the workspace lists it as a saved copy", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getAllByTestId("chapter-row")).toHaveLength(1));
    expect(view.queryByText(/saved copy from earlier sync conflicts/u)).toBeNull();

    testing.fireEvent.click(view.getByTestId("open-story-bible"));
    testing.fireEvent.change(await testing.waitFor(() => view.getByDisplayValue("Two sisters.")), {
      target: { value: "Two sisters and a letter." }
    });
    testing.fireEvent.click(view.getByTestId("save-story-bible"));

    const note = await testing.waitFor(() => view.getByTestId("story-bible-conflict"));
    expect(note.textContent).toContain("The outline changed on disk while you were editing");
    expect(mocks.onNotice).not.toHaveBeenCalled();
    // The workspace asked again, so the banner behind the dialog now counts the Story Bible copy.
    await testing.waitFor(() => expect(view.getByText(/1 saved copy from earlier sync conflicts/u)).toBeTruthy());

    testing.fireEvent.click(testing.within(note).getByText("Show the copy"));
    await testing.waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith(BOOK, COPY));
  });
});
