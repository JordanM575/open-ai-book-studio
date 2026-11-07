import { parseDocument, stringify, visit } from "yaml";
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
    undoResult: result.optional(),
    plannedResult: result.optional(),
    plannedUndoResult: result.optional()
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
  if ((meta.state === "prepared" && meta.plannedUndoResult !== undefined) ||
      (meta.result && meta.plannedResult && !sameHistoryBase(meta.result, meta.plannedResult)) ||
      (meta.undoResult && meta.plannedUndoResult && !sameHistoryBase(meta.undoResult, meta.plannedUndoResult))) {
    context.addIssue({ code: "custom", message: "Intent results do not match their prepared identities." });
  }
});

export const historyRestoreSchema = z.strictObject({
  bookId, chapterId, selected: z.strictObject({ fileName: historyFileNameSchema, id: recordId, hash }),
  source: z.strictObject({ status: z.literal("saved"), version, hash })
});
export const historyUndoSchema = z.strictObject({
  bookId, chapterId, intent: z.strictObject({ fileName: historyFileNameSchema, id: recordId, hash }),
  source: z.strictObject({ status: z.literal("saved"), version, hash })
});
export type HistoryRestoreInput = z.infer<typeof historyRestoreSchema>;
export type HistoryUndoInput = z.infer<typeof historyUndoSchema>;
export type HistoryReference = z.infer<typeof reference>;
export type HistoryBase = z.infer<typeof result>;
export function sameHistoryBase(a: HistoryBase, b: HistoryBase): boolean {
  return a.version === b.version && a.hash === b.hash;
}

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
    const source = `${match[1] ?? ""}\n`;
    const document = parseDocument(source, {
      prettyErrors: false, uniqueKeys: true, stringKeys: true, logLevel: "silent",
      schema: "core", resolveKnownTags: false, merge: false
    });
    if (document.errors.length || document.warnings.length) throw new Error("Invalid YAML");
    if (document.directives?.yaml.version !== "1.2") throw new Error("Unsupported YAML version");
    // Checking the parsed Number alone misses already-rounded integers and underflowed floats.
    visit(document, { Scalar(_key, node) {
      if (typeof node.value !== "number") return;
      const token = node.range ? source.slice(node.range[0], node.range[1]) : "";
      if (!losslessNumber(token, node.value)) throw new Error("Unsupported YAML number");
    } });
    const metadata: unknown = document.toJS();
    validateValues(metadata);
    return { metadata, content: normalizeBody(raw.slice(match[0].length)) };
  } catch {
    throw new HistoryError("corrupt", "The file's front matter could not be read. Keep the file for recovery.");
  }
}

function validateMeta(metadata: unknown): HistoryMeta {
  // Do this before Zod can strip a reserved key or normalize a foreign object.
  try { validateValues(metadata); } catch { invalidValues(); }
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

/** Unknown data in the supported plain-value domain survives; unsupported values are refused. */
export async function serializeHistoryRecord(record: HistoryRecord, runtime: LibraryRuntime): Promise<string> {
  const meta = structuredClone(validateMeta(record.meta));
  const content = normalizeBody(record.content);
  await validateBody(meta, content, runtime);
  const front = stringify(meta, { lineWidth: 0, aliasDuplicateObjects: false }).replace(/\n$/, "");
  return `---\n${front}\n---\n\n${content}`;
}

function invalidValues(): never {
  throw new HistoryError("corrupt", "The history metadata contains unsupported values. Keep the file for recovery.");
}

function supportedNumber(value: number): boolean {
  return Number.isFinite(value) && !Object.is(value, -0) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value));
}

/** Compare decimal values without first rounding both source tokens through Number. */
function decimalValue(token: string): string | null {
  const parts = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!parts) return null;
  const fraction = parts[3] ?? parts[4] ?? "";
  const digits = `${parts[2] ?? ""}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power = Number(parts[5] ?? 0) - fraction.length + digits.length - significant.length;
  if (!Number.isSafeInteger(power)) return null;
  return `${parts[1] === "-" ? "-" : ""}${significant}e${power}`;
}

function losslessNumber(token: string, value: number): boolean {
  if (!supportedNumber(value)) return false;
  if (/^0[xo][\da-f]+$/i.test(token)) {
    try { return BigInt(token) === BigInt(value); } catch { return false; }
  }
  const original = decimalValue(token);
  return original !== null && original === decimalValue(String(value));
}

/** Validate descriptors before accessing values; no getter or toJSON hook is executed. */
function validateValues(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!supportedNumber(value)) invalidValues();
    return;
  }
  if (!value || typeof value !== "object" || active.has(value)) invalidValues();
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalidValues();
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) invalidValues();
  active.add(value);
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string" || key === "__proto__") invalidValues();
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) invalidValues();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalidValues();
    validateValues(descriptor.value, active);
  }
  active.delete(value);
}
