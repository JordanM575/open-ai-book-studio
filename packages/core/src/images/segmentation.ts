export const MAX_SEGMENT_PROMPT = 200;

export interface SegmentationBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SegmentationMatch {
  objectId: string;
  confidence: number | null;
  /** The mask raster's own dimensions, not the source image's. */
  width: number;
  height: number;
  /** The half-open source-pixel box the raster covers. */
  bounds: SegmentationBox;
  /** Row-major 0/1 raster, exactly width * height entries. */
  raster: Uint8Array;
}

export interface SegmentationResult {
  prompt: string;
  model: string;
  matches: SegmentationMatch[];
  /** SAM reports no per-image cost in the response; never invent one. */
  costUsd: number | null;
}

/**
 * SAM accepts one short noun phrase. Commands, lists, negation and questions are refused before a
 * request so the author gets a useful message instead of an empty result.
 */
export function segmentPromptError(value: string): string | null {
  const prompt = value.trim();
  if (!prompt) return "Write a short noun phrase, such as “the lighthouse keeper”.";
  if (prompt.length > MAX_SEGMENT_PROMPT) {
    return `The prompt must be at most ${MAX_SEGMENT_PROMPT} characters.`;
  }
  if (/[;,+]/.test(prompt) || /\s+or\s+/i.test(prompt) || /\s+and\s+/i.test(prompt)) {
    return "Describe one thing at a time. Remove lists, “and” and “or”.";
  }
  if (/[?!]/.test(prompt)) return "Name the object; do not ask a question or give a command.";
  if (/\bnot\b|\bwithout\b|\bexcept\b/i.test(prompt)) {
    return "SAM does not handle negation. Describe the object that is there.";
  }
  if (/^\s*(find|segment|select|cut|remove|show|where)\b/i.test(prompt)) {
    return "Name the object, for example “red hat”, instead of a command.";
  }
  return null;
}
