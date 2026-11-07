import type { HistoryComparison, HistoryListing, HistorySummary, StoredHistoryRecord } from "@ai-book-studio/core/library/history";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent } from "@ai-book-studio/ui/dialog";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HistoryComparisonText, HistoryRecordText } from "./HistoryText";
import type { ChapterHistoryDialogProps, ChapterHistoryState, ChapterHistoryTarget } from "./types";

export type { ChapterHistoryApi, ChapterHistoryDialogProps, ChapterHistoryState, ChapterHistoryTarget } from "./types";

interface Detail {
  mode: "open" | "compare";
  summary: HistorySummary;
  loading: boolean;
  record: StoredHistoryRecord | null;
  comparison: HistoryComparison | null;
  error: string | null;
}

function labelError(value: string): string | null {
  if (!value.trim()) return "Enter a snapshot label.";
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return "Use a single-line label without control characters.";
  if (Array.from(value).length > 200) return "Use at most 200 Unicode characters. Your label has not been shortened.";
  return null;
}

function savedTokenValid(state: ChapterHistoryState): boolean {
  return state.saved !== null && Number.isSafeInteger(state.saved.version) && state.saved.version >= 0 && /^[a-f0-9]{64}$/.test(state.saved.hash);
}

function captureGate(state: ChapterHistoryState): string | null {
  if (state.conflict) return "Resolve the chapter conflict in the editor before keeping a snapshot.";
  if (state.pending) return "Wait for the pending save to finish before keeping a snapshot.";
  if (state.failed) return "Resolve the failed save in the editor before keeping a snapshot.";
  if (state.dirty) return "Save or discard the unsaved draft in the editor before keeping a snapshot.";
  if (!savedTokenValid(state)) return "A confirmed saved version and hash are required to keep a snapshot.";
  return null;
}

function draftDisclosure(state: ChapterHistoryState): string {
  if (state.dirty) return "Your unsaved editor draft is excluded from history and comparisons.";
  if (state.pending) return "A save is pending. Its editor text is excluded from comparisons until confirmed saved.";
  if (state.conflict) return "A conflict is unresolved. Editor drafts and conflict copies are excluded from comparisons.";
  if (state.failed) return "The last save failed. Unsaved editor text is excluded from comparisons.";
  return "No unsaved editor draft is reported. Comparisons use only the confirmed saved text.";
}

