import { countWords } from "../markdown";
import type { BookDetail, ChapterReadIssueReason } from "../schema";
import { REPETITION_DEFINITION, scanRepetition, scanRepetitionSteps, type RepetitionAnalysis } from "./repetition";

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
  findings: readonly ReviewFinding[];
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
    source?.status !== "saved" ||
    source.version !== evidence.sourceVersion ||
    source.hash !== evidence.sourceHash
  ) {
    return { status: "unavailable" };
  }
  const saved = current.chapters.find((chapter) => chapter.status === "saved" && chapter.chapterId === evidence.chapterId);
  if (
    saved?.status !== "saved" ||
    !Number.isSafeInteger(evidence.startOffset) || !Number.isSafeInteger(evidence.endOffset) ||
    evidence.startOffset < 0 || evidence.endOffset <= evidence.startOffset || evidence.endOffset > saved.body.length ||
    saved.body.slice(evidence.startOffset, evidence.endOffset) !== evidence.excerpt ||
    splitsSurrogate(saved.body, evidence.startOffset) || splitsSurrogate(saved.body, evidence.endOffset)
  ) return { status: "unavailable" };
  return { status: "ready", evidence };
}

function splitsSurrogate(body: string, offset: number): boolean {
  const before = body.charCodeAt(offset - 1);
  const after = body.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
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

/** Fixed slices never scan forward to whitespace, even for a giant unbroken token. */
const REVIEW_ANALYSIS_SLICE_CHARS = 65_536;

/**
 * Yield only after this many characters so small books analyze with no added latency, while a
 * long book still keeps the run thread responsive and cancellable.
 */
const REVIEW_ANALYSIS_YIELD_EVERY_CHARS = 262_144;

/**
 * Reuse countWords on bounded slices, subtracting the one whitespace token straddling a boundary.
 * Carry the yield budget across chapters so many short chapters cannot starve cancellation.
 */
async function countBodyWordsInSlices(body: string, signal: AbortSignal, budget: { units: number }): Promise<number | null> {
  let total = 0;
  let start = 0;
  while (start < body.length) {
    if (signal.aborted) return null;
    const end = Math.min(start + REVIEW_ANALYSIS_SLICE_CHARS, body.length);
    const slice = body.slice(start, end);
    total += countWords(slice);
    if (start > 0 && !/\s/u.test(body.charAt(start - 1)) && !/\s/u.test(body.charAt(start))) total -= 1;
    budget.units += slice.length;
    start = end;
    if (budget.units >= REVIEW_ANALYSIS_YIELD_EVERY_CHARS) {
      budget.units = 0;
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
  const budget = { units: 0 };
  for (const chapter of source.chapters) {
    if (chapter.status === "skipped") {
      chapters.push({ status: "skipped", fileName: chapter.fileName, order: chapter.order, wordCount: null });
      continue;
    }
    if (signal.aborted) return null;
    const wordCount = await countBodyWordsInSlices(chapter.body, signal, budget);
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
 * Host-neutral cooperative analysis. Yields allow cancellation between scanner steps, but native
 * whole-token normalization is not bounded by a step budget. Interactive callers must use the
 * app's owned worker adapter; this function alone cannot guarantee a responsive UI event loop.
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
  const steps = scanRepetitionSteps(source);
  let step = steps.next();
  while (!step.done) {
    await yieldBetweenReviewSlices();
    if (signal.aborted) return cancelled();
    step = steps.next();
  }
  const verified = repetitionVerifiedSource(source, step.value);
  const wordCounts = await countReviewWordsAsync(verified, signal);
  if (wordCounts === null || signal.aborted) return cancelled();
  return { status: "complete", value: { ...summarizeReviewCoverage(verified, wordCounts), findings: step.value.findings } };
}

/** Analyze every verified saved chapter; malformed Unicode is explicitly skipped, never repaired. */
export function analyzeReviewCoverage(source: ReviewSourceSnapshot): ReviewCoverageAnalysis {
  const repetition = scanRepetition(source);
  const verified = repetitionVerifiedSource(source, repetition);
  return { ...summarizeReviewCoverage(verified, countReviewWords(verified)), findings: repetition.findings };
}

function repetitionVerifiedSource(source: ReviewSourceSnapshot, repetition: RepetitionAnalysis): ReviewSourceSnapshot {
  const rejected = new Set(repetition.rejectedChapterIds);
  return {
    ...source,
    chapters: source.chapters.map((chapter) => chapter.status === "saved" && rejected.has(chapter.chapterId)
      ? { status: "skipped", fileName: `${chapter.title} (${chapter.chapterId})`, order: chapter.order,
          reason: "The saved chapter contains malformed Unicode and could not be analyzed. Nothing was repaired or changed." }
      : chapter)
  };
}

/** Share one classification between the synchronous analysis and the cancellable slices. */
function summarizeReviewCoverage(
  source: ReviewSourceSnapshot,
  wordCounts: ReviewWordCountSummary
): Omit<ReviewCoverageAnalysis, "findings"> {
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

/** The existing public studio word count is independent of repetition tokenization. */
export const STUDIO_WORD_COUNT_DEFINITION: ReviewMetricDefinition = {
  id: "studio-word-count",
  label: "Studio word count",
  definition:
    "Each whitespace-separated token counts as one word, including punctuation-only tokens. Empty or whitespace-only text counts as zero. The book total is the sum of the included chapters."
};

/**
 * Compose a disposable run-local report from a confirmed saved snapshot and its coverage
 * analysis, including the completed scanner output. No synchronous rescan in the renderer.
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
    metricDefinitions: [STUDIO_WORD_COUNT_DEFINITION, REPETITION_DEFINITION],
    findings: analysis.findings
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
