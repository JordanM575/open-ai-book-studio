import { freeze, REVIEW_LIMITS } from "@ai-book-studio/core/review/contract";
import { reviewDisclosure, type CurrentSource, type ReviewEnvelope } from "@ai-book-studio/core/review/envelope";
import { buildReaderRun, type Citation, type ReaderRun } from "@ai-book-studio/core/review/findings";
import type { SavedIdentity } from "@ai-book-studio/core/review/sources";

export type ReviewRefusal = "unavailable" | "scope-too-large" | "consent" | "terms" | "changed";
export type ReviewFailure = "provider" | "overflow" | "malformed" | "refused";
export interface ReviewTerms {
  readonly bookId: string;
  readonly termsRevision: string;
  readonly dataUse: string;
  readonly training: string;
}
export interface PreparedReaderReview {
  readonly envelope: ReviewEnvelope;
  /** Host-resolved text for each book's exact bound terms revision, never an implicit acceptance. */
  readonly terms: readonly ReviewTerms[];
}
export type PreparationOutcome = { kind: "ready"; prepared: PreparedReaderReview } |
  { kind: "blocked"; reason: ReviewRefusal };
export type StartOutcome = { kind: "completed"; run: ReaderRun } |
  { kind: "blocked"; reason: ReviewRefusal } | { kind: "failed"; reason: ReviewFailure };
export interface ReaderReviewProps {
  open: boolean;
  bookId: string;
  /** Changes for every host view lifetime, including returning to the same book. */
  viewKey: string;
  /** Change whenever selection, profile, destination, terms, consent or capability facts change. */
  disclosureRevision: string;
  supported: boolean;
  currentSources: readonly CurrentSource[];
  editor?: { clean: boolean; identity: SavedIdentity };
  /** No provider call or durable write. Resolve only the host's explicitly selected saved scope. */
  onPrepare(input: { bookId: string; signal: AbortSignal; previousRunId: string | null }): Promise<PreparationOutcome>;
  /** Host must revalidate after awaits, consume the request once, and use scoped execution only. */
  onStart(input: { envelope: ReviewEnvelope; signal: AbortSignal }): Promise<StartOutcome>;
  onStop(input: { requestId: string }): Promise<void> | void;
  /** Revalidate exact source AND actual clean editor immediately before selecting; no fuzzy search. */
  onNavigate(input: { run: ReaderRun; citation: Citation; signal: AbortSignal }): Promise<"selected" | "stale" | "unavailable">;
  onClose(): void;
}

export const refusalCopy: Record<ReviewRefusal, string> = {
  unavailable: "The selected source or destination is unavailable. Check your selection and connection, then prepare again.",
  "scope-too-large": "The selected scope is too large. Choose a smaller selection, then prepare again. Nothing was shortened or sent.",
  consent: "Required book consent is missing. Review the book's provider consent, then prepare again.",
  terms: "Applicable data-use or training terms are unavailable. Check the provider terms, then prepare again.",
  changed: "The disclosure changed. Prepare a fresh disclosure and inspect it before starting."
};
export const failureCopy: Record<ReviewFailure, string> = {
  provider: "The provider request failed. The review is incomplete. Prepare a new request to try again; another request may incur cost.",
  overflow: "The provider's context or output limit was exceeded. The review is incomplete. Choose a smaller scope and prepare again.",
  malformed: "The review result could not be validated. The review is incomplete. Prepare a new request to try again.",
  refused: "The provider refused this request. The review is incomplete. Review your scope before preparing a new request."
};

/** Only core-registered envelopes enter disclosure. This does not establish host provenance. */
export function acceptPreparation(value: PreparedReaderReview, bookId: string): PreparedReaderReview {
  const envelope = reviewDisclosure(value.envelope);
  if (envelope.kind !== "reader-review" || !envelope.profile || envelope.books.length !== 1 ||
      envelope.books[0]?.bookId !== bookId || !Array.isArray(value.terms) || value.terms.length !== 1) {
    throw new Error("Invalid reader disclosure");
  }
  const terms = value.terms.map((term) => {
    const book = envelope.books.find((entry) => entry.bookId === term.bookId);
    if (!book || term.termsRevision !== book.termsRevision ||
        typeof term.dataUse !== "string" || !term.dataUse.trim() || term.dataUse.length > 16000 ||
        typeof term.training !== "string" || !term.training.trim() || term.training.length > 16000) {
      throw new Error("Invalid reader terms");
    }
    return { bookId: term.bookId, termsRevision: term.termsRevision, dataUse: term.dataUse, training: term.training };
  });
  return freeze({ envelope, terms });
}

/** Recompute evidence/subjectivity from the core run; never trust display labels or verified flags. */
export async function acceptRun(run: ReaderRun, envelope: ReviewEnvelope): Promise<ReaderRun> {
  if (run.kind !== "reader-review" || reviewDisclosure(run.envelope).scopeDigest !== envelope.scopeDigest ||
      !Array.isArray(run.findings) || run.findings.length > REVIEW_LIMITS.findings) throw new Error("Invalid reader result");
  const findings = run.findings.map((finding) => {
    if (!Array.isArray(finding.evidence) || !Array.isArray(finding.invalidEvidence) ||
        finding.evidence.length + finding.invalidEvidence.length > REVIEW_LIMITS.evidence) throw new Error("Invalid evidence");
    return {
      findingId: finding.findingId, category: finding.category, readerId: finding.readerId,
      readerVersion: finding.readerVersion, runId: finding.runId, interpretation: finding.interpretation,
      claim: finding.claim,
      evidence: [...finding.evidence.map((entry: ReaderRun["findings"][number]["evidence"][number]) => entry.citation), ...finding.invalidEvidence.map(() => null)]
    };
  });
  return buildReaderRun({ runId: run.runId, startedAt: run.startedAt, completedAt: run.completedAt, envelope,
    output: JSON.stringify({ runId: run.runId, readerId: envelope.profile?.id,
      readerVersion: envelope.profile?.version, findings }) });
}
