import { z } from "zod";
import { LibraryError } from "../library/errors";
import { CheckedSidecar, envelopeFields, parseRequest, type SidecarHost, type SidecarRead, type SidecarSave } from "./checked-sidecar";
import { increment, planningSchema, recordIdSchema, worldbuildingFields, type Planning } from "./schema";

export const planningSaveSchema = z.strictObject({
  ...envelopeFields,
  draft: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("create-worldbuilding"), fields: z.strictObject(worldbuildingFields) }),
    z.strictObject({ kind: z.literal("edit-worldbuilding"), id: recordIdSchema("wb"), fields: z.strictObject(worldbuildingFields) })
  ])
});
export type PlanningSaveRequest = z.infer<typeof planningSaveSchema>;

/** Library-owned policy component; construct with the existing service's queue/commit hooks. */
export class PlanningService {
  private readonly sidecar: CheckedSidecar<Planning>;
  constructor(private readonly host: SidecarHost) {
    this.sidecar = new CheckedSidecar(host, "planning", planningSchema);
  }

  read(bookId: string): Promise<SidecarRead<Planning>> { return this.sidecar.read(bookId); }

  save(input: unknown): Promise<SidecarSave<Planning>> {
    const request = parseRequest(planningSaveSchema, input);
    return this.sidecar.save(request, (base) => {
      const data: Planning = base ?? {
        schemaVersion: 1, bookId: request.bookId, revision: 1,
        worldbuilding: [], timeline: [], timelineOrder: [], beats: [], beatOrder: []
      };
      const draft = request.draft;
      if (draft.kind === "create-worldbuilding") {
        const id = this.host.runtime.newId("wb");
        if (!recordIdSchema("wb").safeParse(id).success || data.worldbuilding.some((record) => record.id === id)) {
          throw new LibraryError("invalid", "The host could not assign a unique worldbuilding ID. Nothing was written.");
        }
        return { changed: true, data: { ...data, worldbuilding: [...data.worldbuilding, {
          id, kind: "worldbuilding", bookId: request.bookId, revision: 1, archived: false, ...draft.fields
        }] } };
      }
      const record = data.worldbuilding.find((entry) => entry.id === draft.id);
      if (!record) throw new LibraryError("not-found", "The record is not in the original planning document. Editing cannot create it.");
      const changed = (Object.keys(draft.fields) as Array<keyof typeof draft.fields>).some((key) => record[key] !== draft.fields[key]);
      if (!changed) return { data, changed: false };
      const updated = { ...record, ...draft.fields, revision: increment(record.revision) };
      return { changed: true, data: { ...data, worldbuilding: data.worldbuilding.map((entry) => entry.id === record.id ? updated : entry) } };
    });
  }
}
