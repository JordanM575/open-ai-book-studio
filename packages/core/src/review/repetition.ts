import type { ReviewEvidenceSpan, ReviewFinding, ReviewMetricDefinition, ReviewSourceSnapshot } from "./index";

export const REPETITION_VERSION = "repetition-v1";
export const REPETITION_DEFINITION: ReviewMetricDefinition = {
  id: REPETITION_VERSION,
  label: "Repeated three-token sequences · repetition-v1",
  definition:
    "Scan every overlapping three-token window within each saved chapter. Tokens contain Unicode letters, numbers and combining marks, with straight or curly apostrophes only internally. Compare NFC-normalized, locale-independent lowercase tokens with U+2019 folded to U+0027. Punctuation separates tokens; windows may cross sentence punctuation, never chapters. List sequences occurring at least twice across the book, retaining every occurrence and original UTF-16 span. No stopwords, stemming, ideal frequency or overuse verdict."
};

export interface RepetitionAnalysis {
  findings: readonly ReviewFinding[];
  /** These chapters contributed no tokens or evidence; callers must disclose the omissions. */
  rejectedChapterIds: readonly string[];
}

const TOKEN_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const SLICE_UNITS = 8_192;

/** Returns one scalar's UTF-16 width, or zero for an unpaired surrogate. */
function scalarWidth(body: string, offset: number): number {
  const unit = body.charCodeAt(offset);
  if (unit >= 0xdc00 && unit <= 0xdfff) return 0;
  if (unit < 0xd800 || unit > 0xdbff) return 1;
  const next = body.charCodeAt(offset + 1);
  return next >= 0xdc00 && next <= 0xdfff ? 2 : 0;
}

function normalizedToken(token: string): string {
  return token.normalize("NFC").toLowerCase().replaceAll("’", "'");
}

function tokenCharacterAt(body: string, offset: number): boolean {
  return offset >= 0 && offset < body.length && TOKEN_CHARACTER.test(body.slice(offset, offset + scalarWidth(body, offset)));
}

function continuesToken(body: string, offset: number, tokenStart: number): boolean {
  const character = body[offset];
  return tokenCharacterAt(body, offset) ||
    ((character === "'" || character === "’") && tokenStart >= 0 && tokenCharacterAt(body, offset + 1));
}

/** The previous scalar's start; callers have already checked the body's Unicode. */
function previousScalar(body: string, offset: number): number {
  const unit = body.charCodeAt(offset - 1);
  return offset - (unit >= 0xdc00 && unit <= 0xdfff ? 2 : 1);
}

export interface RepetitionEvidenceCheck {
  body: string;
  startOffset: number;
  endOffset: number;
  /** The selected finding's normalized comparison key, not its literal excerpt. */
  label: string;
}

/**
 * Check one claimed three-token window, not the report's counts or other occurrences. Interactive
 * callers MUST run this in a terminable worker: whole-token NFC is not cooperatively bounded.
 * No trimming or repairing: the scanner rejects malformed chapters, including trailing Unicode.
 */
export function matchesRepetitionEvidence({ body, startOffset: start, endOffset: end, label }: RepetitionEvidenceCheck): boolean {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > body.length) return false;
  for (let offset = 0; offset < body.length;) {
    const width = scalarWidth(body, offset);
    if (!width) return false;
    offset += width;
  }
  // A leading apostrophe is punctuation; an apostrophe after a token character joins that token.
  const before = previousScalar(body, start);
  if (!tokenCharacterAt(body, start) || tokenCharacterAt(body, before) ||
      ((body[before] === "'" || body[before] === "’") && tokenCharacterAt(body, previousScalar(body, before)))) return false;
  if (!tokenCharacterAt(body, previousScalar(body, end)) || continuesToken(body, end, start)) return false;

  const keys: string[] = [];
  let tokenStart = -1;
  for (let offset = start; offset < end;) {
    const width = scalarWidth(body, offset);
    if (!width || offset + width > end) return false;
    if (continuesToken(body, offset, tokenStart)) {
      if (tokenStart < 0) {
        if (keys.length === 3) return false;
        tokenStart = offset;
      }
    } else if (tokenStart >= 0) {
      keys.push(normalizedToken(body.slice(tokenStart, offset)));
      tokenStart = -1;
    }
    offset += width;
  }
  if (tokenStart >= 0) keys.push(normalizedToken(body.slice(tokenStart, end)));
  return keys.length === 3 && keys.join(" ") === label;
}

/**
 * Pure incremental scanner. Yields are work boundaries, never partial findings. Budgets carry
 * across chapters, including empty/short ones, and through final grouping. The async host may
 * stop between steps and discard the iterator. Native whole-token NFC/casing is NOT bounded by
 * these yields; interactive hosts must use an owned terminable worker. No I/O or persistence.
 */
export function* scanRepetitionSteps(source: ReviewSourceSnapshot): Generator<void, RepetitionAnalysis> {
  const groups = new Map<string, ReviewEvidenceSpan[]>();
  const rejectedChapterIds: string[] = [];
  let units = 0;
  for (const chapter of source.chapters) {
    if (++units >= SLICE_UNITS) { units = 0; yield; }
    if (chapter.status !== "saved") continue;
    const body = chapter.body;
    // Validate the entire chapter first: malformed trailing text cannot leave invented evidence.
    let valid = true;
    for (let offset = 0; offset < body.length;) {
      const width = scalarWidth(body, offset);
      if (width === 0) { valid = false; break; }
      offset += width;
      units += width;
      if (units >= SLICE_UNITS) { units = 0; yield; }
    }
    if (!valid) { rejectedChapterIds.push(chapter.chapterId); continue; }

    const window: Array<{ key: string; start: number }> = [];
    let tokenStart = -1;
    const finishToken = (end: number) => {
      if (tokenStart < 0) return;
      const key = normalizedToken(body.slice(tokenStart, end));
      window.push({ key, start: tokenStart });
      tokenStart = -1;
      const first = window[0];
      if (window.length < 3 || !first) return;
      const start = first.start;
      const phrase = window.map((token) => token.key).join(" ");
      const evidence: ReviewEvidenceSpan = {
        chapterId: chapter.chapterId,
        title: chapter.title,
        order: chapter.order,
        sourceVersion: chapter.version,
        sourceHash: chapter.hash,
        startOffset: start,
        endOffset: end,
        excerpt: body.slice(start, end)
      };
      const occurrences = groups.get(phrase);
      if (occurrences) occurrences.push(evidence);
      else groups.set(phrase, [evidence]);
      window.shift();
    };

    for (let offset = 0; offset < body.length;) {
      const width = scalarWidth(body, offset);
      if (continuesToken(body, offset, tokenStart)) {
        if (tokenStart < 0) tokenStart = offset;
      } else {
        finishToken(offset);
      }
      offset += width;
      units += width;
      if (units >= SLICE_UNITS) { units = 0; yield; }
    }
    finishToken(body.length);
  }

  const findings: ReviewFinding[] = [];
  let visited = 0;
  // Map insertion order is first occurrence in the supplied reading-order snapshot, not locale sort.
  for (const [phrase, evidence] of groups) {
    if (evidence.length >= 2) {
      findings.push({ id: `${REPETITION_VERSION}-${findings.length + 1}`, metricId: REPETITION_VERSION, label: phrase, evidence });
    }
    if (++visited % 256 === 0) yield;
  }
  return { findings, rejectedChapterIds };
}

/** Synchronous pure entry; interactive runs must isolate this work in a terminable worker. */
export function scanRepetition(source: ReviewSourceSnapshot): RepetitionAnalysis {
  const steps = scanRepetitionSteps(source);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
