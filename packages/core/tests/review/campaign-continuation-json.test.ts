import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/review/contract";
import { ReviewRecordError } from "../../src/review/record-error";
import {
  canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson, REVIEW_RECORD_BYTES,
  visitCanonicalJsonBytes
} from "../../src/review/record-json";

function streamed(value: unknown, limit = 2_500_000): { text: string; bytes: number; hash: string; maxChunk: number } {
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let maxChunk = 0;
  const bytes = visitCanonicalJsonBytes(value, limit, (chunk) => {
    chunks.push(chunk);
    hash.update(chunk);
    maxChunk = Math.max(maxChunk, chunk.length);
  });
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), bytes, hash: hash.digest("hex"), maxChunk };
}

describe("bounded canonical JSON visitor", () => {
  test("matches both existing canonical spellings and SHA-256 with Unicode, escaping and own __proto__", () => {
    const own = Object.defineProperty({ b: "\u0000\b\t\n\f\r\"\\", a: "🧪é" }, "__proto__", { value: { z: 1 }, enumerable: true });
    const values: unknown[] = [null, true, false, 0, -1.5, 1e-7, [], {}, own,
      { z: [1, null, false, "x"], "🧪": `${"a".repeat(4095)}🧪\\"\u0001` }];
    for (const value of values) {
      const actual = streamed(value);
      const expected = canonicalJsonText(value);
      expect(actual.text).toBe(expected);
      expect(actual.text).toBe(canonicalJson(value));
      expect(actual.bytes).toBe(Buffer.byteLength(expected));
      expect(actual.hash).toBe(createHash("sha256").update(expected).digest("hex"));
      expect(actual.maxChunk).toBeLessThanOrEqual(12_291);
    }
  });

  test("checks exact encoded bytes, including escaping and punctuation, before delivering an oversized chunk", () => {
    const value = { "\u0000": "🧪\\\"\n" };
    const expected = new TextEncoder().encode(canonicalJsonText(value));
    expect(streamed(value, expected.length).bytes).toBe(expected.length);
    let delivered = 0;
    expect(() => visitCanonicalJsonBytes(value, expected.length - 1, (chunk) => { delivered += chunk.length; })).toThrow(ReviewRecordError);
    expect(delivered).toBeLessThanOrEqual(expected.length - 1);
    expect(() => visitCanonicalJsonBytes(value, -1)).toThrow(ReviewRecordError);
  });

  test("measures the real expanded-plan limit and refuses the next byte", () => {
    const limit = 134_217_728;
    const text = "x".repeat(limit - 2);
    expect(visitCanonicalJsonBytes(text, limit)).toBe(limit);
    expect(() => visitCanonicalJsonBytes(`${text}x`, limit)).toThrow(ReviewRecordError);
  }, 30_000);

  test("does not raise ordinary document parser or encoder limits", () => {
    const value = "x".repeat(REVIEW_RECORD_BYTES - 2);
    expect(encodeCanonicalJson(value).length).toBe(REVIEW_RECORD_BYTES);
    expect(decodeStrictJsonBytes(encodeCanonicalJson(value))).toBe(value);
    const oversized = `${value}x`;
    expect(visitCanonicalJsonBytes(oversized, REVIEW_RECORD_BYTES + 1)).toBe(REVIEW_RECORD_BYTES + 1);
    expect(() => encodeCanonicalJson(oversized)).toThrow(ReviewRecordError);
    expect(() => decodeStrictJsonBytes(new Uint8Array(REVIEW_RECORD_BYTES + 1))).toThrow(ReviewRecordError);
  });

  test("refuses malformed in-memory values like the existing encoder", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = new Array(2);
    sparse[1] = 1;
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get: () => "no" });
    const symbol = { [Symbol("x")]: 1 };
    for (const value of [NaN, Infinity, -0, 9_007_199_254_740_992, "\ud800", { "\udc00": 1 },
      undefined, new Date(), sparse, accessor, symbol, cycle]) {
      expect(() => visitCanonicalJsonBytes(value, 100_000)).toThrow(ReviewRecordError);
      expect(() => canonicalJsonText(value)).toThrow(ReviewRecordError);
    }
    const shared = { value: "same" };
    expect(streamed([shared, shared]).text).toBe('[{"value":"same"},{"value":"same"}]');
    expect(() => visitCanonicalJsonBytes({ a: { b: 1 } }, 100, undefined, { maxDepth: 1 })).toThrow(ReviewRecordError);
  });
});
