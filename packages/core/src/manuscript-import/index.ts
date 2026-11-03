import { z } from "zod";
import { countWords } from "../markdown";

/**
 * Pure first-profile manuscript intake (spec 029 T005, decisions 1–2).
 *
 * No Node, Electron, DOM or provider imports. The desktop main process owns the
 * file picker and reads; this module validates, splits and previews text only.
 * Markdown stays literal: headings and front-matter-like text are body content,
 * never metadata. The source is never modified.
 */

/** Maximum accepted source size: 5 MiB, conservative against proven IPC round-trips. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown"] as const;
export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** Whitespace-only lines count as blank under the canonical body rules. */
const BLANK_LINE = /^\s*$/u;

/** Control characters that always refuse the source, after newline normalization. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the ranges ARE the refusal list — control bytes refuse the import source
const REJECTED_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;

export type SourceRefusalReason =
  | "unsupported-extension"
  | "too-large"
  | "invalid-encoding"
  | "rejected-characters"
  | "empty";

export interface SourceRefusal {
  status: "refused";
  reason: SourceRefusalReason;
  /** Actionable copy; never includes a host path. */
  message: string;
}

/** Shared wording for extension refusals so main and renderer stay consistent. */
export function refuseUnsupportedExtension(fileName: string): SourceRefusal {
  return {
    status: "refused",
    reason: "unsupported-extension",
    message: `“${fileName}” is not a supported manuscript file. Choose a .txt, .md or .markdown file.`
  };
}

export interface ValidatedSource {
  status: "validated";
  /** File name as chosen, without any host directory. */
  fileName: string;
  /** Proposed book title: the basename without extension, still editable by the author. */
  proposedTitle: string;
  /** Decoded text with one leading BOM stripped; newlines not yet normalized. */
  text: string;
  /** True when exactly one leading byte-order mark was stripped. */
  strippedBom: boolean;
}

export interface ImportChapterDraft {
  /** 1-based chapter number for the default title. */
  order: number;
  /** Author-editable title; defaults to `Chapter N`. */
  title: string;
  /** Canonical body: LF newlines, no edge blank lines, exactly one final newline. */
  body: string;
  /** 1-based first and last source line numbers, inclusive. */
  startLine: number;
  endLine: number;
  wordCount: number;
}

export interface ImportNormalization {
  strippedBom: boolean;
  newlineStyle: "lf" | "crlf" | "cr" | "mixed";
  /** Edge blank lines the canonical rules removed, identified per chapter. */
  edgeBlankLines: Array<{ order: number; leadingRemoved: number; trailingRemoved: number }>;
}

export interface ImportPreview {
  fileName: string;
  bookTitle: string;
  chapters: ImportChapterDraft[];
  wordCount: number;
  normalization: ImportNormalization;
}

/**
 * Validate one selected source file. Refusals name the reason and the accepted
 * input; nothing is guessed, truncated or decoded loosely.
 */
export function validateSource(input: { fileName: string; bytes: Uint8Array }): ValidatedSource | SourceRefusal {
  const fileName = input.fileName.split("/").pop() ?? input.fileName;
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return refuseUnsupportedExtension(fileName);
  }
  if (input.bytes.byteLength > MAX_SOURCE_BYTES) {
    return {
      status: "refused",
      reason: "too-large",
      message: `“${fileName}” is larger than the 5 MiB import limit. Choose a smaller file.`
    };
  }
  let bytes = input.bytes;
  let strippedBom = false;
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    strippedBom = true;
    bytes = bytes.slice(3);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      status: "refused",
      reason: "invalid-encoding",
      message: `“${fileName}” is not valid UTF-8 text. Save it as UTF-8 and try again.`
    };
  }
  if (REJECTED_CONTROL.test(text)) {
    return {
      status: "refused",
      reason: "rejected-characters",
      message: `“${fileName}” contains NUL or control characters that cannot become chapter text. Remove them and try again.`
    };
  }
  if (text.trim().length === 0) {
    return {
      status: "refused",
      reason: "empty",
      message: `“${fileName}” has no readable text. Choose a file with manuscript content.`
    };
  }
  return {
    status: "validated",
    fileName,
    proposedTitle: dot === -1 ? fileName : fileName.slice(0, dot),
    text,
    strippedBom
  };
}

/** Normalize CRLF and CR to LF, reporting the original mixture for the preview. */
function normalizeNewlines(text: string): { normalized: string; newlineStyle: ImportNormalization["newlineStyle"] } {
  const hasCrlf = text.includes("\r\n");
  const withoutCrlf = text.replace(/\r\n/gu, "\n");
  const hasCr = withoutCrlf.includes("\r");
  const normalized = withoutCrlf.replace(/\r/gu, "\n");
  return {
    normalized,
    newlineStyle: hasCrlf && hasCr ? "mixed" : hasCrlf ? "crlf" : hasCr ? "cr" : "lf"
  };
}

