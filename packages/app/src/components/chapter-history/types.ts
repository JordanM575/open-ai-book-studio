import type {
  HistoryCaptureInput,
  HistoryComparison,
  HistoryListing,
  HistoryReadInput,
  HistoryScope,
  StoredHistoryRecord
} from "@ai-book-studio/core/library/history";

export interface ChapterHistoryTarget extends HistoryScope {
  /** Stable identity of the current backing library instance, never a display title. */
  libraryId: string;
  /** Unique host navigation lifetime; returning to the same chapter gets a new value. */
  viewId: string;
}

export interface ChapterHistoryState {
  /** Host generation for every saved/draft/save-state transition, including batched A → B → A. */
  revision: number;
  saved: { version: number; hash: string } | null;
  dirty: boolean;
  pending: boolean;
  conflict: boolean;
  failed: boolean;
}

/** Host adapters validate scope/results and recheck the real save gate. No flush capability. */
export interface ChapterHistoryApi {
  list: (target: ChapterHistoryTarget) => Promise<HistoryListing>;
  read: (target: ChapterHistoryTarget, input: HistoryReadInput) => Promise<StoredHistoryRecord>;
  compare: (target: ChapterHistoryTarget, input: HistoryReadInput) => Promise<HistoryComparison>;
  capture: (target: ChapterHistoryTarget, input: HistoryCaptureInput) => Promise<StoredHistoryRecord>;
}

export interface ChapterHistoryDialogProps {
  open: boolean;
  target: ChapterHistoryTarget;
  chapterTitle: string;
  state: ChapterHistoryState;
  api: ChapterHistoryApi;
  onClose: () => void;
}
