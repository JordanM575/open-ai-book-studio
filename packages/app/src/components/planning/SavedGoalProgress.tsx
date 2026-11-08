import { useEffect, useState } from "react";
import type { GoalProgress } from "@ai-book-studio/core/organization/goals";
import { Button } from "@ai-book-studio/ui/button";
import { viewKey, type PlanningView } from "./contracts";

export type ManuscriptSaveState = "clean" | "dirty" | "pending" | "failed" | "conflict";
export interface SavedGoalProgressProps extends PlanningView {
  /** Must count a complete verified saved source; never adapt BookSummary or editor text. */
  readProgress: (bookId: string) => Promise<GoalProgress>;
  /** Change when an observed saved source/target changes. Invalidates the previous count immediately. */
  sourceGeneration: string | number;
  manuscriptState: ManuscriptSaveState;
  unconfirmedGoal?: boolean;
}

export function SavedGoalProgress(props: SavedGoalProgressProps) {
  return <ProgressSession key={`${viewKey(props)}:${JSON.stringify(props.sourceGeneration)}`} {...props} />;
}

function ProgressSession(props: SavedGoalProgressProps) {
  const [request, setRequest] = useState(() => ({ bookId: props.bookId, read: props.readProgress }));
  const [progress, setProgress] = useState<GoalProgress | null>(null);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let active = true;
    setPending(true);
    void (async () => {
      let next: GoalProgress;
      try {
        next = await request.read(request.bookId);
        if (next.bookId !== request.bookId) throw new Error("Foreign progress");
      } catch { next = { status: "unavailable", bookId: request.bookId, reason: "unreadable" }; }
      if (active) { setProgress(next); setPending(false); }
    })();
    return () => { active = false; };
  }, [request]);

  const lastConfirmed = props.manuscriptState !== "clean" || props.unconfirmedGoal || pending;
  return <section aria-label="Saved-word progress" className="space-y-2 rounded-[var(--corner-md)] border border-border p-3">
    <h3 className="font-medium">Saved-word progress</h3>
    <div role="status">
      {!progress && <p>Checking saved progress…</p>}
      {progress?.status === "complete" && <>
        <p>{lastConfirmed ? "Last confirmed saved" : "Saved"}: {progress.savedWords.toLocaleString("en-US")} words
          {progress.targetWords === null ? " · no saved goal" : ` · target ${progress.targetWords.toLocaleString("en-US")} · ${progress.remaining?.toLocaleString("en-US")} remaining`}</p>
        {progress.targetWords !== null && <progress aria-label="Saved words toward saved goal" max={progress.targetWords} value={Math.min(progress.savedWords, progress.targetWords)} className="w-full" />}
      </>}
      {progress?.status === "incomplete" && <p>Saved progress is incomplete · {progress.unreadableChapters} unreadable chapters. No whole-book total is confirmed.</p>}
      {progress?.status === "unavailable" && <p>Saved progress is unavailable · {progress.reason === "changed" ? "the saved source changed during the check" : "the saved source could not be verified"}.</p>}
      {lastConfirmed && <p>Unsaved or unconfirmed changes are not counted as saved progress.</p>}
    </div>
    <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => setRequest({ ...request })}>Refresh saved progress</Button>
  </section>;
}
