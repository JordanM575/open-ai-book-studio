/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { ReviewGateView } from "@ai-book-studio/app/components/ReviewGateDialog";
import type { ChapterConflict } from "@ai-book-studio/core/schema";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let ReviewGateDialog!: typeof import("@ai-book-studio/app/components/ReviewGateDialog").ReviewGateDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ ReviewGateDialog } = await import("@ai-book-studio/app/components/ReviewGateDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/*
 * Spec 034 T006: a review reads only saved text, so when the save cannot confirm, the gate blocks
 * the run and tells the author why in plain words. `review-gate.test.tsx` covers the choice and an
 * outside edit; these are the other reasons a review can be blocked.
 */

function conflict(reason: ChapterConflict["reason"]): ChapterConflict {
  return {
    bookId: "book_gate000001",
    chapterId: "ch_gate0000001",
    chapterTitle: "The Tide",
    savedAs: `books/book_gate000001/conflicts/0001-the-tide.conflict-${reason}.md`,
    reason,
    diskVersion: 3,
    localVersion: 2
  };
}

function show(view: ReviewGateView) {
  const onClose = mock(() => {});
  testing.render(
    React.createElement(ReviewGateDialog, { open: true, view, onSave: () => {}, onCancel: () => {}, onClose })
  );
  return { page: testing.within(document.body), onClose };
}

describe("a blocked review", () => {
  test("a placeholder that could not be read keeps the text as a copy and names it", () => {
    const placeholder = conflict("placeholder");
    const { page } = show({ kind: "blocked", saveStatus: { kind: "conflict", conflict: placeholder } });
    expect(page.getByText("The chapter could not be saved")).toBeTruthy();
    expect(page.getByRole("status").textContent).toBe(
      "The file on disk could not be read. It may still be downloading, so your text was kept as a separate copy. Resolve the conflict, then try the review again."
    );
    expect(page.getByText(placeholder.savedAs)).toBeTruthy();
  });

  test("a newer version on disk is named as the reason", () => {
    const { page } = show({ kind: "blocked", saveStatus: { kind: "conflict", conflict: conflict("newer-version") } });
    expect(page.getByRole("status").textContent).toBe(
      "A newer version of this chapter exists on disk, so your text was kept as a separate copy. Resolve the conflict, then try the review again."
    );
  });

  test("a failed save shows the save's own message", () => {
    const { page } = show({ kind: "blocked", saveStatus: { kind: "error", message: "The book folder is read-only." } });
    expect(page.getByText("The chapter could not be saved")).toBeTruthy();
    expect(page.getByRole("status").textContent).toBe("The book folder is read-only.");
  });

  test("a save still running, or one that never confirmed, asks the author to try again", () => {
    const saving = show({ kind: "blocked", saveStatus: { kind: "saving" } });
    expect(saving.page.getByText("The chapter is still saving")).toBeTruthy();
    expect(saving.page.getByRole("status").textContent).toBe("Wait a moment for the save to finish, then try the review again.");
    testing.cleanup();

    const dirty = show({ kind: "blocked", saveStatus: { kind: "dirty" } });
    expect(dirty.page.getByText("There are still unsaved changes")).toBeTruthy();
    expect(dirty.page.getByRole("status").textContent).toBe("The save did not confirm, so the review cannot start. Try saving again.");
    // The footer's Close, not the dialog's corner button, which shares the name.
    const close = dirty.page.getAllByRole("button", { name: "Close" }).find((button) => button.textContent === "Close");
    if (!close) throw new Error("the blocked gate has no Close button");
    testing.fireEvent.click(close);
    expect(dirty.onClose).toHaveBeenCalled();
  });

  test("while the gate saves, it says so", () => {
    const { page } = show({ kind: "saving" });
    expect(page.getByRole("status").textContent).toBe("Saving your changes…");
    expect(page.queryByRole("button", { name: "Save and continue" })).toBeNull();
  });
});
