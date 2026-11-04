import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import type { SaveStatus } from "./ManuscriptEditor";

export type ReviewGateView =
  | { kind: "choice" }
  | { kind: "saving" }
  | { kind: "blocked"; saveStatus: Exclude<SaveStatus, { kind: "saved" }> };

interface Props {
  open: boolean;
  view: ReviewGateView;
  /** Save the open chapter through the normal save path, then continue. */
  onSave: () => void;
  /** Leave pending text untouched and close. */
  onCancel: () => void;
  /** Dismiss after a blocked or ready outcome. */
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
}

function blockedCopy(saveStatus: Exclude<SaveStatus, { kind: "saved" }>): { title: string; body: string } {
  switch (saveStatus.kind) {
    case "conflict":
      return {
        title: "The chapter could not be saved",
        body:
          saveStatus.conflict.reason === "placeholder"
            ? "The file on disk could not be read. It may still be downloading, so your text was kept as a separate copy. Resolve the conflict, then try the review again."
            : saveStatus.conflict.reason === "external-edit"
              ? "The file changed on disk while you were writing, so your text was kept as a separate copy. Resolve the conflict, then try the review again."
              : "A newer version of this chapter exists on disk, so your text was kept as a separate copy. Resolve the conflict, then try the review again."
      };
    case "error":
      return { title: "The chapter could not be saved", body: saveStatus.message };
    case "saving":
      return {
        title: "The chapter is still saving",
        body: "Wait a moment for the save to finish, then try the review again."
      };
    case "dirty":
      return {
        title: "There are still unsaved changes",
        body: "The save did not confirm, so the review cannot start. Try saving again."
      };
  }
}

/**
 * The explicit save gate for a manuscript review (spec 034 T006). The review reads only saved
 * chapter text, so a dirty buffer must go through the normal save path or the author cancels.
 * A conflict or failure blocks the run and never resolves the save silently.
 */
export function ReviewGateDialog({ open, view, onSave, onCancel, onClose, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Review the saved manuscript"
        description="The review reads only saved chapter text. Anything you have not saved is not included."
        data-testid="review-dialog"
      >
        {view.kind === "choice" ? (
          <>
            <p className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              You have unsaved changes in this chapter. Save them first, or keep writing and review later.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onCancel} data-testid="review-cancel">
                Keep writing
              </Button>
              <Button variant="primary" onClick={onSave} data-testid="review-save">
                Save and continue
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {view.kind === "saving" ? (
          <p
            className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground"
            role="status"
            data-testid="review-status"
          >
            Saving your changes…
          </p>
        ) : null}

        {view.kind === "blocked" ? (
          <>
            <p className="text-(length:--text-callout-size) font-semibold">{blockedCopy(view.saveStatus).title}</p>
            <p
              className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground"
              role="status"
              data-testid="review-status"
            >
              {blockedCopy(view.saveStatus).body}
            </p>
            {view.saveStatus.kind === "conflict" ? (
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={view.saveStatus.conflict.savedAs}>
                {view.saveStatus.conflict.savedAs}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} data-testid="review-close">
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}

      </DialogContent>
    </Dialog>
  );
}
