/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema, type BookDetail, type Chapter } from "@ai-book-studio/core/schema";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import {
  buildReviewReport,
  analyzeReviewCoverage,
  type ReviewReportResult,
  type ReviewSourceSnapshot
} from "@ai-book-studio/core/review";
import type { ReviewRunView } from "@ai-book-studio/app/components/ReviewReportDialog";

let testing!: typeof import("@testing-library/react/pure");
// Loaded in beforeAll, once the DOM exists.
let ManuscriptEditor!: typeof import("@ai-book-studio/app/components/ManuscriptEditor").ManuscriptEditor;
let ReviewReportDialog!: typeof import("@ai-book-studio/app/components/ReviewReportDialog").ReviewReportDialog;
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;

beforeAll(async () => {
  testing = await mountDom();
  // The dialogs reach react-dom through Radix, and react-dom checks for a DOM the first time it loads.
  // So the components load here, after the DOM exists, and not at module scope.
  ({ ManuscriptEditor } = await import("@ai-book-studio/app/components/ManuscriptEditor"));
  ({ ReviewReportDialog } = await import("@ai-book-studio/app/components/ReviewReportDialog"));
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

const NOW = "2026-11-03T12:00:00.000Z";

const dialogSource: ReviewSourceSnapshot = {
  scope: { kind: "book", bookId: "book_dialog0001" },
  capturedAt: NOW,
  chapters: [
    {
      status: "saved",
      chapterId: "ch_dialog0001",
      title: "Empty chapter",
      order: 1,
      body: " \n\t",
      version: 1,
      hash: "1".repeat(64)
    },
    {
      status: "saved",
      chapterId: "ch_dialog0002",
      title: "Punctuation stays",
      order: 2,
      body: "one — two ...",
      version: 4,
      hash: "2".repeat(64)
    }
  ]
};

function dialogReport(): ReviewReportResult {
  const analysis = analyzeReviewCoverage(dialogSource);
  if (analysis.status === "failed") throw new Error("Synthetic fixture must verify at least one source.");
  return buildReviewReport(dialogSource, analysis, { requestedAt: NOW, completedAt: NOW });
}

function renderReport(view: ReviewRunView, handlers?: { onNavigate?: (findingId: string, index: number) => void }) {
  const onNavigate = mock((findingId: string, index: number) => handlers?.onNavigate?.(findingId, index));
  const onCancelRun = mock(() => {});
  const onRunAgain = mock(() => {});
  const onClose = mock(() => {});
  testing.render(
    React.createElement(ReviewReportDialog, {
      open: true,
      view,
      bookTitle: "Fixture book",
      onCancelRun,
      onRunAgain,
      onClose,
      onNavigate
    })
  );
  return { onNavigate, onCancelRun, onRunAgain, onClose };
}

describe("ReviewReportDialog", () => {
  test("running shows progress with a cancel control", () => {
    const { onCancelRun } = renderReport({ kind: "running" });

    expect(testing.within(document.body).getByTestId("review-report")).toBeTruthy();
    expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain(
      "Reading saved chapters"
    );
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-cancel-run"));
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });

  test("stopped and failed states explain what happened and offer a new run", () => {
    const { onRunAgain } = renderReport({ kind: "stopped" });
    expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain(
      "Partial results are discarded"
    );
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-run-again"));
    expect(onRunAgain).toHaveBeenCalledTimes(1);

    testing.cleanup();
    renderReport({ kind: "failed", message: "No saved chapter text could be verified." });
    expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain(
      "No saved chapter text could be verified"
    );
  });

  test("a complete report shows run scope, studio counts, coverage, definitions and empty findings", () => {
    const report = dialogReport();
    expect(report.status).toBe("complete");
    renderReport({ kind: "report", report, freshness: { status: "current" } });

    const meta = testing.within(document.body).getByTestId("review-run-meta").textContent ?? "";
    expect(meta).toContain("Fixture book");
    expect(meta).toContain("2 chapters");
    expect(meta).toContain("4 words");

    const coverage = testing.within(document.body).getByTestId("review-coverage").textContent ?? "";
    expect(coverage).toContain("Empty chapter");
    expect(coverage).toContain("Punctuation stays");

    const definitions = testing.within(document.body).getByTestId("review-definitions").textContent ?? "";
    expect(definitions).toContain("Studio word count");
    expect(definitions).toContain("measures saved words and coverage only");

    const findings = testing.within(document.body).getByTestId("review-findings").textContent ?? "";
    expect(findings).toContain("No phrase findings to show");
  });

  test("partial and insufficient-evidence reports use their own copy, never a false success", () => {
    const partialSource: ReviewSourceSnapshot = {
      ...dialogSource,
      chapters: [
        ...dialogSource.chapters,
        { status: "skipped", fileName: "0003-unreadable-fixture.md", order: 3, reason: "Synthetic fixture read failure" }
      ]
    };
    const partialAnalysis = analyzeReviewCoverage(partialSource);
    if (partialAnalysis.status === "failed") throw new Error("Synthetic fixture must verify at least one source.");
    renderReport({
      kind: "report",
      report: buildReviewReport(partialSource, partialAnalysis, { requestedAt: NOW, completedAt: NOW }),
      freshness: { status: "current" }
    });
    expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain("Partial report");

    testing.cleanup();
    const emptySource: ReviewSourceSnapshot = { ...dialogSource, chapters: [dialogSource.chapters[0]!] };
    const emptyAnalysis = analyzeReviewCoverage(emptySource);
    if (emptyAnalysis.status === "failed") throw new Error("Synthetic fixture must be analyzable.");
    renderReport({
      kind: "report",
      report: buildReviewReport(emptySource, emptyAnalysis, { requestedAt: NOW, completedAt: NOW }),
      freshness: { status: "current" }
    });
    expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain(
      "Not enough saved text to review"
    );
  });

  test("a stale report names the changed chapter and disables evidence navigation", () => {
    const withFinding: ReviewReportResult = {
      ...dialogReport(),
      findings: [
        {
          id: "finding-synthetic",
          metricId: "studio-word-count",
          label: "Synthetic finding",
          evidence: [
            {
              chapterId: "ch_dialog0002",
              title: "Punctuation stays",
              order: 2,
              sourceVersion: 4,
              sourceHash: "2".repeat(64),
              startOffset: 0,
              endOffset: 3,
              excerpt: "one"
            }
          ]
        }
      ]
    };
    const { onNavigate } = renderReport({
      kind: "report",
      report: withFinding,
      freshness: { status: "stale", changes: [{ kind: "changed", chapterId: "ch_dialog0002" }] }
    });

    const stale = testing.within(document.body).getByTestId("review-stale").textContent ?? "";
    expect(stale).toContain("This report is stale");
    expect(stale).toContain("Punctuation stays");

    const evidence = testing.within(document.body).getByTestId("review-evidence") as HTMLButtonElement;
    expect(evidence.disabled).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("current evidence navigates to the exact saved span", () => {
    const withFinding: ReviewReportResult = {
      ...dialogReport(),
      findings: [
        {
          id: "finding-synthetic",
          metricId: "studio-word-count",
          label: "Synthetic finding",
          evidence: [
            {
              chapterId: "ch_dialog0002",
              title: "Punctuation stays",
              order: 2,
              sourceVersion: 4,
              sourceHash: "2".repeat(64),
              startOffset: 0,
              endOffset: 3,
              excerpt: "one"
            }
          ]
        }
      ]
    };
    const seen: Array<[string, number]> = [];
    renderReport(
      { kind: "report", report: withFinding, freshness: { status: "current" } },
      { onNavigate: (findingId, index) => seen.push([findingId, index]) }
    );

    const evidence = testing.within(document.body).getByTestId("review-evidence") as HTMLButtonElement;
    expect(evidence.disabled).toBe(false);
    testing.fireEvent.click(evidence);
    expect(seen).toEqual([["finding-synthetic", 0]]);
  });

  test("a new run replaces the previous report", () => {
    const first = renderReport({ kind: "report", report: dialogReport(), freshness: { status: "current" } });
    expect(first).toBeTruthy();
    expect((testing.within(document.body).getByTestId("review-run-meta").textContent ?? "").replace(/\s+/g, " ")).toContain(
      "2 chapters"
    );

    testing.cleanup();
    const single: ReviewSourceSnapshot = { ...dialogSource, chapters: [dialogSource.chapters[1]!] };
    const analysis = analyzeReviewCoverage(single);
    if (analysis.status === "failed") throw new Error("Synthetic fixture must verify at least one source.");
    renderReport({
      kind: "report",
      report: buildReviewReport(single, analysis, { requestedAt: NOW, completedAt: NOW }),
      freshness: { status: "current" }
    });
    expect(testing.within(document.body).getByTestId("review-run-meta").textContent ?? "").toContain("1 chapter");
  });

  test("the dialog is labelled and every action has an accessible name", () => {
    // A partial report carries the status region; a complete report stays quiet past the dialog title.
    const partialSource: ReviewSourceSnapshot = {
      ...dialogSource,
      chapters: [
        ...dialogSource.chapters,
        { status: "skipped", fileName: "0003-unreadable-fixture.md", order: 3, reason: "Synthetic fixture read failure" }
      ]
    };
    const partialAnalysis = analyzeReviewCoverage(partialSource);
    if (partialAnalysis.status === "failed") throw new Error("Synthetic fixture must verify at least one source.");
    renderReport({
      kind: "report",
      report: buildReviewReport(partialSource, partialAnalysis, { requestedAt: NOW, completedAt: NOW }),
      freshness: { status: "current" }
    });

    const dialog = testing.within(document.body).getByTestId("review-report");
    expect(dialog.getAttribute("role")).toBe("dialog");
    // Both the dialog dismiss control and the footer action expose the same accessible name.
    expect(testing.within(document.body).getAllByRole("button", { name: "Close" })).toHaveLength(2);
    expect(testing.within(document.body).getByRole("button", { name: "Run again" })).toBeTruthy();
    expect(testing.within(document.body).getByTestId("review-status")).toBeTruthy();
  });
});

describe("ManuscriptEditor evidence selection", () => {
  test("an evidence span is selected in the manuscript text", async () => {
    const chapter: Chapter = {
      id: "ch_dialog0002",
      title: "Punctuation stays",
      order: 2,
      arc: "middle",
      purpose: "",
      synopsis: "",
      notes: "",
      isPrologue: false,
      color: null,
      version: 4,
      createdAt: NOW,
      updatedAt: NOW,
      content: "one — two ...\n",
      path: "0002-punctuation-stays.md",
      wordCount: 4,
      hash: "2".repeat(64)
    };
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      chapters: { save: mock(() => Promise.resolve({ ok: true })), updateMeta: mock(() => Promise.resolve({ ok: true })) },
      drafts: {
        set: mock(() => Promise.resolve({ ok: true, data: null })),
        clear: mock(() => Promise.resolve({ ok: true, data: null })),
        onFlushRequest: mock(() => () => {})
      }
    };

    testing.render(
      React.createElement(ManuscriptEditor, {
        bookId: "book_dialog0001",
        chapter,
        ordinal: 2,
        onSaved: () => {},
        onStatus: () => {},
        selection: { start: 0, end: 3, nonce: 1 }
      })
    );

    await testing.waitFor(
      () => {
        const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
        expect(textarea.selectionStart).toBe(0);
        expect(textarea.selectionEnd).toBe(3);
      },
      { timeout: 1000 }
    );
  });
});

const INTEGRATION_BOOK = "book_int000001";
const INTEGRATION_BOOK_TWO = "book_int000002";

function integrationChapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `${String(order).padStart(4, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: `${order}`.repeat(64).slice(0, 64)
  };
}

function integrationDetail(bookId: string, title: string, chapters: Chapter[]): BookDetail {
  return {
    book: bookSchema.parse({ id: bookId, title, createdAt: NOW, updatedAt: NOW }),
    chapters,
    chapterReadIssues: []
  };
}

const firstDetail = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", [
  integrationChapter("ch_int000001", "The Light", 1, "one — two\n"),
  integrationChapter("ch_int000002", "The Road", 2, "Salt and stone.\n")
]);
const secondDetail = integrationDetail(INTEGRATION_BOOK_TWO, "Second Fixture", [
  integrationChapter("ch_int000003", "Only", 1, "Just this.\n")
]);

const ambientStatus: AmbientStatus = {
  book: { id: INTEGRATION_BOOK, title: "Integration Fixture", stage: "drafting" },
  chapter: { id: "ch_int000001", title: "The Light", order: 1, wordCount: 3 },
  progress: { chapters: 2, words: 6, lastOrder: 2 },
  lastChange: null,
  lastSaid: null,
  working: false,
  actions: [],
  say: "Synthetic ambient status for the review integration fixture."
};

describe("workspace review entry to report", () => {
  test("a clean buffer runs the report with no manuscript writes, and switching books discards it", async () => {
    const saves: unknown[] = [];
    const opens: string[] = [];
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      platform: "darwin",
      library: { onChange: mock(() => () => {}) },
      books: {
        open: mock((bookId: string) => {
          opens.push(bookId);
          return Promise.resolve({ ok: true, data: bookId === INTEGRATION_BOOK_TWO ? secondDetail : firstDetail });
        })
      },
      conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      images: {
        list: mock(() =>
          Promise.resolve({ ok: true, data: { manifest: { schemaVersion: 1, images: [] }, warning: null } })
        )
      },
      drafts: {
        set: mock(() => Promise.resolve({ ok: true, data: null })),
        clear: mock(() => Promise.resolve({ ok: true, data: null })),
        onFlushRequest: mock(() => () => {})
      },
      recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      chapters: {
        save: mock((input: unknown) => {
          saves.push(input);
          return Promise.resolve({ ok: true, data: { status: "saved", chapter: firstDetail.chapters[0] } });
        }),
        updateMeta: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: firstDetail.chapters[0] } }))
      },
      agent: {
        ambient: mock(() => Promise.resolve({ ok: true, data: ambientStatus })),
        onEvent: mock(() => () => {})
      },
      voice: {
        speakers: mock(() => Promise.resolve({ ok: true, data: { available: false, voices: [] } })),
        connections: mock(() => Promise.resolve({ ok: true, data: [] }))
      }
    };
    const onNotice = mock((_error: unknown) => {});

    const theme = { choice: "light" as const, set: (_choice: "light" | "dark" | "system") => {}, cycle: () => {} };
    const workspaceProps = {
      theme,
      libraryRoot: "/tmp/synthetic-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    };
    const rendered = testing.render(React.createElement(WorkspaceView, { ...workspaceProps, bookId: INTEGRATION_BOOK }));

    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("manuscript-editor")).toBeTruthy(), {
      timeout: 2000
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-manuscript"));

    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("review-run-meta")).toBeTruthy(), {
      timeout: 2000
    });
    const meta = (testing.within(document.body).getByTestId("review-run-meta").textContent ?? "").replace(/\s+/g, " ");
    expect(meta).toContain("Integration Fixture");
    expect(meta).toContain("2 chapters");
    expect(meta).toContain("6 words");
    const definitions = testing.within(document.body).getByTestId("review-definitions").textContent ?? "";
    expect(definitions).toContain("Studio word count");
    // The run is read-only: nothing was saved, drafted or written.
    expect(saves).toEqual([]);

    // A new run over the same saved chapters replaces the report in place.
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-run-again"));
    await testing.waitFor(
      () => {
        expect(opens.filter((bookId) => bookId === INTEGRATION_BOOK).length).toBeGreaterThan(1);
        expect(testing.within(document.body).getByTestId("review-run-meta")).toBeTruthy();
      },
      { timeout: 2000 }
    );

    // Switching books discards the run-local report without touching the manuscript.
    rendered.rerender(React.createElement(WorkspaceView, { ...workspaceProps, bookId: INTEGRATION_BOOK_TWO }));
    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("manuscript-editor")).toBeTruthy(), {
      timeout: 2000
    });
    expect(testing.within(document.body).queryByTestId("review-report")).toBeNull();
    expect(testing.within(document.body).queryByTestId("review-dialog")).toBeNull();
    expect(saves).toEqual([]);
    // Let bridge promises and dialog focus timers settle before teardown unmounts the DOM.
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  test("cancelling during the snapshot read stops the run without analysis", async () => {
    let releaseRead!: (detail: BookDetail) => void;
    const pendingRead = new Promise<BookDetail>((resolve) => {
      releaseRead = resolve;
    });
    let openCalls = 0;
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      platform: "darwin",
      library: { onChange: mock(() => () => {}) },
      books: {
        open: mock(() => {
          openCalls += 1;
          // The initial workspace load resolves at once; the review's own read stays
          // pending until the test releases it, opening a deterministic cancel window.
          return openCalls === 1
            ? Promise.resolve({ ok: true, data: firstDetail })
            : pendingRead.then((data) => ({ ok: true, data }));
        })
      },
      conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      images: {
        list: mock(() =>
          Promise.resolve({ ok: true, data: { manifest: { schemaVersion: 1, images: [] }, warning: null } })
        )
      },
      drafts: {
        set: mock(() => Promise.resolve({ ok: true, data: null })),
        clear: mock(() => Promise.resolve({ ok: true, data: null })),
        onFlushRequest: mock(() => () => {})
      },
      recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      chapters: {
        save: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: firstDetail.chapters[0] } })),
        updateMeta: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: firstDetail.chapters[0] } }))
      },
      agent: {
        ambient: mock(() => Promise.resolve({ ok: true, data: ambientStatus })),
        onEvent: mock(() => () => {})
      },
      voice: {
        speakers: mock(() => Promise.resolve({ ok: true, data: { available: false, voices: [] } })),
        connections: mock(() => Promise.resolve({ ok: true, data: [] }))
      }
    };
    const onNotice = mock((_error: unknown) => {});

    const theme = { choice: "light" as const, set: (_choice: "light" | "dark" | "system") => {}, cycle: () => {} };
    testing.render(
      React.createElement(WorkspaceView, {
        bookId: INTEGRATION_BOOK,
        theme,
        libraryRoot: "/tmp/synthetic-library",
        libraryStorage: undefined,
        onBack: () => {},
        onNotice,
        onSchemaRefusal: () => {}
      })
    );

    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("manuscript-editor")).toBeTruthy(), {
      timeout: 2000
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-manuscript"));

    // The snapshot read is still pending, so the run waits with a cancel control.
    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("review-cancel-run")).toBeTruthy(), {
      timeout: 2000
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-cancel-run"));
    // The read lands after the abort: analysis must not start and no report body may appear.
    releaseRead(firstDetail);
    await testing.waitFor(
      () =>
        expect(testing.within(document.body).getByTestId("review-status").textContent ?? "").toContain(
          "Partial results are discarded"
        ),
      { timeout: 2000 }
    );
    expect(testing.within(document.body).queryByTestId("review-run-meta")).toBeNull();
    expect(testing.within(document.body).queryByTestId("review-findings")).toBeNull();
    expect(openCalls).toBe(2);
    // Let bridge promises and dialog focus timers settle before teardown unmounts the DOM.
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
