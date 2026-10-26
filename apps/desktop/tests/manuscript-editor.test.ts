/// <reference types="bun" />
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";

GlobalRegistrator.register({ url: "http://localhost" });
const testing = await import("@testing-library/react");
const { ManuscriptEditor } = await import("@ai-book-studio/app/components/ManuscriptEditor");

const BOOK = "book_ui000001";
const CHAPTER: Chapter = {
  id: "ch_ui00000001",
  title: "One",
  order: 1,
  arc: "middle",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 1,
  createdAt: "2026-10-25T12:00:00.000Z",
  updatedAt: "2026-10-25T12:00:00.000Z",
  content: "Original.\n",
  path: "0001-one.md",
  wordCount: 1,
  hash: "a".repeat(64)
};

function mockStudio(result: unknown) {
  const save = mock(() => Promise.resolve(result));
  const updateMeta = mock(() => Promise.resolve(result));
  const clear = mock(() => Promise.resolve({ ok: true, data: null }));
  const setDraft = mock(() => Promise.resolve({ ok: true, data: null }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    chapters: { save, updateMeta },
    drafts: { set: setDraft, clear }
  };
  return { save, clear, setDraft };
}

afterEach(() => testing.cleanup());
afterAll(() => GlobalRegistrator.unregister());

describe("ManuscriptEditor", () => {
  test("waits for the debounce before saving typed text", async () => {
    const saved: Chapter = {
      ...CHAPTER,
      version: 2,
      content: "New text.\n",
      hash: "b".repeat(64),
      updatedAt: "2026-10-25T12:01:00.000Z"
    };
    const { save } = mockStudio({ ok: true, data: { status: "saved", chapter: saved } });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, { bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.screen.getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "New text.\n" } });

    expect(save).not.toHaveBeenCalled();
    await testing.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(save).toHaveBeenCalledWith({
      bookId: BOOK,
      chapterId: CHAPTER.id,
      content: "New text.\n",
      baseVersion: 1,
      baseHash: CHAPTER.hash
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  test("keeps the typed text and reports a conflict", async () => {
    const conflict: ChapterConflict = {
      bookId: BOOK,
      chapterId: CHAPTER.id,
      chapterTitle: "One",
      savedAs: "books/book_ui000001/conflicts/0001-one.conflict-external-edit.md",
      reason: "external-edit",
      diskVersion: 2,
      localVersion: 2
    };
    const { save } = mockStudio({ ok: true, data: { status: "conflict", conflict } });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, { bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.screen.getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "New text.\n" } });

    await testing.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "conflict", conflict }), { timeout: 2500 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(textarea.value).toBe("New text.\n");
  });
});
