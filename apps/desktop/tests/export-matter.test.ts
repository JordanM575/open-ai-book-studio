import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { NO_MATTER, newMatterSection, type BookMatter } from "@ai-book-studio/core/matter";
import { bookSchema, chapterMetaSchema, type BookDetail, type Chapter } from "@ai-book-studio/core/schema";
import { buildEpub } from "../src/main/epub";
import { buildDocx, buildMarkdown } from "../src/main/export";
import { LibraryError } from "../src/main/library/errors";
import { buildManuscriptHtml } from "../src/main/manuscript-html";
import { GOLDEN_DIR, noMatterBooks, renderNoMatter, type NoMatterOutput } from "./support/no-matter-books";

/*
 * Spec 035 T013, D-169: every export puts the matter around the chapters in one order — the
 * generated title page, the front sections, the contents when the book asks for one, the chapters,
 * then the back sections. Word gives each its own page and centres the title page; the EPUB gives
 * each its own XHTML document with its structural semantics, in the spine and the navigation; the
 * PDF prints them in that order; Markdown lists them under their headings. Synthetic books only.
 */

const NOW = "2026-11-04T09:00:00.000Z";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `${String(order).padStart(4, "0")}-x.md`,
    wordCount: content.split(/\s+/u).filter(Boolean).length,
    hash: "d".repeat(64)
  };
}

const MATTER: BookMatter = {
  version: 3,
  titlePage: true,
  author: "Ana Reyes",
  subtitle: "A tidewater tale",
  sections: [
    newMatterSection("copyright", "mat_exp00001", "Copyright © 2026 Ana Reyes\nAll rights reserved."),
    newMatterSection("dedication", "mat_exp00002", "For those who wait."),
    newMatterSection("epigraph", "mat_exp00003", "The sea is patient & <deep>."),
    { ...newMatterSection("other", "mat_exp00004", "Read slowly."), title: "Foreword" },
    newMatterSection("acknowledgements", "mat_exp00005", "Thanks to the keepers."),
    newMatterSection("about-the-author", "mat_exp00006", "Ana lives by the sea.")
  ]
};

function detail(matter: unknown, toc = true): BookDetail {
  return {
    book: bookSchema.parse({
      id: "book_exportm01",
      title: "The Salt Road",
      description: "A premise that stays off a generated title page.",
      createdAt: NOW,
      updatedAt: NOW,
      frontMatter: { dedication: "The old record, never exported." },
      ...(matter === undefined ? {} : { matter }),
      settings: { manuscript: { includeTableOfContents: toc } }
    }),
    chapters: [chapter("ch_exportm02", "The Gate", 2, "Morning came.\n"), chapter("ch_exportm01", "The Door", 1, "The hall was cold.\n")],
    chapterReadIssues: []
  };
}

