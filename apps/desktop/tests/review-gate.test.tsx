/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";
import type { EditorHandle, SaveStatus } from "@ai-book-studio/app/components/ManuscriptEditor";
import type { ReviewGateView } from "@ai-book-studio/app/components/ReviewGateDialog";
import { runAfterReviewSave } from "@ai-book-studio/app/lib/review-save-gate";

let testing!: typeof import("@testing-library/react/pure");
// Loaded in beforeAll, once the DOM exists.
let ManuscriptEditor!: typeof import("@ai-book-studio/app/components/ManuscriptEditor").ManuscriptEditor;
let ReviewGateDialog!: typeof import("@ai-book-studio/app/components/ReviewGateDialog").ReviewGateDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ ManuscriptEditor } = await import("@ai-book-studio/app/components/ManuscriptEditor"));
  ({ ReviewGateDialog } = await import("@ai-book-studio/app/components/ReviewGateDialog"));
});
afterAll(async () => {
  await unmountDom();
});

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

function renderGate(view: ReviewGateView, handlers?: { onSave?: () => void; onCancel?: () => void; onClose?: () => void }) {
  const onSave = mock(() => handlers?.onSave?.());
  const onCancel = mock(() => handlers?.onCancel?.());
  const onClose = mock(() => handlers?.onClose?.());
  testing.render(
    React.createElement(ReviewGateDialog, {
      open: true,
      view,
      onSave,
      onCancel,
      onClose
    })
  );
  return { onSave, onCancel, onClose };
}

describe("ReviewGateDialog", () => {
  test("offers the explicit save path or cancel for unsaved text", () => {
    const { onSave, onCancel } = renderGate({ kind: "choice" });

    testing.within(document.body).getByTestId("review-dialog");
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    testing.cleanup();
    const second = renderGate({ kind: "choice" });
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-cancel"));
    expect(second.onCancel).toHaveBeenCalledTimes(1);
    expect(second.onSave).not.toHaveBeenCalled();
  });

  test("blocks on a save conflict and names the preserved copy", () => {
    const conflict: ChapterConflict = {
      bookId: BOOK,
      chapterId: CHAPTER.id,
      chapterTitle: "One",
      savedAs: "books/book_ui000001/conflicts/0001-one.conflict-external-edit.md",
      reason: "external-edit",
      diskVersion: 2,
      localVersion: 2
    };
    const { onClose } = renderGate({ kind: "blocked", saveStatus: { kind: "conflict", conflict } });

    const status = testing.within(document.body).getByTestId("review-status");
    expect(status.textContent ?? "").toContain("kept as a separate copy");
    expect(testing.within(document.body).getByText(conflict.savedAs)).toBeTruthy();
    expect(testing.within(document.body).queryByTestId("review-save")).toBeNull();
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

});

describe("review gate with live editor state", () => {
  test("getStatus reports the live buffer, so a fast review click still gates", async () => {
    mockStudio({ ok: true, data: { status: "saved", chapter: CHAPTER } });
    const editor = React.createRef<EditorHandle>();

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus: () => {}
      })
    );
    testing.fireEvent.change(testing.within(document.body).getByTestId("manuscript-text"), {
      target: { value: "Fast keystroke.\n" }
    });

    // No waiting: the mirrored React state can lag an effect behind, but the live ref is current.
    expect(editor.current!.getStatus()).toEqual({ kind: "dirty" });
    const run = mock(async () => "must not run");
    const result = await runAfterReviewSave(editor.current!.getStatus(), undefined, () => editor.current!.flush(), run);
    expect(result).toEqual({ status: "choice-required" });
    expect(run).not.toHaveBeenCalled();
    // Settle pending debounce/draft timers on this test's mocks so they cannot leak into the next test.
    await testing.act(async () => {
      await editor.current?.flush();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
  });

  test("a dirty buffer requires a choice, then saves and runs on the confirmed text", async () => {
    const typed = "Review gate text.\n";
    const saved: Chapter = {
      ...CHAPTER,
      version: 2,
      content: typed,
      hash: "c".repeat(64),
      updatedAt: "2026-11-03T00:00:00.000Z"
    };
    const { setDraft } = mockStudio({ ok: true, data: { status: "saved", chapter: saved } });
    const editor = React.createRef<EditorHandle>();
    const onStatus = mock((_status: SaveStatus) => {});

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus
      })
    );
    testing.fireEvent.change(testing.within(document.body).getByTestId("manuscript-text"), {
      target: { value: typed }
    });
    await testing.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await testing.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "dirty" }), { timeout: 1000 });

    const liveStatus = onStatus.mock.calls.at(-1)?.[0] as SaveStatus;
    expect(liveStatus.kind).toBe("dirty");

    // No choice, no run: the gate refuses to start.
    let ran = false;
    const undecided = await runAfterReviewSave(
      liveStatus,
      undefined,
      () => editor.current!.flush(),
      async () => {
        ran = true;
      }
    );
    expect(undecided).toEqual({ status: "choice-required" });
    expect(ran).toBe(false);

    // The explicit save path flushes the live editor, then runs once confirmed.
    const run = mock(async () => "fresh-snapshot");
    let flushed: SaveStatus | undefined;
    let outcome: Awaited<ReturnType<typeof runAfterReviewSave<string>>> | undefined;
    await testing.act(async () => {
      outcome = await runAfterReviewSave(
        liveStatus,
        "save",
        async () => {
          flushed = await editor.current!.flush();
          return flushed;
        },
        run
      );
    });
    expect(flushed?.kind).toBe("saved");
    expect(outcome).toEqual({ status: "ready", value: "fresh-snapshot" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("cancel never flushes and leaves the typed text in place", async () => {
    const typed = "Untouched draft.\n";
    const { setDraft } = mockStudio({ ok: true, data: { status: "saved", chapter: CHAPTER } });
    const editor = React.createRef<EditorHandle>();
    const onStatus = mock((_status: SaveStatus) => {});

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus
      })
    );
    testing.fireEvent.change(testing.within(document.body).getByTestId("manuscript-text"), {
      target: { value: typed }
    });
    await testing.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await testing.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "dirty" }), { timeout: 1000 });

    const flush = mock(async () => ({ kind: "saved", at: 1 }) as const);
    const run = mock(async () => "must not run");
    const result = await runAfterReviewSave({ kind: "dirty" }, "cancel", flush, run);

    expect(result).toEqual({ status: "cancelled" });
    expect(flush).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect((testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement).value).toBe(typed);
  });
});
