import { useLayoutEffect, useRef, useState } from "react";
import { reviewRecordFailureText, type ReviewRecordApi, type ReviewRecordScope } from "@ai-book-studio/core/library/review-record-api";
import type { ReaderRun } from "@ai-book-studio/core/review/findings";
import { Button } from "@ai-book-studio/ui/button";

export interface ReviewPersistence { api: ReviewRecordApi; scope: ReviewRecordScope }

/** The host binds persistence when the result view opens, never lazily to a different library on Save. */
export function SaveReviewControl({ run, persistence }: { run: ReaderRun; persistence: ReviewPersistence | undefined }) {
  const [message, setMessage] = useState("Volatile review · Save explicitly to retain feedback and quotations with this book.");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false);
  const lifetime = useRef(0);
  const api = persistence?.api;
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
    setMessage("Volatile review · Save explicitly to retain feedback and quotations with this book.");
    return () => { lifetime.current++; };
  }, [run, api, bookId, libraryId, viewId]);
  async function save() {
    if (!persistence || active.current || uncertain) return;
    active.current = true;
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
  return <section aria-label={`Save reader review ${run.runId}`} className="space-y-2">
    <p role={persistence ? "status" : undefined}>{message}</p>
    <p className="text-muted-foreground">Saved feedback and quotations travel with ordinary book files and folder sync.</p>
    {!persistence ? <p>Saving is unavailable until this result is bound to the open library.</p> : null}
    <Button disabled={!persistence || busy || uncertain} onClick={() => void save()}>Save review</Button>
  </section>;
}
