/** Literal UTF-16 editor offsets. No whitespace folding, punctuation guessing or normalization. */
export function insertDictation(source: string, transcript: string, start: number, end: number): {
  readonly text: string;
  readonly caret: number;
} {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) {
    throw new RangeError("The selection is outside the source.");
  }
  const splitsSurrogate = (offset: number) => offset > 0 && offset < source.length &&
    /[\uD800-\uDBFF]/.test(source[offset - 1] ?? "") && /[\uDC00-\uDFFF]/.test(source[offset] ?? "");
  if (splitsSurrogate(start) || splitsSurrogate(end)) throw new RangeError("The selection splits a character.");
  return { text: source.slice(0, start) + transcript + source.slice(start), caret: start + transcript.length };
}