/** The positions of each needle in the haystack, which must all be present and in order. */
function inOrder(haystack: string, needles: string[]): void {
  const positions = needles.map((needle) => haystack.indexOf(needle));
  expect(positions.filter((position) => position < 0)).toEqual([]);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

const ORDER = [
  "The Salt Road",
  "A tidewater tale",
  "Ana Reyes",
  "All rights reserved.",
  "For those who wait.",
  "The sea is patient",
  "Foreword",
  "The Door",
  "The Gate",
  "Acknowledgements",
  "Thanks to the keepers.",
  "About the author",
  "Ana lives by the sea."
];

describe("Word", () => {
  test("the title page is its own centred section, and every section starts a page in order", async () => {
    const zip = unzipSync(new Uint8Array(await buildDocx(detail(MATTER))));
    const document = strFromU8(zip["word/document.xml"] ?? new Uint8Array());
    inOrder(document, ORDER);
    expect(document).not.toContain("A premise that stays off");
    expect(document).not.toContain("The old record");
    // The title page ends its own section, which Word centres on the page.
    const sections = document.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('<w:vAlign w:val="center"/>');
    expect(sections[1]).not.toContain("w:vAlign");
    // Five page starts after the first front section: four more sections and two chapters, then two back sections.
    expect(document.match(/<w:pageBreakBefore\/>/g)?.length).toBe(3 + 1 + 1 + 2);
    // A dedication is centred and unindented.
    const dedication = document.slice(document.lastIndexOf("<w:p>", document.indexOf("For those who wait.")), document.indexOf("For those who wait."));
    expect(dedication).toContain('<w:jc w:val="center"/>');
    expect(dedication).not.toContain("w:firstLine");
    expect(strFromU8(zip["docProps/core.xml"] ?? new Uint8Array())).toContain("<dc:creator>Ana Reyes</dc:creator>");
  });

  test("without the title page, the first section opens the document", async () => {
    const zip = unzipSync(new Uint8Array(await buildDocx(detail({ ...MATTER, titlePage: false }))));
    const document = strFromU8(zip["word/document.xml"] ?? new Uint8Array());
    expect(document).not.toContain("A tidewater tale");
    expect(document.match(/<w:sectPr/g)).toHaveLength(1);
    expect(document.indexOf("All rights reserved.")).toBeLessThan(document.indexOf("<w:pageBreakBefore/>"));
  });

  test("a title page with nothing after it is the whole document", async () => {
    const bare = { ...detail({ ...NO_MATTER, author: "Ana Reyes" }), chapters: [] };
    const document = strFromU8(unzipSync(new Uint8Array(await buildDocx(bare)))["word/document.xml"] ?? new Uint8Array());
    expect(document).toContain("Ana Reyes");
    const sections = document.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('<w:vAlign w:val="center"/>');
  });

  test("back matter after no chapters does not leave a blank page", async () => {
    const empty = { ...detail({ ...NO_MATTER, titlePage: false, sections: [MATTER.sections[5]] }), chapters: [] };
    const document = strFromU8(unzipSync(new Uint8Array(await buildDocx(empty)))["word/document.xml"] ?? new Uint8Array());
    expect(document).toContain("Ana lives by the sea.");
    expect(document).not.toContain("<w:pageBreakBefore/>");
  });
});

describe("PDF", () => {
  test("prints the title page, front matter, contents, chapters and back matter in order", () => {
    const html = buildManuscriptHtml(detail(MATTER));
    inOrder(html, ['class="title-page generated"', 'id="front-1"', 'id="front-4"', 'class="contents"', 'id="chapter-1"', 'id="chapter-2"', 'id="back-1"', 'id="back-2"']);
    // Without a contents page, so each name appears once.
    const plain = buildManuscriptHtml(detail(MATTER, false));
    inOrder(plain.slice(plain.indexOf("<body>")), ORDER);
    expect(html).toContain('<p class="book-author">Ana Reyes</p>');
    expect(html).toContain("The sea is patient &amp; &lt;deep&gt;.");
    expect(html).toContain('<li><a href="#back-2">About the author</a></li>');
    expect(html).toContain(".book-author {");
    expect(html).toContain(".title-page.generated {");
    expect(html).not.toContain("A premise that stays off");
    expect(html).not.toContain("The old record");
    expect(XMLValidator.validate(html.replace("<!DOCTYPE html>", ""))).toBe(true);
  });
});

describe("EPUB", () => {
  const files = unzipSync(buildEpub(detail(MATTER)));
  const text = (name: string): string => strFromU8(files[name] ?? new Uint8Array());

  test("each section is its own XHTML document with its semantics, in the spine and navigation in order", () => {
    const opf = text("EPUB/package.opf");
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"\/>/g)].map((match) => match[1]);
    expect(spine).toEqual(["title-page", "front-01", "front-02", "front-03", "front-04", "nav", "chapter-001", "chapter-002", "back-01", "back-02"]);
    const nav = [...text("EPUB/nav.xhtml").matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(nav).toEqual([
      "title.xhtml The Salt Road",
      "front-01.xhtml Copyright",
      "front-02.xhtml Dedication",
      "front-03.xhtml Epigraph",
      "front-04.xhtml Foreword",
      "chapter-001.xhtml The Door",
      "chapter-002.xhtml The Gate",
      "back-01.xhtml Acknowledgements",
      "back-02.xhtml About the author"
    ]);
    expect(text("EPUB/title.xhtml")).toContain('<p class="book-author">Ana Reyes</p>');
    expect(text("EPUB/front-01.xhtml")).toContain('epub:type="copyright-page"');
    expect(text("EPUB/front-02.xhtml")).toContain('epub:type="dedication"');
    expect(text("EPUB/front-03.xhtml")).toContain('epub:type="epigraph"');
    expect(text("EPUB/front-04.xhtml")).toContain('epub:type="frontmatter"');
    expect(text("EPUB/back-01.xhtml")).toContain('epub:type="acknowledgments"');
    expect(text("EPUB/back-02.xhtml")).toContain('epub:type="backmatter"');
    expect(text("EPUB/front-02.xhtml")).not.toContain("<h1");
    expect(text("EPUB/back-02.xhtml")).toContain('<h1 class="chapter-title">About the author</h1>');
    expect(opf).toContain("<dc:creator>Ana Reyes</dc:creator>");
    expect(text("EPUB/styles.css")).toContain(".book-author {");
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith(".xhtml")) expect({ name, valid: XMLValidator.validate(strFromU8(bytes)) }).toEqual({ name, valid: true });
    }
    const everything = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");
    expect(everything).not.toContain("The old record");
    // The description stays the e-book's metadata; it leaves only the title page.
    expect(text("EPUB/title.xhtml")).not.toContain("A premise that stays off");
    expect(opf).toContain("<dc:description>A premise that stays off a generated title page.</dc:description>");
  });

  test("the same book gives the same bytes, and the reading order is never empty", () => {
    expect(buildEpub(detail(MATTER))).toEqual(buildEpub(detail(MATTER)));
    const bare = unzipSync(buildEpub({ ...detail({ ...NO_MATTER, titlePage: false, author: "Ana" }), chapters: [] }));
    expect(strFromU8(bare["EPUB/package.opf"] ?? new Uint8Array())).toContain('<itemref idref="title-page"/>');
  });
});

