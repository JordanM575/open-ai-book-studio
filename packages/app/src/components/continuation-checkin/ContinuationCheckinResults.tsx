import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";
import { formatCount } from "../../lib/utils";
import { reviewActionClass } from "../reader-review/ReviewDisclosure";

/**
 * The counted inputs exactly as the checked campaign record carries them.
 * Every number below is copied from that record; this leaf counts nothing
 * itself and adds no measure the record does not contain.
 */
export function ContinuationCheckinResults({ checkin }: { checkin: ContinuationCheckinInput }) {
  const { counts, segments, checkpoint, reports } = checkin;
  return <section aria-label="Counted check-in inputs" data-testid="continuation-checkin-counts" className="space-y-4 border-t border-[var(--border)] pt-4">
    <p data-testid="continuation-checkin-identity" className="font-semibold">
      Campaign {checkin.campaignId} · Book {checkin.ownerBookId} · Revision {formatCount(checkin.revision)}
    </p>
    <p className="text-muted-foreground">Saved record only · Counts copied from the checked campaign record.</p>
    <div data-testid="continuation-checkin-tallies" className="space-y-2">
      <p>Sources {formatCount(counts.sources)} · Selected spans {formatCount(counts.selectedSpans)} · Stages {formatCount(counts.stages)} · Range stages {formatCount(counts.rangeStages)} · Synthesis stages {formatCount(counts.synthesisStages)} · Dependency edges {formatCount(counts.dependencyEdges)}</p>
      <p>Selected UTF-16 code units {formatCount(counts.selectedUtf16)} · Selected UTF-8 bytes {formatCount(counts.selectedUtf8)} · Resolved plan bytes {formatCount(counts.resolvedPlanBytes)} · Holes {formatCount(counts.holes)}</p>
      <p>Segments {formatCount(segments.count)} · Segment bytes {formatCount(segments.bytes)} · Segment tokens {formatCount(segments.tokens)} · Segments with retained unknown fields {formatCount(segments.unknownBearingSegments)}</p>
    </div>
    {checkpoint === null ? <p data-testid="continuation-checkin-checkpoint-none">No checkpoint is saved for this campaign.</p> : <div data-testid="continuation-checkin-checkpoint" className="space-y-2">
      <p>Checkpoint captured {checkpoint.capturedAt} · Stages {formatCount(checkpoint.stageCount)}</p>
      <p>Receipts · Absent {formatCount(checkpoint.receipts.absent)} · Planned {formatCount(checkpoint.receipts.planned)} · Running {formatCount(checkpoint.receipts.running)} · Completed {formatCount(checkpoint.receipts.completed)} · Incomplete {formatCount(checkpoint.receipts.incomplete)} · Failed {formatCount(checkpoint.receipts.failed)} · Stopped {formatCount(checkpoint.receipts.stopped)}</p>
      <p>Completed stages {checkpoint.completedStageIds.length === 0 ? "None" : checkpoint.completedStageIds.join(" · ")}</p>
    </div>}
    {reports === null ? <p data-testid="continuation-checkin-reports-none">No disposition reports were resolved for this campaign.</p> : <p data-testid="continuation-checkin-reports">
      Reports · Owned {formatCount(reports.owned)} · Foreign {formatCount(reports.foreign)} · Unavailable {formatCount(reports.unavailable)} · Total {formatCount(reports.total)}
    </p>}
    <details>
      <summary className={reviewActionClass}>Inspect saved record digests</summary>
      <div className="space-y-2 pt-2">
        <p className="break-all">Plan digest {checkin.planDigest}</p>
        <p className="break-all">Planned union digest {checkin.plannedUnionDigest}</p>
        <p className="break-all">Manifest hash {checkin.manifestHash}</p>
        <p>Planner {checkin.plannerSemantics}</p>
      </div>
    </details>
    <details>
      <summary className={reviewActionClass}>Inspect retained field names this build keeps without reading</summary>
      <div className="space-y-2 pt-2">
        <p>Manifest fields {checkin.unknownFieldKeys.manifest.length === 0 ? "None" : checkin.unknownFieldKeys.manifest.join(" · ")}</p>
        <p>Saved counts fields {checkin.unknownFieldKeys.counts.length === 0 ? "None" : checkin.unknownFieldKeys.counts.join(" · ")}</p>
        <p>Checkpoint fields {checkin.unknownFieldKeys.checkpoint.length === 0 ? "None" : checkin.unknownFieldKeys.checkpoint.join(" · ")}</p>
      </div>
    </details>
  </section>;
}
