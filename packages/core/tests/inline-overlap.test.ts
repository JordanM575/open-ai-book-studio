import { describe, expect, test } from "bun:test";
import { buildOverlapIndex, inlineSpanKey, overlapAt, type InlineSpan } from "../src/review/inline/overlap";

function span(id: string, from: number, to: number, extra: Partial<InlineSpan> = {}): InlineSpan {
  return { runId: "run", findingId: id, evidenceId: "e", spanId: "s", category: "clarity", from, to, quote: "synthetic", ...extra };
}

describe("complete inline overlap index", () => {
  test("endpoint sweep retains all members of three-way overlap without bridging gaps", () => {
    const index = buildOverlapIndex([span("a", 1, 8), span("b", 4, 11), span("c", 6, 7), span("a", 14, 16, { spanId: "second" })], 20);
    expect(index.segments.map((part) => [part.from, part.to, part.members.map((member) => member.findingId)])).toEqual([
      [1, 4, ["a"]], [4, 6, ["a", "b"]], [6, 7, ["a", "b", "c"]], [7, 8, ["a", "b"]], [8, 11, ["b"]], [14, 16, ["a"]]
    ]);
    expect(overlapAt(index, 11)).toBeNull();
    expect(overlapAt(index, 13)).toBeNull();
    expect(overlapAt(index, 14)?.members[0]?.spanId).toBe("second");
  });

  test("same quotes at different offsets, adjacency and equal spans keep independent identities", () => {
    const index = buildOverlapIndex([span("b", 0, 2), span("a", 0, 2), span("a", 2, 4, { spanId: "2" })], 4);
    expect(overlapAt(index, 1)?.members.map(inlineSpanKey)).toEqual([inlineSpanKey(span("a", 0, 2)), inlineSpanKey(span("b", 0, 2))]);
    expect(overlapAt(index, 2)?.members.map((item) => item.spanId)).toEqual(["2"]);
    expect(overlapAt(index, 4)).toBeNull();
  });

  test("sort is category/run/finding/evidence/span deterministic, independent of input order and locale", () => {
    const spans = [span("z", 0, 2, { category: "a" }), span("a", 0, 2, { category: "z" }), span("a", 0, 2, { category: "a", runId: "other" })];
    expect(buildOverlapIndex(spans, 2)).toEqual(buildOverlapIndex([...spans].reverse(), 2));
    expect(buildOverlapIndex(spans, 2).segments[0]?.members.map((item) => item.runId + item.findingId)).toEqual(["othera", "runz", "runa"]);
  });

  test("rejects invalid rendering bounds and duplicate identities, including sparse arrays", () => {
    for (const [from, to] of [[0, 0], [-1, 2], [0, 21], [0.5, 2], [NaN, 2], [1, Infinity]] as const) {
      expect(() => buildOverlapIndex([span("x", from, to)], 20)).toThrow();
    }
    expect(() => buildOverlapIndex([span("x", 0, 2), span("x", 3, 5)], 20)).toThrow();
    expect(() => buildOverlapIndex(new Array<InlineSpan>(2), 20)).toThrow();
    expect(overlapAt(buildOverlapIndex([], 0), NaN)).toBeNull();
  });

  test("freezes detached records and collision-free prototype-like IDs", () => {
    const input = { ...span("__proto__", 0, 2) };
    const index = buildOverlapIndex([input, span("constructor", 0, 2)], 3);
    input.from = 1;
    expect(index.spans[0]?.from).toBe(0);
    expect(Object.isFrozen(index.segments[0]?.members[0])).toBe(true);
    expect(inlineSpanKey(span("a:b", 0, 1, { evidenceId: "c" }))).not.toBe(inlineSpanKey(span("a", 0, 1, { evidenceId: "b:c" })));
  });

  test("dense deterministic oracle compares every unit with all original memberships", () => {
    const spans = Array.from({ length: 160 }, (_, i) => span(String(i), (i * 17) % 101, (i * 17) % 101 + 1 + (i % 19)));
    const index = buildOverlapIndex(spans, 120);
    for (let at = 0; at < 120; at += 1) {
      const expected = spans.filter((item) => item.from <= at && item.to > at).map(inlineSpanKey).sort();
      expect((overlapAt(index, at)?.members ?? []).map(inlineSpanKey).sort()).toEqual(expected);
    }
  });
});