function matchesScope(record: StoredHistoryRecord | HistorySummary, target: ChapterHistoryTarget): boolean {
  return record.meta.bookId === target.bookId && record.meta.chapterId === target.chapterId;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The history operation could not be completed. Check access to the library folder.";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A closed dialog has no session. A changed identity gets a fresh session, including A → B → A. */
export function ChapterHistoryDialog(props: ChapterHistoryDialogProps) {
  if (!props.open) return null;
  const { libraryId, bookId, chapterId, viewId } = props.target;
  return <HistorySession key={JSON.stringify([libraryId, bookId, chapterId, viewId])} {...props} />;
}

function HistorySession({ target: suppliedTarget, chapterTitle, state, api, onClose }: ChapterHistoryDialogProps) {
  const [target] = useState(() => ({ ...suppliedTarget }));
  const [closed, setClosed] = useState(false);
  const [listing, setListing] = useState<HistoryListing | null>(null);
  const [listPending, setListPending] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [label, setLabel] = useState("");
  const [capturePending, setCapturePending] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<ChapterHistoryState["saved"]>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const live = useRef(false);
  const generation = useRef(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailMode = useRef<Detail["mode"] | null>(null);
  const capturing = useRef(false);
  const reviewRequired = useRef(false);
  const lastCapturedLabel = useRef<string | null>(null);
  const sourceRevision = useRef(0);
  const latestState = useRef(state);
  const sourceKey = JSON.stringify([state.revision, state.saved?.version, state.saved?.hash, state.dirty, state.pending, state.conflict, state.failed]);
  const previousSource = useRef(sourceKey);
  const labelId = useId();
  const hintId = useId();
  const gateId = useId();
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    latestState.current = state;
    if (previousSource.current === sourceKey) return;
    previousSource.current = sourceKey;
    sourceRevision.current += 1;
    if (detailMode.current === "compare") {
      detailRequest.current += 1;
      setDetail((current) => current?.mode === "compare" ? {
        ...current, loading: false, comparison: null,
        error: "The saved source or editor save state changed. Compare again to review the current saved text."
      } : current);
    }
  }, [sourceKey, state]);

  const refresh = useCallback(async (reviewed: boolean) => {
    if (!live.current) return;
    const request = ++listRequest.current;
    const lifetime = generation.current;
    const current = () => live.current && generation.current === lifetime && listRequest.current === request;
    detailRequest.current += 1;
    detailMode.current = null;
    setDetail(null);
    setListPending(true);
    setListError(null);
    try {
      const result = await api.list(target);
      if (!current()) return;
      // A bad adapter result must not display another chapter's records.
      const records = result.records.filter((record) => matchesScope(record, target));
      const issues = [...result.issues, ...result.records.filter((record) => !matchesScope(record, target)).map((record) => ({
        fileName: record.fileName, code: "identity" as const, message: "This record belongs to another book or chapter and cannot be opened here."
      }))];
      setListing({ records: [...records].sort((a, b) => compareText(b.meta.capturedAt, a.meta.capturedAt) || compareText(a.fileName, b.fileName)), issues });
      if (reviewed) {
        reviewRequired.current = false;
        setNeedsReview(false);
      }
    } catch (error) {
      if (current()) setListError(`History could not be refreshed. ${errorText(error)} Use Refresh history to try again.`);
    } finally {
      if (current()) setListPending(false);
    }
  }, [api.list, target]);

  useEffect(() => { void refresh(false); }, [refresh]);

  useEffect(() => {
    if (detail && !detail.loading) detailHeading.current?.focus();
  }, [detail]);

  async function openRecord(summary: HistorySummary, mode: Detail["mode"]) {
    if (!live.current) return;
    const request = ++detailRequest.current;
    const lifetime = generation.current;
    const revision = sourceRevision.current;
    const source = latestState.current.saved;
    const current = () => live.current && generation.current === lifetime && detailRequest.current === request;
    detailMode.current = mode;
    setDetail({ mode, summary, loading: true, record: null, comparison: null, error: null });
    const input = { bookId: target.bookId, chapterId: target.chapterId, fileName: summary.fileName };
    try {
      const result = mode === "open" ? await api.read(target, input) : await api.compare(target, input);
      if (!current()) return;
      const comparison = mode === "compare" ? result as HistoryComparison : null;
      const record = comparison ? comparison.snapshot : result as StoredHistoryRecord;
      if (!matchesScope(record, target) || record.fileName !== summary.fileName || record.meta.id !== summary.meta.id || record.hash !== summary.hash) {
        throw new Error("The selected history record changed or has a different identity. Refresh history before opening it again.");
      }
      if (comparison && (sourceRevision.current !== revision || !source || comparison.basis !== "saved" ||
        comparison.current.bookId !== target.bookId || comparison.current.chapterId !== target.chapterId ||
        comparison.current.version !== source.version || comparison.current.hash !== source.hash)) {
        throw new Error("The saved source changed or could not be confirmed. Refresh the chapter's saved state in the editor, then compare again.");
      }
      setDetail({ mode, summary, loading: false, record, comparison, error: null });
    } catch (error) {
      if (current()) setDetail({ mode, summary, loading: false, record: null, comparison: null, error: errorText(error) });
    }
  }

  async function capture() {
    const currentState = latestState.current;
    if (!live.current || capturing.current || reviewRequired.current || lastCapturedLabel.current === label || captureGate(currentState) || labelError(label) || !currentState.saved) return;
    const source = { status: "saved" as const, ...currentState.saved };
    const revision = sourceRevision.current;
    const lifetime = generation.current;
    const current = () => live.current && generation.current === lifetime;
    capturing.current = true;
    setCapturePending(true);
    setCaptureSource({ version: source.version, hash: source.hash });
    setCaptureError(null);
    setCaptureStatus(null);
    try {
      const record = await api.capture(target, { bookId: target.bookId, chapterId: target.chapterId, label, source });
      if (!current()) return;
      if (!matchesScope(record, target) || record.meta.kind !== "snapshot" || record.meta.sourceVersion !== source.version || record.meta.sourceHash !== source.hash) {
        throw new Error("The capture response did not confirm the requested saved source. A snapshot may already exist.");
      }
      lastCapturedLabel.current = label;
      setLabel("");
      setCaptureStatus(`Snapshot “${record.meta.label}” kept from saved version ${source.version}.${sourceRevision.current !== revision ? " The editor save state changed while capture was pending; this snapshot represents the requested earlier saved source." : ""}`);
      void refresh(false);
    } catch (error) {
      if (current()) {
        setCaptureError(`Capture could not be confirmed. ${errorText(error)} Review the records with Refresh history before trying again; a complete snapshot may already exist.`);
        reviewRequired.current = true;
        setNeedsReview(true);
      }
    } finally {
      if (current()) {
        capturing.current = false;
        setCapturePending(false);
      }
    }
  }

  function close() {
    live.current = false;
    generation.current += 1;
    setClosed(true);
    onClose();
  }

  const gate = captureGate(state);
  const invalidLabel = labelError(label);
  return (
    <Dialog open={!closed} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent title="Chapter history" description={chapterTitle} className="w-[900px]">
        <div className="space-y-5 text-(length:--text-body-size)">
          <p>History uses saved text only. Browsing and comparing do not save or flush the editor.</p>
          <p role="status">{draftDisclosure(state)}</p>
          {state.saved ? <p className="break-all text-(length:--text-caption-size) text-muted-foreground">Current saved source · version {state.saved.version} · raw file hash {state.saved.hash}</p> : <p>No confirmed current saved source is available. Existing records can still be opened.</p>}
          <form onSubmit={(event) => { event.preventDefault(); void capture(); }} className="space-y-2">
            <label htmlFor={labelId} className="block font-medium">Snapshot label</label>
            <textarea id={labelId} rows={1} value={label} disabled={capturePending} aria-describedby={`${hintId} ${gateId}`} aria-invalid={label.length > 0 && invalidLabel !== null}
              className="w-full rounded-[var(--corner-md)] border border-border bg-background p-2 text-foreground"
              onChange={(event) => { lastCapturedLabel.current = null; setLabel(event.target.value); }} />
            <p id={hintId} className="text-(length:--text-caption-size) text-muted-foreground">{Array.from(label).length} / 200 Unicode characters · Single line, no controls. Outer spaces are trimmed only when captured.</p>
            {label.length > 0 && invalidLabel ? <p role="alert">{invalidLabel}</p> : null}
            <p id={gateId}>{gate ?? "Ready to keep the exact current saved source shown above."}</p>
            <Button type="submit" variant="primary" disabled={capturePending || needsReview || gate !== null || invalidLabel !== null}>Keep snapshot</Button>
          </form>
          <p role="status" aria-live="polite">{capturePending ? "Keeping the requested saved snapshot. Closing this dialog does not cancel a dispatched capture." : captureStatus}</p>
          {captureSource ? <p className="break-all text-(length:--text-caption-size) text-muted-foreground">Capture request source · version {captureSource.version} · raw file hash {captureSource.hash}</p> : null}
          {captureError ? <p role="alert">{captureError}</p> : null}
          <section aria-label="History records" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Saved history</h2>
              <Button variant="secondary" disabled={listPending || capturePending} onClick={() => { void refresh(true); }}>Refresh history</Button>
            </div>
            <p role="status">{listPending ? "Loading history…" : listing ? `${listing.records.length} records · ${listing.records.reduce((sum, item) => sum + item.size, 0)} bytes in available records · ${listing.issues.length} unavailable` : "History has not loaded."}</p>
            {listError ? <p role="alert">{listError}</p> : null}
            {listing?.records.length === 0 && listing.issues.length === 0 ? <p>No saved history yet.</p> : null}
            <ul className="space-y-3">
              {listing?.records.map((summary) => (
                <li key={summary.fileName} className="rounded-[var(--corner-md)] border border-border p-3">
                  <p className="whitespace-pre-wrap font-medium">{summary.meta.label}</p>
                  <p><time dateTime={summary.meta.capturedAt}>{summary.meta.capturedAt}</time> · version {summary.meta.sourceVersion} · {summary.size} bytes · {summary.meta.kind}{summary.meta.kind === "intent" ? ` · ${summary.meta.state}` : ""}</p>
                  <p className="break-all text-(length:--text-caption-size) text-muted-foreground">{summary.fileName}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" aria-pressed={detail?.summary.fileName === summary.fileName && detail.mode === "open"} onClick={() => { void openRecord(summary, "open"); }}>Open record</Button>
                    {summary.meta.kind !== "intent" ? <Button variant="secondary" disabled={!savedTokenValid(state)} aria-pressed={detail?.summary.fileName === summary.fileName && detail.mode === "compare"} onClick={() => { void openRecord(summary, "compare"); }}>Compare saved text</Button> : null}
                  </div>
                </li>
              ))}
              {listing?.issues.map((issue) => <li key={`issue:${issue.fileName}`} className="rounded-[var(--corner-md)] border border-border p-3"><p className="break-all">{issue.fileName} · Unavailable ({issue.code})</p><p>{issue.message}</p><p>The record is kept untouched for recovery.</p></li>)}
            </ul>
          </section>
          {detail ? <section aria-label="Selected history record" className="space-y-2">
            <h2 ref={detailHeading} tabIndex={-1} className="whitespace-pre-wrap font-medium">{detail.mode === "compare" ? "Saved-text comparison" : "Read-only history"} · {detail.summary.meta.label}</h2>
            <p className="break-all text-(length:--text-caption-size) text-muted-foreground">Source version {detail.summary.meta.sourceVersion} · raw file hash {detail.summary.meta.sourceHash}</p>
            {detail.loading ? <p role="status">{detail.mode === "compare" ? "Comparing saved text…" : "Opening record…"}</p> : null}
            {detail.error ? <p role="alert">{detail.error}</p> : null}
            {detail.comparison ? <HistoryComparisonText comparison={detail.comparison} /> : detail.record ? <HistoryRecordText record={detail.record} /> : null}
          </section> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
