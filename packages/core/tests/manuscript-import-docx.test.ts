import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  MAX_SOURCE_BYTES,
  describeLossPlaces,
  previewImport,
  type ValidatedSource
} from "../src/manuscript-import";
import {
  MAX_DOCX_XML_BYTES,
  MAX_IMPORT_CHAPTERS,
  convertDocxHtml,
  mammothInput,
  openDocxPackage,
  scanDocxPackage,
  type DocxPackage
} from "../src/manuscript-import/docx";

/**
 * The pure half of Word intake (D-183): the container sniff and the transform from
 * mammoth's HTML dialect to canonical Markdown. The HTML below is written the way mammoth
 * writes it; the desktop tests run the same code on real mammoth output.
 */

function convert(html: string, messages: Array<{ type: string; message: string }> = []): ValidatedSource {
  const result = convertDocxHtml({ fileName: "Book.docx", html, messages, scanned: [] });
  if (result.status !== "validated") throw new Error(result.message);
  return result;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

function packageWith(parts: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(parts)) entries[name] = typeof content === "string" ? strToU8(content) : content;
  return zipSync(entries);
}

function opened(parts: Record<string, string | Uint8Array>): DocxPackage {
  const result = openDocxPackage("Book.docx", packageWith(parts));
  if (result.status !== "ok") throw new Error(result.message);
  return result;
}

