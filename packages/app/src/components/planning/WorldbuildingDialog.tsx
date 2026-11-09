import type { Planning, Worldbuilding } from "@ai-book-studio/core/planning/schema";
import type { PlanningSaveRequest } from "@ai-book-studio/core/planning/service";
import type { SidecarRead } from "@ai-book-studio/core/planning/checked-sidecar";
import { CheckedDraftDialog, type DraftDefinition } from "./CheckedDraftDialog";
import { PlanningTextField, textFields, parseTextFields, type TextFields } from "./PlanningTextField";
import { viewKey, type PlanningDialogProps } from "./contracts";
export type { DraftSaveResult, DraftSessionState, PlanningView } from "./contracts";

type Fields = TextFields<Pick<Worldbuilding, "name" | "category" | "description" | "notes">>;
export interface WorldbuildingDialogProps extends PlanningDialogProps<Planning, PlanningSaveRequest> {
  /** Omit to create. Existing IDs must be present in the original read; edit never becomes create. */
  recordId?: string;
}
const fields = [
  ["name", "Name", 200], ["category", "Category", 200],
  ["description", "Description", 20_000], ["notes", "Notes", 20_000]
] as const;

export function WorldbuildingDialog(props: WorldbuildingDialogProps) {
  if (!props.open) return null;
  return <CheckedDraftDialog key={`${viewKey(props)}:${props.recordId ?? "new"}`} {...props} definition={definition(props.recordId)} />;
}

function definition(recordId: string | undefined): DraftDefinition<Planning, Fields, PlanningSaveRequest> {
  const find = (read: SidecarRead<Planning>) => read.data?.worldbuilding.find((record) => record.id === recordId);
  const fromRead = (read: SidecarRead<Planning>): Fields => {
    if (read.data && read.data.bookId !== read.bookId) throw new Error("The planning data belongs to another book.");
    const record = find(read);
    if (record && (record.bookId !== read.bookId || read.data?.worldbuilding.filter((entry) => entry.id === recordId).length !== 1)) {
      throw new Error("The world detail has a foreign or duplicate identity.");
    }
    if (recordId && (!record || record.archived)) throw new Error("This world detail is missing or archived. Editing cannot create it.");
    return textFields(record ? { name: record.name, category: record.category, description: record.description, notes: record.notes }
      : { name: "", category: "", description: "", notes: "" });
  };
  return {
    title: recordId ? "Edit world detail" : "New world detail",
    fromRead,
    fromSaved: (read, _draft, baseline) => {
      if (!recordId) {
        const added = read.data?.worldbuilding.filter((record) => !baseline.data?.worldbuilding.some((old) => old.id === record.id));
        if (added?.length !== 1 || !added[0]) throw new Error("The created world detail could not be identified.");
        recordId = added[0].id;
      }
      return fromRead(read);
    },
    validate: (draft, read) => {
      const values = parseTextFields(draft);
      if (!values) return "Check the exact JSON string fields. Each must contain one quoted JSON string. Your full draft is still here; nothing was submitted.";
      if (!values.name.trim()) return "Name is required. Your draft has not been submitted.";
      for (const [key, label, limit] of fields) {
        if (values[key].length > limit) return `${label} exceeds ${limit.toLocaleString("en-US")} UTF-16 units. Shorten that field; your full draft is still here.`;
      }
      if (!recordId && (read.data?.worldbuilding.length ?? 0) >= 200) {
        return "This book already has 200 retained world details, including archived records. Your draft has not been submitted.";
      }
      return null;
    },
    request: (draft, read) => {
      const values = parseTextFields(draft);
      if (!values) throw new Error("The exact JSON string draft is invalid.");
      return { bookId: read.bookId, source: read.source, baselineJson: read.baselineJson,
        draft: recordId ? { kind: "edit-worldbuilding", id: recordId, fields: values } : { kind: "create-worldbuilding", fields: values } };
    },
    render: (draft, change) => <>
      <p>Names and categories allow 200 UTF-16 units; descriptions and notes allow 20,000. The complete saved file must also fit 2,500,000 UTF-8 bytes.</p>
      {fields.map(([key, label, limit]) => <PlanningTextField key={key} label={label} limit={limit} field={draft[key]}
        onChange={(value) => change({ ...draft, [key]: value })} />)}
    </>,
    preview: (read) => {
      const record = find(read);
      if (!record) return <p>{recordId ? "This detail is no longer in the saved file." : `${read.data?.worldbuilding.length ?? 0} saved world details. This draft is a new detail.`}</p>;
      return <dl className="whitespace-pre-wrap break-words">{fields.map(([key, label]) => <div key={key}><dt className="font-medium">{label}</dt><dd>{record[key] || "(empty)"}</dd></div>)}</dl>;
    }
  };
}
