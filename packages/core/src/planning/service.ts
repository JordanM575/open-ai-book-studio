import { z } from "zod";
import { LibraryError } from "../library/errors";
import { CheckedSidecar, envelopeFields, parseRequest, type SidecarHost, type SidecarRead, type SidecarSave } from "./checked-sidecar";
import { sameValue } from "../library/book-merge";
import { beatFields, increment, planningSchema, recordIdSchema, storyNotesFields, timelineFields, worldbuildingFields, type Planning } from "./schema";

export const planningSaveSchema = z.strictObject({
  ...envelopeFields,
  draft: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("create-worldbuilding"), fields: z.strictObject(worldbuildingFields) }),
    z.strictObject({ kind: z.literal("edit-worldbuilding"), id: recordIdSchema("wb"), fields: z.strictObject(worldbuildingFields) }),
    z.strictObject({ kind: z.literal("create-timeline"), fields: z.strictObject(timelineFields) }),
    z.strictObject({ kind: z.literal("edit-timeline"), id: recordIdSchema("tl"), fields: z.strictObject(timelineFields) }),
    z.strictObject({ kind: z.literal("create-beat"), fields: z.strictObject(beatFields) }),
    z.strictObject({ kind: z.literal("edit-beat"), id: recordIdSchema("beat"), fields: z.strictObject(beatFields) }),
    z.strictObject({ kind: z.literal("set-story-notes"), fields: z.strictObject(storyNotesFields) }),
    z.strictObject({ kind: z.literal("clear-story-notes") }),
    z.strictObject({ kind: z.literal("order-timeline"), ids: z.array(recordIdSchema("tl")).max(200) }),
    z.strictObject({ kind: z.literal("order-beats"), ids: z.array(recordIdSchema("beat")).max(200) }),
    z.strictObject({ kind: z.literal("archive-worldbuilding"), id: recordIdSchema("wb"), archived: z.boolean() }),
    z.strictObject({ kind: z.literal("archive-timeline"), id: recordIdSchema("tl"), archived: z.boolean() }),
    z.strictObject({ kind: z.literal("archive-beat"), id: recordIdSchema("beat"), archived: z.boolean() })
  ])
});
export type PlanningSaveRequest = z.infer<typeof planningSaveSchema>;
export type PlanningDraft = PlanningSaveRequest["draft"];

/** Pure bounded intent projection, also used to verify complete transport correspondence.
 * Only the service generates IDs; response validation supplies the one returned new identity.
 */
export function applyPlanningDraft(base: Planning | null, bookId: string, draft: PlanningDraft,
  newId: (prefix: "wb" | "tl" | "beat" | "sn") => string): { data: Planning; changed: boolean } {
  const data: Planning = base ?? { schemaVersion: 1, bookId, revision: 1,
    worldbuilding: [], timeline: [], timelineOrder: [], beats: [], beatOrder: [] };
  const createId = (prefix: "wb" | "tl" | "beat" | "sn") => {
    const id = newId(prefix);
    const retained = [...data.worldbuilding, ...data.timeline, ...data.beats, ...(data.storyNotes ? [data.storyNotes] : [])];
    if (!recordIdSchema(prefix).safeParse(id).success || retained.some((record) => record.id === id)) {
      throw new LibraryError("invalid", "The host could not assign a unique planning ID. Nothing was written.");
    }
    return { id, bookId, revision: 1, archived: false };
  };
  if (draft.kind === "order-timeline" || draft.kind === "order-beats") {
    const key = draft.kind === "order-timeline" ? "timelineOrder" : "beatOrder";
    const order = data[key];
    if (draft.ids.length !== order.length || new Set(draft.ids).size !== order.length || draft.ids.some((id) => !order.includes(id))) {
      throw new LibraryError("invalid", "Order must include every retained record exactly once, including archived records.");
    }
    return { data: { ...data, [key]: [...draft.ids] }, changed: !sameValue(order, draft.ids) };
  }
  if (draft.kind === "set-story-notes" || draft.kind === "clear-story-notes") {
    const fields = draft.kind === "clear-story-notes" ? { workingNotes: "", styleNotes: "", synopsis: "" } : draft.fields;
    const record = data.storyNotes;
    // Empty optional notes never create a file/record merely by opening and saving.
    if (!record && Object.values(fields).every((value) => value === "")) return { data, changed: false };
    if (!record) return { changed: true, data: { ...data, storyNotes: { ...createId("sn"), kind: "story-notes", ...fields } } };
    const changed = Object.entries(fields).some(([key, value]) => record[key] !== value);
    return { changed, data: changed ? { ...data, storyNotes: { ...record, ...fields, revision: increment(record.revision) } } : data };
  }
  if (draft.kind === "create-worldbuilding") return { changed: true, data: { ...data,
    worldbuilding: [...data.worldbuilding, { ...createId("wb"), kind: "worldbuilding", ...draft.fields }] } };
  if (draft.kind === "create-timeline") {
    const record = { ...createId("tl"), kind: "timeline" as const, ...draft.fields };
    return { changed: true, data: { ...data, timeline: [...data.timeline, record], timelineOrder: [...data.timelineOrder, record.id] } };
  }
  if (draft.kind === "create-beat") {
    const record = { ...createId("beat"), kind: "beat" as const, ...draft.fields };
    return { changed: true, data: { ...data, beats: [...data.beats, record], beatOrder: [...data.beatOrder, record.id] } };
  }
  const key = draft.kind === "edit-worldbuilding" || draft.kind === "archive-worldbuilding" ? "worldbuilding"
    : draft.kind === "edit-timeline" || draft.kind === "archive-timeline" ? "timeline" : "beats";
  const record = data[key].find((entry) => entry.id === draft.id);
  if (!record) throw new LibraryError("not-found", "The record is not in the original planning document. Editing cannot create it.");
  const fields = "fields" in draft ? draft.fields : { archived: draft.archived };
  if ("fields" in draft && record.archived) throw new LibraryError("invalid", "Restore this archived record before editing it.");
  if (Object.entries(fields).every(([field, value]) => record[field] === value)) return { data, changed: false };
  const updated = { ...record, ...fields, revision: increment(record.revision) };
  return { changed: true, data: { ...data, [key]: data[key].map((entry) => entry.id === record.id ? updated : entry) } };
}

/** Library-owned policy component; construct with the existing service's queue/commit hooks. */
export class PlanningService {
  private readonly sidecar: CheckedSidecar<Planning>;
  constructor(private readonly host: SidecarHost) {
    this.sidecar = new CheckedSidecar(host, "planning", planningSchema);
  }

  read(bookId: string): Promise<SidecarRead<Planning>> { return this.sidecar.read(bookId); }

  save(input: unknown): Promise<SidecarSave<Planning>> {
    const request = parseRequest(planningSaveSchema, input);
    return this.sidecar.save(request, (base) => applyPlanningDraft(base, request.bookId, request.draft, (prefix) => this.host.runtime.newId(prefix)));
  }
}
