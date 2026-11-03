import { countWords } from "../markdown";
import type { BookDetail, ChapterReadIssueReason } from "../schema";

export interface ReviewScope {
  kind: "book";
  bookId: string;
}

export interface ReviewChapterLocation {
  chapterId: string;
  title: string;
  order: number;
}

/** A chapter body and its concurrency identity read from the current saved library. */
export interface SavedReviewChapter extends ReviewChapterLocation {
  status: "saved";
  body: string;
  version: number;
  /** SHA-256 of the exact saved chapter file, lowercase hexadecimal. */
  hash: string;
}

/** A chapter file that could not be read or verified, identified by its library-relative file name. */
export interface SkippedReviewChapter {
  status: "skipped";
  fileName: string;
  order: number | null;
  reason: string;
}

export type ReviewSourceChapter = SavedReviewChapter | SkippedReviewChapter;

/**
 * A run-local view of the chapters in a book, in reading order. Bodies belong only to the input
 * snapshot; report results keep source references but never retain a second manuscript copy.
 */
export interface ReviewSourceSnapshot {
  scope: ReviewScope;
  capturedAt: string;
  chapters: readonly ReviewSourceChapter[];
}

export interface ReviewRunRequest {
  requestedAt: string;
  source: ReviewSourceSnapshot;
}

export type ReviewSourceReference =
  | (ReviewChapterLocation & { status: "saved"; version: number; hash: string })
  | SkippedReviewChapter;

export type ReviewCoverageEntry =
  | (ReviewChapterLocation & { status: "included"; wordCount: number })
  | (ReviewChapterLocation & { status: "empty"; wordCount: 0 })
  | SkippedReviewChapter;

export interface ReviewCoverage {
  inScope: number;
  included: number;
  empty: number;
  skipped: number;
  chapters: readonly ReviewCoverageEntry[];
}

export interface ReviewMetricDefinition {
  id: string;
  label: string;
  definition: string;
}

/** Offsets are half-open UTF-16 code-unit indexes into the saved chapter body. */
export interface ReviewEvidenceSpan extends ReviewChapterLocation {
  sourceVersion: number;
  sourceHash: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
}

export interface ReviewFinding {
  id: string;
  metricId: string;
  label: string;
  evidence: readonly ReviewEvidenceSpan[];
}

export type ReviewWordCountChapter =
  | (ReviewChapterLocation & { status: "included"; wordCount: number })
  | (ReviewChapterLocation & { status: "empty"; wordCount: 0 })
  | (Pick<SkippedReviewChapter, "fileName" | "order"> & { status: "skipped"; wordCount: null });

export interface ReviewWordCountSummary {
  totalWordCount: number;
  chapters: readonly ReviewWordCountChapter[];
}

export type ReviewReportStatus = "complete" | "partial" | "insufficient-evidence";
export type ReviewAnalysisStatus = ReviewReportStatus | "failed";

export interface ReviewCoverageAnalysis {
  status: ReviewAnalysisStatus;
  wordCounts: ReviewWordCountSummary;
  coverage: ReviewCoverage;
}

export interface ReviewReportResult {
  status: ReviewReportStatus;
  scope: ReviewScope;
  requestedAt: string;
  completedAt: string;
  source: {
    capturedAt: string;
    chapters: readonly ReviewSourceReference[];
  };
  wordCounts: ReviewWordCountSummary;
  coverage: ReviewCoverage;
  metricDefinitions: readonly ReviewMetricDefinition[];
  findings: readonly ReviewFinding[];
}

export interface ReviewFailedResult {
  status: "failed";
  scope: ReviewScope;
  requestedAt: string;
  message: string;
  chapterId?: string;
  coverage?: ReviewCoverage;
}

export interface ReviewCancelledResult {
  status: "cancelled";
  scope: ReviewScope;
  requestedAt: string;
}

