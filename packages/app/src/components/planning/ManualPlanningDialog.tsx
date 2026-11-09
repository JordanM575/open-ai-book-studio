import { useId } from "react";
import type { Planning } from "@ai-book-studio/core/planning/schema";
import { planningSaveSchema, type PlanningDraft, type PlanningSaveRequest } from "@ai-book-studio/core/planning/service";
import type { SidecarRead } from "@ai-book-studio/core/planning/checked-sidecar";
import { Button } from "@ai-book-studio/ui/button";
import { CheckedDraftDialog, type DraftDefinition } from "./CheckedDraftDialog";
import { PlanningTextField, textFields, parseTextFields, type PlanningText, type TextFields } from "./PlanningTextField";
import { viewKey, type PlanningDialogProps } from "./contracts";

export type ManualEditor =
  | { kind: "timeline"; recordId?: string }
  | { kind: "beat"; recordId?: string }
  | { kind: "notes" }
  | { kind: "order-timeline" }
  | { kind: "order-beats" }
  | { kind: "archive-worldbuilding" | "archive-timeline" | "archive-beat"; recordId: string; archived: boolean };
type EditingIntent<T> = T extends { fields: infer F extends Record<string, string> }
  ? Omit<T, "fields"> & { fields: TextFields<F> } : T;
type Draft = { intent: EditingIntent<PlanningDraft>; confirmed: boolean; labels: Record<string, string>; record: unknown };
const emptyNotes = { workingNotes: "", styleNotes: "", synopsis: "" };
const labels: Record<string, string> = { title: "Title", when: "When · literal label", description: "Description", notes: "Notes",
  summary: "Summary", workingNotes: "Working notes", styleNotes: "Style notes", synopsis: "Synopsis" };

export function ManualPlanningDialog(props: PlanningDialogProps<Planning, PlanningSaveRequest> & { editor: ManualEditor }) {
  if (!props.open) return null;
  return <CheckedDraftDialog key={viewKey(props)} {...props} definition={definition(props.editor)} />;
}

function definition(editor: ManualEditor): DraftDefinition<Planning, Draft, PlanningSaveRequest> {
  // Learned only from a checked creation result; Reload must never turn creation into a second create.
  let savedId = "recordId" in editor ? editor.recordId : undefined;
  const fromRead = (read: SidecarRead<Planning>): Draft => {
    const data = read.data;
    let intent: PlanningDraft;
    let record: unknown = null;
    const titles: Record<string, string> = {};
    if (editor.kind === "timeline") {
      const found = data?.timeline.find((item) => item.id === savedId);
      if (savedId && (!found || found.archived)) throw new Error("This event is missing or archived. Restore it before editing.");
      const fields = found ? { title: found.title, when: found.when, description: found.description, notes: found.notes }
        : { title: "", when: "", description: "", notes: "" };
      intent = savedId ? { kind: "edit-timeline", id: savedId, fields } : { kind: "create-timeline", fields };
    } else if (editor.kind === "beat") {
      const found = data?.beats.find((item) => item.id === savedId);
      if (savedId && (!found || found.archived)) throw new Error("This beat is missing or archived. Restore it before editing.");
      const fields = found ? { title: found.title, summary: found.summary, notes: found.notes } : { title: "", summary: "", notes: "" };
      intent = savedId ? { kind: "edit-beat", id: savedId, fields } : { kind: "create-beat", fields };
    } else if (editor.kind === "notes") {
      const notes = data?.storyNotes;
      intent = { kind: "set-story-notes", fields: notes ? { workingNotes: notes.workingNotes, styleNotes: notes.styleNotes, synopsis: notes.synopsis } : emptyNotes };
    } else if (editor.kind === "order-timeline" || editor.kind === "order-beats") {
      const timeline = editor.kind === "order-timeline";
      for (const item of (timeline ? data?.timeline : data?.beats) ?? []) titles[item.id] = `${item.title}${timeline && item.when ? ` · ${String(item.when)}` : ""}${item.archived ? " · archived" : ""}`;
      intent = { kind: editor.kind, ids: [...((timeline ? data?.timelineOrder : data?.beatOrder) ?? [])] };
    } else {
      const list = editor.kind === "archive-worldbuilding" ? data?.worldbuilding : editor.kind === "archive-timeline" ? data?.timeline : data?.beats;
      record = list?.find((item) => item.id === editor.recordId);
      if (!record) throw new Error("This retained record is unavailable. Nothing can be archived or restored.");
      intent = { kind: editor.kind, id: editor.recordId, archived: editor.archived };
    }
    return { intent: "fields" in intent ? { ...intent, fields: textFields(intent.fields) } as Draft["intent"] : intent,
      confirmed: false, labels: titles, record };
  };
  return {
    title: editor.kind === "timeline" ? "Timeline event" : editor.kind === "beat" ? "Outline beat" : editor.kind === "notes" ? "Story notes"
      : editor.kind === "order-timeline" ? "Order timeline" : editor.kind === "order-beats" ? "Order beats"
      : editor.archived ? "Archive planning record" : "Restore planning record",
    fromRead,
    fromSaved: (read, submitted, baseline) => {
      if (submitted.intent.kind === "create-timeline" || submitted.intent.kind === "create-beat") {
        const key = submitted.intent.kind === "create-timeline" ? "timeline" : "beats";
        const added = read.data?.[key].filter((item) => !baseline.data?.[key].some((old) => old.id === item.id));
        if (added?.length !== 1 || !added[0]) throw new Error("The created record could not be identified.");
        savedId = added[0].id;
      }
      return fromRead(read);
    },
    validate: (draft, read) => {
      if ("archived" in draft.intent && draft.intent.archived && !draft.confirmed) return "Confirm the archive action before saving. The record and its text will be retained.";
      const intent = savedIntent(draft.intent);
      if (!intent) return "Check the exact JSON string fields. Each must contain one quoted JSON string. Your full draft is still here; nothing was submitted.";
      const parsed = planningSaveSchema.safeParse({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson, draft: intent });
      if (!parsed.success) return "Check required titles and field limits: short fields allow 200 UTF-16 units; prose allows 20,000. Your full draft is still here.";
      const key = draft.intent.kind === "create-timeline" ? "timeline" : draft.intent.kind === "create-beat" ? "beats" : null;
      if (key && (read.data?.[key].length ?? 0) >= 200) return "This book already has 200 retained records of this kind, including archived records. Your draft has not been submitted.";
      return null;
    },
    request: (draft, read) => {
      const intent = savedIntent(draft.intent);
      if (!intent) throw new Error("The exact JSON string draft is invalid.");
      return { bookId: read.bookId, source: read.source, baselineJson: read.baselineJson, draft: intent };
    },
    render: (draft, change) => <ManualFields draft={draft} change={change} />,
    preview: (read) => <pre className="whitespace-pre-wrap break-words">{JSON.stringify(read.data, null, 2) ?? "No saved planning data."}</pre>
  };
}

