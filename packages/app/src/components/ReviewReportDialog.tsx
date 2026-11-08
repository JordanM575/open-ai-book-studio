import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  ReviewCoverageEntry,
  ReviewFinding,
  ReviewReportFreshness,
  ReviewReportResult
} from "@ai-book-studio/core/review";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { formatWords, pluralize } from "../lib/utils";
import { validVisibleEvidence } from "../lib/review-worker-validation";

export type ReviewRunView =
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "failed"; message: string }
  | { kind: "report"; report: ReviewReportResult; freshness: ReviewDisplayFreshness };

/** Source identity and individual worker excerpts are distinct checks. */
export type ReviewDisplayFreshness = ReviewReportFreshness
  | { status: "checking"; cancellableRun: boolean }
  | { status: "unavailable"; reason: "read" | "evidence" };

interface Props {
  open: boolean;
  view: ReviewRunView;
  bookTitle: string;
  /** Cancel the in-progress run. Partial results are discarded. */
  onCancelRun: () => void;
  /** Start a new run over the current saved chapters. */
  onRunAgain: () => void;
  onClose: () => void;
  /** Open a finding's evidence span in the manuscript after revalidation. */
  onNavigate: (findingId: string, evidenceIndex: number) => void;
  /** Retry a failed saved-source comparison without rerunning analysis. */
  onRetryFreshness?: () => void;
  /** A malformed visible worker occurrence must fail the report, not crash rendering. */
  onMalformedEvidence?: () => void;
  onOpenChange?: (open: boolean) => void;
}

function coverageRowLabel(entry: ReviewCoverageEntry): string {
  if (entry.status === "included") return formatWords(entry.wordCount);
  if (entry.status === "empty") return "Empty";
  return entry.reason;
}

function coverageRowTitle(entry: ReviewCoverageEntry): string {
  if (entry.status === "skipped") return entry.fileName;
  return `${entry.title} · ${entry.order === null ? "un-ordered" : `Chapter ${entry.order}`}`;
}

function staleChapterLabels(report: ReviewReportResult, freshness: ReviewDisplayFreshness): string[] {
  if (freshness.status !== "stale") return [];
  const titles = new Map<string, string>();
  for (const chapter of report.source.chapters) {
    if (chapter.status === "saved") titles.set(chapter.chapterId, chapter.title);
    else titles.set(chapter.fileName, chapter.fileName);
  }
  return freshness.changes.map((change) => {
    if (change.kind === "scope-changed") return "the book scope";
    const key = "chapterId" in change ? change.chapterId : change.fileName;
    return titles.get(key) ?? key;
  });
}

function StatusCopy({ view }: { view: Extract<ReviewRunView, { kind: "report" }> }): ReactElement | null {
  const { report } = view;
  if (report.status === "insufficient-evidence") {
    return (
      <p role="status" data-testid="review-status" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
        Not enough saved text to review. None of the chapters in scope contain readable saved prose. Add
        text, save, then run the review again.
      </p>
    );
  }
  if (report.status === "partial") {
    return (
      <p role="status" data-testid="review-status" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
        Partial report. {report.coverage.skipped} of {report.coverage.inScope}{" "}
        {pluralize(report.coverage.inScope, "chapter")} could not be read, so that text is not included in
        the counts below.
      </p>
    );
  }
  return null;
}

/**
 * The author-facing manuscript review report (spec 034 T011). Read-only and run-local: the
 * report is held in memory, never written anywhere, and a new run replaces it. Evidence
 * navigation rechecks the saved version and hash before opening a span (T012).
 */
