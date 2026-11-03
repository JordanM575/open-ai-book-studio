import { describe, expect, test } from "bun:test";
import {
  buildImportReport,
  IMPORT_NOT_IMPORTED_NOTE,
  importManuscriptInputSchema,
  MAX_SOURCE_BYTES,
  previewImport,
  validateSource,
  type ValidatedSource
} from "../src/manuscript-import";

const encoder = new TextEncoder();

function validated(fileName: string, text: string): ValidatedSource {
  const result = validateSource({ fileName, bytes: encoder.encode(text) });
  if (result.status !== "validated") throw new Error(`Synthetic fixture was refused: ${result.reason}`);
  return result;
}

describe("manuscript source validation", () => {
  test("accepts txt and markdown with a filename-derived title", () => {
    for (const fileName of ["The Long Road.txt", "The Long Road.md", "The Long Road.markdown"]) {
      const result = validateSource({ fileName, bytes: encoder.encode("First.\n") });
      expect(result.status).toBe("validated");
      if (result.status !== "validated") continue;
      expect(result.proposedTitle).toBe("The Long Road");
      expect(result.strippedBom).toBe(false);
    }
  });

  test("refuses unsupported extensions before reading any further", () => {
    for (const fileName of ["book.docx", "book.pdf", "book", "book.txt.bak"]) {
      const result = validateSource({ fileName, bytes: encoder.encode("First.\n") });
      expect(result).toMatchObject({ status: "refused", reason: "unsupported-extension" });
      if (result.status !== "refused") continue;
      expect(result.message).toContain(".txt, .md or .markdown");
    }
  });

  test("refuses oversized input without truncating", () => {
    const result = validateSource({ fileName: "big.txt", bytes: new Uint8Array(MAX_SOURCE_BYTES + 1) });
    expect(result).toMatchObject({ status: "refused", reason: "too-large" });
  });

  test("refuses invalid UTF-8, NUL and control characters", () => {
    expect(validateSource({ fileName: "a.txt", bytes: new Uint8Array([0xff, 0xfe]) })).toMatchObject({
      status: "refused",
      reason: "invalid-encoding"
    });
    expect(validateSource({ fileName: "a.txt", bytes: encoder.encode("one\0two\n") })).toMatchObject({
      status: "refused",
      reason: "rejected-characters"
    });
    expect(validateSource({ fileName: "a.txt", bytes: encoder.encode("one\u001Ftwo\n") })).toMatchObject({
      status: "refused",
      reason: "rejected-characters"
    });
  });

  test("strips exactly one leading BOM and refuses empty input", () => {
    const bom = validateSource({ fileName: "a.txt", bytes: encoder.encode("\uFEFFFirst.\n") });
    expect(bom).toMatchObject({ status: "validated", strippedBom: true });
    if (bom.status === "validated") {
      expect(previewImport(bom).chapters[0]?.body).toBe("First.\n");
    }
    expect(validateSource({ fileName: "a.txt", bytes: encoder.encode("   \n\t\n") })).toMatchObject({
      status: "refused",
      reason: "empty"
    });
  });
});

