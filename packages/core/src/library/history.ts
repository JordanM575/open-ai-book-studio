import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { normalizeBody } from "../markdown";
import { toLibraryFilePath, toLibraryPath, type LibraryPath } from "./path";
import type { LibraryRuntime } from "./port";

export type HistoryErrorCode =
  | "invalid" | "not-found" | "newer-schema" | "corrupt" | "identity"
  | "stale-source" | "saved-source-required" | "io";

export class HistoryError extends Error {
  constructor(readonly code: HistoryErrorCode, message: string) {
    super(message);
    this.name = "HistoryError";
  }
}

const bookId = z.string().regex(/^book_[A-Za-z0-9-]{6,}$/);
const chapterId = z.string().regex(/^ch_[A-Za-z0-9-]{6,}$/);
const recordId = z.string().regex(/^hist_[A-Za-z0-9-]{6,}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ precision: 3 });

export const historyLabelSchema = z.string().refine(
  (value) => value.trim().length > 0 && [...value].length <= 200 && !/[\p{Cc}\u2028\u2029]/u.test(value),
  "Use a nonblank single-line label of at most 200 characters without control characters."
);

export const historyFileNameSchema = z.string().refine((value) => {
  if (!value.endsWith(".md") || value.startsWith(".")) return false;
  try {
    toLibraryFilePath([value]);
    return true;
  } catch {
    return false;
  }
}, "Use a history file name, not a path.");

export const historyScopeSchema = z.strictObject({ bookId, chapterId });
export const historyReadSchema = z.strictObject({ bookId, chapterId, fileName: historyFileNameSchema });
export const historyCaptureSchema = z.strictObject({
  bookId,
  chapterId,
  label: historyLabelSchema,
  // A host must obtain this from its current save state, not a draft or a pending save.
  source: z.strictObject({ status: z.literal("saved"), version, hash })
});

const reference = z.looseObject({ fileName: historyFileNameSchema, id: recordId, hash });
const result = z.looseObject({ version, hash });
const common = {
  schemaVersion: z.literal(1),
  id: recordId,
  bookId,
  chapterId,
  label: historyLabelSchema,
  capturedAt: timestamp,
  sourceVersion: version,
  sourceHash: hash,
  bodyHash: hash
};

export const historyMetaSchema = z.discriminatedUnion("kind", [
  z.looseObject({ ...common, kind: z.literal("snapshot") }),
  z.looseObject({ ...common, kind: z.literal("safety") }),
  z.looseObject({
    ...common,
    kind: z.literal("intent"),
    selected: reference,
    safety: reference,
    intendedBodyHash: hash,
    state: z.enum(["prepared", "applied", "undone"]),
    result: result.optional(),
    undoResult: result.optional()
  })
]).superRefine((meta, context) => {
  if (meta.kind !== "intent") return;
  if ((meta.state === "prepared") !== (meta.result === undefined) ||
      (meta.state === "undone") !== (meta.undoResult !== undefined)) {
    context.addIssue({ code: "custom", message: "Intent results do not match its state." });
  }
  if (meta.id === meta.selected.id || meta.id === meta.safety.id || meta.selected.id === meta.safety.id ||
      meta.selected.fileName === meta.safety.fileName) {
    context.addIssue({ code: "custom", message: "An intent must reference distinct selected and safety records." });
  }
});

export type HistoryScope = z.infer<typeof historyScopeSchema>;
export type HistoryReadInput = z.infer<typeof historyReadSchema>;
export type HistoryCaptureInput = z.infer<typeof historyCaptureSchema>;
export type HistoryMeta = z.infer<typeof historyMetaSchema>;
export interface HistoryRecord { meta: HistoryMeta; content: string }
export interface StoredHistoryRecord extends HistoryRecord { fileName: string; hash: string }
export interface HistorySummary { fileName: string; hash: string; meta: HistoryMeta; size: number }
export interface HistoryIssue { fileName: string; code: HistoryErrorCode; message: string }
export interface HistoryListing { records: HistorySummary[]; issues: HistoryIssue[] }
export interface HistoryComparison {
  basis: "saved";
  snapshot: StoredHistoryRecord;
  current: { bookId: string; chapterId: string; content: string; version: number; hash: string };
  equal: boolean;
}

export function historyDirectory(scope: HistoryScope): LibraryPath {
  const parsed = historyScopeSchema.safeParse(scope);
  if (!parsed.success) throw new HistoryError("invalid", "The history book or chapter ID is invalid.");
  return toLibraryPath(["books", parsed.data.bookId, "history", parsed.data.chapterId]);
}

export function historyFilePath(input: HistoryReadInput): LibraryPath {
  const parsed = historyReadSchema.safeParse(input);
  if (!parsed.success) throw new HistoryError("invalid", "The history record address is invalid.");
  return toLibraryFilePath([...historyDirectory({ bookId: input.bookId, chapterId: input.chapterId }), input.fileName]);
}

/** Shared only with saved-source validation. Never include parser excerpts in errors or logs. */
export function readHistoryEnvelope(raw: string): { metadata: unknown; content: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!match) throw new HistoryError("corrupt", "The history file has no readable front matter. Keep the file for recovery.");
  try {
    const document = parseDocument(`${match[1] ?? ""}\n`, { prettyErrors: false, uniqueKeys: true });
    if (document.errors.length || document.warnings.length) throw new Error("Invalid YAML");
    return { metadata: document.toJS(), content: normalizeBody(raw.slice(match[0].length)) };
  } catch {
    throw new HistoryError("corrupt", "The file's front matter could not be read. Keep the file for recovery.");
  }
}

function validateMeta(metadata: unknown): HistoryMeta {
  if (metadata && typeof metadata === "object" && "schemaVersion" in metadata &&
      typeof metadata.schemaVersion === "number" && metadata.schemaVersion > 1) {
    throw new HistoryError("newer-schema", "This history record needs a newer version of Open Book Studio. Update the app to open it.");
  }
  const parsed = historyMetaSchema.safeParse(metadata);
  if (!parsed.success) throw new HistoryError("corrupt", "The history metadata is invalid. Keep the file for recovery.");
  return parsed.data;
}

async function validateBody(meta: HistoryMeta, content: string, runtime: LibraryRuntime): Promise<void> {
  if ((meta.kind === "intent" && content !== "") ||
      await runtime.sha256(new TextEncoder().encode(content)) !== meta.bodyHash) {
    throw new HistoryError("corrupt", "The history body does not match its integrity hash. Keep the file for recovery.");
  }
}

export async function parseHistoryRecord(raw: string, scope: HistoryScope, runtime: LibraryRuntime): Promise<HistoryRecord> {
  historyDirectory(scope);
  const envelope = readHistoryEnvelope(raw);
  const meta = validateMeta(envelope.metadata);
  if (meta.bookId !== scope.bookId || meta.chapterId !== scope.chapterId) {
    throw new HistoryError("identity", "This history record belongs to a different book or chapter. Keep the file for recovery.");
  }
  await validateBody(meta, envelope.content, runtime);
  return { meta, content: envelope.content };
}

/** Metadata is not reconstructed: unknown keys, including nested ones, survive. */
export async function serializeHistoryRecord(record: HistoryRecord, runtime: LibraryRuntime): Promise<string> {
  const meta = validateMeta(record.meta);
  const content = normalizeBody(record.content);
  await validateBody(meta, content, runtime);
  const front = stringify(meta, { lineWidth: 0 }).replace(/\n$/, "");
  return `---\n${front}\n---\n\n${content}`;
}