export function ReviewReportDialog({ open, view, bookTitle, onCancelRun, onRunAgain, onClose, onNavigate, onMalformedEvidence, onRetryFreshness, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Manuscript review"
        description="A read-only check of saved chapter text. Nothing was changed."
        data-testid="review-report"
      >
        {view.kind === "running" ? (
          <>
            <p role="status" data-testid="review-status" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              Reading saved chapters…
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onCancelRun} data-testid="review-cancel-run">
                Cancel run
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {view.kind === "stopped" ? (
          <>
            <p role="status" data-testid="review-status" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              The review was stopped. Partial results are discarded and nothing was changed. Run again
              when ready.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} data-testid="review-close">
                Close
              </Button>
              <Button variant="secondary" onClick={onRunAgain} data-testid="review-run-again">
                Run again
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {view.kind === "failed" ? (
          <>
            <p role="status" data-testid="review-status" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              {view.message} Run again when the chapter files are readable.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} data-testid="review-close">
                Close
              </Button>
              <Button variant="secondary" onClick={onRunAgain} data-testid="review-run-again">
                Run again
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {view.kind === "report" ? (
          <ReportBody
            key={`${view.report.scope.bookId}:${view.report.requestedAt}:${view.report.completedAt}`}
            bookTitle={bookTitle}
            report={view.report}
            freshness={view.freshness}
            onNavigate={onNavigate}
            onMalformedEvidence={onMalformedEvidence}
            onRetryFreshness={onRetryFreshness}
            onCancelRun={onCancelRun}
            onRunAgain={onRunAgain}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReportBody({
  bookTitle,
  report,
  freshness,
  onNavigate,
  onMalformedEvidence,
  onRetryFreshness,
  onCancelRun,
  onRunAgain,
  onClose
}: {
  bookTitle: string;
  report: ReviewReportResult;
  freshness: ReviewDisplayFreshness;
  onNavigate: (findingId: string, evidenceIndex: number) => void;
  onMalformedEvidence: Props["onMalformedEvidence"];
  onRetryFreshness: Props["onRetryFreshness"];
  onCancelRun: Props["onCancelRun"];
  onRunAgain: () => void;
  onClose: () => void;
}) {
  const stale = freshness.status === "stale";
  const navigationDisabled = freshness.status !== "current";
  const staleLabels = staleChapterLabels(report, freshness);
  return (
    <>
      <p data-testid="review-run-meta" className="text-(length:--text-caption-size) text-muted-foreground">
        {bookTitle} · Reviewed {report.coverage.inScope} {pluralize(report.coverage.inScope, "chapter")} ·{" "}
        {formatWords(report.wordCounts.totalWordCount)} · {new Date(report.completedAt).toLocaleString()}
      </p>

      {stale ? (
        <div data-testid="review-stale" role="status" className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2">
          <p className="text-(length:--text-subheadline-size) font-medium">This report is stale</p>
          <p className="mt-0.5 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Changed since this run: {staleLabels.join(", ")}. Evidence navigation is disabled until a new
            run reads the current text.
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={onRunAgain} data-testid="review-run-again">
            Run again
          </Button>
        </div>
      ) : null}

      {freshness.status === "checking" ? (
        <div data-testid="review-checking" role="status" className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-(length:--text-subheadline-size)">
          Checking the saved chapters. Evidence cannot be opened until this check finishes.
          {freshness.cancellableRun ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={onCancelRun} data-testid="review-cancel-run">Cancel run</Button>
          ) : null}
        </div>
      ) : null}

      {freshness.status === "unavailable" ? (
        <div data-testid="review-unavailable" role="status" className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-(length:--text-subheadline-size)">
          <p className="font-medium">This report cannot be verified</p>
          <p className="mt-0.5 text-muted-foreground">
            {freshness.reason === "read"
              ? "The saved chapters could not be checked. Evidence navigation is unavailable."
              : "A passage could not be verified against the saved chapters. Run the review again for current results."}
          </p>
          {freshness.reason === "read" && onRetryFreshness ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={onRetryFreshness} data-testid="review-retry-freshness">Retry check</Button>
          ) : null}
        </div>
      ) : null}

      <StatusCopy view={{ kind: "report", report, freshness }} />

      <section aria-label="Coverage" className="mt-4" data-testid="review-coverage">
        <h3 className="text-(length:--text-callout-size) font-semibold">Coverage</h3>
        <p className="mt-2 text-(length:--text-subheadline-size) text-muted-foreground">
          {report.coverage.included} with text · {report.coverage.empty} empty · {report.coverage.skipped} skipped · {report.coverage.inScope} in scope
        </p>
        <ul className="mt-2 space-y-1.5">
          {report.coverage.chapters.map((entry, index) => (
            <li
              key={entry.status === "skipped" ? `skipped-${entry.fileName}` : entry.chapterId}
              data-testid={`review-coverage-row-${index}`}
              className="flex items-baseline justify-between gap-3 text-(length:--text-subheadline-size)"
            >
              <span className="min-w-0 truncate">{coverageRowTitle(entry)}</span>
              <span className="shrink-0 text-muted-foreground">{coverageRowLabel(entry)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Definitions" className="mt-4" data-testid="review-definitions">
        <h3 className="text-(length:--text-callout-size) font-semibold">What was measured</h3>
        <ul className="mt-2 space-y-2">
          {report.metricDefinitions.map((definition) => (
            <li key={definition.id} className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)]">
              <span className="font-medium">{definition.label}. </span>
              <span className="text-muted-foreground">{definition.definition}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Findings" className="mt-4" data-testid="review-findings">
        <h3 className="text-(length:--text-callout-size) font-semibold">Findings</h3>
        {report.findings.length === 0 ? (
          <p className="mt-2 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            {report.status === "insufficient-evidence"
              ? "Not enough saved text for phrase findings."
              : report.status === "partial"
                ? "No repeated three-token sequences in the analyzed chapters. Skipped chapters were not scanned."
                : "No repeated three-token sequences in the saved chapters."}
          </p>
        ) : (
          <PagedFindings findings={report.findings} sources={report.source.chapters} navigationDisabled={navigationDisabled} onNavigate={onNavigate} onMalformedEvidence={onMalformedEvidence} />
        )}
      </section>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} data-testid="review-close">
          Close
        </Button>
        <Button variant="secondary" onClick={onRunAgain} data-testid="review-run-again">
          Run again
        </Button>
      </DialogFooter>
    </>
  );
}

const FINDINGS_PER_PAGE = 5;
const OCCURRENCES_PER_PAGE = 10;

/** View-only slices: every finding and occurrence remains in the completed volatile report. */
function PagedFindings({ findings, sources, navigationDisabled, onNavigate, onMalformedEvidence }: {
  findings: readonly ReviewFinding[];
  sources: ReviewReportResult["source"]["chapters"];
  navigationDisabled: boolean;
  onNavigate: Props["onNavigate"];
  onMalformedEvidence: Props["onMalformedEvidence"];
}) {
  const [page, setPage] = useState(0);
  const totalOccurrences = useMemo(() => findings.reduce((total, finding) => total + finding.evidence.length, 0), [findings]);
  const savedSources = useMemo(() => new Map(sources.flatMap((source) => source.status === "saved" ? [[source.chapterId, source] as const] : [])), [sources]);
  return (
    <>
      <p className="mt-2 text-(length:--text-subheadline-size) text-muted-foreground">
        {findings.length} {pluralize(findings.length, "sequence")} · {totalOccurrences} occurrences, including overlaps. All results are retained; paging changes only this view.
      </p>
      <p className="mt-1 text-(length:--text-caption-size) text-muted-foreground">
        Excerpts are unverified until checked against the saved text when opened.
      </p>
      <ReviewPages label="Sequences" page={page} size={FINDINGS_PER_PAGE} total={findings.length} onPage={setPage} />
      <ul className="mt-2 space-y-3">
        {findings.slice(page * FINDINGS_PER_PAGE, (page + 1) * FINDINGS_PER_PAGE).map((finding) => (
          <FindingOccurrences key={finding.id} finding={finding} sources={savedSources} navigationDisabled={navigationDisabled} onNavigate={onNavigate} onMalformedEvidence={onMalformedEvidence} />
        ))}
      </ul>
    </>
  );
}

function FindingOccurrences({ finding, sources, navigationDisabled, onNavigate, onMalformedEvidence }: {
  finding: ReviewFinding;
  sources: ReadonlyMap<string, Extract<ReviewReportResult["source"]["chapters"][number], { status: "saved" }>>;
  navigationDisabled: boolean;
  onNavigate: Props["onNavigate"];
  onMalformedEvidence: Props["onMalformedEvidence"];
}) {
  const [page, setPage] = useState(0);
  const start = page * OCCURRENCES_PER_PAGE;
  const visible = finding.evidence.slice(start, start + OCCURRENCES_PER_PAGE);
  // Array methods such as some/map skip holes: inspect every index in this bounded page.
  let malformed = false;
  for (let index = 0; index < visible.length; index++) {
    const span = visible[index];
    if (!validVisibleEvidence(span)) { malformed = true; break; }
    const source = sources.get(span.chapterId);
    if (!source || source.title !== span.title || source.order !== span.order ||
        source.version !== span.sourceVersion || source.hash !== span.sourceHash) { malformed = true; break; }
  }
  useEffect(() => {
    if (malformed) onMalformedEvidence?.();
  }, [malformed, onMalformedEvidence]);
  if (malformed) return <li role="status">The local review worker returned an invalid result. Run the review again.</li>;
  return (
    <li data-testid="review-finding">
      <p className="break-words text-(length:--text-subheadline-size) font-medium">{finding.label} · {finding.evidence.length} occurrences</p>
      <ReviewPages label="Occurrences" page={page} size={OCCURRENCES_PER_PAGE} total={finding.evidence.length} onPage={setPage} />
      <ul className="mt-1 space-y-1.5">
        {visible.map((span, index) => (
          <li key={`${span.chapterId}:${span.startOffset}:${span.endOffset}`} className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words text-(length:--text-caption-size) text-muted-foreground">
              Unverified excerpt · Chapter {span.order} · {span.title} · “{span.excerpt}”
            </span>
            <Button variant="ghost" size="sm" disabled={navigationDisabled}
              onClick={() => onNavigate(finding.id, start + index)} data-testid="review-evidence">
              Show in chapter
            </Button>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ReviewPages({ label, page, size, total, onPage }: {
  label: string; page: number; size: number; total: number; onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  const hasNext = (page + 1) * size < total;
  return (
    <fieldset aria-label={`${label} pages`} className="mt-2 flex flex-wrap items-center gap-2">
      {/* Keep the controls mounted and focusable at boundaries; unavailable actions are inert. */}
      <Button variant="ghost" size="sm" aria-disabled={page === 0} onClick={() => { if (page > 0) onPage(page - 1); }}>
        Previous {label.toLowerCase()}
      </Button>
      <span role="status" aria-live="polite" className="text-(length:--text-caption-size) text-muted-foreground">
        {label} {page * size + 1}–{Math.min((page + 1) * size, total)} of {total}
      </span>
      <Button variant="ghost" size="sm" aria-disabled={!hasNext} onClick={() => { if (hasNext) onPage(page + 1); }}>
        Next {label.toLowerCase()}
      </Button>
    </fieldset>
  );
}
