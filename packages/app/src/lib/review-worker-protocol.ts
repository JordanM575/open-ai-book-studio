import type { ReviewCoverageAnalysis, ReviewSourceSnapshot } from "@ai-book-studio/core/review";
import type { RepetitionEvidenceCheck } from "@ai-book-studio/core/review/repetition";

/** One disposable worker per run: no source or result is shared with a subsequent run. */
export type ReviewWorkerRequest =
  | { kind: "analyze"; source: ReviewSourceSnapshot }
  | { kind: "verify-evidence"; evidence: RepetitionEvidenceCheck };
export type ReviewWorkerReply =
  | { kind: "ready" }
  | { kind: "complete"; analysis: ReviewCoverageAnalysis }
  | { kind: "verified-evidence"; matches: boolean }
  | { kind: "failed" };
