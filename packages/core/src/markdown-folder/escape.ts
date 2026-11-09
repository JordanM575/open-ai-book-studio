/*
 * The reversible metadata notation for the Markdown folder export (D-202, docs/formats/
 * markdown-folder.md §4). Metadata passes through two stages, escape (E) then Markdown-escape
 * (M); bodies never use either stage. For a known generated data segment the stages reverse
 * exactly: remove the punctuation escapes, then read the escape notation left to right.
 * This notation is not a general Markdown parser.
 */

export class MarkdownFolderEscapeError extends Error {
  constructor(readonly code: string) {
    super(`Markdown folder escape refused: ${code}.`);
    this.name = "MarkdownFolderEscapeError";
  }
}

function fail(code: string): never {
  throw new MarkdownFolderEscapeError(code);
}

const ESCAPE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef]
];

export function inMarkdownFolderEscapeRange(codePoint: number): boolean {
  return ESCAPE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isAsciiPunctuation(codePoint: number): boolean {
  return (
    (codePoint >= 0x21 && codePoint <= 0x2f) ||
    (codePoint >= 0x3a && codePoint <= 0x40) ||
    (codePoint >= 0x5b && codePoint <= 0x60) ||
    (codePoint >= 0x7b && codePoint <= 0x7e)
  );
}

/** True when every UTF-16 unit belongs to a well-formed Unicode scalar sequence. */
export function isWellFormedScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requireWellFormed(value: string): void {
  if (!isWellFormedScalarText(value)) fail("invalid-unicode");
}

function scalarsOf(value: string): string[] {
  requireWellFormed(value);
  return [...value];
}

/**
 * Stage E. Scalar by scalar, without normalization: a literal backslash doubles, CR/LF/tab
 * use their named forms (which win over the ranges), a space at either edge or in a run of
 * two or more becomes `\s`, a single inner space stays, and every other scalar in the fixed
 * ranges becomes `\u{HEX}` with uppercase hex of at least four digits.
 */
export function markdownFolderEscapeE(value: string): string {
  const scalars = scalarsOf(value);
  let output = "";
  for (let index = 0; index < scalars.length; index += 1) {
    const scalar = scalars[index] as string;
    if (scalar === "\\") {
      output += "\\\\";
    } else if (scalar === "\r") {
      output += "\\r";
    } else if (scalar === "\n") {
      output += "\\n";
    } else if (scalar === "\t") {
      output += "\\t";
    } else if (scalar === " ") {
      const atEdge = index === 0 || index === scalars.length - 1;
      const inRun = scalars[index - 1] === " " || scalars[index + 1] === " ";
      output += atEdge || inRun ? "\\s" : " ";
    } else {
      const codePoint = scalar.codePointAt(0) as number;
      output += inMarkdownFolderEscapeRange(codePoint)
        ? `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`
        : scalar;
    }
  }
  return output;
}

/** Stage M. Prefix every ASCII punctuation scalar with a backslash. */
export function markdownFolderMarkdownEscapeM(value: string): string {
  const scalars = scalarsOf(value);
  let output = "";
  for (const scalar of scalars) {
    const codePoint = scalar.codePointAt(0) as number;
    output += isAsciiPunctuation(codePoint) ? `\\${scalar}` : scalar;
  }
  return output;
}

/** The full metadata encoding: E, then M. Bodies never pass through here. */
export function encodeMarkdownFolderMetadata(value: string): string {
  return markdownFolderMarkdownEscapeM(markdownFolderEscapeE(value));
}

function removePunctuationEscapes(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined || !isAsciiPunctuation(next.codePointAt(0) as number)) {
      fail("invalid-escape");
    }
    output += next;
    index += 1;
  }
  return output;
}

function readEscapeNotation(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) fail("invalid-escape");
    if (next === "\\") {
      output += "\\";
      index += 1;
    } else if (next === "r") {
      output += "\r";
      index += 1;
    } else if (next === "n") {
      output += "\n";
      index += 1;
    } else if (next === "t") {
      output += "\t";
      index += 1;
    } else if (next === "s") {
      output += " ";
      index += 1;
    } else if (next === "u") {
      if (value[index + 2] !== "{") fail("invalid-escape");
      const close = value.indexOf("}", index + 3);
      if (close === -1) fail("invalid-escape");
      const hex = value.slice(index + 3, close);
      if (!/^[0-9A-F]{4,6}$/.test(hex)) fail("invalid-escape");
      if (hex.length > 4 && hex.startsWith("0")) fail("invalid-escape");
      const codePoint = Number.parseInt(hex, 16);
      if (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        !inMarkdownFolderEscapeRange(codePoint)
      ) {
        fail("invalid-escape");
      }
      output += String.fromCodePoint(codePoint);
      index = close;
    } else {
      fail("invalid-escape");
    }
  }
  return output;
}

/**
 * The exact inverse for a known generated data segment: remove the punctuation escapes,
 * then read the escape notation left to right. Malformed segments refuse.
 */
export function decodeMarkdownFolderMetadata(value: string): string {
  requireWellFormed(value);
  const decoded = readEscapeNotation(removePunctuationEscapes(value));
  requireWellFormed(decoded);
  return decoded;
}

/** UTF-8 byte length of a string counted scalar by scalar, without encoding it. */
export function markdownFolderUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
