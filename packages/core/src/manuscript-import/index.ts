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

/** Formats read as UTF-8 text by `validateSource`. */
export const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"] as const;
/** Word documents, converted in the desktop main process (D-183). */
export const DOCX_EXTENSION = ".docx";
export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, DOCX_EXTENSION] as const;
export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** Lower-cased extension with its dot, or "" when the name has none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

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
    message: `“${fileName}” is not a supported manuscript file. Choose a Word document (.docx) or a .txt, .md or .markdown file.`
  };
}

/** What a Word document cannot carry into a chapter body (D-183). */
export type ImportLossKind =
  | "table"
  | "image"
  | "footnote"
  | "endnote"
  | "comment"
  | "tracked-insertion"
  | "tracked-deletion"
  | "text-box"
  | "field"
  | "chart"
  | "equation"
  | "header"
  | "footer"
  | "link"
  | "underline"
  | "strikethrough"
  | "checkbox"
  | "symbol"
  | "other";

export interface ImportLossPlace {
  /** 1-based line of the converted text, when the item sits in the body flow. */
  line?: number;
  /** The Word heading the item falls under when only its section is known; null before the first heading. */
  heading?: string | null;
  /** A short excerpt or detail: note text, deleted words, a field code. */
  detail?: string;
}

export interface ImportLossItem {
  kind: ImportLossKind;
  /** Exact number found. */
  count: number;
  /** The first places found, at most `MAX_LOSS_PLACES`; `count` stays exact when there are more. */
  places: ImportLossPlace[];
}

export const MAX_LOSS_PLACES = 20;

/** What the Word conversion found beyond the text itself. */
export interface DocxSourceDetail {
  /** Lines of `text` that hold a Word heading, in document order. */
  headings: Array<{ line: number; level: number; text: string }>;
  /** Proposed chapter starts: the top-level heading lines. The author confirms or changes them. */
  proposedSplits: number[];
  /**
   * Blank lines the document itself holds: empty paragraphs and empty lines inside one.
   * The blank lines the conversion writes between blocks are separators and are not listed.
   */
  blankLines: number[];
  /** Everything the chapter bodies cannot carry, by kind, in a stable order. */
  loss: ImportLossItem[];
}

export interface ValidatedSource {
  status: "validated";
  /** File name as chosen, without any host directory. */
  fileName: string;
  /** Proposed book title: the basename without extension (or a Word Title paragraph), still editable by the author. */
  proposedTitle: string;
  /** Decoded text with one leading BOM stripped; newlines not yet normalized. For Word, the converted Markdown. */
  text: string;
  /** True when exactly one leading byte-order mark was stripped. */
  strippedBom: boolean;
  /** Present only for a converted Word document. */
  docx?: DocxSourceDetail;
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
  /** "docx" when the source was a converted Word document. */
  format: "text" | "docx";
  /** What the chapter bodies cannot carry; empty for text sources. */
  loss: ImportLossItem[];
}

/**
 * Validate one selected text source file. Refusals name the reason and the
 * accepted input; nothing is guessed, truncated or decoded loosely. Word
 * documents are converted by the desktop app, never decoded here as text.
 */