/**
 * Map validated text to chapters. The default is one chapter holding the whole file;
 * `splits` holds 1-based line numbers where a new chapter starts, applied in order.
 * Every nonblank source line lands in exactly one chapter; edge blank lines removed
 * by the canonical rules are reported per chapter rather than silently dropped.
 */
export function previewImport(validated: ValidatedSource, splits: readonly number[] = []): ImportPreview {
  const { normalized, newlineStyle } = normalizeNewlines(validated.text);
  const lines = normalized.split("\n");
  // A trailing final newline is a terminator, not an extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const boundaries = [...new Set(splits.filter((line) => Number.isInteger(line) && line > 1 && line <= lines.length))].sort(
    (a, b) => a - b
  );
  const starts = [1, ...boundaries];

  const chapters: ImportChapterDraft[] = [];
  const edgeBlankLines: ImportNormalization["edgeBlankLines"] = [];
  starts.forEach((startLine, index) => {
    const endLine = index + 1 < starts.length ? starts[index + 1]! - 1 : lines.length;
    const span = lines.slice(startLine - 1, endLine);
    let leadingRemoved = 0;
    while (leadingRemoved < span.length && BLANK_LINE.test(span[leadingRemoved]!)) leadingRemoved += 1;
    let trailingRemoved = 0;
    while (trailingRemoved < span.length - leadingRemoved && BLANK_LINE.test(span[span.length - 1 - trailingRemoved]!)) {
      trailingRemoved += 1;
    }
    const kept = span.slice(leadingRemoved, span.length - trailingRemoved);
    const body = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    const order = index + 1;
    edgeBlankLines.push({ order, leadingRemoved, trailingRemoved });
    chapters.push({
      order,
      title: `Chapter ${order}`,
      body,
      startLine,
      endLine,
      wordCount: countWords(body)
    });
  });

  return {
    fileName: validated.fileName,
    bookTitle: validated.proposedTitle,
    chapters,
    wordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    normalization: { strippedBom: validated.strippedBom, newlineStyle, edgeBlankLines }
  };
}

/**
 * The renderer-to-main import contract (spec 029 T010). The mapping carries
 * titles and text only: strict objects reject smuggled filesystem paths, and
 * sizes stay near the accepted 5 MiB source ceiling so one call cannot exhaust
 * the bridge. The desktop handler parses every payload with this schema.
 */
export const importManuscriptInputSchema = z.strictObject({
  bookTitle: z.string().min(1).max(300),
  chapters: z
    .array(
      z.strictObject({
        title: z.string().max(300),
        content: z.string().max(6_000_000)
      })
    )
    .min(1)
    .max(200)
});

export type ImportManuscriptInput = z.infer<typeof importManuscriptInputSchema>;

/** Reasons a picked source never becomes a preview: the core refusals plus main-process read failures. */
export type ImportSourceReadIssue = SourceRefusalReason | "not-found" | "unreadable";

/**
 * What choosing a file yields (spec 029 T011). A cancellation is silent; a
 * refusal names only the file; a ready source carries text, never a host path.
 */
export type ImportSourcePick =
  | { status: "cancelled" }
  | { status: "ready"; source: ValidatedSource }
  | { status: "refused"; reason: ImportSourceReadIssue | "unsupported-platform"; message: string };

/** The studio imports chapter text and titles only. This note says so, verbatim, in every result report. */
export const IMPORT_NOT_IMPORTED_NOTE =
  "Planning data, images and other metadata were not imported. Only chapter text and titles were.";

export interface ImportReportChapter {
  order: number;
  title: string;
  /** 1-based source line range the chapter was split from. */
  startLine: number;
  endLine: number;
  /** Counted from the committed chapter body, never from the preview. */
  wordCount: number;
}

export interface ImportResultReport {
  /** File name as chosen, without any host directory. */
  sourceName: string;
  bookId: string;
  bookTitle: string;
  chapters: ImportReportChapter[];
  totalWords: number;
  normalization: ImportNormalization;
  notImportedNote: string;
}

/**
 * Build the final result report (spec 029 T012). Every count comes from the
 * committed book the library read back, independently of the preview mapping:
 * pass the published detail through and the report cannot repeat uncommitted
 * numbers. Full host paths never enter the report; callers pass display names.
 */
export function buildImportReport(input: {
  sourceName: string;
  normalization: ImportNormalization;
  splits: Array<{ order: number; startLine: number; endLine: number }>;
  published: { bookId: string; bookTitle: string; chapters: Array<{ title: string; body: string }> };
}): ImportResultReport {
  const chapters = input.published.chapters.map((chapter, index) => {
    const split = input.splits[index];
    return {
      order: index + 1,
      title: chapter.title,
      startLine: split?.startLine ?? 0,
      endLine: split?.endLine ?? 0,
      wordCount: countWords(chapter.body)
    };
  });
  return {
    sourceName: input.sourceName,
    bookId: input.published.bookId,
    bookTitle: input.published.bookTitle,
    chapters,
    totalWords: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    normalization: input.normalization,
    notImportedNote: IMPORT_NOT_IMPORTED_NOTE
  };
}