describe("manuscript preview mapping", () => {
  test("one file becomes one chapter by default with exact bodies", () => {
    const preview = previewImport(validated("Road.txt", "First line.\n\nSecond line.\n"));
    expect(preview.bookTitle).toBe("Road");
    expect(preview.chapters).toHaveLength(1);
    expect(preview.chapters[0]).toMatchObject({
      order: 1,
      title: "Chapter 1",
      body: "First line.\n\nSecond line.\n",
      startLine: 1,
      endLine: 3
    });
    expect(preview.wordCount).toBe(4);
    expect(preview.normalization.edgeBlankLines).toEqual([{ order: 1, leadingRemoved: 0, trailingRemoved: 0 }]);
  });

  test("line-boundary splits keep every nonblank line in exactly one chapter", () => {
    const preview = previewImport(validated("Road.txt", "One.\n\nTwo.\nThree.\n\nFour.\n"), [3]);
    expect(preview.chapters).toHaveLength(2);
    expect(preview.chapters[0]).toMatchObject({ body: "One.\n", startLine: 1, endLine: 2 });
    expect(preview.chapters[1]).toMatchObject({ body: "Two.\nThree.\n\nFour.\n", startLine: 3, endLine: 6 });
    expect(preview.normalization.edgeBlankLines).toEqual([
      { order: 1, leadingRemoved: 0, trailingRemoved: 1 },
      { order: 2, leadingRemoved: 0, trailingRemoved: 0 }
    ]);
    // The removed edge blank line is identified, not silently dropped.
    const total = preview.normalization.edgeBlankLines.reduce((sum, entry) => sum + entry.trailingRemoved, 0);
    expect(total).toBe(1);
  });

  test("invalid, duplicate and out-of-range splits are ignored deterministically", () => {
    const source = validated("Road.txt", "One.\nTwo.\nThree.\n");
    const preview = previewImport(source, [3, 3, 99, 1, 0, -2, Number.NaN]);
    expect(preview.chapters.map((chapter) => [chapter.startLine, chapter.endLine])).toEqual([
      [1, 2],
      [3, 3]
    ]);
    const again = previewImport(source, [3]);
    expect(again).toEqual(preview);
  });

  test("CRLF and CR become LF and the mixture is named", () => {
    const preview = previewImport(validated("Road.txt", "One.\r\nTwo.\rThree.\r\n"));
    expect(preview.normalization.newlineStyle).toBe("mixed");
    expect(preview.chapters[0]?.body).toBe("One.\nTwo.\nThree.\n");
  });

  test("Markdown syntax stays literal body text", () => {
    const text = "# The Road\n\n---\ntitle: not metadata\n---\n\n**Bold** and `code`.\n";
    const preview = previewImport(validated("Road.md", text));
    expect(preview.chapters).toHaveLength(1);
    expect(preview.chapters[0]?.body).toBe(text);
  });

  test("Unicode text round-trips with exact offsets", () => {
    const preview = previewImport(validated("Élodie.txt", "Élodie sails ⛵ at dawn.\n\nSalt and stone.\n"), [3]);
    expect(preview.chapters[0]?.body).toBe("Élodie sails ⛵ at dawn.\n");
    expect(preview.chapters[1]).toMatchObject({ body: "Salt and stone.\n", startLine: 3, endLine: 3 });
  });

  test("the same source bytes always produce the identical preview", () => {
    const text = "One.\n\nTwo.\nThree.\n\nFour.\nFive.\n";
    const first = previewImport(validated("Road.txt", text), [3, 5]);
    const second = previewImport(validated("Road.txt", text), [5, 3]);
    expect(second).toEqual(first);
    expect(first.wordCount).toBe(first.chapters.reduce((total, chapter) => total + chapter.wordCount, 0));
  });

  test("every nonblank source line lands in exactly one chapter", () => {
    const text = "  One.\n\n\nTwo.\n   \nThree.\n\n";
    const source = validated("Road.txt", text);
    for (const splits of [[], [2], [2, 4], [4, 2, 4, 99]]) {
      const preview = previewImport(source, splits);
      const covered: number[] = [];
      for (const chapter of preview.chapters) {
        for (let line = chapter.startLine; line <= chapter.endLine; line += 1) covered.push(line);
      }
      const sourceLines = text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
      if (sourceLines[sourceLines.length - 1] === "") sourceLines.pop();
      // Contiguous, gapless, in order, covering every source line exactly once.
      expect(covered).toEqual(sourceLines.map((_, index) => index + 1));
      // Each body is exactly its span minus the reported edge blanks: nothing else
      // is dropped, duplicated or reordered, and removed edges really are blank.
      for (const chapter of preview.chapters) {
        const span = sourceLines.slice(chapter.startLine - 1, chapter.endLine);
        const entry = preview.normalization.edgeBlankLines.find((item) => item.order === chapter.order)!;
        expect(span.slice(0, entry.leadingRemoved).every((line) => line.trim() === "")).toBe(true);
        expect(span.slice(span.length - entry.trailingRemoved).every((line) => line.trim() === "")).toBe(true);
        const middle = span.slice(entry.leadingRemoved, span.length - entry.trailingRemoved);
        const expected = chapter.body === "" ? [] : chapter.body.slice(0, -1).split("\n");
        expect(expected).toEqual(middle);
      }
    }
  });
});

