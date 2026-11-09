import { useEffect, useRef, useState } from "react";
import { planningValue, type PlanningApi } from "@ai-book-studio/core/library/planning-api";
import { inspectPlanningCopy, type PlanningCopyList, type PlanningCopy } from "@ai-book-studio/core/library/planning-recovery";
import type { Planning } from "@ai-book-studio/core/planning/schema";
import { Button } from "@ai-book-studio/ui/button";

export function PlanningCopies({ api, bookId, revision }: { api: PlanningApi; bookId: string; revision: number }) {
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<PlanningCopyList | null>(null);
  const [copy, setCopy] = useState<PlanningCopy | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a completed save/explicit refresh invalidates the copy listing.
  useEffect(() => {
    const token = ++generation.current;
    setCopy(null);
    setList(null);
    setError(false);
    void planningValue(api.listCopies(bookId, offset)).then((value) => {
      if (token === generation.current) setList(value);
    }, () => { if (token === generation.current) setError(true); });
    return () => { generation.current++; };
  }, [api, bookId, offset, revision]);
  const inspect = async (name: string) => {
    const token = ++generation.current;
    setCopy(null);
    setError(false);
    try {
      const value = await planningValue(api.readCopy(bookId, name));
      if (token === generation.current) setCopy(value);
    } catch { if (token === generation.current) setError(true); }
  };
  const inspected = copy ? inspectPlanningCopy(copy) : null;
  return <details className="space-y-2">
    <summary className="min-h-11 cursor-pointer py-2">Planning recovery copies</summary>
    <p>Copies are retained in this book’s conflicts folder and travel in its archive. Inspect the read-only fields below, then reopen the matching editor and manually enter the values you want to recover against the current saved version. Save changes performs a new checked edit; it never replaces the whole file with a copy.</p>
    {error && <p role="alert">The copy or listing could not be verified. Nothing was changed. Refresh to inspect again.</p>}
    {list?.names.length === 0 && <p>No planning recovery copies on this page.</p>}
    <ul>{list?.names.map((name) => <li key={name}><Button variant="ghost" className="max-w-full break-all whitespace-normal" onClick={() => void inspect(name)}>Inspect {name}</Button></li>)}</ul>
    {offset > 0 && <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - 25))}>Previous copies</Button>}
    {list?.nextOffset != null && <Button variant="ghost" onClick={() => { if (list.nextOffset !== null) setOffset(list.nextOffset); }}>Next copies</Button>}
    {copy && <div className="space-y-2">
      <p className="break-all">Verified copy · {copy.name}</p>
      {inspected?.kind === "goals" && <>
        <p>Copy target: {inspected.data.targetWords ?? "No goal"}</p>
        <p>Reopen Set saved-word goal or Edit saved-word goal to enter this target. Use Clear goal if you want to recover No goal.</p>
      </>}
      {inspected?.kind === "planning" && <PlanningCopyFields data={inspected.data} />}
      <p>The display view below may show CR and CRLF line endings as LF. The exact representation encodes the entire original JSON text as one JSON string; decoding it once recovers the original text, including formatting and line endings.</p>
      <label className="block">Complete read-only copy<textarea readOnly value={copy.rawJson} rows={8} className="w-full font-mono" /></label>
      <label className="block">Complete exact copy · JSON string<textarea readOnly value={JSON.stringify(copy.rawJson)} rows={8} className="w-full font-mono" /></label>
    </div>}
  </details>;
}

function CopyFields({ label, fields }: { label: string; fields: [string, string][] }) {
  return <fieldset className="min-w-0 space-y-2">
    <legend className="font-medium">{label} · read-only</legend>
    <dl className="space-y-2">{fields.map(([name, value]) => <div key={name}>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="whitespace-pre-wrap break-words">{value}</dd>
      <dd><label className="block">{name} · exact JSON string<textarea readOnly value={JSON.stringify(value)} rows={2} className="w-full font-mono" /></label></dd>
    </div>)}</dl>
  </fieldset>;
}

function CopyOrder({ label, order, records }: { label: string; order: string[]; records: { id: string; title: string; archived: boolean }[] }) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return <fieldset className="min-w-0 space-y-2">
    <legend className="font-medium">{label} · read-only</legend>
    {order.length === 0 ? <p>No records in this order.</p> : <ol className="list-inside list-decimal">
      {order.map((id) => { const record = byId.get(id); return <li key={id} className="whitespace-pre-wrap break-words">
        <span>{record?.title}</span> · <span>{id}</span>{record?.archived ? " · Archived" : ""}
      </li>; })}
    </ol>}
  </fieldset>;
}

function PlanningCopyFields({ data }: { data: Planning }) {
  return <div className="space-y-4">
    <p>These are the copy’s decoded values, including line breaks and literal punctuation. For exact re-entry, select Use exact JSON string in the matching editor, then paste the field’s exact JSON string including its quotes. This preserves CR, CRLF and LF without browser line-ending normalization. Match a record by its title and identity before editing the current version. Use its Restore control first if the current record is archived; use the New control if it does not exist. Inspect the complete JSON for any additional fields.</p>
    <section className="space-y-2" aria-label="World details in copy">
      <p>For world details, reopen the matching world detail editor or New world detail.</p>
      {data.worldbuilding.map((record, index) => <CopyFields key={record.id} label={`World detail ${index + 1}`} fields={[
        ["Identity", record.id], ["Status", record.archived ? "Archived" : "Active"], ["Name", record.name],
        ["Category", record.category], ["Description", record.description], ["Notes", record.notes]
      ]} />)}
    </section>
    <section className="space-y-2" aria-label="Timeline events in copy">
      <p>For timeline events, reopen the matching timeline event editor or New timeline event. Use Order timeline to recover the order below against the current records.</p>
      {data.timeline.map((record, index) => <CopyFields key={record.id} label={`Timeline event ${index + 1}`} fields={[
        ["Identity", record.id], ["Status", record.archived ? "Archived" : "Active"], ["Title", record.title],
        ["When · literal label", record.when], ["Description", record.description], ["Notes", record.notes]
      ]} />)}
      <CopyOrder label="Timeline order" order={data.timelineOrder} records={data.timeline} />
    </section>
    <section className="space-y-2" aria-label="Outline beats in copy">
      <p>For outline beats, reopen the matching outline beat editor or New outline beat. Use Order beats to recover the order below against the current records.</p>
      {data.beats.map((record, index) => <CopyFields key={record.id} label={`Outline beat ${index + 1}`} fields={[
        ["Identity", record.id], ["Status", record.archived ? "Archived" : "Active"], ["Title", record.title],
        ["Summary", record.summary], ["Notes", record.notes]
      ]} />)}
      <CopyOrder label="Beat order" order={data.beatOrder} records={data.beats} />
    </section>
    <section className="space-y-2" aria-label="Story notes in copy">
      <p>For working notes, style notes and synopsis, reopen Edit story notes.</p>
      {data.storyNotes ? <CopyFields label="Story notes" fields={[
        ["Identity", data.storyNotes.id], ["Working notes", data.storyNotes.workingNotes],
        ["Style notes", data.storyNotes.styleNotes], ["Synopsis", data.storyNotes.synopsis]
      ]} /> : <p>No story notes are present in this copy.</p>}
    </section>
  </div>;
}
