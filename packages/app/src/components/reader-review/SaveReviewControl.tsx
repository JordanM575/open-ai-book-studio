import { useLayoutEffect, useRef, useState } from "react";
import { reviewRecordFailureText, type ReviewRecordApi, type ReviewRecordScope, type SavedReview } from "@ai-book-studio/core/library/review-record-api";
import type { ReaderRun } from "@ai-book-studio/core/review/findings";
import { Button } from "@ai-book-studio/ui/button";

export interface ReviewPersistence { api: ReviewRecordApi; scope: ReviewRecordScope }

/** The host binds persistence when the result view opens, never lazily to a different library on Save. */
export function SaveReviewControl({ run, persistence }: { run: ReaderRun; persistence: ReviewPersistence | undefined }) {
  const [message, setMessage] = useState("Volatile review · Save explicitly to retain feedback and quotations with this book.");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [inspected, setInspected] = useState<{ report: SavedReview | null } | null>(null);
  const active = useRef(false);
  const lifetime = useRef(0);
  const bookId = persistence?.scope.bookId;
  const libraryId = persistence?.scope.libraryId;
  const viewId = persistence?.scope.viewId;
  // These scalar identities retire prior replies even if the host reconstructs the wrapper object.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each identity is an intentional lifetime trigger
  useLayoutEffect(() => {
    lifetime.current++;
    active.current = false;
    setBusy(false);
    setUncertain(false);
    setInspected(null);
    setMessage("Volatile review · Save explicitly to retain feedback and quotations with this book.");
    return () => { lifetime.current++; };
  }, [run.runId, bookId, libraryId, viewId]);
  async function save() {
    if (!persistence || active.current || uncertain) return;
    active.current = true;
    setInspected(null);
    setBusy(true);
    const ticket = lifetime.current;
    try {
      const result = await persistence.api.save(persistence.scope, run);
      if (lifetime.current !== ticket) return;
      if (result.ok) setMessage(result.data.status === "unchanged" ? "Review already saved · Exact existing report confirmed." : "Review saved · Historical quotations verified-at-capture, not currently verified.");
      else { setMessage(reviewRecordFailureText(result.error)); setUncertain(result.error.outcome === "uncertain"); }
    } catch {
      if (lifetime.current === ticket) { setMessage("Save outcome uncertain · Keep this review and inspect Saved reviews before another save."); setUncertain(true); }
    } finally {
      if (lifetime.current === ticket) { active.current = false; setBusy(false); }
    }
  }
  async function inspect() {
    if (!persistence || active.current || !uncertain) return;
    active.current = true;
    setBusy(true);
    setInspected(null);
    const ticket = lifetime.current;
    try {
      // Scan bounded pages on the same bound view; a list alone never claims a durable copy.
      for (let offset = 0; offset < 1000; offset += 50) {
        const listed = await persistence.api.list(persistence.scope, offset);
        if (lifetime.current !== ticket) return;
        if (!listed.ok) { setMessage(reviewRecordFailureText(listed.error)); return; }
        const entry = listed.data.reports.find((item) => item.id === run.runId);
        if (entry) {
          const read = await persistence.api.read(persistence.scope, entry.id, entry.hash);
          if (lifetime.current !== ticket) return;
          if (!read.ok) { setMessage(reviewRecordFailureText(read.error)); return; }
          setInspected({ report: read.data });
          setMessage("Saved review inspected · Compare it with this volatile result before deciding whether to save again.");
          return;
        }
        if (offset + listed.data.reports.length >= listed.data.total) {
          if (listed.data.issueTotal) { setMessage("Some saved review files are unavailable. Inspect them and the conflicts folder before another save."); return; }
          setInspected({ report: null });
          setMessage("No readable matching report was listed. Files may change during inspection; check the conflicts folder too.");
          return;
        }
      }
      setMessage("The list is too large to inspect here. Check saved reviews and conflicts before another save.");
    } catch {
      if (lifetime.current === ticket) setMessage("Inspection could not be confirmed. Keep this review and try inspection again.");
    } finally {
      if (lifetime.current === ticket) { active.current = false; setBusy(false); }
    }
  }
  return <section aria-label={`Save reader review ${run.runId}`} className="space-y-2">
    <p role={persistence ? "status" : undefined}>{message}</p>
    <p className="text-muted-foreground">Saved feedback and quotations travel with ordinary book files and folder sync.</p>
    {!persistence ? <p>Saving is unavailable until this result is bound to the open library.</p> : null}
    <Button disabled={!persistence || busy || uncertain} onClick={() => void save()}>Save review</Button>
    {uncertain ? <div className="space-y-2">
      <p>Inspect the current saved review and conflicts before deciding whether to submit again. Your volatile result stays here.</p>
      <Button disabled={!persistence || busy} onClick={() => void inspect()}>Inspect saved review for this run</Button>
      {inspected ? <div>
        {inspected.report ? <details><summary>Inspect exact saved review</summary>
          <p>Saved {inspected.report.record.savedAt} · Historical quotations verified-at-capture, not currently verified.</p>
          <pre className="whitespace-pre-wrap break-words">{inspected.report.rawJson}</pre>
        </details> : <p>No readable matching report was listed; this does not prove that no copy exists.</p>}
        <Button disabled={busy} onClick={() => { setUncertain(false); setInspected(null); setMessage("Inspection acknowledged · Save again only if you intend another submission."); }}>I inspected the saved state · Allow another save</Button>
      </div> : null}
    </div> : null}
  </section>;
}