describe("Markdown", () => {
  test("lists the title page, front matter, chapters and back matter under their headings", () => {
    const markdown = buildMarkdown(detail(MATTER));
    expect(markdown.startsWith("# The Salt Road\n\n_A tidewater tale_\n\nAna Reyes\n\n## Copyright\n\nCopyright © 2026 Ana Reyes\nAll rights reserved.\n\n## Dedication\n\nFor those who wait.")).toBe(true);
    inOrder(markdown, ["## Epigraph", "## Foreword", "## The Door", "## The Gate", "## Acknowledgements", "## About the author"]);
    expect(markdown.endsWith("## About the author\n\nAna lives by the sea.\n")).toBe(true);
    expect(markdown).not.toContain("The old record");
    expect(buildMarkdown(detail({ ...MATTER, titlePage: false })).startsWith("## Copyright")).toBe(true);
  });
});

describe("matter that changes nothing, and matter that cannot be read", () => {
  test("empty matter exports exactly as no matter", async () => {
    for (const book of noMatterBooks()) {
      const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, `${book.name}.json`), "utf8")) as NoMatterOutput;
      const withEmpty = { ...book, detail: { ...book.detail, book: { ...book.detail.book, matter: { ...NO_MATTER, version: 7 } } } };
      const actual = await renderNoMatter(withEmpty);
      expect({ name: book.name, docx: actual.docx, epub: actual.epub, markdown: actual.markdown, html: actual.pdfHtml }).toEqual({
        name: book.name,
        docx: golden.docx,
        epub: golden.epub,
        markdown: golden.markdown,
        html: golden.pdfHtml
      });
    }
  });

  test("every export stops with a plain reason instead of leaving the matter out", async () => {
    const broken = detail({ sections: [{ id: "mat_broken01", kind: "foreword", position: "front" }] });
    const attempts: Array<() => unknown> = [() => buildMarkdown(broken), () => buildManuscriptHtml(broken), () => buildEpub(broken)];
    for (const attempt of attempts) {
      expect(attempt).toThrow(LibraryError);
      expect(attempt).toThrow(/front and back matter in book.json could not be read, so nothing was exported/);
    }
    await expect(buildDocx(broken)).rejects.toThrow(/could not be read/);
  });
});
