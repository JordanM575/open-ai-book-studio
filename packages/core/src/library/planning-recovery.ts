import { z } from "zod";
import { goalSchema } from "../organization/goals";
import { assertSidecarOwner, type SidecarHost } from "../planning/checked-sidecar";
import { bookIdSchema, decoder, encoder, hashSchema, parseJson, planningSchema, RECOVERY_BYTES, sourceSchema, validateDocument } from "../planning/schema";
import { conflictPath, conflictsPath } from "./paths";
import type { LibraryPort } from "./port";

export const copyNameSchema = z.string().max(300).regex(/^(planning|goals)\.conflict-(external-edit|missing-file)\.[A-Za-z0-9_-]{1,100}\.[0-9TZ-]{1,100}\.json$/);
export const copyListInput = z.strictObject({ bookId: bookIdSchema.max(200), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export const copyReadInput = z.strictObject({ bookId: bookIdSchema.max(200), name: copyNameSchema });
export const copyListSchema = z.strictObject({ bookId: bookIdSchema, names: z.array(copyNameSchema).max(25), nextOffset: z.number().int().min(0).nullable() });
export const copySchema = z.strictObject({ bookId: bookIdSchema, name: copyNameSchema, hash: hashSchema,
  rawJson: z.string().refine((text) => encoder.encode(text).byteLength <= RECOVERY_BYTES) });
export type PlanningCopyList = z.infer<typeof copyListSchema>;
export type PlanningCopy = z.infer<typeof copySchema>;

/** Inspection only. Copy metadata is never returned as an active save baseline. */
export function inspectPlanningCopy(copy: PlanningCopy) {
  const parsed = parseJson(encoder.encode(copy.rawJson), RECOVERY_BYTES);
  const envelope = z.looseObject({ conflictMetadata: z.strictObject({ reason: z.enum(["external-edit", "missing-file"]), baseline: sourceSchema, observed: sourceSchema }) }).parse(parsed);
  if (!copy.name.includes(`.conflict-${envelope.conflictMetadata.reason}.`)) throw new Error("Copy reason mismatch.");
  const { conflictMetadata: _metadata, ...document } = envelope;
  return copy.name.startsWith("planning.")
    ? { kind: "planning" as const, data: validateDocument(planningSchema, document, copy.bookId) }
    : { kind: "goals" as const, data: validateDocument(goalSchema, document, copy.bookId) };
}

export class PlanningRecovery {
  constructor(private readonly host: SidecarHost, private readonly storage: LibraryPort) {}
  list(input: unknown): Promise<PlanningCopyList> {
    const { bookId, offset } = copyListInput.parse(input);
    return this.host.withBook(bookId, async () => {
      await assertSidecarOwner(this.host, bookId);
      const names = (await this.storage.listDirectory(conflictsPath(bookId)))
        .filter((entry) => entry.kind === "file" && copyNameSchema.safeParse(entry.name).success).map((entry) => entry.name).sort();
      return { bookId, names: names.slice(offset, offset + 25), nextOffset: offset + 25 < names.length ? offset + 25 : null };
    });
  }
  read(input: unknown): Promise<PlanningCopy> {
    const { bookId, name } = copyReadInput.parse(input);
    return this.host.withBook(bookId, async () => {
      await assertSidecarOwner(this.host, bookId);
      const path = conflictPath(bookId, name);
      const stat = await this.storage.stat(path);
      if (!stat || stat.size > RECOVERY_BYTES) throw new Error("Copy unavailable.");
      const snapshot = await this.storage.readFile(path);
      if (!snapshot || snapshot.bytes.byteLength > RECOVERY_BYTES || await this.host.runtime.sha256(snapshot.bytes) !== snapshot.sha256) throw new Error("Copy unavailable.");
      const copy = copySchema.parse({ bookId, name, hash: snapshot.sha256, rawJson: decoder.decode(snapshot.bytes) });
      inspectPlanningCopy(copy);
      return copy;
    });
  }
}
