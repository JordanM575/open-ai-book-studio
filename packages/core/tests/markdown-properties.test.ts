import { describe, expect, test } from "bun:test";
import {
  chapterFileName,
  countWords,
  isConflictCopyName,
  normalizeBody,
  parseChapterFile,
  parseOrderFromFileName,
  serializeChapter,
  slugify
} from "../src/markdown";
import { chapterMetaSchema } from "../src/schema";

/**
 * Deterministic format properties (spec 012 T007). No sampling library: a
 * fixed-seed mulberry32 generator produces the same synthetic cases every run,
 * and every property asserts an invariant rather than a golden value.
 */

/** mulberry32 with a fixed seed. Same seed, same cases, every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "lighthouse", "keeper", "counted", "gulls", "evening", "wrong", "again",
  "Élodie", "sails", "⛵", "salt", "stone", "—", "...", "#", "---",
  "'quoted'", '"double"', "back\\slash", "under_score", "CAPS", "x"
];
const GAPS = [" ", " ", " ", "\n", "\n\n", "  \n  ", "\r\n", "\r", "\t", "\n\n\n"];

function sampleText(rand: () => number, maxParts: number): string {
  const parts = 1 + Math.floor(rand() * maxParts);
  let text = "";
  for (let i = 0; i < parts; i += 1) {
    text += WORDS[Math.floor(rand() * WORDS.length)];
    if (i + 1 < parts) text += GAPS[Math.floor(rand() * GAPS.length)];
  }
  if (rand() < 0.3) text = "\n\n" + text;
  if (rand() < 0.3) text = text + "\n";
  return text;
}

function sampleId(rand: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-";
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += alphabet[Math.floor(rand() * alphabet.length)];
  return `ch_${suffix}`;
}

const ARCS = ["beginning", "middle", "end"] as const;
const STAMP = "2026-11-03T00:00:00.000Z";

describe("markdown format properties", () => {
  test("front matter round-trips any metadata and body", () => {
    const rand = mulberry32(0x029001);
    for (let i = 0; i < 250; i += 1) {
      const meta = chapterMetaSchema.parse({
        id: sampleId(rand),
        title: sampleText(rand, 6).replace(/\r/g, ""),
        order: 1 + Math.floor(rand() * 9999),
        arc: ARCS[Math.floor(rand() * ARCS.length)],
        purpose: sampleText(rand, 8),
        synopsis: sampleText(rand, 8),
        notes: sampleText(rand, 8),
        isPrologue: rand() < 0.2,
        color: rand() < 0.2 ? "#123456" : null,
        version: Math.floor(rand() * 50),
        createdAt: STAMP,
        updatedAt: STAMP
      });
      const body = sampleText(rand, 40);
      const raw = serializeChapter(meta, body);
      const read = parseChapterFile(raw, "property.md", meta);
      expect(read.meta).toEqual(meta);
      expect(read.content).toBe(normalizeBody(body));
    }
  });

  test("normalizeBody is idempotent and canonical", () => {
    const rand = mulberry32(0x029002);
    for (let i = 0; i < 250; i += 1) {
      const input = sampleText(rand, 30);
      const once = normalizeBody(input);
      expect(normalizeBody(once)).toBe(once);
      expect(once.includes("\r")).toBe(false);
      if (once !== "") {
        expect(once.endsWith("\n")).toBe(true);
        expect(once.endsWith("\n\n")).toBe(false);
        expect(once.startsWith("\n")).toBe(false);
      }
    }
  });

  test("slugify always yields a safe, bounded, deterministic slug", () => {
    const rand = mulberry32(0x029003);
    for (let i = 0; i < 250; i += 1) {
      const input = sampleText(rand, 12);
      const maxLength = 10 + Math.floor(rand() * 60);
      const slug = slugify(input, maxLength);
      expect(slug.length <= maxLength).toBe(true);
      expect(slugify(input, maxLength)).toBe(slug);
      if (slug === "chapter") continue;
      expect(/^[a-z0-9-]+$/.test(slug)).toBe(true);
      expect(slug.startsWith("-") || slug.endsWith("-")).toBe(false);
    }
    expect(slugify("", 60)).toBe("chapter");
    expect(slugify("---", 60)).toBe("chapter");
  });

  test("chapterFileName carries its order past parseOrderFromFileName", () => {
    const rand = mulberry32(0x029004);
    // The file-name convention is four digits (orders 1-9999); longer orders are
    // not a file-name range, so the property holds within the designed bound.
    for (let i = 0; i < 250; i += 1) {
      const order = 1 + Math.floor(rand() * 9999);
      const title = sampleText(rand, 6);
      expect(parseOrderFromFileName(chapterFileName(order, title))).toBe(order);
    }
  });

  test("conflict copies never look like chapters and back", () => {
    const rand = mulberry32(0x029005);
    for (let i = 0; i < 250; i += 1) {
      const order = 1 + Math.floor(rand() * 9999);
      expect(isConflictCopyName(chapterFileName(order, sampleText(rand, 4)))).toBe(false);
      const device = `device_${Math.floor(rand() * 1e9)}`;
      const stamp = `2026-11-0${1 + Math.floor(rand() * 9)}T00-00-00-000Z`;
      const conflict = `0001-chapter.conflict-newer-version.${device}.${stamp}.md`;
      expect(isConflictCopyName(conflict)).toBe(true);
      expect(isConflictCopyName(`notes (conflicted copy).md`)).toBe(true);
    }
  });

  test("normalization never changes the word count", () => {
    const rand = mulberry32(0x029006);
    for (let i = 0; i < 250; i += 1) {
      const input = sampleText(rand, 30);
      expect(countWords(normalizeBody(input))).toBe(countWords(input));
    }
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t \n")).toBe(0);
  });
});