describe("importManuscriptInputSchema", () => {
  const valid = {
    bookTitle: "The Long Road",
    chapters: [{ title: "Beginnings", content: "One.\nTwo.\n" }]
  };

  test("accepts the confirmed preview mapping", () => {
    expect(importManuscriptInputSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects an empty chapter list", () => {
    expect(importManuscriptInputSchema.safeParse({ ...valid, chapters: [] }).success).toBe(false);
  });

  test("rejects more chapters than the bounded profile", () => {
    const chapters = Array.from({ length: 201 }, (_, index) => ({ title: `Chapter ${index + 1}`, content: "x\n" }));
    expect(importManuscriptInputSchema.safeParse({ ...valid, chapters }).success).toBe(false);
  });

  test("rejects a chapter larger than the source ceiling allows", () => {
    const chapters = [{ title: "Too big", content: `${"x".repeat(6_000_001)}\n` }];
    expect(importManuscriptInputSchema.safeParse({ ...valid, chapters }).success).toBe(false);
  });

  test("rejects a smuggled filesystem path", () => {
    const smuggled = { ...valid, filePath: "/Users/author/Books/draft.txt", absolutePath: "/tmp/x" };
    expect(importManuscriptInputSchema.safeParse(smuggled).success).toBe(false);
  });

  test("rejects a missing book title", () => {
    const { bookTitle: _omitted, ...rest } = valid;
    void _omitted;
    expect(importManuscriptInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe("buildImportReport", () => {
  const normalization = {
    strippedBom: false,
    newlineStyle: "lf" as const,
    edgeBlankLines: [{ order: 1, leadingRemoved: 0, trailingRemoved: 0 }]
  };

  test("counts come from the committed book, not the preview", () => {
    const report = buildImportReport({
      sourceName: "Road.txt",
      normalization,
      splits: [
        { order: 1, startLine: 1, endLine: 3 },
        { order: 2, startLine: 4, endLine: 6 }
      ],
      published: {
        bookId: "book_00000001",
        bookTitle: "The Long Road",
        // The committed bodies carry one more word than the preview mapping claimed.
        chapters: [
          { title: "Beginnings", body: "One.\nTwo.\nExtra.\n" },
          { title: "The Crossing", body: "Three.\nFour.\n" }
        ]
      }
    });
    expect(report.sourceName).toBe("Road.txt");
    expect(report.bookTitle).toBe("The Long Road");
    expect(report.chapters).toEqual([
      { order: 1, title: "Beginnings", startLine: 1, endLine: 3, wordCount: 3 },
      { order: 2, title: "The Crossing", startLine: 4, endLine: 6, wordCount: 2 }
    ]);
    expect(report.totalWords).toBe(5);
    expect(report.normalization).toBe(normalization);
    expect(report.notImportedNote).toBe(IMPORT_NOT_IMPORTED_NOTE);
  });

  test("the report carries display names only", () => {
    const report = buildImportReport({
      sourceName: "Road.txt",
      normalization,
      splits: [{ order: 1, startLine: 1, endLine: 2 }],
      published: {
        bookId: "book_00000001",
        bookTitle: "Road",
        chapters: [{ title: "Chapter 1", body: "One.\n" }]
      }
    });
    expect(report.sourceName).not.toContain("/");
    expect(report.notImportedNote).toContain("were not imported");
  });
});
