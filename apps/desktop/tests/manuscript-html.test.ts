import { describe, expect, test } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import { buildManuscriptHtml, chapterParagraphs, escapeText } from "../src/main/manuscript-html";
import type { DocxImage } from "../src/main/export";
import {
  bookSchema,
  chapterMetaSchema,
  manuscriptSettingsSchema,
  type BookDetail,
  type Chapter,
  type ManuscriptSettings
} from "@ai-book-studio/core/schema";

/*
 * The manuscript HTML behind the PDF export (D-108): the book's own settings, every piece of
 * author text escaped, chapters in reading order on their own pages, and the Word export's
 * illustrations inlined in the same order. Synthetic books only.
 */

const NOW = "2026-11-03T12:34:56.789Z";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `${String(order).padStart(4, "0")}-x.md`,
    wordCount: content.split(/\s+/u).filter(Boolean).length,
    hash: "e".repeat(64)
  };
}

function book(
  chapters: Chapter[],
  manuscript: Partial<ManuscriptSettings> = {},
  fields: { title?: string; description?: string } = {}
): BookDetail {
  return {
    book: bookSchema.parse({
      id: "book_html0001",
      title: fields.title ?? "The Salt Road",
      description: fields.description ?? "A crossing at low tide.",
      createdAt: NOW,
      updatedAt: NOW,
      settings: { manuscript: { ...manuscriptSettingsSchema.parse({}), ...manuscript } }
    }),
    chapters,
    chapterReadIssues: []
  };
}

const DOOR = chapter("ch_html0001", "The Door", 1, "The hall was cold.\n\nMara closed the door.\n");
const GATE = chapter("ch_html0002", "The Gate", 2, "Morning came slowly.\n");

const PNG: DocxImage = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  width: 1,
  height: 1,
  mimeType: "image/png",
  prompt: "A lighthouse in a storm"
};
const JPEG: DocxImage = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 4, 5, 6]),
  width: 960,
  height: 640,
  mimeType: "image/jpeg",
  prompt: ""
};

function dataUri(image: DocxImage): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

