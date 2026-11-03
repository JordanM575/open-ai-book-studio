import type { ReactElement } from "react";
import type {
  ReviewCoverageEntry,
  ReviewEvidenceSpan,
  ReviewReportFreshness,
  ReviewReportResult
} from "@ai-book-studio/core/review";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { formatWords, pluralize } from "../lib/utils";

export type ReviewRunView =
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "failed"; message: string }
  | { kind: "report"; report: ReviewReportResult; freshness: ReviewReportFreshness };

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

function staleChapterLabels(report: ReviewReportResult, freshness: ReviewReportFreshness): string[] {
  if (freshness.status === "current") return [];
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
      <p role="status" data-testid="review-status" className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
        Not enough saved text to review. None of the chapters in scope contain readable saved prose. Add
        text, save, then run the review again.
      </p>
    );
  }
  if (report.status === "partial") {
    return (
      <p role="status" data-testid="review-status" className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
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
export function ReviewReportDialog({ open, view, bookTitle, onCancelRun, onRunAgain, onClose, onNavigate, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Manuscript review"
        description="A read-only check of saved chapter text. Nothing was changed."
        data-testid="review-report"
      >
        {view.kind === "running" ? (
          <>
            <p role="status" data-testid="review-status" className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
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
            <p role="status" data-testid="review-status" className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
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
            <p role="status" data-testid="review-status" className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
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
            bookTitle={bookTitle}
            report={view.report}
            freshness={view.freshness}
            onNavigate={onNavigate}
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
  onRunAgain,
  onClose
}: {
  bookTitle: string;
  report: ReviewReportResult;
  freshness: ReviewReportFreshness;
  onNavigate: (findingId: string, evidenceIndex: number) => void;
  onRunAgain: () => void;
  onClose: () => void;
}) {
  const stale = freshness.status === "stale";
  const staleLabels = staleChapterLabels(report, freshness);
  return (
    <>
      <p data-testid="review-run-meta" className="text-[var(--text-caption-size)] text-muted-foreground">
        {bookTitle} · Reviewed {report.coverage.inScope} {pluralize(report.coverage.inScope, "chapter")} ·{" "}
        {formatWords(report.wordCounts.totalWordCount)} · {new Date(report.completedAt).toLocaleString()}
      </p>

      {stale ? (
        <div data-testid="review-stale" role="status" className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2">
          <p className="text-[var(--text-subheadline-size)] font-medium">This report is stale</p>
          <p className="mt-0.5 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Changed since this run: {staleLabels.join(", ")}. Evidence navigation is disabled until a new
            run reads the current text.
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={onRunAgain} data-testid="review-run-again">
            Run again
          </Button>
        </div>
      ) : null}

      <StatusCopy view={{ kind: "report", report, freshness }} />

      <section aria-label="Coverage" className="mt-4" data-testid="review-coverage">
        <h3 className="text-[var(--text-callout-size)] font-semibold">Coverage</h3>
        <ul className="mt-2 space-y-1.5">
          {report.coverage.chapters.map((entry, index) => (
            <li
              key={entry.status === "skipped" ? `skipped-${entry.fileName}` : entry.chapterId}
              data-testid={`review-coverage-row-${index}`}
              className="flex items-baseline justify-between gap-3 text-[var(--text-subheadline-size)]"
            >
              <span className="min-w-0 truncate">{coverageRowTitle(entry)}</span>
              <span className="shrink-0 text-muted-foreground">{coverageRowLabel(entry)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Definitions" className="mt-4" data-testid="review-definitions">
        <h3 className="text-[var(--text-callout-size)] font-semibold">What was measured</h3>
        <ul className="mt-2 space-y-2">
          {report.metricDefinitions.map((definition) => (
            <li key={definition.id} className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)]">
              <span className="font-medium">{definition.label}. </span>
              <span className="text-muted-foreground">{definition.definition}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
          Repeated-phrase findings are not in this report. The first report measures saved words and
          coverage only.
        </p>
      </section>

      <section aria-label="Findings" className="mt-4" data-testid="review-findings">
        <h3 className="text-[var(--text-callout-size)] font-semibold">Findings</h3>
        {report.findings.length === 0 ? (
          <p className="mt-2 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            No phrase findings to show.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {report.findings.map((finding) => (
              <li key={finding.id}>
                <p className="text-[var(--text-subheadline-size)] font-medium">{finding.label}</p>
                <ul className="mt-1 space-y-1.5">
                  {finding.evidence.map((span: ReviewEvidenceSpan, evidenceIndex: number) => (
                    <li key={`${finding.id}-${span.sourceHash}-${span.startOffset}-${span.endOffset}`} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={span.excerpt}>
                        {span.title} · “{span.excerpt}”
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={stale}
                        onClick={() => onNavigate(finding.id, evidenceIndex)}
                        data-testid="review-evidence"
                      >
                        Show in chapter
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
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