export type ReviewRunResult = ReviewReportResult | ReviewFailedResult | ReviewCancelledResult;

export type ReviewWorkResult<T> = { status: "complete"; value: T } | ReviewFailedResult | ReviewCancelledResult;

export type ReviewSourceChange =
  | { kind: "scope-changed" }
  | { kind: "added" | "removed" | "changed"; chapterId: string }
  | { kind: "added" | "removed" | "changed"; fileName: string };

export type ReviewReportFreshness =
  | { status: "current" }
  | { status: "stale"; changes: readonly ReviewSourceChange[] };

export type ReviewEvidenceNavigation =
  | { status: "ready"; evidence: ReviewEvidenceSpan }
  | { status: "stale"; changes: readonly ReviewSourceChange[] }
  | { status: "unavailable" };

/** Convert the current public book-read response into the review's saved-source snapshot contract. */
export function reviewSourceSnapshotFromBookDetail(detail: BookDetail, capturedAt: string): ReviewSourceSnapshot {
  const saved: SavedReviewChapter[] = detail.chapters.map((chapter) => ({
    status: "saved",
    chapterId: chapter.id,
    title: chapter.title,
    order: chapter.order,
    body: chapter.content,
    version: chapter.version,
    hash: chapter.hash
  }));
  const skipped: SkippedReviewChapter[] = detail.chapterReadIssues.map((issue) => ({
    status: "skipped",
    fileName: issue.fileName,
    order: issue.order,
    reason: reviewSkipReasonCopy[issue.reason]
  }));
  const chapters: ReviewSourceChapter[] = [...saved, ...skipped].sort(compareReviewSources);

  return {
    scope: { kind: "book", bookId: detail.book.id },
    capturedAt,
    chapters
  };
}

/**
 * Run disposable analysis work. Aborting resolves as cancelled immediately and never returns a
 * value produced after the request, even if work was not able to stop itself yet.
 */