export function validateSource(input: { fileName: string; bytes: Uint8Array }): ValidatedSource | SourceRefusal {
  const fileName = input.fileName.split("/").pop() ?? input.fileName;
  const dot = fileName.lastIndexOf(".");
  const extension = extensionOf(fileName);
  if (extension === DOCX_EXTENSION) {
    return {
      status: "refused",
      reason: "unsupported-extension",
      message: `“${fileName}” is a Word document. Import it from the desktop app, which converts Word documents.`
    };
  }
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
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
 *
 * For a converted Word document, a chapter whose first nonblank line is a Word
 * heading takes that heading as its title instead of carrying it in the body, and
 * only blank lines the document itself holds count as removed: the blank lines
 * between converted blocks are separators the conversion wrote.
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
  const docx = validated.docx;
  const headings = new Map((docx?.headings ?? []).map((heading) => [heading.line, heading]));
  const documentBlanks = new Set(docx?.blankLines ?? []);
  const isBlank = (line: string): boolean => BLANK_LINE.test(line);

  const chapters: ImportChapterDraft[] = [];
  const edgeBlankLines: ImportNormalization["edgeBlankLines"] = [];
  starts.forEach((startLine, index) => {
    const endLine = index + 1 < starts.length ? starts[index + 1]! - 1 : lines.length;
    const span = lines.slice(startLine - 1, endLine);
    let first = 0;
    while (first < span.length && isBlank(span[first] ?? "")) first += 1;
    const heading = first < span.length ? headings.get(startLine + first) : undefined;
    let bodyStart = first;
    if (heading) {
      bodyStart = first + 1;
      while (bodyStart < span.length && isBlank(span[bodyStart] ?? "")) bodyStart += 1;
    }
    let bodyEnd = span.length;
    while (bodyEnd > bodyStart && isBlank(span[bodyEnd - 1] ?? "")) bodyEnd -= 1;
    // Text sources report every removed edge line; Word sources only the blank lines the document holds.
    const counted = (from: number, to: number): number => {
      let total = 0;
      for (let offset = from; offset < to; offset += 1) {
        if (!docx || documentBlanks.has(startLine + offset)) total += 1;
      }
      return total;
    };
    const leadingRemoved = counted(0, first) + (heading ? counted(first + 1, bodyStart) : 0);
    const trailingRemoved = counted(bodyEnd, span.length);
    const kept = span.slice(bodyStart, bodyEnd);
    const body = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    const order = index + 1;
    edgeBlankLines.push({ order, leadingRemoved, trailingRemoved });
    chapters.push({
      order,
      title: heading ? heading.text : `Chapter ${order}`,
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
    normalization: { strippedBom: validated.strippedBom, newlineStyle, edgeBlankLines },
    format: docx ? "docx" : "text",
    loss: docx?.loss ?? []
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

/** Why a Word document is refused before any preview (D-183). */
export type DocxRefusalReason =
  | "not-docx"
  | "encrypted"
  | "macro-enabled"
  | "corrupt"
  | "too-large"
  | "empty"
  | "too-many-chapters";

/** Reasons a picked source never becomes a preview: the core refusals plus main-process read failures. */
export type ImportSourceReadIssue = SourceRefusalReason | DocxRefusalReason | "not-found" | "unreadable";

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

/** Shown with every Word preview and report: styling is never part of a chapter body. */
export const DOCX_FORMATTING_NOTE =
  "Fonts, sizes, spacing, alignment and page layout are not imported. Emphasis, lists and quotes are.";

const LOSS_WORDS: Record<ImportLossKind, { one: string; many: string; outcome: string }> = {
  table: { one: "table", many: "tables", outcome: "Cell text kept as plain lines; the table layout was not." },
  image: { one: "image", many: "images", outcome: "Not imported." },
  footnote: { one: "footnote", many: "footnotes", outcome: "Not imported; the reference mark was removed." },
  endnote: { one: "endnote", many: "endnotes", outcome: "Not imported; the reference mark was removed." },
  comment: { one: "comment", many: "comments", outcome: "Not imported." },
  "tracked-insertion": { one: "tracked insertion", many: "tracked insertions", outcome: "Kept as ordinary text." },
  "tracked-deletion": { one: "tracked deletion", many: "tracked deletions", outcome: "Left out, as if accepted." },
  "text-box": { one: "text box", many: "text boxes", outcome: "Text kept as ordinary paragraphs." },
  field: { one: "field", many: "fields", outcome: "Shown text kept; it will not update." },
  chart: { one: "chart or diagram", many: "charts and diagrams", outcome: "Not imported." },
  equation: { one: "equation", many: "equations", outcome: "Not imported." },
  header: { one: "page header", many: "page headers", outcome: "Not imported." },
  footer: { one: "page footer", many: "page footers", outcome: "Not imported." },
  link: { one: "link", many: "links", outcome: "Text kept; the link address was not." },
  underline: { one: "underlined passage", many: "underlined passages", outcome: "Text kept without the underline." },
  strikethrough: {
    one: "struck-through passage",
    many: "struck-through passages",
    outcome: "Text kept without the strike."
  },
  checkbox: { one: "checkbox", many: "checkboxes", outcome: "Not imported." },
  symbol: { one: "symbol", many: "symbols", outcome: "Not imported." },
  other: { one: "other item", many: "other items", outcome: "Not imported; the importer cannot read it." }
};

/** "2 tables" and what happened to them, in the author's words. */
export function describeLoss(item: ImportLossItem): { label: string; outcome: string } {
  const words = LOSS_WORDS[item.kind];
  return {
    label: `${item.count.toLocaleString("en-US")} ${item.count === 1 ? words.one : words.many}`,
    outcome: words.outcome
  };
}

function lossPlaceText(place: ImportLossPlace): string {
  const where =
    place.line !== undefined
      ? `line ${place.line}`
      : place.heading === undefined
        ? null
        : place.heading === null
          ? "before the first heading"
          : `under “${place.heading}”`;
  const detail = place.detail ? `“${place.detail}”` : null;
  if (where && detail) return `${where}: ${detail}`;
  return where ?? detail ?? "";
}

/** Where the first few items are, such as "Line 12, line 40 and 3 more"; null when no place is known. */
export function describeLossPlaces(item: ImportLossItem, limit = 5): string | null {
  const shown = item.places
    .slice(0, limit)
    .map(lossPlaceText)
    .filter((text) => text !== "");
  if (shown.length === 0) return null;
  const more = item.count - shown.length;
  const parts = more > 0 ? [...shown, `${more.toLocaleString("en-US")} more`] : shown;
  const last = parts[parts.length - 1] ?? "";
  const listed = parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}`;
}

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
  /** "docx" when the source was a converted Word document. */
  format: "text" | "docx";
  /** What the chapter bodies could not carry, exactly as the preview listed it. */
  loss: ImportLossItem[];
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
  format?: "text" | "docx";
  loss?: ImportLossItem[];
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
    notImportedNote: IMPORT_NOT_IMPORTED_NOTE,
    format: input.format ?? "text",
    loss: input.loss ?? []
  };
}
