import { z } from "zod";
import { LibraryError } from "../library/errors";

export const SIDECAR_BYTES = 2_500_000;
export const RECOVERY_BYTES = 2 * SIDECAR_BYTES;
export const encoder = new TextEncoder();
export const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Explicit JS length: the format uses UTF-16 units, independent of Zod's string-length policy.
export const shortText = z.string().refine((value) => value.length <= 200, "At most 200 UTF-16 units.");
export const prose = z.string().refine((value) => value.length <= 20_000, "At most 20,000 UTF-16 units.");
const name = shortText.refine((value) => value.trim().length > 0, "A name or title is required.");
export const revisionSchema = z.number().refine((value) => Number.isSafeInteger(value) && value >= 1);
export const bookIdSchema = z.string().regex(/^book_[A-Za-z0-9-]{6,}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const recordIdSchema = (prefix: "wb" | "tl" | "sn" | "beat" | "ann" | "col") =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9-]{6,40}$`));

const recordFields = { bookId: bookIdSchema, revision: revisionSchema, archived: z.boolean() };
export const worldbuildingFields = { name, category: shortText, description: prose, notes: prose };
export const worldbuildingSchema = z.looseObject({
  ...recordFields, id: recordIdSchema("wb"), kind: z.literal("worldbuilding"), ...worldbuildingFields
});
export const timelineSchema = z.looseObject({
  ...recordFields, id: recordIdSchema("tl"), kind: z.literal("timeline"),
  title: name, when: shortText, description: prose, notes: prose
});
export const beatSchema = z.looseObject({
  ...recordFields, id: recordIdSchema("beat"), kind: z.literal("beat"), title: name, summary: prose, notes: prose
});
export const storyNotesSchema = z.looseObject({
  ...recordFields, id: recordIdSchema("sn"), kind: z.literal("story-notes"),
  workingNotes: prose, styleNotes: prose, synopsis: prose
});

export const planningSchema = z.looseObject({
  schemaVersion: z.literal(1), bookId: bookIdSchema, revision: revisionSchema,
  worldbuilding: z.array(worldbuildingSchema).max(200),
  timeline: z.array(timelineSchema).max(200), timelineOrder: z.array(recordIdSchema("tl")).max(200),
  beats: z.array(beatSchema).max(200), beatOrder: z.array(recordIdSchema("beat")).max(200),
  storyNotes: storyNotesSchema.optional()
}).superRefine((data, ctx) => {
  const records = [...data.worldbuilding, ...data.timeline, ...data.beats, ...(data.storyNotes ? [data.storyNotes] : [])];
  if (records.some((record) => record.bookId !== data.bookId)) {
    ctx.addIssue({ code: "custom", message: "Every record must belong to this book." });
  }
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    ctx.addIssue({ code: "custom", message: "Retained record IDs must be unique." });
  }
  for (const [list, order] of [[data.timeline, data.timelineOrder], [data.beats, data.beatOrder]] as const) {
    const ids = new Set(list.map((record) => record.id));
    if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
      ctx.addIssue({ code: "custom", message: "Order must contain each retained ID exactly once." });
    }
  }
});

export const sourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent"), revision: z.literal(0) }),
  z.strictObject({ kind: z.literal("sha256"), value: hashSchema, revision: revisionSchema })
]);
export type SidecarSource = z.infer<typeof sourceSchema>;
export type Planning = z.infer<typeof planningSchema>;
export type Worldbuilding = z.infer<typeof worldbuildingSchema>;
export type SidecarDocument = { schemaVersion: number; bookId: string; revision: number; [key: string]: unknown };

export function increment(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw new LibraryError("invalid", "The revision cannot advance safely. Nothing was written.");
  }
  return revision + 1;
}

export function checkBytes(bytes: Uint8Array, limit = SIDECAR_BYTES): Uint8Array {
  if (bytes.byteLength > limit) throw new LibraryError("invalid", `The file exceeds ${limit.toLocaleString("en-US")} UTF-8 bytes. Nothing was written.`);
  return bytes;
}

export function serializeDocument(data: SidecarDocument, limit = SIDECAR_BYTES): Uint8Array {
  return checkBytes(encoder.encode(`${JSON.stringify(data, null, 2)}\n`), limit);
}

export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(checkBytes(bytes)), (_key, value: unknown) => {
      // JSON permits exponents outside IEEE-754's range; stringify would silently turn them into null.
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Unrepresentable JSON number");
      return value;
    }) as unknown;
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    throw new LibraryError("format", "The sidecar is not valid UTF-8 JSON. Nothing was written.");
  }
}

/** Validate the raw JSON, but retain it rather than a parser's reconstructed/defaulted object. */
export function validateDocument<T extends SidecarDocument>(schema: z.ZodType<T>, raw: unknown, bookId: string): T {
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw &&
      typeof raw.schemaVersion === "number" && raw.schemaVersion > 1) {
    throw new LibraryError("newer-schema", "This sidecar needs a newer version of the studio. Nothing was written.");
  }
  if (!schema.safeParse(raw).success) throw new LibraryError("format", "The sidecar has unsupported or invalid fields. Nothing was written.");
  const data = raw as T;
  if (data.bookId !== bookId) throw new LibraryError("invalid", "The sidecar belongs to a different book. Nothing was written.");
  if (Object.hasOwn(data, "conflictMetadata")) throw new LibraryError("invalid", "A recovery copy cannot be used as an active sidecar.");
  return data;
}
