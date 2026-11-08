import { ReviewRecordError } from "./record-error";

/**
 * Raw JSON boundary for saved review records.
 *
 * A saved record is ordinary JSON the author can read and hand-edit. A checked writer therefore has
 * to prove that the exact bytes it publishes are bytes this build can read again, and a checked
 * reader must refuse a loss rather than silently normalize it. JavaScript's `JSON.parse` accepts
 * duplicate member names, lone surrogates and numeric lexemes that do not round-trip; all three
 * would make a later save rewrite an author's file with different meaning.
 *
 * This reader and canonical encoder are deliberately self-contained. The same rules already live in
 * `agent/thread-document.ts` and `authoring/wire.ts`; consolidating the three is a coordinator change,
 * not something a bounded review-record slice should do inside another builder's surface.
 *
 * No storage, Library, clock or provider access.
 */

/** D-199 / ADR 0020: each saved review document is at most 2,500,000 serialized UTF-8 bytes. */
export const REVIEW_RECORD_BYTES = 2_500_000;
/** Same raw depth ceiling as the accepted workflow/thread readers. */
export const REVIEW_RECORD_DEPTH = 64;

export type StrictJsonRefusal =
  | "invalid-json"
  | "invalid-utf8"
  | "byte-order-mark"
  | "duplicate-key"
  | "invalid-unicode"
  | "lossy-number"
  | "value-depth"
  | "record-overflow"
  | "non-data-value"
  | "cyclic-value"
  | "non-plain-value"
  | "sparse-or-extended-array"
  | "non-data-property"
  | "symbol-property";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

