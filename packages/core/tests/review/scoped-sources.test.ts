import { describe, expect, test } from "bun:test";
import { scalarCount } from "../../src/review/contract";
import { captureChapterSource, checkSavedQuoteNavigation, verifySavedBodyQuote } from "../../src/review/sources";
import { saved, selectedEnd, selectedStart, source, stamp } from "./scoped-fixtures";

const anchor = { bookId: saved.bookId, chapterId: saved.chapterId, version: saved.version, hash: saved.hash,
  start: selectedStart, end: selectedEnd, quote: saved.body.slice(selectedStart, selectedEnd) };

describe("saved-body exact quotes", () => {
  test("derives body lines and exact full-body coordinates from selected text", () => {
    expect(verifySavedBodyQuote(saved, anchor)).toEqual({ status: "verified", firstLine: 2, lastLine: 2 });
    expect(source().segments).toEqual([{ start: selectedStart, end: selectedEnd, text: anchor.quote, startLine: 2 }]);
    expect(JSON.stringify(source())).not.toContain("ADJACENT");
    expect(Object.isFrozen(source().segments[0])).toBe(true);
  });
  for (const [label, change] of Object.entries({
    negative: { start: -1 }, zero: { end: selectedStart }, backwards: { end: selectedStart - 1 },
    fractional: { start: selectedStart + 0.5 }, infinite: { end: Infinity }, nan: { start: NaN },
    oversized: { end: saved.body.length + 1 }, unsafe: { end: Number.MAX_SAFE_INTEGER + 1 },
    wrongBook: { bookId: "book_654321" }, wrongChapter: { chapterId: "ch_654321" },
    wrongHash: { hash: "b".repeat(64) }, wrongVersion: { version: saved.version + 1 },
    zeroVersion: { version: 0 }, invalidHash: { hash: "not-a-hash" }, pathId: { chapterId: "../chapter" }
  })) test(`rejects ${label}`, () => {
    expect(verifySavedBodyQuote(saved, { ...anchor, ...change }).status).toBe("invalid");
  });
  test("never splits surrogate pairs on either boundary", () => {
    const emoji = saved.body.indexOf("😀");
    expect(verifySavedBodyQuote(saved, { ...anchor, start: emoji, end: emoji + 2, quote: "😀" }).status).toBe("verified");
    expect(verifySavedBodyQuote(saved, { ...anchor, start: emoji + 1, quote: saved.body.slice(emoji + 1, anchor.end) }).status).toBe("invalid");
    expect(verifySavedBodyQuote(saved, { ...anchor, end: emoji + 1, quote: saved.body.slice(anchor.start, emoji + 1) }).status).toBe("invalid");
    expect(() => source(saved.body, emoji, emoji + 1)).toThrow();
  });
  test("requires membership in one selected range, not their bounding box", () => {
    expect(verifySavedBodyQuote(saved, anchor, [{ start: selectedStart, end: selectedEnd }]).status).toBe("verified");
    expect(verifySavedBodyQuote(saved, anchor, [{ start: selectedStart + 1, end: selectedEnd }]).status).toBe("invalid");
    expect(verifySavedBodyQuote(saved, anchor, [{ start: 0, end: selectedStart + 2 }, { start: selectedEnd - 2, end: saved.body.length }]).status).toBe("invalid");
    expect(verifySavedBodyQuote(saved, anchor, []).status).toBe("invalid");
  });
  test("does not normalize Unicode, punctuation, spaces, case or line endings", () => {
    const body = "é e\u0301 ’ '  A\nB\r\nC";
    const exact = { ...anchor, start: 0, end: body.length, quote: body };
    expect(verifySavedBodyQuote({ ...saved, body }, exact).status).toBe("verified");
    for (const quote of [body.normalize("NFC"), body.normalize("NFD"), body.toLowerCase(), body.replace("  ", " "), body.replace("’", "'"), body.replace("\r\n", "\n")]) {
      expect(verifySavedBodyQuote({ ...saved, body }, { ...exact, quote }).status).toBe("invalid");
    }
  });
  test("repeated quotes stay at their supplied position; no nearest match", () => {
    const body = "same wrong same";
    expect(verifySavedBodyQuote({ ...saved, body }, { ...anchor, start: 5, end: 9, quote: "same" }).status).toBe("invalid");
    expect(verifySavedBodyQuote({ ...saved, body }, { ...anchor, start: 11, end: 15, quote: "same" }).status).toBe("verified");
  });
  test("generic annotations have no 039-specific 500-scalar cap", () => {
    const body = "😀".repeat(501);
    expect(verifySavedBodyQuote({ ...saved, body }, { ...anchor, start: 0, end: body.length, quote: body }).status).toBe("verified");
  });
  test("newline-ending quotes label the last covered line rather than the next", () => {
    expect(verifySavedBodyQuote({ ...saved, body: "a\nb\n" }, { ...anchor, start: 0, end: 4, quote: "a\nb\n" })).toEqual({ status: "verified", firstLine: 1, lastLine: 2 });
  });
  test("merges overlapping/adjacent ranges, rejects empty selection, and keeps gaps private", () => {
    const capture = captureChapterSource({ sourceId: "selected", saved: { ...saved, body: "abcPRIVATEdef" }, bookTitle: "Book", title: "Chapter", position: 1,
      capturedAt: stamp, ranges: [{ start: 1, end: 3 }, { start: 0, end: 2 }, { start: 10, end: 13 }] });
    expect(capture.segments.map((part) => part.text)).toEqual(["abc", "def"]);
    expect(JSON.stringify(capture)).not.toContain("PRIVATE");
    expect(() => captureChapterSource({ sourceId: "selected", saved, bookTitle: "B", title: "C", position: 1, capturedAt: stamp, ranges: [] })).toThrow();
  });
  test("accepts safe maximum revision and rejects overflow and malformed scalar text", () => {
    expect(verifySavedBodyQuote({ ...saved, version: Number.MAX_SAFE_INTEGER }, { ...anchor, version: Number.MAX_SAFE_INTEGER }).status).toBe("verified");
    expect(verifySavedBodyQuote({ ...saved, version: Number.MAX_SAFE_INTEGER + 1 }, { ...anchor, version: Number.MAX_SAFE_INTEGER + 1 }).status).toBe("invalid");
    expect(scalarCount("a😀e\u0301")).toBe(4);
    for (const text of ["\ud800", "\udfff", "a\ud800b"]) expect(() => scalarCount(text)).toThrow();
  });
  test("fresh navigation requires unique identity and the same clean saved editor", () => {
    const editor = { clean: true, identity: saved };
    expect(checkSavedQuoteNavigation(anchor, [saved], editor)).toBe("ready");
    expect(checkSavedQuoteNavigation(anchor, [saved], { ...editor, clean: false })).toBe("stale");
    expect(checkSavedQuoteNavigation(anchor, [saved], { ...editor, identity: { ...saved, hash: "b".repeat(64) } })).toBe("stale");
    expect(checkSavedQuoteNavigation(anchor, [{ ...saved, version: 4 }], editor)).toBe("stale");
    expect(checkSavedQuoteNavigation(anchor, [], editor)).toBe("unavailable");
    expect(checkSavedQuoteNavigation(anchor, [saved, saved], editor)).toBe("unavailable");
    expect(checkSavedQuoteNavigation(anchor, [{ ...saved, chapterId: "ch_654321" }], editor)).toBe("unavailable");
  });
});
