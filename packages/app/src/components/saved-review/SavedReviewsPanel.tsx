import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  reviewRecordFailureText, type ReviewRecordApi, type ReviewRecordScope,
  type SavedDispositions, type SavedReview, type SavedReviewList
} from "@ai-book-studio/core/library/review-record-api";
import { dispositionStateSchema, type DispositionState, type ReviewReport, type ReviewDispositions } from "@ai-book-studio/core/review/record-format";
import type { ReviewInspection, ReviewTrashList } from "@ai-book-studio/core/review/record-recovery";
import { Button } from "@ai-book-studio/ui/button";
import { ProfileAttribution, reviewActionClass, reviewTextClass } from "../reader-review/ReviewDisclosure";

interface Props { bookId: string; libraryKey: string; api: ReviewRecordApi | undefined }
type Draft = { state: DispositionState; note: string; baseline: SavedDispositions | null };
type Inspection = { report: SavedReview; dispositions: SavedDispositions | null; dispositionError: string | null };

/** A new library/book visit owns a fresh lifetime; collapsed content and local drafts stay mounted. */
export function SavedReviewsPanel(props: Props) {
  return <SavedReviewsSession key={JSON.stringify([props.libraryKey, props.bookId])} {...props} />;
}

function SavedReviewsSession({ bookId, api }: Props) {
  const heading = useId();
  const content = useId();
  const [viewId] = useState(() => globalThis.crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ReviewRecordScope | null>(null);
  const [list, setList] = useState<SavedReviewList | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const [message, setMessage] = useState("Opening and filtering saved reviews never writes files.");
  const [busy, setBusy] = useState(false);
  const [blockedDrafts, setBlockedDrafts] = useState<ReadonlySet<string>>(new Set());
  const [trash, setTrash] = useState<ReviewTrashList | null>(null);
  const [trashIssues, setTrashIssues] = useState<ReadonlyMap<string, string>>(new Map());
  const [recovery, setRecovery] = useState<ReviewInspection | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: an API replacement retires its callbacks and bound Library scope
  useLayoutEffect(() => {
    alive.current = true;
    pending.current = false;
    setBusy(false);
    setScope(null);
    setRecoveryReady(false);
    setConfirmed(false);
    setInspection((previous) => previous ? { ...previous, dispositionError: "Inspect this report again on the current host before saving." } : null);
    return () => { alive.current = false; generation.current++; };
  }, [api]);
  const current = (ticket: number) => alive.current && generation.current === ticket;

  async function load(offset = 0, issueOffset = 0) {
    if (pending.current || !api) return;
    const ticket = ++generation.current;
    pending.current = true;
    setBusy(true);
    setMessage("Loading saved reviews…");
    try {
      let bound = scope;
      if (!bound) {
        const opened = await api.open(bookId, viewId);
        if (!current(ticket)) return;
        if (!opened.ok) { setMessage(reviewRecordFailureText(opened.error)); return; }
        bound = opened.data;
        setScope(bound);
      }
      const result = await api.list(bound, offset, issueOffset);
      if (!current(ticket)) return;
      if (result.ok) { setList(result.data); setMessage("Saved review list loaded · Your inspected feedback and local choices are retained."); }
      else setMessage(reviewRecordFailureText(result.error));
    } catch { if (current(ticket)) setMessage("Saved reviews could not be loaded. Your inspected feedback and local choices are retained. Refresh the list when ready."); }
    finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  }

  async function inspect(id: string, hash: string) {
    if (!api || !scope || pending.current) return;
    const ticket = ++generation.current;
    pending.current = true;
    setBusy(true);
    setRecoveryReady(false);
    setConfirmed(false);
    setMessage("Checking the selected saved review…");
    try {
      const result = await api.read(scope, id, hash);
      if (!current(ticket)) return;
      if (!result.ok) { setMessage(reviewRecordFailureText(result.error)); return; }
      // Keep readable feedback even when its separate author-state file is unavailable.
      const report = result.data;
      setInspection((previous) => ({ report, dispositions: previous?.report.hash === hash ? previous.dispositions : null,
        dispositionError: "Loading saved dispositions…" }));
      const dispositions = await api.readDispositions(scope, id, hash);
      if (!current(ticket)) return;
      setInspection((previous) => ({ report, dispositions: dispositions.ok ? dispositions.data : previous?.report.hash === hash ? previous.dispositions : null,
        dispositionError: dispositions.ok ? null : reviewRecordFailureText(dispositions.error) }));
      setMessage("Review opened · Quotations were verified at capture; current manuscript verification is unavailable here.");
    } catch { if (current(ticket)) setMessage("The selected review could not be verified. Your inspected feedback and local choices are retained."); }
    finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  }

  async function saveDisposition(findingId: string, draft: Draft) {
    if (!api || !scope || !inspection || inspection.dispositionError || pending.current) return;
    const key = JSON.stringify([inspection.report.hash, findingId]);
    if (blockedDrafts.has(key)) return;
    const ticket = ++generation.current;
    pending.current = true;
    setBusy(true);
    const { report } = inspection;
    const dispositions = draft.baseline;
    setBlockedDrafts((previous) => new Set(previous).add(key));
    setInspection({ ...inspection, dispositionError: "A save was submitted. Inspect saved history again before confirming another baseline." });
    setRecoveryReady(false);
    try {
      const result = await api.saveDisposition({ scope, id: report.record.id, hash: report.hash, findingId,
        report: { hash: report.hash, rawJson: report.rawJson },
        state: draft.state, note: draft.note, base: dispositions
          ? { kind: "sha256", value: dispositions.hash, revision: dispositions.record.revision, rawJson: dispositions.rawJson } : { kind: "absent" } });
      if (!current(ticket)) return;
      if (result.ok) {
        setInspection({ report, dispositions: result.data.record, dispositionError: null });
        setBlockedDrafts((previous) => { const next = new Set(previous); next.delete(key); return next; });
        setDrafts((previous) => { const next = new Map(previous); if (next.get(key) === draft) next.delete(key); return next; });
        setMessage("Disposition saved · Exact history and note confirmed. Any newer local edits are retained.");
      } else setMessage(reviewRecordFailureText(result.error));
    } catch { if (current(ticket)) setMessage("The disposition save could not be confirmed. Your local choice and note are retained."); }
    finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  }

  async function recover(action: "list" | "active" | "inspect" | "move", groupId?: string, offset = 0) {
    if (!api || !scope || pending.current) return;
    if (action === "move" && (!recovery || !recoveryReady || !confirmed)) return;
    const ticket = ++generation.current;
    pending.current = true;
    setBusy(true);
    setRecoveryReady(false);
    setConfirmed(false);
    try {
      if (action === "list") {
        const result = await api.listTrash(scope, offset);
        if (!current(ticket)) return;
        if (result.ok) { setTrash(result.data); setMessage("Review trash listed · Inspect a group before restoring it."); }
        else setMessage(reviewRecordFailureText(result.error));
      } else if (action === "move" && recovery) {
        const { id, hash, token, groupId: inspectedGroup } = recovery;
        const result = await api.moveGroup(scope, { id, hash, token, groupId: inspectedGroup });
        if (!current(ticket)) return;
        if (result.ok) {
          setMessage(result.data.status === "trashed" ? "Review moved to recoverable trash · Refresh saved reviews or inspect review trash." : "Review restored · Exact inspected files confirmed. Refresh saved reviews to reopen.");
          setInspection((previous) => previous ? { ...previous, dispositionError: "Inspect the active report again before saving dispositions." } : null);
        } else setMessage(reviewRecordFailureText(result.error));
      } else {
        const result = action === "inspect" && groupId ? await api.inspectTrash(scope, groupId)
          : inspection ? await api.inspectGroup(scope, inspection.report.record.id, inspection.report.hash) : null;
        if (!current(ticket) || !result) return;
        if (result.ok) {
          setRecovery(result.data); setRecoveryReady(true); setMessage("Exact recovery contents inspected · Confirm these files before moving them.");
          if (groupId) setTrashIssues((previous) => { const next = new Map(previous); next.delete(groupId); return next; });
        } else {
          const text = reviewRecordFailureText(result.error);
          setMessage(text);
          if (groupId) setTrashIssues((previous) => new Map(previous).set(groupId, text));
        }
      }
    } catch { if (current(ticket)) setMessage("Recovery outcome could not be confirmed. Inspect active reviews and review trash before another action. Your drafts and inspected contents are retained."); }
    finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  }

  function toggle() {
    if (open) { generation.current++; pending.current = false; setBusy(false); setRecoveryReady(false); setConfirmed(false); }
    setOpen(!open);
    if (!open && !list) void load();
  }
  const report = inspection?.report.record;
  const filtered = list?.reports.filter((entry) => `${entry.id} ${entry.profileId} ${entry.completedAt}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return <section aria-labelledby={heading} className="glass mb-4 rounded-[var(--corner-lg)] p-4 text-(length:--text-body-size)">
    <h2 id={heading}><Button variant="ghost" onClick={toggle} aria-expanded={open} aria-controls={content} className={reviewActionClass}>Saved reviews</Button></h2>
    <div id={content} hidden={!open} className="space-y-4">
      <p>Explicitly saved reader feedback · Historical quotations · Local author choices.</p>
      <p className="text-muted-foreground">Structured reader generation is not connected in this workspace yet. Deterministic manuscript indicators are a separate report.</p>
      {!api ? <p role="status">Saved reviews are unavailable on this host. No request was submitted.</p> : <>
        <p role="status" aria-live="polite">{message}</p>
        <Button disabled={busy} onClick={() => void load(list?.offset ?? 0, list?.issueOffset ?? 0)}>Refresh saved reviews</Button>
        <label className="block">Filter this page
          <input className="field mt-1 w-full" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        {list ? <>
          <p>{list.total} saved reviews · {list.issueTotal} unavailable files</p>
          {list.total === 0 ? <p>No readable saved reviews in this book.</p> : null}
          {filtered.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void inspect(entry.id, entry.hash)} aria-label={`Inspect review ${entry.id}`}>Inspect review</Button>
            <span className={reviewTextClass}>{entry.profileId} · Version {entry.profileVersion} · {entry.completedAt} · {entry.findings} findings</span>
          </div>)}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || list.offset === 0} onClick={() => void load(Math.max(0, list.offset - 50), list.issueOffset)}>Previous reviews</Button>
            <Button disabled={busy || list.offset + 50 >= list.total} onClick={() => void load(list.offset + 50, list.issueOffset)}>Next reviews</Button>
          </div>
          {list.issues.length ? <section aria-label="Unavailable review files">
            <h3 className="font-semibold">Unavailable review files</h3>
            <ul className="space-y-2">{list.issues.map((issue) => <li key={issue.fileName} className={reviewTextClass}>{issue.fileName} · {issue.code} · {issue.message}</li>)}</ul>
          </section> : null}
          {list.issueTotal > 50 ? <div className="flex flex-wrap gap-2">
            <Button disabled={busy || list.issueOffset === 0} onClick={() => void load(list.offset, Math.max(0, list.issueOffset - 50))}>Previous unavailable files</Button>
            <Button disabled={busy || list.issueOffset + 50 >= list.issueTotal} onClick={() => void load(list.offset, list.issueOffset + 50)}>Next unavailable files</Button>
          </div> : null}
        </> : null}
      </>}
      {report && inspection ? <article aria-label={`Saved review ${report.id}`} className="space-y-4 border-t border-[var(--border)] pt-4">
        <h3 className="font-semibold">Saved reader review · {report.analyzer.provider} · {report.analyzer.model}</h3>
        <p>Completed {report.run.completedAt} · Saved {report.savedAt} · Report revision {report.revision}</p>
        <ProfileAttribution profile={report.profile} />
        <p>Subjective feedback · Historical quotations verified-at-capture · Not currently verified.</p>
        <details><summary className={reviewActionClass}>Inspect captured source revisions</summary>
          <ul>{report.sources.map((source) => <li key={source.sourceId} className={reviewTextClass}>
            {source.bookTitle} · {source.kind === "chapter" ? `Chapter ${source.position}: ${source.title} · Saved version ${source.version}` : `Story Bible · ${source.label}`} · Captured {source.capturedAt}
          </li>)}</ul>
        </details>
        {inspection.dispositionError ? <p role="status">Saved dispositions unavailable · {inspection.dispositionError}</p> : null}
        <p className="text-muted-foreground">Local choices are unsaved until confirmed. Failed saves retain the exact draft and its inspected baseline. Inspect saved history before explicitly adopting a new baseline.</p>
        {report.findings.map((finding) => {
          const key = JSON.stringify([inspection.report.hash, finding.findingId]);
          const saved = inspection.dispositions?.record.dispositions.find((entry) => entry.findingId === finding.findingId);
          const draft = drafts.get(key) ?? { state: saved?.state ?? "open", note: "", baseline: inspection.dispositions };
          const edit = (next: Draft) => setDrafts((previous) => new Map(previous).set(key, next));
          return <section key={finding.findingId} aria-label={`Saved finding ${finding.findingId}`} className="space-y-2 border-t border-[var(--border)] pt-3">
            <h4 className="font-semibold">{finding.category.replaceAll("-", " ")} · Subjective {finding.claim === "contradiction" && finding.evidenceState !== "complete" ? "question" : finding.claim}</h4>
            <p className={reviewTextClass}>{finding.interpretation}</p>
            <p>{finding.evidenceState.replaceAll("-", " ")} · {finding.invalidEvidence.length} unverified quotations withheld</p>
            {finding.evidence.map((evidence, index) =>
              // biome-ignore lint/suspicious/noArrayIndexKey: The report is immutable and preserves repeated citations in captured order.
              <div key={`${finding.findingId}-${evidence.citation.sourceId}-${index}`}>
              <blockquote className={reviewTextClass}>{evidence.citation.quote}</blockquote>
              <p className={reviewTextClass}>{evidence.label} · Historical quotation · Verified-at-capture</p>
            </div>)}
            <p>Saved disposition: {inspection.dispositionError ? "Unavailable" : saved?.state.replaceAll("-", " ") ?? "No saved choice"} · {drafts.has(key) ? "Local draft retained" : "No local changes"}</p>
            <label className="block">Local disposition for {finding.findingId}
              <select className="field ml-2" value={draft.state} onChange={(event) => edit({ ...draft, state: dispositionStateSchema.parse(event.target.value) })}>
                {dispositionStateSchema.options.map((state) => <option key={state} value={state}>{state.replaceAll("-", " ")}</option>)}
              </select>
            </label>
            <label className="block">Local note for {finding.findingId}
              <textarea className="field mt-1 w-full" value={draft.note} onChange={(event) => edit({ ...draft, note: event.target.value })} />
            </label>
            <Button disabled={busy || !scope || !drafts.has(key) || blockedDrafts.has(key) || !!inspection.dispositionError} onClick={() => void saveDisposition(finding.findingId, draft)}>Save disposition</Button>
            {drafts.has(key) && blockedDrafts.has(key) ? <>
              <p>Another save needs explicit baseline confirmation. Reopen this review and inspect saved history first; a previously saved note must not be submitted again unintentionally.</p>
              <Button disabled={busy || !!inspection.dispositionError} onClick={() => {
                edit({ ...draft, baseline: inspection.dispositions });
                setBlockedDrafts((previous) => { const next = new Set(previous); next.delete(key); return next; });
              }}>Use inspected history for this draft</Button>
            </> : null}
            {saved ? <details><summary className={reviewActionClass}>Inspect saved disposition history</summary>
              <ol>{saved.events.map((event) => <li key={event.sequence} className={reviewTextClass}>{event.at} · {event.to.replaceAll("-", " ")}{event.note === undefined ? "" : ` · ${event.note}`}</li>)}</ol>
            </details> : null}
          </section>;
        })}
      </article> : null}
      <section aria-label="Review recovery" className="space-y-2">
        <h3 className="font-semibold">Review recovery</h3>
        <p>Inspect exact report and disposition contents before confirming a recoverable move. Local unsaved drafts stay in this workspace.</p>
        <Button disabled={busy || !scope || !inspection || !!inspection.dispositionError} onClick={() => void recover("active")}>Move review to trash</Button>{" "}
        <Button disabled={busy || !scope} onClick={() => void recover("list")}>Inspect review trash</Button>
        {trash ? <div>
          <p>{trash.total} review trash groups</p>
          {trash.groups.map((group) => <div key={group.groupId} className={reviewTextClass}>
            <span>{group.groupId} · {group.available ? "Inspection required" : "Unavailable · Kept untouched"}</span>{" "}
            {trashIssues.has(group.groupId) ? <p>Unavailable · {trashIssues.get(group.groupId)}</p> : null}
            <Button disabled={busy || !group.available} onClick={() => void recover("inspect", group.groupId)} aria-label={`Inspect trash group ${group.groupId}`}>Inspect trash group</Button>
          </div>)}
          <Button disabled={busy || trash.offset === 0} onClick={() => void recover("list", undefined, Math.max(0, trash.offset - 50))}>Previous trash groups</Button>{" "}
          <Button disabled={busy || trash.offset + 50 >= trash.total} onClick={() => void recover("list", undefined, trash.offset + 50)}>Next trash groups</Button>
        </div> : null}
        {recovery ? <section aria-label="Inspected recovery contents" className="space-y-2">
          <h4>Review {recovery.id} · {recovery.groupId === null ? "Active files" : `Trash group ${recovery.groupId}`}</h4>
          <p>{recovery.report ? "Report included" : "Report stays active as an exact checked dependency"} · {recovery.dispositions ? "Disposition history included" : "No disposition file"}</p>
          <p>Historical quotations are verified-at-capture, not currently verified.</p>
          <RecoveryContents inspection={recovery} />
          {(["report", "dispositions", "dependencyReport"] as const).map((kind) => recovery[kind] ? <details key={kind}>
            <summary className={reviewActionClass}>Inspect exact {kind === "dependencyReport" ? "active report dependency" : kind} content</summary>
            <pre className="whitespace-pre-wrap break-words">{recovery[kind]?.rawJson}</pre>
          </details> : null)}
          <label className="block"><input type="checkbox" checked={confirmed} disabled={busy || !recoveryReady} onChange={(event) => setConfirmed(event.target.checked)} /> I inspected these exact files and confirm this {recovery.groupId === null ? "move to recoverable trash" : "free-path restore"}.</label>
          <Button disabled={busy || !scope || !confirmed || !recoveryReady} onClick={() => void recover("move")}>{recovery.groupId === null ? "Confirm move to trash" : "Confirm restore review"}</Button>
        </section> : null}
      </section>
    </div>
  </section>;
}

function RecoveryContents({ inspection }: { inspection: ReviewInspection }) {
  const report = JSON.parse((inspection.report ?? inspection.dependencyReport)?.rawJson ?? "null") as ReviewReport | null;
  const dispositions = JSON.parse(inspection.dispositions?.rawJson ?? "null") as ReviewDispositions | null;
  return <div className="space-y-2">
    {report ? <>
      <p>{report.analyzer.provider} · {report.analyzer.model} · Completed {report.run.completedAt}</p>
      <ProfileAttribution profile={report.profile} />
      {report.findings.map((finding) => <div key={finding.findingId} className={reviewTextClass}>
        <p>{finding.findingId} · Subjective {finding.category} · {finding.interpretation}</p>
        {finding.evidence.map((evidence, index) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: immutable captured citation order includes duplicates
          <blockquote key={index}>{evidence.label} · {evidence.citation.quote}</blockquote>)}
      </div>)}
    </> : null}
    {dispositions ? <div>
      <p>Disposition revision {dispositions.revision} · Updated {dispositions.updatedAt}</p>
      {dispositions.dispositions.map((entry) => <section key={entry.findingId} aria-label={`Recovery history ${entry.findingId}`}>
        <h5>{entry.findingId} · {entry.state}</h5>
        <ol>{entry.events.map((event) => <li key={event.sequence} className={reviewTextClass}>{event.at} · {event.to}{event.note === undefined ? "" : ` · ${event.note}`}</li>)}</ol>
      </section>)}
    </div> : null}
  </div>;
}