function refuse(code: StrictJsonRefusal): never {
  if (code === "record-overflow") {
    throw new ReviewRecordError(
      "too-large",
      `This review record is larger than the ${REVIEW_RECORD_BYTES.toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
    );
  }
  if (code === "invalid-unicode") {
    throw new ReviewRecordError(
      "corrupt",
      "This review record contains text that is not valid Unicode. The file was left untouched."
    );
  }
  if (code === "duplicate-key") {
    throw new ReviewRecordError(
      "corrupt",
      "This review record names the same field twice. The file was left untouched so no value is silently chosen."
    );
  }
  if (code === "lossy-number") {
    throw new ReviewRecordError(
      "corrupt",
      "This review record contains a number this version cannot preserve exactly. The file was left untouched."
    );
  }
  if (code === "value-depth" || code === "cyclic-value" || code === "sparse-or-extended-array") {
    throw new ReviewRecordError(
      "corrupt",
      "This review record nests data too deeply or is not ordinary JSON. The file was left untouched."
    );
  }
  if (code === "non-data-value" || code === "non-plain-value" || code === "non-data-property" || code === "symbol-property") {
    throw new ReviewRecordError("invalid", "A review record may hold only ordinary JSON data. Nothing was written.");
  }
  throw new ReviewRecordError(
    "corrupt",
    "This review record is not valid UTF-8 JSON. The file was left untouched."
  );
}

function requireValue(condition: unknown, code: StrictJsonRefusal): asserts condition {
  if (!condition) refuse(code);
}

function wellFormed(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++index);
      requireValue(low >= 0xdc00 && low <= 0xdfff, "invalid-unicode");
    } else requireValue(unit < 0xdc00 || unit > 0xdfff, "invalid-unicode");
  }
}

/** Exact decimal identity for a JSON number token, without first rounding it through a double. */
function decimalValue(token: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power = Number(match[4] ?? 0) - fraction.length + digits.length - significant.length;
  if (!Number.isSafeInteger(power)) return null;
  return `${match[1] ?? ""}${significant}e${power}`;
}

function losslessNumber(token: string): number {
  const value = Number(token);
  requireValue(
    Number.isFinite(value) && !Object.is(value, -0) && Math.abs(value) <= Number.MAX_SAFE_INTEGER,
    "lossy-number"
  );
  requireValue(decimalValue(token) === decimalValue(String(value)), "lossy-number");
  return value;
}

class Reader {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly maxDepth: number
  ) {}

  parse(): unknown {
    this.space();
    const value = this.value(0);
    this.space();
    requireValue(this.index === this.source.length, "invalid-json");
    return value;
  }

  private space(): void {
    while (WHITESPACE.has(this.source.charCodeAt(this.index))) this.index++;
  }

  private value(depth: number): unknown {
    requireValue(depth <= this.maxDepth, "value-depth");
    this.space();
    const code = this.source.charCodeAt(this.index);
    if (code === 0x7b) return this.object(depth);
    if (code === 0x5b) return this.array(depth);
    if (code === 0x22) return this.string();
    if (code === 0x74) {
      this.literal("true");
      return true;
    }
    if (code === 0x66) {
      this.literal("false");
      return false;
    }
    if (code === 0x6e) {
      this.literal("null");
      return null;
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return this.number();
    refuse("invalid-json");
  }

  private object(depth: number): Record<string, unknown> {
    this.index++;
    this.space();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.source.charCodeAt(this.index) === 0x7d) {
      this.index++;
      return result;
    }
    for (;;) {
      this.space();
      requireValue(this.source.charCodeAt(this.index) === 0x22, "invalid-json");
      const key = this.string();
      // JSON would keep the last duplicate silently; a checked record must not choose for the author.
      requireValue(!keys.has(key), "duplicate-key");
      keys.add(key);
      this.space();
      requireValue(this.source.charCodeAt(this.index) === 0x3a, "invalid-json");
      this.index++;
      const value = this.value(depth + 1);
      Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      this.space();
      const code = this.source.charCodeAt(this.index);
      if (code === 0x2c) {
        this.index++;
        continue;
      }
      requireValue(code === 0x7d, "invalid-json");
      this.index++;
      return result;
    }
  }

  private array(depth: number): unknown[] {
    this.index++;
    this.space();
    const result: unknown[] = [];
    if (this.source.charCodeAt(this.index) === 0x5d) {
      this.index++;
      return result;
    }
    for (;;) {
      result.push(this.value(depth + 1));
      this.space();
      const code = this.source.charCodeAt(this.index);
      if (code === 0x2c) {
        this.index++;
        continue;
      }
      requireValue(code === 0x5d, "invalid-json");
      this.index++;
      return result;
    }
  }

  private string(): string {
    requireValue(this.source.charCodeAt(this.index) === 0x22, "invalid-json");
    this.index++;
    let result = "";
    for (;;) {
      requireValue(this.index < this.source.length, "invalid-json");
      const code = this.source.charCodeAt(this.index++);
      if (code === 0x22) {
        wellFormed(result);
        return result;
      }
      if (code === 0x5c) {
        requireValue(this.index < this.source.length, "invalid-json");
        const escapeCode = this.source.charCodeAt(this.index++);
        if (escapeCode === 0x22) result += '"';
        else if (escapeCode === 0x5c) result += "\\";
        else if (escapeCode === 0x2f) result += "/";
        else if (escapeCode === 0x62) result += "\b";
        else if (escapeCode === 0x66) result += "\f";
        else if (escapeCode === 0x6e) result += "\n";
        else if (escapeCode === 0x72) result += "\r";
        else if (escapeCode === 0x74) result += "\t";
        else if (escapeCode === 0x75) {
          requireValue(this.index + 4 <= this.source.length, "invalid-json");
          const hex = this.source.slice(this.index, this.index + 4);
          requireValue(/^[0-9a-fA-F]{4}$/.test(hex), "invalid-json");
          result += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 4;
        } else refuse("invalid-json");
      } else {
        requireValue(code >= 0x20, "invalid-json");
        result += String.fromCharCode(code);
      }
    }
  }

  private literal(word: string): void {
    requireValue(this.source.startsWith(word, this.index), "invalid-json");
    this.index += word.length;
  }

  private number(): number {
    const start = this.index;
    if (this.source.charCodeAt(this.index) === 0x2d) this.index++;
    const first = this.source.charCodeAt(this.index);
    if (first === 0x30) this.index++;
    else {
      requireValue(first >= 0x31 && first <= 0x39, "invalid-json");
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    if (this.source.charCodeAt(this.index) === 0x2e) {
      this.index++;
      requireValue(this.digit(this.source.charCodeAt(this.index)), "invalid-json");
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    const exponent = this.source.charCodeAt(this.index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.index++;
      const sign = this.source.charCodeAt(this.index);
      if (sign === 0x2b || sign === 0x2d) this.index++;
      requireValue(this.digit(this.source.charCodeAt(this.index)), "invalid-json");
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    const token = this.source.slice(start, this.index);
    const next = this.source.charCodeAt(this.index);
    requireValue(
      Number.isNaN(next) || WHITESPACE.has(next) || next === 0x2c || next === 0x5d || next === 0x7d,
      "invalid-json"
    );
    return losslessNumber(token);
  }

  private digit(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
  }
}

function parseJsonBytes(bytes: Uint8Array, maxDepth: number): unknown {
  requireValue(bytes.length > 0, "invalid-json");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    refuse("byte-order-mark");
  }
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    refuse("invalid-utf8");
  }
  requireValue(source.charCodeAt(0) !== 0xfeff, "byte-order-mark");
  return new Reader(source, maxDepth).parse();
}

export interface StrictJsonOptions {
  /** Test/recovery override; never above the record ceiling. */
  maxBytes?: number;
  maxDepth?: number;
}

/** Exact bytes to a lossless in-memory value. Refuses before any semantic record exists. */
export function decodeStrictJsonBytes(bytes: Uint8Array, options: StrictJsonOptions = {}): unknown {
  const limit = Math.min(options.maxBytes ?? REVIEW_RECORD_BYTES, REVIEW_RECORD_BYTES);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new ReviewRecordError("invalid", "The review record size limit is not valid.");
  }
  requireValue(bytes instanceof Uint8Array, "non-data-value");
  requireValue(bytes.byteLength <= limit, "record-overflow");
  return parseJsonBytes(bytes, options.maxDepth ?? REVIEW_RECORD_DEPTH);
}

/**
 * Compact canonical spelling: object keys in UTF-16 code-unit order, no insignificant whitespace and
 * no trailing newline. Strings, array order and exact numeric values survive untouched.
 */
export function canonicalJsonText(value: unknown, options: { maxDepth?: number } = {}): string {
  const maxDepth = options.maxDepth ?? REVIEW_RECORD_DEPTH;
  const active = new Set<object>();
  const visit = (input: unknown, depth: number): string => {
    requireValue(depth <= maxDepth, "value-depth");
    if (input === null) return "null";
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      requireValue(Number.isFinite(input) && Math.abs(input) <= Number.MAX_SAFE_INTEGER && !Object.is(input, -0), "lossy-number");
      const encoded = JSON.stringify(input);
      requireValue(encoded !== undefined, "non-data-value");
      return encoded;
    }
    if (typeof input === "string") {
      wellFormed(input);
      return JSON.stringify(input);
    }
    requireValue(typeof input === "object" && input !== null, "non-data-value");
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    requireValue(
      prototype === (array ? Array.prototype : Object.prototype) || prototype === null,
      "non-plain-value"
    );
    requireValue(!active.has(input), "cyclic-value");
    active.add(input);
    const keys = Reflect.ownKeys(input);
    let output: string;
    if (array) {
      const length = (input as unknown[]).length;
      requireValue(keys.length === length + 1, "sparse-or-extended-array");
      const items: string[] = [];
      for (let index = 0; index < length; index++) {
        const property = Object.getOwnPropertyDescriptor(input, String(index));
        requireValue(property && "value" in property && property.enumerable, "non-data-property");
        items.push(visit(property.value, depth + 1));
      }
      output = `[${items.join(",")}]`;
    } else {
      const names: string[] = [];
      for (const key of keys) {
        requireValue(typeof key === "string", "symbol-property");
        names.push(key);
      }
      names.sort();
      const members: string[] = [];
      for (const key of names) {
        wellFormed(key);
        const property = Object.getOwnPropertyDescriptor(input, key);
        requireValue(property && "value" in property && property.enumerable, "non-data-property");
        members.push(`${JSON.stringify(key)}:${visit(property.value, depth + 1)}`);
      }
      output = `{${members.join(",")}}`;
    }
    active.delete(input);
    return output;
  };
  return visit(value, 0);
}

/** Canonical bytes, bounded before anything touches storage. */
export function encodeCanonicalJson(value: unknown, options: StrictJsonOptions = {}): Uint8Array {
  const limit = Math.min(options.maxBytes ?? REVIEW_RECORD_BYTES, REVIEW_RECORD_BYTES);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new ReviewRecordError("invalid", "The review record size limit is not valid.");
  }
  const bytes = encoder.encode(canonicalJsonText(value, { maxDepth: options.maxDepth ?? REVIEW_RECORD_DEPTH }));
  requireValue(bytes.byteLength <= limit, "record-overflow");
  return bytes;
}

export function jsonBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