describe("buildManuscriptHtml", () => {
  test("applies the book's manuscript settings", () => {
    const custom = buildManuscriptHtml(
      book([DOOR], {
        bodyFont: "Georgia",
        bodyFontSize: 14,
        firstLineIndent: 0.3,
        lineSpacing: "1.5",
        chapterTitleAlignment: "Left",
        preserveLineBreaks: false
      })
    );
    expect(custom).toContain("font-family: 'Georgia', serif; font-size: 14pt;");
    expect(custom).toContain("text-indent: 0.3in; line-height: 1.5; white-space: normal;");
    expect(custom).toContain(".contents-title, .chapter-title { text-align: left;");

    const defaults = buildManuscriptHtml(book([DOOR]));
    expect(defaults).toContain("font-family: 'Times New Roman', serif; font-size: 12pt;");
    expect(defaults).toContain("text-indent: 0.2in; line-height: 2; white-space: pre-wrap;");
    expect(defaults).toContain(".contents-title, .chapter-title { text-align: center;");

    const plain = buildManuscriptHtml(book([DOOR], { bodyFont: "Courier New", firstLineIndent: 0, lineSpacing: "Single" }));
    expect(plain).toContain("font-family: 'Courier New', monospace;");
    expect(plain).toContain("text-indent: 0; line-height: 1;");
    // The prose is the same whatever the settings say.
    expect(custom.slice(custom.indexOf("<body>"))).toBe(defaults.slice(defaults.indexOf("<body>")));
  });

  test("puts the title page first, then every chapter in reading order on a new page", () => {
    const html = buildManuscriptHtml(book([GATE, DOOR]));
    const title = html.indexOf('<section class="title-page">');
    const door = html.indexOf('<h2 class="chapter-title">The Door</h2>');
    const gate = html.indexOf('<h2 class="chapter-title">The Gate</h2>');
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(door);
    expect(door).toBeLessThan(gate);
    expect(html).toContain('<h1 class="book-title">The Salt Road</h1>');
    expect(html).toContain('<p class="book-description">A crossing at low tide.</p>');
    expect(html.match(/<section class="chapter" id="chapter-\d+">/g)).toEqual([
      '<section class="chapter" id="chapter-1">',
      '<section class="chapter" id="chapter-2">'
    ]);
    expect(html).toContain(".contents, .chapter { break-before: page; }");
    expect(html).toContain("@page { size: A4; margin: 1in; }");
  });

  test("adds a contents page only when the book asks for one", () => {
    expect(buildManuscriptHtml(book([DOOR, GATE]))).not.toContain('<nav class="contents">');
    const html = buildManuscriptHtml(book([GATE, DOOR], { includeTableOfContents: true }));
    const contents = html.indexOf('<nav class="contents">');
    expect(contents).toBeGreaterThan(html.indexOf('<section class="title-page">'));
    expect(contents).toBeLessThan(html.indexOf('<section class="chapter"'));
    expect(html).toContain(
      '<ol>\n<li><a href="#chapter-1">The Door</a></li>\n<li><a href="#chapter-2">The Gate</a></li>\n</ol>'
    );
  });

  test("keeps one paragraph per line, with blank lines kept as space", () => {
    expect(chapterParagraphs("The hall was cold.\n\nMara closed the door.\n")).toBe(
      '<p>The hall was cold.</p>\n<p class="blank">&#160;</p>\n<p>Mara closed the door.</p>'
    );
    expect(chapterParagraphs("Roses are red,\r\nviolets are blue.   \r\n")).toBe(
      "<p>Roses are red,</p>\n<p>violets are blue.</p>"
    );
    expect(chapterParagraphs("  \n\n")).toBe("");
    // A chapter without a heading of its own takes its number.
    expect(buildManuscriptHtml(book([chapter("ch_html0003", "  ", 3, "Untitled.\n")]))).toContain(
      '<h2 class="chapter-title">Chapter 3</h2>'
    );
  });

  test("escapes every piece of author text and stays well-formed", () => {
    const hostile = 'The <b>"Bold"</b> & the <script>alert(\'x\')</script>';
    const html = buildManuscriptHtml(
      book([chapter("ch_html0004", hostile, 1, `${hostile}\nA bell\u0007 rang\u000b.\n\ud800 alone.\n`)], {}, {
        title: hostile,
        description: hostile
      }),
      new Map([["ch_html0004", { ...PNG, prompt: hostile }]])
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain(
      "The &lt;b&gt;&quot;Bold&quot;&lt;/b&gt; &amp; the &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"
    );
    expect(html).toContain(`alt="${escapeText(hostile)}"`);
    expect(html).toContain("<p>A bell rang.</p>");
    expect(html).toContain("<p>� alone.</p>");
    expect(XMLValidator.validate(html)).toBe(true);
  });

  test("embeds each chapter's illustration after its text, in the Word export's order", () => {
    const html = buildManuscriptHtml(
      book([GATE, DOOR]),
      new Map([
        [GATE.id, JPEG],
        [DOOR.id, PNG]
      ])
    );
    const png = html.indexOf(`<img src="${dataUri(PNG)}"`);
    const jpeg = html.indexOf(`<img src="${dataUri(JPEG)}"`);
    expect(png).toBeGreaterThan(html.indexOf("<p>Mara closed the door.</p>"));
    expect(png).toBeLessThan(html.indexOf('<h2 class="chapter-title">The Gate</h2>'));
    expect(jpeg).toBeGreaterThan(html.indexOf("<p>Morning came slowly.</p>"));
    // The Word export's box: 480 by 640 pixels, keeping the picture's shape.
    expect(html).toContain(`alt="A lighthouse in a storm" width="480" height="480" />`);
    expect(html).toContain("<figcaption>A lighthouse in a storm</figcaption>");
    expect(html).toContain(`alt="Illustration for The Gate" width="480" height="320" />`);
    expect(html.match(/<figure class="illustration">/g)).toHaveLength(2);
  });

  test("cuts a long caption at 160 characters but keeps the whole prompt as alt text", () => {
    const prompt = `${"A long winter crossing. ".repeat(10)}😀 end`;
    const html = buildManuscriptHtml(book([DOOR]), new Map([[DOOR.id, { ...PNG, prompt }]]));
    const caption = /<figcaption>([^<]*)<\/figcaption>/.exec(html)?.[1] ?? "";
    expect(Array.from(caption)).toHaveLength(160);
    expect(caption.endsWith("…")).toBe(true);
    expect(html).toContain(`alt="${prompt.trim()}"`);
  });

  test("the same book gives the same document, with nothing remote in it", () => {
    const detail = book([DOOR, GATE], { includeTableOfContents: true });
    const images = new Map([[DOOR.id, PNG]]);
    const html = buildManuscriptHtml(detail, images);
    expect(buildManuscriptHtml(detail, images)).toBe(html);
    const references = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((match) => match[1] ?? "");
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(reference.startsWith("data:") || reference.startsWith("#")).toBe(true);
    expect(html).not.toMatch(/url\(|@import/);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />`
    );
  });

  test("a book without chapters is its title page", () => {
    const html = buildManuscriptHtml(book([], { includeTableOfContents: true }, { title: " ", description: "" }));
    expect(html).toContain('<h1 class="book-title">Untitled book</h1>');
    expect(html).not.toContain('class="book-description"');
    expect(html).not.toContain('<nav class="contents">');
    expect(html).not.toContain('<section class="chapter"');
    expect(XMLValidator.validate(html)).toBe(true);
  });
});
