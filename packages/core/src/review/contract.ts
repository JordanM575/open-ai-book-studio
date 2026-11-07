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

/** Sorted object keys; array/selection order and literal strings are never normalized. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
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
