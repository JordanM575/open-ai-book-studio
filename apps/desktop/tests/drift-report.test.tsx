/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React from "react";
import type { DriftEntry, DriftKind, DriftReport } from "@ai-book-studio/core/sync/types";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let DriftReportDialog!: typeof import("@ai-book-studio/app/components/DriftReportDialog").DriftReportDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ DriftReportDialog } = await import("@ai-book-studio/app/components/DriftReportDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

const KINDS: DriftKind[] = [
  "new-remote",
  "remote-changed",
  "local-changed",
  "both-changed",
  "remote-deleted",
  "local-deleted",
  "renamed",
  "conflict-copy",
  "placeholder",
  "unreadable",
  "schema-newer"
];

function counts(overrides: Partial<Record<DriftKind, number>> = {}): Record<DriftKind, number> {
  const full = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<DriftKind, number>;
  return { ...full, ...overrides };
}

function entry(overrides: Partial<DriftEntry>): DriftEntry {
  return {
    kind: "remote-changed",
    path: "books/book_test000001/chapters/0001-one.md",
    bookId: "book_test000001",
    chapterId: "chapter_test000001",
    renamedFrom: undefined,
    message: "The file changed somewhere else.",
    ...overrides
  };
}

function report(overrides: Partial<DriftReport> = {}): DriftReport {
  const base: DriftReport = {
    clean: false,
    scannedAt: "2026-11-03T12:00:00.000Z",
    entries: [],
    counts: counts()
  };
  return { ...base, ...overrides };
}

function renderDialog(dialogReport: DriftReport, extra: Record<string, unknown> = {}) {
  const calls: {
    review: unknown[][];
    keepDisk: unknown[][];
    keepMine: unknown[][];
    openBoth: unknown[][];
    export: unknown[][];
    close: unknown[][];
  } = {
    review: [],
    keepDisk: [],
    keepMine: [],
    openBoth: [],
    export: [],
    close: []
  };
  testing.render(
    React.createElement(DriftReportDialog, {
      open: true,
      report: dialogReport,
      busy: false,
      bookTitles: { book_test000001: "The Salt Road" },
      onReview: (...args: unknown[]) => void calls.review.push(args),
      onKeepDisk: (...args: unknown[]) => void calls.keepDisk.push(args),
      onKeepMine: (...args: unknown[]) => void calls.keepMine.push(args),
      onOpenBoth: (...args: unknown[]) => void calls.openBoth.push(args),
      onExportLibrary: () => void calls.export.push([]),
      onClose: () => void calls.close.push([]),
      ...extra
    })
  );
  return { body: testing.within(document.body), calls };
}

/**
 * Spec 016 T006: the drift review dialog. It changes nothing itself — every button calls back
 * into the app — and it stays honest about read-only entries.
 */
describe("drift report dialog", () => {
  test("lists every entry with its kind and the book title", () => {
    const { body } = renderDialog(
      report({
        entries: [
          entry({ kind: "remote-changed" }),
          entry({ kind: "conflict-copy", path: "books/book_test000001/conflicts/saved.md" })
        ],
        counts: counts({ "remote-changed": 1, "conflict-copy": 1 })
      })
    );
    expect(body.getByTestId("drift-counts").textContent).toBe("1 changed elsewhere · 1 conflict copy");
    expect(body.getByTestId("drift-entry-0").textContent).toContain("The Salt Road");
    expect(body.getByTestId("drift-entry-1").textContent).toContain("Conflict copy");
  });

  test("a both-changed entry offers review, both keeps and open both", () => {
    const both = entry({ kind: "both-changed" });
    const { body, calls } = renderDialog(report({ entries: [both] }));
    testing.fireEvent.click(body.getByTestId("drift-review-0"));
    testing.fireEvent.click(body.getByTestId("drift-keep-mine-0"));
    testing.fireEvent.click(body.getByTestId("drift-open-both-0"));
    testing.fireEvent.click(body.getByTestId("drift-keep-disk-0"));
    expect(calls.review).toEqual([[{ bookId: "book_test000001", chapterId: "chapter_test000001" }]]);
    expect(calls.keepMine).toEqual([[both]]);
    expect(calls.openBoth).toEqual([[both]]);
    expect(calls.keepDisk).toEqual([[both]]);
  });

  test("a remote-changed entry offers review and keep disk, never keep mine", () => {
    const { body } = renderDialog(report({ entries: [entry({ kind: "remote-changed" })] }));
    expect(body.queryByTestId("drift-review-0")).not.toBeNull();
    expect(body.queryByTestId("drift-keep-disk-0")).not.toBeNull();
    expect(body.queryByTestId("drift-keep-mine-0")).toBeNull();
    expect(body.queryByTestId("drift-open-both-0")).toBeNull();
  });

  test("a placeholder entry has no action buttons", () => {
    const { body } = renderDialog(
      report({ entries: [entry({ kind: "placeholder", bookId: undefined, chapterId: undefined })] })
    );
    expect(body.queryByTestId("drift-review-0")).toBeNull();
    expect(body.queryByTestId("drift-keep-disk-0")).toBeNull();
    expect(body.getByTestId("drift-entry-0").textContent).toContain("Not downloaded");
  });

  test("a clean report says everything matches and offers export", () => {
    const { body, calls } = renderDialog(report({ clean: true, entries: [], counts: counts() }));
    expect(body.getByTestId("drift-clean").textContent).toBe("Everything matches. Nothing to review.");
    expect(body.queryByTestId("drift-entries")).toBeNull();
    testing.fireEvent.click(body.getByTestId("drift-export"));
    testing.fireEvent.click(body.getByTestId("drift-done"));
    expect(calls.export).toHaveLength(1);
    expect(calls.close).toHaveLength(1);
  });

  test("a missing baseline shows the warning line", () => {
    const { body } = renderDialog(report({ entries: [], warning: "No sync baseline exists yet." }));
    expect(body.getByTestId("drift-warning").textContent).toContain("baseline");
  });

  test("a busy dialog disables every button", () => {
    const { body } = renderDialog(report({ entries: [entry({ kind: "both-changed" })] }), { busy: true });
    for (const id of ["drift-review-0", "drift-keep-mine-0", "drift-open-both-0", "drift-keep-disk-0", "drift-done"]) {
      expect((body.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
