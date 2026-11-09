/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema, type BookDetail, type Chapter } from "@ai-book-studio/core/schema";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import {
  buildReviewReport,
  analyzeReviewCoverage,
  analyzeReviewCoverageAsync,
  type ReviewCoverageAnalysis,
  type ReviewReportResult,
  type ReviewSourceSnapshot
} from "@ai-book-studio/core/review";
import type { ReviewRunView } from "@ai-book-studio/app/components/ReviewReportDialog";
import type { ReviewWorkerReply, ReviewWorkerRequest } from "@ai-book-studio/app/lib/review-worker-protocol";
import { matchesRepetitionEvidence } from "@ai-book-studio/core/review/repetition";

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

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing synthetic fixture at index ${index}`);
  return item;
}

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
    expect(definitions).toContain("repetition-v1");
    expect(definitions).toContain("overlapping three-token");

    const findings = testing.within(document.body).getByTestId("review-findings").textContent ?? "";
    expect(findings).toContain("Unverified result");
    expect(findings).toContain("worker reported no repeated three-token sequences in the saved chapters");
    expect(findings).toContain("This does not confirm that none exist");
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
    const partialFindings = testing.within(document.body).getByTestId("review-findings").textContent ?? "";
    expect(partialFindings).toContain("Unverified result");
    expect(partialFindings).toContain("worker reported no repeated three-token sequences in the analyzed chapters");
    expect(partialFindings).toContain("This does not confirm that none exist");
    expect(partialFindings).toContain("Skipped chapters were not scanned");

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
    const emptyFindings = testing.within(document.body).getByTestId("review-findings").textContent ?? "";
    expect(emptyFindings).toContain("Not enough saved text for phrase findings");
    expect(emptyFindings).not.toContain("reported no repeated");
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

  test("actual findings retain every overlap across occurrence pages, preserve focus and block stale navigation", async () => {
    const source: ReviewSourceSnapshot = { ...dialogSource, chapters: [{
      status: "saved", chapterId: "ch_paged", title: "Repeated fixture", order: 1,
      body: Array(27).fill("word").join(" "), version: 1, hash: "a".repeat(64)
    }] };
    const outcome = await analyzeReviewCoverageAsync(source, new AbortController().signal);
    if (outcome.status !== "complete") throw new Error("Synthetic scan must complete");
    const report = buildReviewReport(source, outcome.value, { requestedAt: NOW, completedAt: NOW });
    const onNavigate = mock((_findingId: string, _index: number) => {});
    const props = { open: true, bookTitle: "Paging fixture", onNavigate, onCancelRun: () => {}, onRunAgain: () => {}, onClose: () => {} };
    const rendered = testing.render(React.createElement(ReviewReportDialog, {
      ...props, view: { kind: "report", report, freshness: { status: "current" } }
    }));
    const queries = testing.within(document.body);
    expect(queries.getByTestId("review-findings").textContent).toContain("1 sequence · 25 occurrences");
    for (const [page, count] of [[0, 10], [1, 10], [2, 5]] as const) {
      const buttons = queries.getAllByTestId("review-evidence");
      expect(buttons).toHaveLength(count);
      for (const button of buttons) testing.fireEvent.click(button);
      expect(queries.getByRole("group", { name: "Occurrences pages" }).textContent)
        .toContain(`Occurrences ${page * 10 + 1}–${page * 10 + count} of 25`);
      const next = queries.getByRole("button", { name: "Next occurrences" });
      next.focus();
      testing.fireEvent.click(next);
      expect(document.activeElement).toBe(next);
    }
    const finding = report.findings[0];
    if (!finding) throw new Error("Expected the completed repetition finding");
    expect(onNavigate.mock.calls).toEqual(Array.from({ length: 25 }, (_, index) => [finding.id, index]));
    expect(report.findings[0]?.evidence).toHaveLength(25);
    rendered.rerender(React.createElement(ReviewReportDialog, {
      ...props, view: { kind: "report", report, freshness: { status: "stale", changes: [{ kind: "changed", chapterId: "ch_paged" }] } }
    }));
    for (const button of queries.getAllByTestId("review-evidence")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      testing.fireEvent.click(button);
    }
    expect(onNavigate).toHaveBeenCalledTimes(25);
    testing.fireEvent.click(queries.getByRole("button", { name: "Previous occurrences" }));
    expect(queries.getAllByTestId("review-evidence")).toHaveLength(10);
    expect(onNavigate).toHaveBeenCalledTimes(25);
  });

  test("sequence paging is bounded, covers every generated finding and resets for a new run", () => {
    const source: ReviewSourceSnapshot = { ...dialogSource, chapters: Array.from({ length: 12 }, (_, index) => ({
      status: "saved", chapterId: `ch_sequence${index}`, title: `Sequence ${index}`, order: index + 1,
      body: `word${index} repeats here. WORD${index} repeats here.`, version: 1, hash: "a".repeat(64)
    })) };
    const report = buildReviewReport(source, analyzeReviewCoverage(source), { requestedAt: NOW, completedAt: NOW });
    expect(report.findings).toHaveLength(12);
    const onNavigate = mock((_findingId: string, _index: number) => {});
    const props = { open: true, bookTitle: "Sequence pages", onNavigate, onCancelRun: () => {}, onRunAgain: () => {}, onClose: () => {} };
    const rendered = testing.render(React.createElement(ReviewReportDialog, {
      ...props, view: { kind: "report", report, freshness: { status: "current" } }
    }));
    const queries = testing.within(document.body);
    for (const count of [5, 5, 2]) {
      expect(queries.getAllByTestId("review-finding")).toHaveLength(count);
      for (const button of queries.getAllByTestId("review-evidence")) testing.fireEvent.click(button);
      testing.fireEvent.click(queries.getByRole("button", { name: "Next sequences" }));
    }
    expect(onNavigate.mock.calls).toEqual(report.findings.flatMap((finding) => [[finding.id, 0], [finding.id, 1]]));
    rendered.rerender(React.createElement(ReviewReportDialog, {
      ...props, view: { kind: "report", report: { ...report, requestedAt: "2026-11-08T13:00:00.000Z" }, freshness: { status: "current" } }
    }));
    expect(queries.getByRole("group", { name: "Sequences pages" }).textContent).toContain("Sequences 1–5 of 12");
  });

  test.each(["hole", "invalid shape", "wrong source"] as const)(
    "a %s on a later occurrence page fails safely when it becomes visible", (defect) => {
      const source: ReviewSourceSnapshot = { ...dialogSource, chapters: [{
        status: "saved", chapterId: "ch_paged", title: "Repeated fixture", order: 1,
        body: Array(27).fill("word").join(" "), version: 1, hash: "a".repeat(64)
      }] };
      const report = buildReviewReport(source, analyzeReviewCoverage(source), { requestedAt: NOW, completedAt: NOW });
      const finding = report.findings[0];
      if (!finding) throw new Error("Expected a repetition finding");
      const evidence = [...finding.evidence];
      if (defect === "hole") delete evidence[12];
      else if (defect === "invalid shape") evidence[12] = null as unknown as typeof evidence[number];
      else evidence[12] = { ...at(evidence, 12), sourceHash: "wrong" };
      const malformed = { ...report, findings: [{ ...finding, evidence }] };
      const onMalformedEvidence = mock(() => {});
      const onNavigate = mock(() => {});
      testing.render(React.createElement(ReviewReportDialog, {
        open: true, bookTitle: "Synthetic", view: { kind: "report", report: malformed, freshness: { status: "current" } },
        onNavigate, onMalformedEvidence, onCancelRun: () => {}, onRunAgain: () => {}, onClose: () => {}
      }));
      const queries = testing.within(document.body);
      expect(queries.getAllByTestId("review-evidence")).toHaveLength(10);
      expect(onMalformedEvidence).not.toHaveBeenCalled();
      testing.fireEvent.click(queries.getByRole("button", { name: "Next occurrences" }));
      expect(queries.getByText(/worker returned an invalid result/)).toBeTruthy();
      expect(queries.queryByTestId("review-evidence")).toBeNull();
      expect(onMalformedEvidence).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    }
  );
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
        selection: { start: 0, end: 3, source: { libraryId: "studio-local", bookId: "book_dialog0001",
          chapterId: chapter.id, version: chapter.version, rawHash: chapter.hash, savedBody: chapter.content },
          isCurrent: () => true, onResult: () => {} }
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
  integrationChapter("ch_int000001", "The Light", 1, "Salt and stone.\n"),
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

/** Synthetic read-only bridge for worker lifetime tests; any accidental writer/provider call fails. */
function workerWorkspaceFixture(detail = firstDetail) {
  const forbidden = mock(() => { throw new Error("No write/provider in local review"); });
  const open = mock((bookId: string) => Promise.resolve({ ok: true as const, data: bookId === INTEGRATION_BOOK_TWO ? secondDetail : detail }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin", library: { onChange: () => () => {} }, books: { open },
    conflicts: { list: () => Promise.resolve({ ok: true, data: [] }) },
    images: { list: () => Promise.resolve({ ok: true, data: { manifest: { schemaVersion: 1, images: [] }, warning: null } }) },
    drafts: { set: forbidden, clear: forbidden, onFlushRequest: () => () => {} },
    recovery: { list: () => Promise.resolve({ ok: true, data: [] }) },
    chapters: { save: forbidden, updateMeta: forbidden },
    agent: { send: forbidden, ambient: () => Promise.resolve({ ok: true, data: ambientStatus }), onEvent: () => () => {} },
    voice: {
      speakers: () => Promise.resolve({ ok: true, data: { available: false, voices: [] } }),
      connections: () => Promise.resolve({ ok: true, data: [] })
    }
  };
  const props = {
    bookId: INTEGRATION_BOOK, libraryRoot: "/synthetic/review-worker",
    theme: { choice: "light" as const, set: (_choice: "light" | "dark" | "system") => {}, cycle: () => {} },
    onBack: () => {}, onNotice: mock((_error: unknown) => {}), onSchemaRefusal: () => {}
  };
  return { props, open, forbidden };
}

function controlledReviewWorkers(holdEvidence = false) {
  const original = globalThis.Worker;
  const workers: ControlledWorker[] = [];
  const checks: ControlledWorker[] = [];
  class ControlledWorker extends EventTarget {
    request: ReviewWorkerRequest | undefined;
    terminate = mock(() => {});
    constructor(_url: string | URL, _options?: WorkerOptions) {
      super();
      queueMicrotask(() => this.reply({ kind: "ready" }));
    }
    postMessage(request: ReviewWorkerRequest) {
      this.request = request;
      if (request.kind === "analyze") workers.push(this);
      else {
        checks.push(this);
        // A small-fixture protocol double only; real off-thread normalization has separate tests.
        if (!holdEvidence) queueMicrotask(() => this.verify());
      }
    }
    reply(reply: ReviewWorkerReply) { this.dispatchEvent(new MessageEvent("message", { data: reply })); }
    complete(change?: (analysis: ReviewCoverageAnalysis) => ReviewCoverageAnalysis) {
      if (this.request?.kind !== "analyze") throw new Error("Worker has no saved snapshot");
      const analysis = analyzeReviewCoverage(this.request.source);
      this.reply({ kind: "complete", analysis: change ? change(analysis) : analysis });
    }
    verify() {
      if (this.request?.kind !== "verify-evidence") throw new Error("Worker has no selected evidence");
      this.reply({ kind: "verified-evidence", matches: matchesRepetitionEvidence(this.request.evidence) });
    }
  }
  globalThis.Worker = ControlledWorker as unknown as typeof Worker;
  return { workers, checks, restore: () => { globalThis.Worker = original; } };
}

function deferredRead() {
  let resolve!: (result: { ok: true; data: BookDetail }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ ok: true; data: BookDetail }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function startControlledReport(
  fixture: ReturnType<typeof workerWorkspaceFixture>, control: ReturnType<typeof controlledReviewWorkers>,
  change?: (analysis: ReviewCoverageAnalysis) => ReviewCoverageAnalysis, expectedLabel = "salt and stone"
) {
  const rendered = testing.render(React.createElement(WorkspaceView, fixture.props));
  const queries = testing.within(document.body);
  await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
  testing.fireEvent.click(queries.getByTestId("review-manuscript"));
  await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
  await testing.act(async () => { control.workers[0]?.complete(change); });
  await testing.waitFor(() => expect(queries.queryByTestId("review-findings")?.textContent?.includes(expectedLabel) ?? false).toBe(true), {
    onTimeout: (error) => new Error(`${error.message}\nReview state: ${queries.queryByTestId("review-report")?.textContent?.slice(0, 1500) ?? "not mounted"}`)
  });
  await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-checking"))).toBe(false));
  return { rendered, queries };
}

const repeatedBody = `😀 ${Array(25).fill("agate birch cloud").join(" ")}`;
const repeatedDetail = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", [
  integrationChapter("ch_int000001", "The Light", 1, repeatedBody)
]);

function changeLaterOccurrence(
  analysis: ReviewCoverageAnalysis,
  change: (evidence: Array<ReviewCoverageAnalysis["findings"][number]["evidence"][number]>) => void
): ReviewCoverageAnalysis {
  const finding = at(analysis.findings, 0);
  const evidence = [...finding.evidence];
  change(evidence);
  return { ...analysis, findings: [{ ...finding, evidence }, ...analysis.findings.slice(1)] };
}

describe("workspace review entry to report", () => {
  test.each([false, true])("an omitted worker result discloses unverified zero findings (partial=%s)", async (partial) => {
    const detail: BookDetail = { ...firstDetail, chapterReadIssues: partial
      ? [{ fileName: "0003-unreadable-fixture.md", order: 3, reason: "unreadable" }] : [] };
    const fixture = workerWorkspaceFixture(detail);
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control, (analysis) => {
        expect(analysis.findings.length).toBeGreaterThan(0);
        return { ...analysis, findings: [] };
      }, "Unverified result");
      const findings = queries.getByTestId("review-findings").textContent ?? "";
      expect(findings).toContain("worker reported no repeated three-token sequences");
      expect(findings).toContain("This does not confirm that none exist");
      expect(findings.includes("Skipped chapters were not scanned")).toBe(partial);
      expect(queries.queryByTestId("review-evidence")).toBeNull();
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      expect(editor.value).toBe(at(detail.chapters, 0).content);
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
      expect(control.checks).toHaveLength(0);
      expect(fixture.forbidden).not.toHaveBeenCalled();
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["swapped", "label", "token-start", "token-end", "apostrophe", "astral"] as const)(
    "opening a %s claim refuses false finding association and retains the unavailable report", async (defect) => {
      const prefix = defect === "token-start" ? "x" : defect === "apostrophe" ? "x’" : defect === "astral" ? "𐐀" : "";
      const suffix = defect === "token-end" ? "\u0301" : "";
      const body = `${prefix}agate birch cloud${suffix} agate birch cloud agate birch cloud`;
      const detail = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", [integrationChapter("ch_int000001", "The Light", 1, body)]);
      const fixture = workerWorkspaceFixture(detail);
      const control = controlledReviewWorkers();
      try {
        const { queries } = await startControlledReport(fixture, control, (analysis) => {
          const finding = analysis.findings.find((item) => item.label === "agate birch cloud");
          if (!finding) throw new Error("Fixture needs the repeated phrase");
          const evidence = [...finding.evidence];
          if (defect === "swapped") {
            const other = analysis.findings.find((item) => item.label === "birch cloud agate");
            if (!other) throw new Error("Fixture needs another sequence");
            evidence[0] = at(other.evidence, 0);
          }
          else if (defect !== "label") evidence[0] = { ...at(evidence, 0), startOffset: prefix.length,
            endOffset: prefix.length + "agate birch cloud".length, excerpt: "agate birch cloud" };
          return { ...analysis, findings: [{ ...finding, id: "repetition-v1-1", label: defect === "label" ? "silver fir pine" : finding.label, evidence }] };
        }, defect === "label" ? "silver fir pine" : "agate birch cloud");
        expect(queries.getByTestId("review-findings").textContent).toContain("Unverified totals");
        expect(queries.getByTestId("review-finding").textContent).toContain("Unverified sequence");
        expect(queries.getByTestId("review-finding").textContent).toContain("unverified count");
        testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 0));
        await testing.waitFor(() => expect(queries.getByTestId("review-unavailable")).toBeTruthy());
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        expect(editor.value).toBe(body);
        expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
        testing.fireEvent.click(queries.getByTestId("review-close"));
        testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        expect(queries.getByTestId("review-unavailable")).toBeTruthy();
        expect(queries.queryByTestId("review-retry-freshness")).toBeNull();
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  );

  test("valid normalized Unicode and punctuation evidence selects the original literal", async () => {
    const literal = "CAFÉ, L’ÉTÉ 𐐀";
    const body = `😀 ${literal}. Cafe\u0301—l'e\u0301te\u0301;𐐨!`;
    const detail = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", [integrationChapter("ch_int000001", "The Light", 1, body)]);
    const fixture = workerWorkspaceFixture(detail);
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control, undefined, "café l'été 𐐨");
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 0));
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-report"))).toBe(false));
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      expect(editor.selectionStart).toBe(3);
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe(literal);
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["initial", "after verification"] as const)("navigation read %s stays checking, rejects visibly, then retries explicitly", async (phase) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers(phase === "after verification");
    try {
      const { queries } = await startControlledReport(fixture, control);
      const pending = deferredRead();
      if (phase === "initial") fixture.open.mockImplementationOnce(() => pending.promise);
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 0));
      expect(queries.getByTestId("review-checking")).toBeTruthy();
      expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
      if (phase === "after verification") {
        await testing.waitFor(() => expect(control.checks[0]?.request).toBeTruthy());
        fixture.open.mockImplementationOnce(() => pending.promise);
        await testing.act(async () => { control.checks[0]?.verify(); });
      }
      await testing.act(async () => { pending.reject(new Error("synthetic navigation read failure")); });
      expect(queries.getByTestId("review-unavailable").textContent).toContain("saved chapters could not be checked");
      expect(queries.queryByTestId("review-stale")).toBeNull();
      expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      expect(editor.value).toBe(at(firstDetail.chapters, 0).content);
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
      const retry = deferredRead();
      fixture.open.mockImplementationOnce(() => retry.promise);
      testing.fireEvent.click(queries.getByTestId("review-retry-freshness"));
      expect(queries.getByTestId("review-checking")).toBeTruthy();
      await testing.act(async () => { retry.resolve({ ok: true, data: firstDetail }); });
      expect(queries.queryByTestId("review-unavailable")).toBeNull();
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-checking"))).toBe(false));
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
      const checkIndex = control.checks.length;
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 0));
      if (phase === "after verification") {
        await testing.waitFor(() => expect(control.checks[checkIndex]?.request).toBeTruthy());
        await testing.act(async () => { control.checks[checkIndex]?.verify(); });
      }
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-report"))).toBe(false));
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("Salt and stone");
      expect(fixture.props.onNotice).toHaveBeenCalledTimes(1);
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["changed", "dirty"] as const)("source becoming %s during evidence normalization cannot be selected", async (change) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers(true);
    try {
      const { queries } = await startControlledReport(fixture, control);
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 1));
      await testing.waitFor(() => expect(control.checks[0]?.request).toBeTruthy());
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      if (change === "dirty") testing.fireEvent.change(editor, { target: { value: "My live words" } });
      else fixture.open.mockImplementationOnce(async () => ({ ok: true as const, data: { ...firstDetail,
        chapters: firstDetail.chapters.map((chapter) => ({ ...chapter, version: 2, hash: "f".repeat(64) })) } }));
      await testing.act(async () => { control.checks[0]?.verify(); });
      expect(queries.getByTestId("review-report")).toBeTruthy();
      expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Light");
      if (change === "dirty") expect(editor.value).toBe("My live words");
      else expect(queries.getByTestId("review-stale")).toBeTruthy();
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["close", "rerun", "book", "library", "ABA", "unmount"] as const)("%s cancels evidence normalization and old replies cannot poison a replacement", async (change) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers(true);
    try {
      const { rendered, queries } = await startControlledReport(fixture, control);
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 0));
      await testing.waitFor(() => expect(control.checks[0]?.request).toBeTruthy());
      const check = at(control.checks, 0);
      if (change === "unmount") rendered.unmount();
      else if (change === "close") testing.fireEvent.click(queries.getByTestId("review-close"));
      else if (change === "rerun") testing.fireEvent.click(queries.getByTestId("review-run-again"));
      else if (change === "library") rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props, libraryRoot: "/synthetic/new" }));
      else {
        rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props, bookId: INTEGRATION_BOOK_TWO }));
        if (change === "ABA") rendered.rerender(React.createElement(WorkspaceView, fixture.props));
      }
      expect(check.terminate).toHaveBeenCalledTimes(1);
      await testing.act(async () => {
        check.reply({ kind: "verified-evidence", matches: false });
        check.dispatchEvent(new Event("error"));
      });
      if (change === "rerun") {
        await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
        expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
        await testing.act(async () => { control.workers[1]?.complete(); });
        expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone");
      } else expect(queries.queryByTestId("review-report")).toBeNull();
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["literal", "bounds", "gap", "surrogate"] as const)(
    "a later %s occurrence is explicitly unverified and an exact open makes the report unavailable", async (defect) => {
      const fixture = workerWorkspaceFixture(repeatedDetail);
      const control = controlledReviewWorkers();
      try {
        const change = (analysis: ReviewCoverageAnalysis) => changeLaterOccurrence(analysis, (evidence) => {
          const span = at(evidence, 12);
          if (defect === "literal") evidence[12] = { ...span, excerpt: "Q".repeat(span.excerpt.length) };
          else if (defect === "bounds") evidence[12] = { ...span, startOffset: 10_000, endOffset: 10_000 + span.excerpt.length };
          else if (defect === "gap") evidence[12] = { ...span, excerpt: span.excerpt.replace(" ", "-") };
          else evidence[12] = { ...span, startOffset: 1, endOffset: 2, excerpt: repeatedBody.slice(1, 2) };
        });
        const { queries } = await startControlledReport(fixture, control, change, "agate birch cloud");
        const finding = at(queries.getAllByTestId("review-finding"), 0);
        const page = testing.within(finding);
        testing.fireEvent.click(page.getByRole("button", { name: "Next occurrences" }));
        expect(queries.getByTestId("review-findings").textContent).toContain("Sequence labels, counts and excerpts are unverified");
        expect(finding.textContent).toContain("Unverified excerpt");
        expect(page.getAllByTestId("review-evidence")).toHaveLength(10);
        testing.fireEvent.click(at(page.getAllByTestId("review-evidence"), 2));
        await testing.waitFor(() => expect(queries.getByTestId("review-unavailable").textContent).toContain("passage could not be verified"));
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        expect(queries.getByTestId("review-findings").textContent).toContain("25 occurrences");
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        expect(editor.value).toBe(repeatedBody);
        expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
        expect(fixture.props.onNotice).toHaveBeenCalledTimes(1);
        testing.fireEvent.click(queries.getByTestId("review-close"));
        testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        expect(queries.getByTestId("review-unavailable")).toBeTruthy();
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  );

  test("a valid later-page excerpt remains useful and selects its exact saved span", async () => {
    const fixture = workerWorkspaceFixture(repeatedDetail);
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control, undefined, "agate birch cloud");
      const finding = testing.within(at(queries.getAllByTestId("review-finding"), 0));
      testing.fireEvent.click(finding.getByRole("button", { name: "Next occurrences" }));
      expect(finding.getAllByText(/Unverified excerpt/)).toHaveLength(10);
      testing.fireEvent.click(at(finding.getAllByTestId("review-evidence"), 2));
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-report"))).toBe(false));
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      const expectedStart = 3 + 12 * "agate birch cloud ".length;
      expect(editor.selectionStart).toBe(expectedStart);
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("agate birch cloud");
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["resolve", "reject"] as const)(
    "a current malformed page invalidates a pending navigation on late %s", async (outcome) => {
      const fixture = workerWorkspaceFixture(repeatedDetail);
      const control = controlledReviewWorkers();
      try {
        const { queries } = await startControlledReport(fixture, control, (analysis) =>
          changeLaterOccurrence(analysis, (evidence) => { delete evidence[12]; }), "agate birch cloud");
        const pending = deferredRead();
        fixture.open.mockImplementationOnce(() => pending.promise);
        const finding = testing.within(at(queries.getAllByTestId("review-finding"), 0));
        const before = fixture.open.mock.calls.length;
        testing.fireEvent.click(at(finding.getAllByTestId("review-evidence"), 0));
        expect(fixture.open.mock.calls.length).toBe(before + 1);
        testing.fireEvent.click(finding.getByRole("button", { name: "Next occurrences" }));
        expect(queries.getByTestId("review-status").textContent).toContain("invalid result");
        await testing.act(async () => {
          if (outcome === "resolve") pending.resolve({ ok: true, data: repeatedDetail });
          else pending.reject(new Error("obsolete synthetic navigation"));
        });
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("");
        expect(queries.getByTestId("review-status").textContent).toContain("invalid result");
        expect(fixture.props.onNotice).not.toHaveBeenCalled();
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  );

  test("a superseded malformed page does not cancel the replacement worker", async () => {
    const fixture = workerWorkspaceFixture(repeatedDetail);
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control, (analysis) =>
        changeLaterOccurrence(analysis, (evidence) => { delete evidence[12]; }), "agate birch cloud");
      await testing.act(async () => {
        const finding = testing.within(at(queries.getAllByTestId("review-finding"), 0));
        testing.fireEvent.click(finding.getByRole("button", { name: "Next occurrences" }));
        testing.fireEvent.click(queries.getByTestId("review-run-again"));
      });
      await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
      expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
      expect(control.workers[1]?.terminate).not.toHaveBeenCalled();
      await testing.act(async () => { control.workers[1]?.complete(); });
      expect(queries.getByTestId("review-findings").textContent).toContain("agate birch cloud");
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["changed", "reject"] as const)(
    "reopen stays checking and disabled until its saved read %s", async (outcome) => {
      const fixture = workerWorkspaceFixture();
      const control = controlledReviewWorkers();
      try {
        const { queries } = await startControlledReport(fixture, control);
        testing.fireEvent.click(queries.getByTestId("review-close"));
        const pending = deferredRead();
        fixture.open.mockImplementationOnce(() => pending.promise);
        testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        expect(queries.getByTestId("review-checking").textContent).toContain("Checking the saved chapters");
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        testing.fireEvent.change(editor, { target: { value: "Unsaved live words remain here." } });
        const changed = { ...firstDetail, chapters: firstDetail.chapters.map((chapter) => ({ ...chapter, version: chapter.version + 1, hash: "f".repeat(64), content: "Changed saved words." })) };
        await testing.act(async () => {
          if (outcome === "changed") pending.resolve({ ok: true, data: changed });
          else pending.reject(new Error("synthetic saved read failed"));
        });
        expect(editor.value).toBe("Unsaved live words remain here.");
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        if (outcome === "changed") {
          expect(queries.getByTestId("review-stale").textContent).toContain("The Light");
          expect(queries.getByTestId("review-stale").textContent).toContain("The Road");
          expect(fixture.props.onNotice).not.toHaveBeenCalled();
        } else {
          expect(queries.getByTestId("review-unavailable").textContent).toContain("saved chapters could not be checked");
          expect(fixture.props.onNotice).toHaveBeenCalledTimes(1);
          const retry = deferredRead();
          fixture.open.mockImplementationOnce(() => retry.promise);
          testing.fireEvent.click(queries.getByTestId("review-retry-freshness"));
          expect(queries.getByTestId("review-checking")).toBeTruthy();
          expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
          await testing.act(async () => { retry.resolve({ ok: true, data: firstDetail }); });
          expect(queries.queryByTestId("review-checking")).toBeNull();
          expect(queries.queryByTestId("review-unavailable")).toBeNull();
          expect(queries.getAllByTestId("review-evidence").every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
          expect(editor.value).toBe("Unsaved live words remain here.");
        }
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  );

  for (const action of ["cancel", "close", "rerun", "unmount", "chapter", "book ABA", "library ABA"] as const) {
    for (const outcome of ["resolve", "reject"] as const) {
      test(`an obsolete first-display ${outcome} cannot affect ${action}`, async () => {
        const fixture = workerWorkspaceFixture();
        const control = controlledReviewWorkers();
        try {
          const rendered = testing.render(React.createElement(WorkspaceView, fixture.props));
          const queries = testing.within(document.body);
          await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
          testing.fireEvent.click(queries.getByTestId("review-manuscript"));
          await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
          const pending = deferredRead();
          fixture.open.mockImplementationOnce(() => pending.promise);
          await testing.act(async () => { control.workers[0]?.complete(); });
          expect(queries.getByTestId("review-checking")).toBeTruthy();

          if (action === "cancel") testing.fireEvent.click(queries.getByTestId("review-cancel-run"));
          else if (action === "close") testing.fireEvent.click(queries.getByTestId("review-close"));
          else if (action === "rerun") {
            testing.fireEvent.click(queries.getByTestId("review-run-again"));
            await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
          } else if (action === "unmount") rendered.unmount();
          else if (action === "chapter") {
            rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props,
              chapterRequest: { bookId: INTEGRATION_BOOK, chapterId: "ch_int000002", nonce: 1, revert: false } }));
            await testing.waitFor(() => expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road"));
          } else {
            const other = action === "book ABA" ? { bookId: INTEGRATION_BOOK_TWO } : { libraryRoot: "/synthetic/other-library" };
            const oldEditor = queries.getByTestId("manuscript-text");
            rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props, ...other }));
            await testing.waitFor(() => expect(queries.getByTestId("manuscript-text")).not.toBe(oldEditor));
            rendered.rerender(React.createElement(WorkspaceView, fixture.props));
            await testing.waitFor(() => expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Light"));
            testing.fireEvent.click(queries.getByTestId("review-manuscript"));
            await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
          }

          const changed = { ...firstDetail, chapters: firstDetail.chapters.map((chapter) => ({ ...chapter, version: chapter.version + 1, hash: "e".repeat(64) })) };
          await testing.act(async () => {
            if (outcome === "resolve") pending.resolve({ ok: true, data: changed });
            else pending.reject(new Error("obsolete first-display read"));
          });
          if (action === "cancel") expect(queries.getByTestId("review-status").textContent).toContain("Partial results are discarded");
          if (action === "close" || action === "unmount") expect(queries.queryByTestId("review-report")).toBeNull();
          if (action === "chapter") {
            expect(queries.getByTestId("review-unavailable")).toBeTruthy();
            expect(queries.queryByTestId("review-stale")).toBeNull();
            expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road");
          }
          if (action === "rerun" || action === "book ABA" || action === "library ABA") {
            expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
            expect(control.workers[1]?.terminate).not.toHaveBeenCalled();
          }
          expect(fixture.props.onNotice).not.toHaveBeenCalled();
          expect(fixture.forbidden).not.toHaveBeenCalled();
        } finally { testing.cleanup(); control.restore(); }
      });
    }
  }

  test.each(["changed", "reject"] as const)(
    "the first display is unverified while the post-analysis read %s", async (outcome) => {
      const fixture = workerWorkspaceFixture();
      const control = controlledReviewWorkers();
      try {
        testing.render(React.createElement(WorkspaceView, fixture.props));
        const queries = testing.within(document.body);
        await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
        testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
        const pending = deferredRead();
        fixture.open.mockImplementationOnce(() => pending.promise);
        await testing.act(async () => { control.workers[0]?.complete(); });
        expect(queries.getByTestId("review-checking")).toBeTruthy();
        expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        testing.fireEvent.change(editor, { target: { value: "Live editing during analysis." } });
        const changed = { ...firstDetail, chapters: firstDetail.chapters.map((chapter) => ({ ...chapter, version: chapter.version + 1, hash: "e".repeat(64) })) };
        await testing.act(async () => {
          if (outcome === "changed") pending.resolve({ ok: true, data: changed });
          else pending.reject(new Error("synthetic first-display read failed"));
        });
        expect(editor.value).toBe("Live editing during analysis.");
        expect(queries.getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        if (outcome === "changed") expect(queries.getByTestId("review-stale").textContent).toContain("The Light");
        else {
          expect(queries.getByTestId("review-unavailable")).toBeTruthy();
          expect(queries.getByTestId("review-retry-freshness")).toBeTruthy();
        }
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  );

  test.each(["same", "different"] as const)("a current %s-chapter occurrence selects its exact saved text", async (target) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control);
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), target === "same" ? 0 : 1));
      await testing.waitFor(() => {
        const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
        expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("Salt and stone");
        expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe(target === "same" ? "The Light" : "The Road");
        expect(queries.queryByTestId("review-report")).toBeNull();
      });
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["resolve", "reject"] as const)("a late reopen %s cannot replace or hide a newer run", async (outcome) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control);
      testing.fireEvent.click(queries.getByTestId("review-close"));
      const pending = deferredRead();
      fixture.open.mockImplementationOnce(() => pending.promise);
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      const revised = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", firstDetail.chapters.map((chapter) => ({
        ...chapter, content: "Fresh bright stars.\n", version: chapter.version + 1, hash: "f".repeat(64)
      })));
      fixture.open.mockImplementationOnce(() => Promise.resolve({ ok: true, data: revised }));
      testing.fireEvent.click(queries.getByTestId("review-run-again"));
      await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
      await testing.act(async () => {
        if (outcome === "resolve") pending.resolve({ ok: true, data: firstDetail });
        else pending.reject(new Error("obsolete synthetic reopen failure"));
      });
      expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
      expect(control.workers[1]?.terminate).not.toHaveBeenCalled();
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      await testing.act(async () => { control.workers[1]?.complete(); });
      expect(queries.getByTestId("review-findings").textContent).toContain("fresh bright stars");
      expect(queries.getByTestId("review-findings").textContent).not.toContain("salt and stone");
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each([
    ["reopen", "close"], ["reopen", "book"], ["reopen", "library"], ["reopen", "book ABA"],
    ["reopen", "chapter"], ["reopen", "unmount"],
    ["navigation", "close"], ["navigation", "book"], ["navigation", "library"], ["navigation", "book ABA"],
    ["navigation", "chapter"], ["navigation", "unmount"]
  ] as const)("obsolete %s reads cannot affect a %s change, even on late failure", async (operation, change) => {
    for (const outcome of ["resolve", "reject"] as const) {
      const fixture = workerWorkspaceFixture();
      const control = controlledReviewWorkers();
      try {
        const { rendered, queries } = await startControlledReport(fixture, control);
        const pending = deferredRead();
        if (operation === "reopen") testing.fireEvent.click(queries.getByTestId("review-close"));
        fixture.open.mockImplementationOnce(() => pending.promise);
        if (operation === "reopen") testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        else testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 1));
        const oldEditor = queries.getByTestId("manuscript-text");
        if (change === "unmount") rendered.unmount();
        else if (change === "close") testing.fireEvent.click(queries.getByTestId("review-close"));
        else if (change === "chapter") {
          rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props,
            chapterRequest: { bookId: INTEGRATION_BOOK, chapterId: "ch_int000002", nonce: 1, revert: false } }));
          await testing.waitFor(() => expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road"));
        } else if (change === "library") {
          rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props, libraryRoot: "/synthetic/other-library" }));
          await testing.waitFor(() => expect(queries.getByTestId("manuscript-text")).not.toBe(oldEditor));
        } else {
          rendered.rerender(React.createElement(WorkspaceView, { ...fixture.props, bookId: INTEGRATION_BOOK_TWO }));
          await testing.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Second Fixture"));
          if (change === "book ABA") {
            rendered.rerender(React.createElement(WorkspaceView, fixture.props));
            await testing.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Integration Fixture"));
          }
        }
        await testing.act(async () => {
          if (outcome === "resolve") pending.resolve({ ok: true, data: firstDetail });
          else pending.reject(new Error("obsolete synthetic read failure"));
        });
        if (change === "unmount" || change === "close" || change === "book" || change === "library" || change === "book ABA") {
          expect(queries.queryByTestId("review-report")).toBeNull();
        }
        if (change === "book") expect(document.querySelector("h1")?.textContent).toBe("Second Fixture");
        if (change === "chapter") expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road");
        if (change === "library" || change === "book ABA") {
          expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Light");
        }
        expect(fixture.props.onNotice).not.toHaveBeenCalled();
        expect(fixture.forbidden).not.toHaveBeenCalled();
      } finally { testing.cleanup(); control.restore(); }
    }
  });

  test.each(["resolve", "reject"] as const)("a superseded navigation %s cannot undo the newer selection", async (outcome) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control);
      const pending = deferredRead();
      fixture.open.mockImplementationOnce(() => pending.promise);
      const buttons = queries.getAllByTestId("review-evidence");
      const before = fixture.open.mock.calls.length;
      testing.fireEvent.click(at(buttons, 0));
      expect(fixture.open.mock.calls.length).toBe(before + 1);
      expect(queries.getByTestId("review-checking")).toBeTruthy();
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 1));
      expect(fixture.open.mock.calls.length).toBe(before + 1);
      // A new explicit visit, rather than a disabled second click, supersedes the pending read.
      testing.fireEvent.click(queries.getByTestId("review-close"));
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-checking"))).toBe(false));
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), 1));
      await testing.waitFor(() => expect(Boolean(queries.queryByTestId("review-report"))).toBe(false));
      await testing.act(async () => {
        if (outcome === "resolve") pending.resolve({ ok: true, data: firstDetail });
        else pending.reject(new Error("obsolete synthetic navigation failure"));
      });
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road");
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("Salt and stone");
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["resolve", "reject"] as const)("a chapter switch completing after a newer reopen invalidates its late %s", async (outcome) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    let finishSave!: (value: unknown) => void;
    const saveResult = new Promise<unknown>((resolve) => { finishSave = resolve; });
    const bridge = window.studio as unknown as {
      chapters: { save: () => Promise<unknown> };
      drafts: { set: () => Promise<unknown>; clear: () => Promise<unknown> };
    };
    bridge.chapters.save = mock(() => saveResult);
    bridge.drafts.set = mock(async () => ({ ok: true, data: null }));
    bridge.drafts.clear = mock(async () => ({ ok: true, data: null }));
    try {
      const { queries } = await startControlledReport(fixture, control);
      testing.fireEvent.click(queries.getByTestId("review-close"));
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      const text = "Saved synthetic edit.";
      testing.fireEvent.change(editor, { target: { value: text } });
      testing.fireEvent.click(at(queries.getAllByTestId("chapter-row"), 1));
      await testing.waitFor(() => expect(bridge.chapters.save).toHaveBeenCalledTimes(1));
      const pending = deferredRead();
      fixture.open.mockImplementationOnce(() => pending.promise);
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      const chapter = { ...at(firstDetail.chapters, 0), content: text, version: 2, hash: "f".repeat(64) };
      await testing.act(async () => { finishSave({ ok: true, data: { status: "saved", chapter } }); });
      await testing.waitFor(() => expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Road"));
      await testing.act(async () => {
        if (outcome === "resolve") pending.resolve({ ok: true, data: { ...firstDetail, chapters: [chapter, at(firstDetail.chapters, 1)] } });
        else pending.reject(new Error("obsolete synthetic reopen failure"));
      });
      expect(queries.queryByTestId("review-stale")).toBeNull();
      expect(fixture.props.onNotice).not.toHaveBeenCalled();
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["same", "different"] as const)("%s-chapter navigation refuses an edit made while the saved read waits", async (target) => {
    const fixture = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      const { queries } = await startControlledReport(fixture, control);
      const pending = deferredRead();
      fixture.open.mockImplementationOnce(() => pending.promise);
      testing.fireEvent.click(at(queries.getAllByTestId("review-evidence"), target === "same" ? 0 : 1));
      const editor = queries.getByTestId("manuscript-text") as HTMLTextAreaElement;
      testing.fireEvent.change(editor, { target: { value: "My unsaved synthetic words." } });
      await testing.act(async () => { pending.resolve({ ok: true, data: firstDetail }); });
      expect((queries.getByTestId("manuscript-text") as HTMLTextAreaElement).value).toBe("My unsaved synthetic words.");
      expect((queries.getByLabelText("Chapter title") as HTMLInputElement).value).toBe("The Light");
      expect(queries.getByTestId("review-report")).toBeTruthy();
      expect(fixture.props.onNotice).toHaveBeenCalledTimes(1);
      expect(fixture.forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test("the actual worker reaches adversarial NFC while Workspace Cancel stays usable and Run again completes", async () => {
    const { props, open, forbidden } = workerWorkspaceFixture();
    const token = `a${"\u0315".repeat(65_536)}${"\u0300".repeat(65_536)}`;
    const adversarial = integrationDetail(INTEGRATION_BOOK, "Integration Fixture", [
      integrationChapter("ch_int000001", "Adversarial", 1, `${token} two three`)
    ]);
    // Load an ordinary editor; only the explicit saved-review read returns the adversarial fixture.
    open.mockImplementationOnce(() => Promise.resolve({ ok: true, data: firstDetail }));
    open.mockImplementationOnce(() => Promise.resolve({ ok: true, data: adversarial }));
    const OriginalWorker = globalThis.Worker;
    let entered = false;
    let finished = false;
    const terminations = mock(() => {});
    class ObservedWorker extends OriginalWorker {
      constructor(_url: string | URL, options?: WorkerOptions) {
        super(new URL("./support/review-normalization.worker.ts", import.meta.url), options);
        this.addEventListener("message", (event: MessageEvent<{ kind: string; units: number }>) => {
          if (!event.data.kind.startsWith("test-native-")) return;
          event.stopImmediatePropagation();
          if (event.data.units === token.length) {
            if (event.data.kind === "test-native-enter") entered = true;
            else finished = true;
          }
        });
      }
      override terminate() { terminations(); super.terminate(); }
    }
    globalThis.Worker = ObservedWorker;
    try {
      testing.render(React.createElement(WorkspaceView, props));
      const queries = testing.within(document.body);
      await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(entered).toBe(true));
      const cancelAt = performance.now();
      testing.fireEvent.click(queries.getByTestId("review-cancel-run"));
      expect(queries.getByTestId("review-status").textContent).toContain("Partial results are discarded");
      expect(performance.now() - cancelAt).toBeLessThan(500);
      expect(finished).toBe(false);
      expect(terminations).toHaveBeenCalledTimes(1);
      expect(queries.queryByTestId("review-run-meta")).toBeNull();
      testing.fireEvent.click(queries.getByTestId("review-run-again"));
      await testing.waitFor(() => expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone"));
      expect(terminations).toHaveBeenCalledTimes(2);
      expect(forbidden).not.toHaveBeenCalled();
      expect(props.onNotice).not.toHaveBeenCalled();
    } finally { testing.cleanup(); globalThis.Worker = OriginalWorker; }
  });

  test("worker failure is visible and Run again uses a fresh worker", async () => {
    const { props, forbidden } = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      testing.render(React.createElement(WorkspaceView, props));
      const queries = testing.within(document.body);
      await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
      const first = control.workers[0];
      if (!first) throw new Error("Expected worker");
      await testing.act(async () => { first.dispatchEvent(new Event("error")); });
      expect(queries.getByTestId("review-status").textContent).toContain("local review worker");
      expect(queries.queryByTestId("review-run-meta")).toBeNull();
      expect(first.terminate).toHaveBeenCalledTimes(1);
      testing.fireEvent.click(queries.getByTestId("review-run-again"));
      await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
      await testing.act(async () => { control.workers[1]?.complete(); });
      expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone");
      expect(forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test("cancel discards an active worker and late output cannot replace the next run", async () => {
    const { props, forbidden } = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      testing.render(React.createElement(WorkspaceView, props));
      const queries = testing.within(document.body);
      await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
      const first = control.workers[0];
      if (!first) throw new Error("Expected active worker");
      testing.fireEvent.click(queries.getByTestId("review-cancel-run"));
      expect(queries.getByTestId("review-status").textContent).toContain("Partial results are discarded");
      expect(first.terminate).toHaveBeenCalledTimes(1);
      testing.fireEvent.click(queries.getByTestId("review-run-again"));
      await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
      await testing.act(async () => { first.complete(); });
      expect(queries.getByTestId("review-cancel-run")).toBeTruthy();
      expect(queries.queryByTestId("review-run-meta")).toBeNull();
      await testing.act(async () => { control.workers[1]?.complete(); });
      expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone");
      expect(control.workers[1]?.terminate).toHaveBeenCalledTimes(1);
      expect(forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test.each(["book", "library", "close", "unmount"] as const)("%s cleanup terminates owned work and ignores late completion", async (change) => {
    const { props, forbidden } = workerWorkspaceFixture();
    const control = controlledReviewWorkers();
    try {
      const rendered = testing.render(React.createElement(WorkspaceView, props));
      const queries = testing.within(document.body);
      await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
      const first = control.workers[0];
      if (!first) throw new Error("Expected active worker");
      if (change === "unmount") rendered.unmount();
      else if (change === "close") testing.fireEvent.click(queries.getAllByRole("button", { name: "Close" })[0] as HTMLElement);
      else rendered.rerender(React.createElement(WorkspaceView, {
        ...props, ...(change === "book" ? { bookId: INTEGRATION_BOOK_TWO } : { libraryRoot: "/synthetic/other-library" })
      }));
      expect(first.terminate).toHaveBeenCalledTimes(1);
      await testing.act(async () => { first.complete(); });
      expect(queries.queryByTestId("review-report")).toBeNull();
      expect(queries.queryByTestId("review-run-meta")).toBeNull();
      if (change !== "unmount") {
        testing.fireEvent.click(queries.getByTestId("review-manuscript"));
        await testing.waitFor(() => expect(control.workers[1]?.request).toBeTruthy());
        await testing.act(async () => { control.workers[1]?.complete(); });
        expect(queries.getByTestId("review-run-meta").textContent).toContain(change === "book" ? "Second Fixture" : "Integration Fixture");
      }
      expect(forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test("a cancelled pending read cannot overwrite a fresh completed report", async () => {
    const { props, open, forbidden } = workerWorkspaceFixture();
    let release!: (result: { ok: true; data: BookDetail }) => void;
    const pending = new Promise<{ ok: true; data: BookDetail }>((resolve) => { release = resolve; });
    open.mockImplementationOnce(() => Promise.resolve({ ok: true, data: firstDetail }));
    open.mockImplementationOnce(() => pending);
    const control = controlledReviewWorkers();
    try {
      testing.render(React.createElement(WorkspaceView, props));
      const queries = testing.within(document.body);
      await testing.waitFor(() => expect(queries.getByTestId("manuscript-editor")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-manuscript"));
      await testing.waitFor(() => expect(queries.getByTestId("review-cancel-run")).toBeTruthy());
      testing.fireEvent.click(queries.getByTestId("review-cancel-run"));
      expect(queries.getByTestId("review-status").textContent).toContain("Partial results are discarded");
      testing.fireEvent.click(queries.getByTestId("review-run-again"));
      await testing.waitFor(() => expect(control.workers[0]?.request).toBeTruthy());
      await testing.act(async () => { control.workers[0]?.complete(); });
      expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone");
      await testing.act(async () => { release({ ok: true, data: secondDetail }); });
      expect(queries.getByTestId("review-findings").textContent).toContain("salt and stone");
      expect(control.workers).toHaveLength(1);
      expect(forbidden).not.toHaveBeenCalled();
    } finally { testing.cleanup(); control.restore(); }
  });

  test("a clean buffer runs the report with no manuscript writes, and switching books discards it", async () => {
    const saves: unknown[] = [];
    const opens: string[] = [];
    const draftWrites = mock(() => Promise.resolve({ ok: true, data: null }));
    const metadataWrites = mock(() => Promise.resolve({ ok: true, data: null }));
    let currentDetail = firstDetail;
    const providerCall = mock(() => { throw new Error("Review must not call a provider"); });
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      platform: "darwin",
      library: { onChange: mock(() => () => {}) },
      books: {
        open: mock((bookId: string) => {
          opens.push(bookId);
          return Promise.resolve({ ok: true, data: bookId === INTEGRATION_BOOK_TWO ? secondDetail : currentDetail });
        })
      },
      conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      images: {
        list: mock(() =>
          Promise.resolve({ ok: true, data: { manifest: { schemaVersion: 1, images: [] }, warning: null } })
        )
      },
      drafts: {
        set: draftWrites,
        clear: draftWrites,
        onFlushRequest: mock(() => () => {})
      },
      recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
      chapters: {
        save: mock((input: unknown) => {
          saves.push(input);
          return Promise.resolve({ ok: true, data: { status: "saved", chapter: firstDetail.chapters[0] } });
        }),
        updateMeta: metadataWrites
      },
      agent: {
        send: providerCall,
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

    // Real scanner output, through the existing Workspace re-read/navigation callback to the editor.
    expect(testing.within(document.body).getByTestId("review-findings").textContent).toContain("salt and stone");
    const evidenceButtons = testing.within(document.body).getAllByTestId("review-evidence");
    const secondEvidence = evidenceButtons[1];
    if (!secondEvidence) throw new Error("Expected the second real occurrence");
    testing.fireEvent.click(secondEvidence);
    await testing.waitFor(() => {
      const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("Salt and stone");
      expect(testing.within(document.body).queryByTestId("review-report")).toBeNull();
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-manuscript"));
    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("review-run-meta")).toBeTruthy());

    // A new run over the same saved chapters replaces the report in place.
    testing.fireEvent.click(testing.within(document.body).getByTestId("review-run-again"));
    await testing.waitFor(
      () => {
        expect(opens.filter((bookId) => bookId === INTEGRATION_BOOK).length).toBeGreaterThan(1);
        expect(testing.within(document.body).getByTestId("review-run-meta")).toBeTruthy();
      },
      { timeout: 2000 }
    );

    // A saved revision changes after the run: clicking a real finding must refuse navigation.
    currentDetail = { ...firstDetail, chapters: firstDetail.chapters.map((chapter) => ({ ...chapter, version: chapter.version + 1, hash: "f".repeat(64) })) };
    const staleEvidence = testing.within(document.body).getAllByTestId("review-evidence")[0];
    if (!staleEvidence) throw new Error("Expected a real finding before source revalidation");
    testing.fireEvent.click(staleEvidence);
    await testing.waitFor(() => expect(testing.within(document.body).getByTestId("review-stale")).toBeTruthy());
    expect(testing.within(document.body).getAllByTestId("review-evidence").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(providerCall).not.toHaveBeenCalled();
    expect(draftWrites).not.toHaveBeenCalled();
    expect(metadataWrites).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();

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