export async function runReviewWork<T>(
  request: ReviewRunRequest,
  signal: AbortSignal,
  work: (request: ReviewRunRequest, signal: AbortSignal) => Promise<T>
): Promise<ReviewWorkResult<T>> {
  const cancelled = (): ReviewCancelledResult => ({
    status: "cancelled",
    scope: request.source.scope,
    requestedAt: request.requestedAt
  });
  if (signal.aborted) return cancelled();

  const aborted = Symbol("review-aborted");
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<typeof aborted>((resolve) => {
    onAbort = () => resolve(aborted);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  type TaskOutcome = { kind: "complete"; value: T } | { kind: "failed" } | typeof aborted;
  const task: Promise<TaskOutcome> = Promise.resolve().then(
    async (): Promise<TaskOutcome> => {
      // Deferred one microtask so a synchronous abort still wins before work starts.
      if (signal.aborted) return aborted;
      try {
        const value = await work(request, signal);
        return { kind: "complete" as const, value };
      } catch {
        return { kind: "failed" as const };
      }
    }
  );

  try {
    const outcome = await Promise.race([task, cancellation]);
    if (outcome === aborted || signal.aborted) return cancelled();
    if (outcome.kind === "failed") {
      return {
        status: "failed",
        scope: request.source.scope,
        requestedAt: request.requestedAt,
        message: "The review could not be completed. Your saved manuscript was not changed."
      };
    }
    return { status: "complete", value: outcome.value };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Compare a finished report's source identities with a newly read saved snapshot. */
export function reviewReportFreshness(
  report: ReviewReportResult,
  current: ReviewSourceSnapshot
): ReviewReportFreshness {
  if (report.scope.bookId !== current.scope.bookId || report.scope.kind !== current.scope.kind) {
    return { status: "stale", changes: [{ kind: "scope-changed" }] };
  }

  const previousByKey = new Map(report.source.chapters.map((chapter) => [reviewSourceKey(chapter), chapter]));
  const currentByKey = new Map(current.chapters.map((chapter) => [reviewSourceKey(chapter), chapter]));
  const changes: ReviewSourceChange[] = [];

  for (const previous of report.source.chapters) {
    const key = reviewSourceKey(previous);
    const latest = currentByKey.get(key);
    if (!latest) {
      changes.push(reviewSourceChange("removed", previous));
    } else if (!sameReviewSource(previous, latest)) {
      changes.push(reviewSourceChange("changed", previous));
    }
  }
  for (const latest of current.chapters) {
    if (!previousByKey.has(reviewSourceKey(latest))) changes.push(reviewSourceChange("added", latest));
  }

  return changes.length === 0 ? { status: "current" } : { status: "stale", changes };
}

/** Return evidence only while the whole report still refers to the current saved source. */
export function revalidateReviewEvidence(
  report: ReviewReportResult,
  current: ReviewSourceSnapshot,
  findingId: string,
  evidenceIndex: number
): ReviewEvidenceNavigation {
  const freshness = reviewReportFreshness(report, current);
  if (freshness.status === "stale") return freshness;

  const evidence = report.findings.find((finding) => finding.id === findingId)?.evidence[evidenceIndex];
  if (!evidence) return { status: "unavailable" };
  const source = report.source.chapters.find(
    (chapter) => chapter.status === "saved" && chapter.chapterId === evidence.chapterId
  );
  if (
    !source ||
    source.status !== "saved" ||
    source.version !== evidence.sourceVersion ||
    source.hash !== evidence.sourceHash
  ) {
    return { status: "unavailable" };
  }
  return { status: "ready", evidence };
}

/** Reuse the studio's whitespace-token counter and sum only bodies verified in the snapshot. */
export function countReviewWords(source: ReviewSourceSnapshot): ReviewWordCountSummary {
  let totalWordCount = 0;
  const chapters = source.chapters.map((chapter): ReviewWordCountChapter => {
    if (chapter.status === "skipped") {
      return {
        status: "skipped",
        fileName: chapter.fileName,
        order: chapter.order,
        wordCount: null
      };
    }

    const wordCount = countWords(chapter.body);
    totalWordCount += wordCount;
    const location = {
      chapterId: chapter.chapterId,
      title: chapter.title,
      order: chapter.order
    };
    return wordCount === 0 ? { ...location, status: "empty", wordCount: 0 } : { ...location, status: "included", wordCount };
  });

  return { totalWordCount, chapters };
}

/**
 * Yield one macrotask so a visible run can paint and a cancel click can land between slices
 * of a long analysis instead of queueing behind a blocked thread.
 */
function yieldBetweenReviewSlices(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Bodies are counted in slices so a long chapter never blocks the run thread. */
const REVIEW_ANALYSIS_SLICE_CHARS = 65_536;

/**
 * Yield only after this many characters so small books analyze with no added latency, while a
 * long book still keeps the run thread responsive and cancellable.
 */
const REVIEW_ANALYSIS_YIELD_EVERY_CHARS = 262_144;

/**
 * Count the words in one body slice by slice. Slice boundaries always fall on whitespace, so
 * summing `countWords` per slice matches the whole-body count exactly.
 */
async function countBodyWordsInSlices(body: string, signal: AbortSignal): Promise<number | null> {
  let total = 0;
  let start = 0;
  let sinceYield = 0;
  while (start < body.length) {
    if (signal.aborted) return null;
    let end = Math.min(start + REVIEW_ANALYSIS_SLICE_CHARS, body.length);
    if (end < body.length) {
      let cursor = end;
      let cursorChar = body.charAt(cursor);
      while (cursor < body.length && cursorChar !== "" && !/\s/u.test(cursorChar)) {
        cursor += 1;
        cursorChar = body.charAt(cursor);
      }
      end = cursor;
    }
    const slice = body.slice(start, end);
    total += countWords(slice);
    sinceYield += slice.length;
    start = end;
    if (sinceYield >= REVIEW_ANALYSIS_YIELD_EVERY_CHARS && start < body.length) {
      sinceYield = 0;
      await yieldBetweenReviewSlices();
    }
  }
  return total;
}

/** Count every saved body without blocking, returning null when the run is cancelled. */
async function countReviewWordsAsync(
  source: ReviewSourceSnapshot,
  signal: AbortSignal
): Promise<ReviewWordCountSummary | null> {
  let totalWordCount = 0;
  const chapters: ReviewWordCountChapter[] = [];
  for (const chapter of source.chapters) {
    if (chapter.status === "skipped") {
      chapters.push({ status: "skipped", fileName: chapter.fileName, order: chapter.order, wordCount: null });
      continue;
    }
    if (signal.aborted) return null;
    const wordCount = await countBodyWordsInSlices(chapter.body, signal);
    if (wordCount === null) return null;
    totalWordCount += wordCount;
    const location = {
      chapterId: chapter.chapterId,
      title: chapter.title,
      order: chapter.order
    };
    chapters.push(wordCount === 0 ? { ...location, status: "empty", wordCount: 0 } : { ...location, status: "included", wordCount });
  }
  return { totalWordCount, chapters };
}

/**
 * Analyze the saved source without blocking the run thread: each slice of chapter text yields,
 * so Cancel stays clickable on long books and an abort discards partial counts instead of
 * completing. Skipped chapters never touch body text, exactly like the synchronous analysis.
 */
export async function analyzeReviewCoverageAsync(
  source: ReviewSourceSnapshot,
  signal: AbortSignal
): Promise<ReviewWorkResult<ReviewCoverageAnalysis>> {
  const cancelled = (): ReviewWorkResult<ReviewCoverageAnalysis> => ({
    status: "cancelled",
    scope: source.scope,
    requestedAt: source.capturedAt
  });
  if (signal.aborted) return cancelled();
  const wordCounts = await countReviewWordsAsync(source, signal);
  if (wordCounts === null || signal.aborted) return cancelled();
  return { status: "complete", value: summarizeReviewCoverage(source, wordCounts) };
}

/** Classify saved-source coverage without implying that an unimplemented metric found nothing. */
export function analyzeReviewCoverage(source: ReviewSourceSnapshot): ReviewCoverageAnalysis {
  const wordCounts = countReviewWords(source);
  return summarizeReviewCoverage(source, wordCounts);
}

/** Share one classification between the synchronous analysis and the cancellable slices. */
function summarizeReviewCoverage(
  source: ReviewSourceSnapshot,
  wordCounts: ReviewWordCountSummary
): ReviewCoverageAnalysis {
  let included = 0;
  let empty = 0;
  let skipped = 0;

  const chapters = source.chapters.map((chapter, index): ReviewCoverageEntry => {
    if (chapter.status === "skipped") {
      skipped += 1;
      return {
        status: "skipped",
        fileName: chapter.fileName,
        order: chapter.order,
        reason: chapter.reason
      };
    }

    const chapterCounts = wordCounts.chapters[index]!;
    if (chapterCounts.status === "skipped") throw new Error("A saved review chapter has no saved word count.");
    if (chapterCounts.status === "empty") {
      empty += 1;
      return {
        chapterId: chapter.chapterId,
        title: chapter.title,
        order: chapter.order,
        status: "empty",
        wordCount: 0
      };
    }

    included += 1;
    return {
      chapterId: chapter.chapterId,
      title: chapter.title,
      order: chapter.order,
      status: "included",
      wordCount: chapterCounts.wordCount
    };
  });

  const coverage: ReviewCoverage = {
    inScope: source.chapters.length,
    included,
    empty,
    skipped,
    chapters
  };
  const savedChapterCount = included + empty;
  const status: ReviewAnalysisStatus =
    source.chapters.length > 0 && savedChapterCount === 0
      ? "failed"
      : included === 0
        ? "insufficient-evidence"
        : skipped > 0
          ? "partial"
          : "complete";

  return { status, wordCounts, coverage };
}

const reviewSkipReasonCopy: Record<ChapterReadIssueReason, string> = {
  "file-missing": "The chapter file was missing when the saved snapshot was read.",
  "permission-needed": "The studio did not have permission to read this chapter file.",
  "invalid-format": "The chapter file could not be read as a valid chapter.",
  unreadable: "The studio could not read this chapter file."
};

function compareReviewSources(a: ReviewSourceChapter, b: ReviewSourceChapter): number {
  const order = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  const aLabel = a.status === "saved" ? a.title : a.fileName;
  const bLabel = b.status === "saved" ? b.title : b.fileName;
  return aLabel.localeCompare(bLabel);
}

function reviewSourceKey(source: ReviewSourceReference | ReviewSourceChapter): string {
  return source.status === "saved" ? `saved:${source.chapterId}` : `skipped:${source.fileName}`;
}

function sameReviewSource(
  a: ReviewSourceReference | ReviewSourceChapter,
  b: ReviewSourceReference | ReviewSourceChapter
): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "saved" && b.status === "saved") {
    return a.title === b.title && a.order === b.order && a.version === b.version && a.hash === b.hash;
  }
  return a.status === "skipped" && b.status === "skipped" && a.order === b.order && a.reason === b.reason;
}

function reviewSourceChange(
  kind: "added" | "removed" | "changed",
  source: ReviewSourceReference | ReviewSourceChapter
): ReviewSourceChange {
  return source.status === "saved" ? { kind, chapterId: source.chapterId } : { kind, fileName: source.fileName };
}

/** The one measure this milestone reports: the existing public studio word count. */
export const STUDIO_WORD_COUNT_DEFINITION: ReviewMetricDefinition = {
  id: "studio-word-count",
  label: "Studio word count",
  definition:
    "Each whitespace-separated token counts as one word, including punctuation-only tokens. Empty or whitespace-only text counts as zero. The book total is the sum of the included chapters."
};

/**
 * Compose a disposable run-local report from a confirmed saved snapshot and its coverage
 * analysis. Findings stay empty: the repeated-phrase signal is deferred by recorded spec 034
 * decision 1, so this milestone reports no phrase matches rather than implying the text
 * was scanned.
 */
export function buildReviewReport(
  source: ReviewSourceSnapshot,
  analysis: ReviewCoverageAnalysis,
  stamps: { requestedAt: string; completedAt: string }
): ReviewReportResult {
  if (analysis.status === "failed") {
    throw new Error("A report needs at least one verified saved chapter.");
  }
  return {
    status: analysis.status,
    scope: source.scope,
    requestedAt: stamps.requestedAt,
    completedAt: stamps.completedAt,
    source: {
      capturedAt: source.capturedAt,
      chapters: source.chapters.map(
        (chapter): ReviewSourceReference =>
          chapter.status === "saved"
            ? {
                status: "saved",
                chapterId: chapter.chapterId,
                title: chapter.title,
                order: chapter.order,
                version: chapter.version,
                hash: chapter.hash
              }
            : { status: "skipped", fileName: chapter.fileName, order: chapter.order, reason: chapter.reason }
      )
    },
    wordCounts: analysis.wordCounts,
    coverage: analysis.coverage,
    metricDefinitions: [STUDIO_WORD_COUNT_DEFINITION],
    findings: []
  };
}

/** Failure result when no saved chapter text could be verified. Nothing was written. */
export function reviewNoSourceResult(
  scope: ReviewScope,
  requestedAt: string,
  coverage?: ReviewCoverage
): ReviewFailedResult {
  return {
    status: "failed",
    scope,
    requestedAt,
    message: "No saved chapter text could be verified. Your manuscript was not changed.",
    ...(coverage ? { coverage } : {})
  };
}
