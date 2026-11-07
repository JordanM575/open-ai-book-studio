import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SidecarRead } from "@ai-book-studio/core/planning/checked-sidecar";
import { SIDECAR_BYTES } from "@ai-book-studio/core/planning/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import type { DraftSaveResult, PlanningDialogProps } from "./contracts";

interface RequestBase {
  bookId: string;
  baselineJson: string | null;
  draft: unknown;
}

export interface DraftDefinition<T, Draft, Request> {
  title: string;
  fromRead: (read: SidecarRead<T>) => Draft;
  validate: (draft: Draft, read: SidecarRead<T>) => string | null;
  request: (draft: Draft, read: SidecarRead<T>) => Request;
  render: (draft: Draft, change: (draft: Draft) => void) => ReactNode;
  preview: (read: SidecarRead<T>) => ReactNode;
}

/** Mounted with a lifetime key by the public leaves. A prop refresh is never a new baseline. */
export function CheckedDraftDialog<T, Draft, Request extends RequestBase>(props: PlanningDialogProps<T, Request> & {
  definition: DraftDefinition<T, Draft, Request>;
  children?: (unconfirmed: boolean, revision: number) => ReactNode;
}) {
  // Pin the initiating callbacks as well as scope: later parent closures cannot redirect an old request.
  const [session] = useState(() => ({ ...props, view: { bookId: props.bookId, viewGeneration: props.viewGeneration } }));
  const [baseline, setBaseline] = useState<SidecarRead<T> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState("");
  const [pending, setPending] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [message, setMessage] = useState("Reading saved data…");
  const [failure, setFailure] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "reload" | null>(null);
  const [preview, setPreview] = useState<SidecarRead<T> | null>(null);
  const [conflictCopy, setConflictCopy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const lifetime = useRef(0);
  const busy = useRef(false);
  const closed = useRef(false);
  const formId = useId();
  const statusId = useId();
  const confirmation = useRef<HTMLFieldSetElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const dirty = draft !== null && JSON.stringify(draft) !== original;

  const acceptRead = useCallback((read: SidecarRead<T>) => {
    if (read.bookId !== session.bookId) throw new Error("The saved data belongs to another book.");
    // Isolate from callback-owned mutable objects while retaining the exact original raw string.
    const retained = structuredClone(read);
    const next = session.definition.fromRead(retained);
    setBaseline(retained);
    setDraft(next);
    setOriginal(JSON.stringify(next));
    setNeedsReload(false);
    setPreview(null);
    setConflictCopy(null);
  }, [session]);

  useEffect(() => {
    const generation = ++lifetime.current;
    busy.current = true;
    setPending(true);
    void (async () => {
      try {
        const read = await session.read(session.bookId);
        if (generation !== lifetime.current || closed.current) return;
        acceptRead(read);
        setMessage("Ready · changes save only when you choose Save changes.");
      } catch (error) {
        if (generation !== lifetime.current || closed.current) return;
        setFailure(true);
        setMessage(`Saved data is unavailable. ${errorText(error)} Try Reload saved data.`);
      } finally {
        if (generation === lifetime.current && !closed.current) {
          busy.current = false;
          setPending(false);
        }
      }
    })();
    return () => { lifetime.current += 1; };
  }, [session, acceptRead]);

  useEffect(() => {
    if (confirm) confirmation.current?.focus();
  }, [confirm]);

  const close = useCallback(() => {
    if (busy.current || closed.current) return;
    closed.current = true;
    lifetime.current += 1;
    session.onClose(session.view);
  }, [session]);
  const requestClose = useCallback(() => {
    if (busy.current || closed.current) return;
    if (dirty || needsReload) setConfirm("close");
    else close();
  }, [dirty, needsReload, close]);

  useEffect(() => {
    session.onSessionState?.(session.view, { dirty, pending, needsReload, requestClose });
  }, [session, dirty, pending, needsReload, requestClose]);

  const keepEditing = () => {
    setConfirm(null);
    form.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  };

  const readAgain = async (inspect: boolean) => {
    if (busy.current || closed.current) return;
    busy.current = true;
    setPending(true);
    const generation = lifetime.current;
    try {
      const read = await session.read(session.bookId);
      if (generation !== lifetime.current || closed.current) return;
      if (read.bookId !== session.bookId) throw new Error("The saved data belongs to another book.");
      if (inspect) {
        setPreview(structuredClone(read));
        // Inspection never changes the baseline, draft, conflict state or retry authority.
      } else {
        acceptRead(read);
        setConfirm(null);
        setFailure(false);
        setMessage("Reloaded saved data · the previous draft was discarded.");
        setRevision((value) => value + 1);
      }
    } catch (error) {
      if (generation !== lifetime.current || closed.current) return;
      setFailure(true);
      setMessage(`Could not read saved data. ${errorText(error)} Your draft and original baseline are still here.`);
    } finally {
      if (generation === lifetime.current && !closed.current) {
        busy.current = false;
        setPending(false);
      }
    }
  };

  const submit = async () => {
    if (busy.current || closed.current || needsReload || !baseline || draft === null || confirm) return;
    const invalid = session.definition.validate(draft, baseline);
    if (invalid) { setFailure(true); setMessage(invalid); return; }
    const request = session.definition.request(draft, baseline);
    const encoder = new TextEncoder();
    if (encoder.encode(request.baselineJson ?? "").byteLength > SIDECAR_BYTES ||
        encoder.encode(JSON.stringify({ bookId: request.bookId, draft: request.draft })).byteLength > SIDECAR_BYTES) {
      setFailure(true);
      setMessage("The baseline or draft exceeds 2,500,000 UTF-8 bytes. Nothing was submitted. Keep your draft and reduce its size.");
      return;
    }
    busy.current = true;
    setPending(true);
    setFailure(false);
    setMessage("Saving… · keep this view open.");
    const generation = lifetime.current;
    let result: DraftSaveResult<T> | undefined;
    try {
      result = await session.save(structuredClone(request));
      if (generation !== lifetime.current || closed.current) return;
      if (result.status === "refused") {
        setFailure(true);
        setMessage(`Not saved. ${result.message} Your draft and original baseline are still here.`);
      } else if (result.status === "conflict") {
        if (result.bookId !== session.bookId) throw new Error("The save reply belongs to another book.");
        setNeedsReload(true);
        setConflictCopy(result.savedAs);
        setFailure(true);
        setMessage(`The saved source changed. Your submitted draft was kept in conflict copy ${result.savedAs}. Your current draft is still here. Review saved data, then explicitly reload or keep editing.`);
      } else {
        acceptRead(result.current);
        setMessage(result.status === "unchanged" ? "Already current · no file was written." : "Saved.");
        setRevision((value) => value + 1);
      }
    } catch (error) {
      if (generation !== lifetime.current || closed.current) return;
      setFailure(true);
      setNeedsReload(true);
      const notKept = typeof error === "object" && error !== null && "outcome" in error && error.outcome === "not-kept";
      setMessage(notKept
        ? "No durable conflict copy was verified. Your draft is still only in this editor. Review saved data before reloading; no retry was made."
        : "The save outcome is uncertain. Your draft and original baseline are still here. Review saved data before reloading; no retry was made.");
      result = undefined;
    } finally {
      if (generation === lifetime.current && !closed.current) {
        busy.current = false;
        setPending(false);
      }
    }
    // Consumer notification is outside the write catch: a UI callback cannot turn Saved into uncertain.
    if (result && result.status !== "refused" && generation === lifetime.current && !closed.current) {
      session.onResult?.(session.view, result);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent title={session.definition.title} description={`Book: ${session.bookTitle}`} aria-busy={pending}
        className="w-[calc(100vw-48px)] max-w-[680px] [&_button]:min-h-11 [&_button]:min-w-11"
        footer={<DialogFooter className="mt-0 flex-wrap">
          <Button variant="ghost" disabled={pending} onClick={requestClose}>Close editor</Button>
          <Button variant="secondary" disabled={pending} onClick={() => {
            if (dirty || needsReload) setConfirm("reload");
            else void readAgain(false);
          }}>Reload saved data</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending || !baseline || needsReload || confirm !== null}>
            {pending ? "Please wait…" : "Save changes"}
          </Button>
        </DialogFooter>}>
        <div className="space-y-4">
          <p id={statusId} role={failure ? "alert" : "status"} className="whitespace-pre-wrap break-words">{message}</p>
          {conflictCopy && <p className="break-words">Submitted draft copy: {conflictCopy}. Later edits stay only in this editor.</p>}
          {needsReload && <>
            <p>Saving is paused until you explicitly reload. Keep editing preserves the original baseline.</p>
            <Button variant="secondary" disabled={pending} onClick={() => void readAgain(true)}>Review saved version</Button>
            <Button variant="ghost" disabled={pending} onClick={keepEditing}>Keep editing</Button>
          </>}
          {preview && <section aria-label="Saved version for comparison" className="space-y-2 rounded-[var(--corner-md)] border border-border p-3">
            <h3>Saved version for comparison</h3>
            <p>This read does not change your draft or baseline. The saved source may change again.</p>
            {session.definition.preview(preview)}
          </section>}
          {confirm && <fieldset ref={confirmation} tabIndex={-1} aria-label="Confirm draft discard" className="space-y-3 rounded-[var(--corner-md)] border border-border p-3">
            <p>{confirm === "close" ? "Discard this draft and close?" : "Discard this draft only after saved data reloads successfully?"}</p>
            {needsReload && <p>Discarding does not undo a save or remove a conflict copy.</p>}
            <Button variant="secondary" disabled={pending} onClick={keepEditing}>Keep editing</Button>
            <Button variant="secondary" disabled={pending} onClick={() => confirm === "close" ? close() : void readAgain(false)}>
              {confirm === "close" ? "Discard draft and close" : "Reload and discard draft"}
            </Button>
          </fieldset>}
          {draft !== null && <form ref={form} id={formId} aria-describedby={statusId} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <fieldset disabled={pending || confirm !== null} className="min-w-0 space-y-4">
              <legend className="mb-3 font-medium">{dirty || needsReload ? "Your draft · not saved" : "Current values"}</legend>
              {session.definition.render(draft, (next) => {
                if (busy.current || closed.current) return;
                setDraft(next);
                if (!needsReload) {
                  setFailure(false);
                  setMessage("Draft not saved. Choose Save changes when you are ready.");
                }
              })}
            </fieldset>
          </form>}
          {props.children?.(dirty || pending || needsReload || failure, revision)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The service could not read this book.";
}

export const planningInputClass = "min-h-11 w-full rounded-[var(--corner-md)] bg-card px-3 py-2 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]";
