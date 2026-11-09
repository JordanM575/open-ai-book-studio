import { describe, expect, test } from "bun:test";
import {
  decodeMarkdownFolderMetadata,
  encodeMarkdownFolderMetadata,
  markdownFolderEscapeE,
  markdownFolderMarkdownEscapeM
} from "../../src/markdown-folder/escape";

/*
 * D-202 §4: metadata is escape (E) then Markdown-escape (M); the inverse, for a known
 * generated data segment, removes the punctuation escapes and then reads E left to right.
 */

describe("markdown folder escape notation", () => {
  test("stage E doubles a backslash and names CR, LF and tab", () => {
    expect(markdownFolderEscapeE("\\")).toBe("\\\\");
    expect(markdownFolderEscapeE("\r")).toBe("\\r");
    expect(markdownFolderEscapeE("\n")).toBe("\\n");
    expect(markdownFolderEscapeE("\t")).toBe("\\t");
    expect(markdownFolderEscapeE("a b")).toBe("a b");
    expect(markdownFolderEscapeE(" a")).toBe("\\sa");
    expect(markdownFolderEscapeE("a ")).toBe("a\\s");
    expect(markdownFolderEscapeE("a  b")).toBe("a\\s\\sb");
    expect(markdownFolderEscapeE(" ")).toBe("\\s");
  });

  test("stage M prefixes only ASCII punctuation", () => {
    expect(markdownFolderMarkdownEscapeM("!")).toBe("\\!");
    expect(markdownFolderMarkdownEscapeM("~")).toBe("\\~");
    expect(markdownFolderMarkdownEscapeM("\\")).toBe("\\\\");
    expect(markdownFolderMarkdownEscapeM("a")).toBe("a");
    expect(markdownFolderMarkdownEscapeM("é")).toBe("é");
  });

  test("encode is M after E, and backslash-n stays distinct from a line feed", () => {
    const literal = encodeMarkdownFolderMetadata("\\n");
    const lineFeed = encodeMarkdownFolderMetadata("\n");
    expect(literal).not.toBe(lineFeed);
    expect(decodeMarkdownFolderMetadata(literal)).toBe("\\n");
    expect(decodeMarkdownFolderMetadata(lineFeed)).toBe("\n");
  });

  test("round trips punctuation, edges, runs and astral scalars", () => {
    const samples = [
      "",
      "plain",
      " leading and trailing ",
      "two  spaces",
      "tab\there",
      "line\nbreak",
      "carriage\rreturn",
      "back\\slash",
      "# Heading [link](target) *star*",
      "emoji 😀 and café",
      "a\u00a0b",
      "trailing \\"
    ];
    for (const sample of samples) {
      expect(decodeMarkdownFolderMetadata(encodeMarkdownFolderMetadata(sample))).toBe(sample);
    }
  });

  test("fixed scalar ranges use uppercase hex of at least four digits", () => {
    const ranges: Array<[number, number]> = [
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
    for (const [start, end] of ranges) {
      for (const codePoint of [start, end]) {
        if (codePoint === 0x0009 || codePoint === 0x000a || codePoint === 0x000d) continue;
        const scalar = String.fromCodePoint(codePoint);
        const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
        expect(encodeMarkdownFolderMetadata(scalar)).toBe(`\\\\u\\{${hex}\\}`);
        expect(decodeMarkdownFolderMetadata(encodeMarkdownFolderMetadata(scalar))).toBe(scalar);
      }
    }
    // Just outside the fixed ranges, and not otherwise escaped, scalars pass through.
    expect(encodeMarkdownFolderMetadata("\u00a1")).toBe("¡");
    expect(encodeMarkdownFolderMetadata("a")).toBe("a");
    expect(decodeMarkdownFolderMetadata(encodeMarkdownFolderMetadata("\ufe10"))).toBe("\ufe10");
    expect(decodeMarkdownFolderMetadata(encodeMarkdownFolderMetadata("\u{e01f0}"))).toBe("\u{e01f0}");
  });

  test("decode refuses malformed known segments", () => {
    expect(() => decodeMarkdownFolderMetadata("bad\\")).toThrow();
    expect(() => decodeMarkdownFolderMetadata("bad\\x")).toThrow();
    expect(() => decodeMarkdownFolderMetadata("\\\\u\\{ZZZZ\\}")).toThrow();
    expect(() => decodeMarkdownFolderMetadata("\\\\u\\{0001")).toThrow();
  });
});
