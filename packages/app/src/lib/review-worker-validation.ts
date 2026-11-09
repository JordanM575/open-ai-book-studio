import type { ReviewCoverageAnalysis, ReviewEvidenceSpan, ReviewSourceReference, ReviewSourceSnapshot, SkippedReviewChapter } from "@ai-book-studio/core/review";
import { REPETITION_VERSION } from "@ai-book-studio/core/review/repetition";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const order = (value: unknown): boolean => Number.isSafeInteger(value);
const MALFORMED_UNICODE = "The saved chapter contains malformed Unicode and could not be analyzed. Nothing was repaired or changed.";

export type ReviewFailureCoverageEntry = SkippedReviewChapter & { origin: "source-read" | "worker" };

/** Keep fresh read issues even when the worker fails. Only a validated reply can add worker claims. */
export function reviewFailureCoverage(source: { chapters: readonly ReviewSourceReference[] }, analysis?: ReviewCoverageAnalysis): ReviewFailureCoverageEntry[] {
  return source.chapters.flatMap((chapter, index): ReviewFailureCoverageEntry[] => {
    if (chapter.status === "skipped") return [{ ...chapter, origin: "source-read" }];
    const entry = analysis?.coverage.chapters[index];
    return entry?.status === "skipped" ? [{ ...entry, origin: "worker" }] : [];
  });
}

/** Only metadata is traversed here; occurrence arrays can contain hundreds of thousands of spans. */
export async function validReviewAnalysis(value: unknown, source: ReviewSourceSnapshot, signal: AbortSignal): Promise<boolean> {
  if (!record(value) || !["complete", "partial", "insufficient-evidence", "failed"].includes(String(value.status)) ||
      !record(value.coverage) || !record(value.wordCounts) || !Array.isArray(value.findings)) return false;
  const coverage = value.coverage;
  const words = value.wordCounts;
  if (!count(coverage.inScope) || !count(coverage.included) || !count(coverage.empty) || !count(coverage.skipped) ||
      !Array.isArray(coverage.chapters) || !count(words.totalWordCount) || !Array.isArray(words.chapters) ||
      coverage.inScope !== source.chapters.length || coverage.chapters.length !== coverage.inScope ||
      words.chapters.length !== coverage.inScope) return false;

  let included = 0, empty = 0, skipped = 0, total = 0, budget = 0;
  const yieldIfNeeded = async (): Promise<boolean> => {
    if (++budget >= 256) {
      budget = 0;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return !signal.aborted;
  };
  for (let i = 0; i < coverage.chapters.length; i++) {
    const entry: unknown = coverage.chapters[i];
    const word: unknown = words.chapters[i];
    const chapter = source.chapters[i];
    if (!chapter || !record(entry) || !record(word) || entry.status !== word.status) return false;
    if (entry.status === "skipped") {
      if (!text(entry.fileName) || !text(entry.reason) || !(entry.order === null || order(entry.order)) ||
          word.fileName !== entry.fileName || word.order !== entry.order || word.wordCount !== null) return false;
      // The scanner may reject an originally saved chapter for malformed Unicode. It supplies
      // this exact synthetic location and reason; checking it must not rescan the body on the UI.
      if (chapter.status === "skipped"
        ? entry.fileName !== chapter.fileName || entry.order !== chapter.order || entry.reason !== chapter.reason
        : entry.fileName !== `${chapter.title} (${chapter.chapterId})` || entry.order !== chapter.order || entry.reason !== MALFORMED_UNICODE) return false;
      skipped++;
    } else if (entry.status === "included" || entry.status === "empty") {
      if (!text(entry.chapterId) || !text(entry.title) || !order(entry.order) || !count(entry.wordCount) ||
          word.chapterId !== entry.chapterId || word.title !== entry.title || word.order !== entry.order ||
          word.wordCount !== entry.wordCount || (entry.status === "empty" ? entry.wordCount !== 0 : entry.wordCount === 0)) return false;
      if (chapter.status !== "saved" || entry.chapterId !== chapter.chapterId ||
          entry.title !== chapter.title || entry.order !== chapter.order) return false;
      total += entry.wordCount;
      if (!Number.isSafeInteger(total)) return false;
      if (entry.status === "included") included++; else empty++;
    } else return false;
    if (!(await yieldIfNeeded())) return false;
  }
  if (included !== coverage.included || empty !== coverage.empty || skipped !== coverage.skipped || total !== words.totalWordCount) return false;
  const expectedStatus = coverage.inScope > 0 && included + empty === 0 ? "failed"
    : included === 0 ? "insufficient-evidence" : skipped > 0 ? "partial" : "complete";
  if (value.status !== expectedStatus) return false;
  if (included === 0 && value.findings.length !== 0) return false;

  const ids = new Set<string>();
  for (const [index, finding] of value.findings.entries()) {
    if (!record(finding) || !text(finding.id) || !finding.id || ids.has(finding.id) ||
        finding.id !== `${REPETITION_VERSION}-${index + 1}` || finding.metricId !== REPETITION_VERSION ||
        !text(finding.label) || !finding.label ||
        !Array.isArray(finding.evidence) || finding.evidence.length < 2) return false;
    ids.add(finding.id);
    if (!(await yieldIfNeeded())) return false;
  }
  return !signal.aborted;
}

/** Validate only a visible occurrence; exact saved-text verification still happens on navigation. */
export function validVisibleEvidence(value: unknown): value is ReviewEvidenceSpan {
  return record(value) && text(value.chapterId) && value.chapterId.length > 0 && text(value.title) && order(value.order) &&
    count(value.sourceVersion) && text(value.sourceHash) && value.sourceHash.length > 0 && count(value.startOffset) && count(value.endOffset) &&
    value.endOffset > value.startOffset && text(value.excerpt) && value.excerpt.length === value.endOffset - value.startOffset;
}

/** Narrowed only after the asynchronous metadata check succeeds. */
export function asReviewAnalysis(value: unknown): ReviewCoverageAnalysis {
  return value as ReviewCoverageAnalysis;
}
