import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_DIR, noMatterBooks, renderNoMatter, type NoMatterOutput } from "./support/no-matter-books";

/*
 * Spec 035 T013's hard constraint: a book with no front or back matter exports exactly as it did
 * before ordered matter existed. Each golden was rendered by the exporters at 3a234cc, before any
 * matter code, from the synthetic books in `support/no-matter-books.ts`: every DOCX part (the build
 * time and the library's drawing counter aside), the EPUB's exact bytes, the Markdown text, and
 * the HTML Chromium prints to PDF together with the text a reader sees in it. The legacy book keeps
 * a populated `frontMatter` record, which must stay out of every export.
 */

function golden(name: string): NoMatterOutput {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, `${name}.json`), "utf8")) as NoMatterOutput;
}

describe("a book without matter exports exactly as before", () => {
  for (const book of noMatterBooks()) {
    test(book.name, async () => {
      const expected = golden(book.name);
      const actual = await renderNoMatter(book);
      expect(actual.docx).toEqual(expected.docx);
      expect(actual.epub.entries).toEqual(expected.epub.entries);
      expect(actual.epub.sha256).toBe(expected.epub.sha256);
      expect(actual.markdown).toBe(expected.markdown);
      expect(actual.pdfHtml).toBe(expected.pdfHtml);
      expect(actual.pdfText).toBe(expected.pdfText);
    });
  }

  test("the legacy record and the book's description never reach an export by another name", () => {
    const legacy = golden("legacy");
    const everything = [JSON.stringify(legacy.docx), JSON.stringify(legacy.epub.entries), legacy.markdown, legacy.pdfHtml];
    for (const text of everything) {
      for (const value of ["A tidewater tale", "Ana Reyes", "For those who wait.", "coincidental", "by the sea", "Garamond."]) {
        expect(text).not.toContain(value);
      }
    }
  });
});
