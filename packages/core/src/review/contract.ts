import { z } from "zod";

/** ADR 0018 v1 resource policy; bytes are UTF-8, not model tokens. */
export const REVIEW_LIMITS = Object.freeze({
  books: 4, items: 64, sourceBytes: 65_536, contentBytes: 131_072,
  requestBytes: 262_144, outputBytes: 262_144, findings: 50,
  interpretationScalars: 2_000, evidence: 8, quoteScalars: 500, guidanceScalars: 2_000
});

export class ReviewContractError extends Error {
  constructor(public readonly code: string) {
    super(`Review contract refused: ${code}. Reduce the selection or prepare a new disclosure.`);
    this.name = "ReviewContractError";
  }
}

export function requireContract(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ReviewContractError(code);
}

export function scalarCount(text: string): number {
  let count = 0;
  for (const scalar of text) {
    const code = scalar.codePointAt(0) ?? 0;
    requireContract(code < 0xd800 || code > 0xdfff, "invalid-unicode");
    count++;
  }
  return count;
}

export function withinScalarLimit(text: string, limit: number): boolean {
  try { return scalarCount(text) <= limit; } catch { return false; }
}

export const textSchema = z.string().refine((value) => {
  try { scalarCount(value); return true; } catch { return false; }
}, "Unpaired surrogate");
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).max(200);
export const bookIdSchema = z.string().regex(/^book_[A-Za-z0-9-]{6,}$/);
export const chapterIdSchema = z.string().regex(/^ch_[A-Za-z0-9-]{6,}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const integerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const versionSchema = integerSchema.min(1);
export const timestampSchema = z.iso.datetime({ offset: true });
export const spanSchema = z.strictObject({ start: integerSchema, end: integerSchema });
export type Span = z.infer<typeof spanSchema>;
export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

/** Only call with freshly parsed, acyclic JSON data, never caller-owned objects. */
export function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

export function utf8Bytes(text: string): number { return new TextEncoder().encode(text).length; }
export function checkBytes(text: string, limit: number, code: string): void {
  requireContract(utf8Bytes(text) <= limit, code);
}

function dataEntries(value: object): [string, unknown][] {
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  requireContract(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, "non-json-prototype");
  const keys = Reflect.ownKeys(value);
  requireContract(!array || keys.length === value.length + 1, "non-json-array");
  const entries: [string, unknown][] = [];
  for (const key of keys) {
    if (array && key === "length") continue;
    requireContract(typeof key === "string", "non-json-property");
    requireContract(!array || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length), "non-json-array");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireContract(descriptor?.enumerable && "value" in descriptor, "non-json-property");
    entries.push([key, descriptor.value]);
  }
  return entries;
}

/** Lossless in-memory JSON domain, checked before a schema can discard object shape.
 * Dense ordinary arrays and plain/null-prototype own enumerable data only; no getters/toJSON.
 * Shared subvalues are visited once per check, cycles are not permitted. Text schemas enforce Unicode.
 * This is not a raw JSON numeric/duplicate-key or persisted-file reader.
 */
export function assertReviewData(value: unknown): void {
  const active = new Set<object>();
  const complete = new Set<object>();
  const pending: { value: unknown; exit?: boolean }[] = [{ value }];
  while (pending.length) {
    const frame = pending.pop();
    if (!frame) break;
    const item = frame.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      requireContract(Number.isFinite(item) && !Object.is(item, -0) &&
        (!Number.isInteger(item) || Number.isSafeInteger(item)), "non-json-number");
      continue;
    }
    requireContract(typeof item === "object", "non-json-value");
    if (frame.exit) { active.delete(item); complete.add(item); continue; }
    requireContract(!active.has(item), "cyclic-json");
    if (complete.has(item)) continue;
    const entries = dataEntries(item);
    active.add(item);
    pending.push({ value: item, exit: true });
    for (let index = entries.length - 1; index >= 0; index--) pending.push({ value: entries[index]?.[1] });
  }
}

export function isReviewData(value: unknown): boolean {
  try { assertReviewData(value); return true; } catch { return false; }
}

/** Sorted object keys; array order and literal strings survive without normalization or hooks. */
export function canonicalJson(value: unknown): string {
  assertReviewData(value);
  const output: string[] = [];
  const pending: ({ kind: "value"; value: unknown } | { kind: "text"; text: string })[] = [{ kind: "value", value }];
  while (pending.length) {
    const frame = pending.pop();
    if (!frame) break;
    if (frame.kind === "text") { output.push(frame.text); continue; }
    const item = frame.value;
    if (item === null || typeof item !== "object") { output.push(JSON.stringify(item)); continue; }
    const array = Array.isArray(item);
    const entries = dataEntries(item);
    entries.sort(([a], [b]) => array ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0);
    output.push(array ? "[" : "{");
    pending.push({ kind: "text", text: array ? "]" : "}" });
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (!entry) continue;
      if (index < entries.length - 1) pending.push({ kind: "text", text: "," });
      pending.push({ kind: "value", value: entry[1] });
      if (!array) pending.push({ kind: "text", text: `${JSON.stringify(entry[0])}:` });
    }
  }
  return output.join("");
}

export async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isScalarBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function validSpan(text: string, span: Span): boolean {
  return Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= text.length &&
    isScalarBoundary(text, span.start) && isScalarBoundary(text, span.end);
}
