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
 * the second starting from what the first returned. Started together they would both start from the
 * original, and the second would look like another writer's conflicting change.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_fo000001";

const CHAPTER: Chapter = {
  ...chapterMetaSchema.parse({ id: "ch_fo000001", title: "First", order: 1, createdAt: NOW, updatedAt: NOW }),
  content: "First line.\n",
  path: "0001-first.md",
  wordCount: 2,
  hash: "b".repeat(64)
};

type Pending = { changes: BookChanges; finish: () => void };

function mockWorkspace() {
  const book = bookSchema.parse({ id: BOOK, title: "The Salt Road", createdAt: NOW, updatedAt: NOW });
  let disk: BookMeta = book;
  const pending: Pending[] = [];
  const calls: BookChanges[] = [];
  // A book on disk that merges like the library: an edit that started from other settings than the
  // disk now holds is a conflicting change and leaves the disk as it is.
  const edit = mock(
    (_bookId: string, changes: BookChanges) =>
      new Promise((resolve) => {
        calls.push(changes);
        pending.push({
          changes,
          finish: () => {
            const settings = changes.settings;
            const same = JSON.stringify(settings?.from) === JSON.stringify(disk.settings);
            if (settings && same) disk = { ...disk, settings: settings.to };
            resolve({
              ok: true,
              data: same
                ? { status: "saved", book: disk }
                : { status: "conflict", book: disk, savedAs: `books/${BOOK}/conflicts/book.conflict-external-edit.d.json`, fields: ["settings"] }
            });
          }
        });
      })
  );
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open: mock(() => Promise.resolve({ ok: true, data: { book, chapters: [CHAPTER], chapterReadIssues: [] } })),
      edit
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER } }))
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
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
  return { calls, pending, onNotice, disk: () => disk };
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
});
