import type { Goal, GoalSaveRequest, GoalProgress } from "@ai-book-studio/core/organization/goals";
import { CheckedDraftDialog, planningInputClass, type DraftDefinition } from "./CheckedDraftDialog";
import { SavedGoalProgress, type ManuscriptSaveState } from "./SavedGoalProgress";
import { viewKey, type PlanningDialogProps } from "./contracts";
import { Button } from "@ai-book-studio/ui/button";
export type { DraftSaveResult, DraftSessionState, PlanningView } from "./contracts";

export interface GoalDialogProps extends PlanningDialogProps<Goal, GoalSaveRequest> {
  readProgress: (bookId: string) => Promise<GoalProgress>;
  sourceGeneration: string | number;
  manuscriptState: ManuscriptSaveState;
}

const definition: DraftDefinition<Goal, string, GoalSaveRequest> = {
  title: "Saved-word goal",
  fromRead: (read) => {
    if (read.data && read.data.bookId !== read.bookId) throw new Error("The goal belongs to another book.");
    return read.data?.targetWords?.toString() ?? "";
  },
  validate: (draft) => draft === "" || (/^[0-9]+$/.test(draft) && Number.isSafeInteger(Number(draft)) && Number(draft) > 0)
    ? null : "Enter a positive whole number no greater than 9,007,199,254,740,991, or choose Clear goal. Your draft has not been submitted.",
  request: (draft, read) => ({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson,
    draft: { kind: "set-goal", targetWords: draft === "" ? null : Number(draft) } }),
  render: (draft, change) => <>
    <label className="block space-y-1.5"><span>Total saved-word target</span>
      <input className={planningInputClass} inputMode="numeric" value={draft} onChange={(event) => change(event.target.value)} />
    </label>
    <p>{draft === "" ? "No target in this draft. Save changes to clear the saved goal." : "This is a total-book target, not a daily quota. Save changes to apply it."}</p>
    <Button variant="secondary" type="button" onClick={() => change("")}>Clear goal</Button>
  </>,
  preview: (read) => <p>{read.data?.targetWords == null ? "No saved goal." : `Saved target: ${read.data.targetWords.toLocaleString("en-US")} words.`}</p>
};

export function GoalDialog(props: GoalDialogProps) {
  if (!props.open) return null;
  return <CheckedDraftDialog key={viewKey(props)} {...props} definition={definition}>
    {(unconfirmed, revision) => <SavedGoalProgress bookId={props.bookId} viewGeneration={props.viewGeneration}
      readProgress={props.readProgress} manuscriptState={props.manuscriptState} unconfirmedGoal={unconfirmed}
      sourceGeneration={JSON.stringify([props.sourceGeneration, revision])} />}
  </CheckedDraftDialog>;
}
