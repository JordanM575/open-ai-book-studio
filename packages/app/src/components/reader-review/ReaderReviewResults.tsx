import { reviewDisclosure, sourceCurrency, type CurrentSource } from "@ai-book-studio/core/review/envelope";
import { compareReaderRuns, reviewCitationNavigation, type Citation, type ReaderRun } from "@ai-book-studio/core/review/findings";
import { Button } from "@ai-book-studio/ui/button";
import type { ReaderReviewProps } from "./contracts";
import { ProfileAttribution, reviewActionClass, reviewTextClass, SelectedScope } from "./ReviewDisclosure";
import { SaveReviewControl, type ReviewPersistence } from "./SaveReviewControl";

export function navigationKey(run: ReaderRun, citation: Citation): string {
  return JSON.stringify([run.runId, citation]);
}

export function navigationState(run: ReaderRun, citation: Citation, currentSources: readonly CurrentSource[], editor: ReaderReviewProps["editor"]) {
  try {
    // Keep editor data uninspected until the core's descriptor-first validation.
    const envelope = reviewDisclosure(run.envelope);
    return reviewCitationNavigation(envelope, citation, currentSources, editor).status;
  } catch { return "unavailable" as const; }
}

export function ReaderReviewResults({ runs, currentSources, editor, navigationBusy, navigationRefusals, onNavigate, persistence }: {
  persistence?: ReviewPersistence | undefined;
  runs: readonly ReaderRun[];
  currentSources: readonly CurrentSource[];
  editor: ReaderReviewProps["editor"];
  navigationBusy: boolean;
  navigationRefusals: ReadonlyMap<string, "stale" | "unavailable">;
  onNavigate(run: ReaderRun, citation: Citation): void;
}) {
  const before = runs.at(-2);
  const after = runs.at(-1);
  const comparison = before && after ? compareReaderRuns(before, after) : null;
  return <section aria-label="Volatile reader results" className="space-y-6">
    {comparison && before && after ? <section aria-label="Latest run comparison" className="space-y-2">
      <h3 className="font-semibold">Compare the latest two runs</h3>
      <p>Run {before.runId} → Run {after.runId}</p>
      <p>Sources: {comparison.sourceChanged ? "Changed" : "Unchanged"} · Profile: {comparison.profileChanged ? "Changed" : "Unchanged"}</p>
      <p>Provider or destination: {comparison.destinationChanged ? "Changed" : "Unchanged"} · Request or feedback: {comparison.promptOrFeedbackChanged ? "Changed" : "Unchanged"}</p>
      <p>Interpretation: {comparison.interpretationChanged ? "Changed" : "Unchanged"}</p>
      <p>{comparison.modelVariation ? "Same-input model variation. " : ""}Changes are not improvement scores.</p>
    </section> : null}
    {runs.map((run) => <article key={run.runId} aria-label={`Reader run ${run.runId}`} className="space-y-4 border-t border-[var(--border)] pt-4">
      <h3 className="font-semibold">Run {run.runId} · {run.envelope.destination.provider} · {run.envelope.destination.model}</h3>
      <p className="text-muted-foreground">Started {run.startedAt} · Completed {run.completedAt}</p>
      {run.envelope.profile ? <ProfileAttribution profile={run.envelope.profile} /> : null}
      <SaveReviewControl run={run} persistence={persistence} />
      <p>Source status: {sourcesCurrent(run, currentSources) ? "Current saved sources" : "Stale or unavailable sources"} · Interpretations are subjective.</p>
      <details><summary className={reviewActionClass}>Inspect this run's historical scope</summary><SelectedScope envelope={run.envelope} /></details>
      {run.findings.length === 0 ? <p>No findings returned. This does not establish that the manuscript has no issues.</p> : null}
      {run.findings.map((finding) => <section key={finding.findingId} aria-label={`${finding.category.replaceAll("-", " ")} finding`} className="space-y-2">
        <h4 className="font-semibold">{finding.category.replaceAll("-", " ")} · Subjective {finding.claim === "contradiction" && finding.evidenceState !== "complete" ? "question" : finding.claim}</h4>
        <p className={reviewTextClass}>{finding.interpretation}</p>
        <p>Evidence: {finding.evidenceState.replaceAll("-", " ")} · {finding.invalidEvidence.length} unverified quotations withheld</p>
        {finding.evidence.map((evidence, index) => {
          const state = navigationRefusals.get(navigationKey(run, evidence.citation)) ?? navigationState(run, evidence.citation, currentSources, editor);
          // biome-ignore lint/suspicious/noArrayIndexKey: An immutable run fixes evidence order for its entire lifetime, including duplicate quotes.
          return <div key={`${finding.findingId}-${index}`} className="space-y-2">
            <blockquote className={reviewTextClass}>{evidence.citation.quote}</blockquote>
            <p className="text-muted-foreground">{evidence.label} · Historical quotation · {state === "ready" ? "Current navigation available" : state === "stale" ? "Stale — navigation disabled" : "Unavailable — navigation disabled"}</p>
            <Button className={reviewActionClass} disabled={navigationBusy || state !== "ready"} onClick={() => onNavigate(run, evidence.citation)}>
              Show exact passage
            </Button>
          </div>;
        })}
      </section>)}
    </article>)}
  </section>;
}

function sourcesCurrent(run: ReaderRun, currentSources: readonly CurrentSource[]): boolean {
  try { return run.envelope.sources.every((source) => sourceCurrency(source, currentSources) === "current"); }
  catch { return false; }
}
