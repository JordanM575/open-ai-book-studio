export interface TranscriptInsertion {
  text: string;
  caret: number;
}

/**
 * Insert dictated text at a selection, adding only the spaces the surrounding text needs.
 * Returns null for an empty transcript so the editor can leave the chapter untouched.
 */
export function insertTranscript(
  text: string,
  transcript: string,
  start: number,
  end: number
): TranscriptInsertion | null {
  const clean = transcript.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const before = text.slice(0, from);
  const after = text.slice(to);
  const prefix = before && !/\s$/.test(before) && !/[([{“‘]$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) && !/^[.,;:!?…)\]}%]/.test(after) ? " " : "";
  const inserted = `${prefix}${clean}${suffix}`;
  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + inserted.length
  };
}