function savedIntent(intent: Draft["intent"]): PlanningDraft | null {
  if (!("fields" in intent)) return intent;
  const fields = parseTextFields(intent.fields);
  return fields ? { ...intent, fields } as PlanningDraft : null;
}

function ManualFields({ draft, change }: { draft: Draft; change: (draft: Draft) => void }) {
  const id = useId();
  const intent = draft.intent;
  if ("ids" in intent) return <>
    <p>Match each stable identity to the recovery copy, move records with the buttons, then choose Save changes. Archived records keep their positions. Chapter order is separate.</p>
    {!intent.ids.length && <p>No records to order yet.</p>}
    <ol aria-label="Draft planning order" className="space-y-2">{intent.ids.map((recordId, index) => <li key={recordId} className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 break-words"><span>{index + 1}. {draft.labels[recordId]}</span>
        <p id={`${id}-${recordId}`} className="break-all text-muted-foreground">Identity: <code>{recordId}</code></p>
      </div>
      {([-1, 1] as const).map((direction) => <Button key={direction} type="button" variant="secondary"
        aria-describedby={`${id}-${recordId}`}
        aria-label={`Move ${direction < 0 ? "up" : "down"} · position ${index + 1} · ${draft.labels[recordId]}`} disabled={index + direction < 0 || index + direction >= intent.ids.length}
        onClick={() => {
          const ids = [...intent.ids];
          const other = ids[index + direction];
          if (!other) return;
          ids[index] = other; ids[index + direction] = recordId;
          change({ ...draft, intent: { ...intent, ids } });
        }}>{direction < 0 ? "Move up" : "Move down"}</Button>)}
    </li>)}</ol>
  </>;
  if ("archived" in intent) return <>
    <p>{intent.archived ? "Archive this record? Its text, identity and order will be retained. You can restore it from archived records." : "Restore this retained record to the active list. Its text and identity stay the same."}</p>
    <p className="break-all text-muted-foreground">Identity: <code>{intent.id}</code></p>
    <pre className="whitespace-pre-wrap break-words">{JSON.stringify(draft.record, null, 2)}</pre>
    {intent.archived && <label className="flex items-center gap-2" htmlFor={id}><input id={id} type="checkbox" checked={draft.confirmed}
      onChange={(event) => change({ ...draft, confirmed: event.target.checked })} />Confirm archive · keep all content</label>}
  </>;
  const fields: Record<string, PlanningText> = intent.kind === "clear-story-notes" ? textFields(emptyNotes) : "fields" in intent ? intent.fields : {};
  return <>
    <p>Short fields allow 200 UTF-16 units; prose allows 20,000. The full file must fit 2,500,000 UTF-8 bytes.</p>
    {(intent.kind === "create-timeline" || intent.kind === "edit-timeline") && <p>When is a literal story label. Events stay in your chosen order.</p>}
    {Object.entries(fields).map(([key, field]) => {
      const limit = key === "title" || key === "when" ? 200 : 20_000;
      return <PlanningTextField key={key} label={labels[key] ?? key} limit={limit} field={field}
        onChange={(next) => change({ ...draft, intent: { ...(intent.kind === "clear-story-notes" ? { kind: "set-story-notes" as const } : intent),
          fields: { ...fields, [key]: next } } as Draft["intent"] })} />;
    })}
    {(intent.kind === "set-story-notes" || intent.kind === "clear-story-notes") && <>
      <p>Notes are optional. Clearing blanks these three fields only after Save changes; the saved identity and unknown fields remain.</p>
      <Button variant="secondary" type="button" onClick={() => change({ ...draft, intent: { kind: "clear-story-notes" } })}>Clear story notes</Button>
    </>}
  </>;
}
