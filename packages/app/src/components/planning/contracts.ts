import type { SidecarRead, SidecarSave } from "@ai-book-studio/core/planning/checked-sidecar";

export interface PlanningView {
  bookId: string;
  /** Change for every library/view lifetime, including reopening the same book. */
  viewGeneration: string | number;
}

/** Only use refused when the host knows no publication was attempted. Unknown throws are uncertain. */
export type DraftSaveResult<T> = SidecarSave<T> | { status: "refused"; message: string };

export interface DraftSessionState {
  dirty: boolean;
  pending: boolean;
  needsReload: boolean;
  /** Route navigation through this action; onClose runs only after any required confirmation. */
  requestClose: () => void;
}

export interface PlanningDialogProps<T, Request> extends PlanningView {
  /** Host navigation must honor onSessionState.requestClose before changing open/scope. */
  open: boolean;
  bookTitle: string;
  read: (bookId: string) => Promise<SidecarRead<T>>;
  save: (request: Request) => Promise<DraftSaveResult<T>>;
  onClose: (view: PlanningView) => void;
  onResult?: (view: PlanningView, result: SidecarSave<T>) => void;
  onSessionState?: (view: PlanningView, state: DraftSessionState) => void;
}

export function viewKey(view: PlanningView): string {
  return JSON.stringify([view.bookId, view.viewGeneration]);
}