describe("opening the package", () => {
  test("decompresses only XML parts, never images or other binaries", () => {
    const pkg = opened({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": documentXml("<w:p><w:r><w:t>Hello.</w:t></w:r></w:p>"),
      "word/media/image1.png": new Uint8Array([137, 80, 78, 71])
    });
    expect(Object.keys(pkg.parts).sort()).toEqual(["[Content_Types].xml", "word/document.xml"]);
    expect(pkg.names).toContain("word/media/image1.png");
  });

  test("mammoth reads a stored copy of exactly those parts", () => {
    const pkg = opened({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": documentXml("") });
    expect(Object.keys(unzipSync(mammothInput(pkg))).sort()).toEqual(["[Content_Types].xml", "word/document.xml"]);
  });

  test("a simple field's shown text reaches mammoth without the wrapper it would drop", () => {
    const pkg = opened({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": documentXml(
        `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple></w:p>`
      )
    });
    const fed = new TextDecoder().decode(unzipSync(mammothInput(pkg))["word/document.xml"]);
    expect(fed).not.toContain("fldSimple");
    expect(fed).toContain("<w:t>7</w:t>");
    expect(scanDocxPackage(pkg)).toEqual([{ kind: "field", place: { heading: null, detail: "PAGE" } }]);
  });

  test("a link or checkbox inside a simple field is reported as such, with the link's address", () => {
    const pkg = opened({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": documentXml(
        `<w:p><w:fldSimple w:instr=" HYPERLINK &quot;https://example.com/b&quot; "><w:r><w:t>linked</w:t></w:r></w:fldSimple>` +
          `<w:fldSimple w:instr=" FORMCHECKBOX "/></w:p>`
      )
    });
    expect(scanDocxPackage(pkg)).toEqual([
      { kind: "link", place: { heading: null, detail: "https://example.com/b" } },
      { kind: "checkbox", place: { heading: null } }
    ]);
    const fed = new TextDecoder().decode(unzipSync(mammothInput(pkg))["word/document.xml"]);
    expect(fed).toContain("<w:t>linked</w:t>");
  });

  test("XML past the expansion cap is refused before any of it is inflated", () => {
    expect(MAX_DOCX_XML_BYTES).toBe(10 * MAX_SOURCE_BYTES);
    const big = new Uint8Array(MAX_DOCX_XML_BYTES + 1);
    const result = openDocxPackage("Big.docx", packageWith({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": big }));
    expect(result).toMatchObject({ status: "refused", reason: "too-large" });
  });

  test("random bytes, a zip without content types and a damaged zip are refused", () => {
    expect(openDocxPackage("Noise.docx", new Uint8Array([1, 2, 3, 4, 5]))).toMatchObject({ reason: "not-docx" });
    expect(openDocxPackage("Zip.docx", packageWith({ "a.txt": "x" }))).toMatchObject({ reason: "not-docx" });
    const zip = packageWith({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": documentXml("") });
    expect(openDocxPackage("Cut.docx", zip.subarray(0, 40))).toMatchObject({ reason: "corrupt" });
  });

  test("a macro-enabled main part is refused", () => {
    const macro = CONTENT_TYPES.replace(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      "application/vnd.ms-word.document.macroEnabled.main+xml"
    );
    expect(
      openDocxPackage("Macro.docx", packageWith({ "[Content_Types].xml": macro, "word/document.xml": documentXml("") }))
    ).toMatchObject({ reason: "macro-enabled" });
  });
});

describe("scanning what mammoth drops", () => {
  test("text boxes inside mc:Choice are not counted twice", () => {
    const box = `<w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent>`;
    const pkg = opened({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": documentXml(
        `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${box}</mc:Choice><mc:Fallback><w:pict>${box}</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`
      )
    });
    expect(scanDocxPackage(pkg)).toEqual([{ kind: "text-box", place: { heading: null, detail: "Boxed" } }]);
  });

  test("tracked changes are placed under the heading they follow; table borders are not insertions", () => {
    const pkg = opened({
      "[Content_Types].xml": CONTENT_TYPES,
      "word/document.xml": documentXml(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>The Door</w:t></w:r></w:p>` +
          `<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/></w:tblBorders></w:tblPr></w:tbl>` +
          `<w:p><w:ins w:id="1"><w:r><w:t>new</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>old</w:delText></w:r></w:del></w:p>`
      )
    });
    expect(scanDocxPackage(pkg)).toEqual([
      { kind: "tracked-insertion", place: { heading: "The Door", detail: "new" } },
      { kind: "tracked-deletion", place: { heading: "The Door", detail: "old" } }
    ]);
  });
});

describe("mammoth HTML to canonical Markdown", () => {
  test("edge spaces stay outside emphasis markers, and every space is kept", () => {
    const source = convert("<p>Plain.<strong> Bold </strong><em> Italic.</em></p>");
    expect(source.text).toBe("Plain. **Bold**  *Italic.*\n");
  });

  test("nested and ordered lists keep their numbers and indentation", () => {
    const source = convert("<ol><li>One<ol><li>Inner</li></ol></li><li>Two</li></ol><ul><li>Dot</li></ul>");
    expect(source.text).toBe("1. One\n   1. Inner\n2. Two\n\n- Dot\n");
  });

  test("a quote with two paragraphs stays one quote", () => {
    expect(convert("<blockquote><p>First.</p><p>Second.</p></blockquote>").text).toBe("> First.\n>\n> Second.\n");
  });

  test("headings keep emphasis in the body line and give plain titles", () => {
    const source = convert("<h1>The <em>Long</em> Road</h1><p>Body.</p><h1>Next</h1><p>More.</p>");
    expect(source.text).toBe("# The *Long* Road\n\nBody.\n\n# Next\n\nMore.\n");
    expect(previewImport(source, source.docx?.proposedSplits).chapters.map((chapter) => chapter.title)).toEqual([
      "The Long Road",
      "Next"
    ]);
  });

  test("chapters split at the shallowest heading level present", () => {
    const source = convert("<h2>One</h2><p>a</p><h3>Scene</h3><p>b</p><h2>Two</h2><p>c</p>");
    expect(source.docx?.proposedSplits).toEqual([9]);
  });

  test("text before the first heading stays an opening chapter rather than being dropped", () => {
    const source = convert("<p>For Ann.</p><h1>One</h1><p>Body.</p>");
    const preview = previewImport(source, source.docx?.proposedSplits);
    expect(preview.chapters.map((chapter) => [chapter.title, chapter.body])).toEqual([
      ["Chapter 1", "For Ann.\n"],
      ["One", "Body.\n"]
    ]);
  });

  test("only a Title paragraph at the very start names the book", () => {
    expect(convert('<h1 class="title">The Book</h1><p>Body.</p>').proposedTitle).toBe("The Book");
    const late = convert('<p>Body.</p><h1 class="title">Not the book</h1>');
    expect(late.proposedTitle).toBe("Book");
    expect(late.text).toBe("Body.\n\n# Not the book\n");
    expect(late.docx?.proposedSplits).toEqual([]);
  });

  test("table cell text becomes plain lines, headings in a cell never split", () => {
    const source = convert("<table><tr><td><h1>Cell heading</h1></td><td><p>south</p><p></p></td></tr></table>");
    expect(source.text).toBe("Cell heading\nsouth\n");
    expect(source.docx?.headings).toEqual([]);
  });

  test("appended notes and comments are reported, never imported as text", () => {
    const source = convert(
      '<p>Noted<sup><a href="#endnote-2" id="endnote-ref-2">[1]</a></sup>.</p>' +
        '<p>Seen<sup><a href="#comment-0" id="comment-ref-0">[AB1]</a></sup></p>' +
        '<ol><li id="endnote-2"><p>The end note. <a href="#endnote-ref-2">↑</a></p></li></ol>' +
        '<dl><dt id="comment-0">Comment [AB1]</dt><dd><p>Tighten this. <a href="#comment-ref-0">↑</a></p></dd></dl>'
    );
    expect(source.text).toBe("Noted.\n\nSeen\n");
    expect(source.docx?.loss).toEqual([
      { kind: "endnote", count: 1, places: [{ line: 1, detail: "The end note." }] },
      { kind: "comment", count: 1, places: [{ line: 3, detail: "Tighten this." }] }
    ]);
  });

  test("mammoth's warnings become symbols and other items; style and equation warnings do not", () => {
    const source = convert("<p>Text.</p>", [
      { type: "warning", message: "Unrecognised paragraph style: 'Subtitle' (Style ID: Subtitle)" },
      { type: "warning", message: "An unrecognised element was ignored: m:oMathPara" },
      { type: "warning", message: "An unrecognised element was ignored: w:ruby" },
      { type: "warning", message: "A w:sym element with an unsupported character was ignored: char F04A in font Wingdings" }
    ]);
    expect(source.docx?.loss).toEqual([
      { kind: "symbol", count: 1, places: [{ detail: "char F04A in font Wingdings" }] },
      { kind: "other", count: 1, places: [{ detail: "w:ruby" }] }
    ]);
  });

  test("more chapters than one import may create is refused at intake", () => {
    const html = Array.from({ length: MAX_IMPORT_CHAPTERS + 1 }, (_, index) => `<h1>Part ${index}</h1><p>x</p>`).join("");
    const result = convertDocxHtml({ fileName: "Long.docx", html, messages: [], scanned: [] });
    expect(result).toMatchObject({ status: "refused", reason: "too-many-chapters" });
    const fits = Array.from({ length: MAX_IMPORT_CHAPTERS }, (_, index) => `<h1>Part ${index}</h1><p>x</p>`).join("");
    expect(convertDocxHtml({ fileName: "Fits.docx", html: fits, messages: [], scanned: [] }).status).toBe("validated");
  });

  test("converted text over the 5 MiB import limit is refused", () => {
    const result = convertDocxHtml({
      fileName: "Huge.docx",
      html: `<p>${"a".repeat(MAX_SOURCE_BYTES)}</p>`,
      messages: [],
      scanned: []
    });
    expect(result).toMatchObject({ status: "refused", reason: "too-large" });
  });

  test("place descriptions read plainly and say how many more there are", () => {
    expect(
      describeLossPlaces({
        kind: "image",
        count: 8,
        places: [{ line: 3, detail: "A dot" }, { line: 9 }, { heading: "Two" }, { heading: null }]
      })
    ).toBe("Line 3: “A dot”, line 9, under “Two”, before the first heading and 4 more");
    expect(describeLossPlaces({ kind: "header", count: 1, places: [{}] })).toBeNull();
  });
});
