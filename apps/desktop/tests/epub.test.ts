import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { buildEpub, epubIdentifier } from "../src/main/epub";
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
 * The EPUB 3 container (D-108): `mimetype` first and stored, a package document whose manifest
 * and spine match the files, a navigation document, well-formed XHTML per chapter, unmodified
 * images, and the same bytes from the same book. Synthetic books only.
 */

const NOW = "2026-11-03T12:34:56.789Z";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `${String(order).padStart(4, "0")}-x.md`,
    wordCount: content.split(/\s+/u).filter(Boolean).length,
    hash: "f".repeat(64)
  };
}

function book(
  chapters: Chapter[],
  manuscript: Partial<ManuscriptSettings> = {},
  fields: { title?: string; description?: string; updatedAt?: string } = {}
): BookDetail {
  return {
    book: bookSchema.parse({
      id: "book_epub0001",
      title: fields.title ?? "The Salt Road",
      description: fields.description ?? "A crossing at low tide.",
      createdAt: NOW,
      updatedAt: fields.updatedAt ?? NOW,
      settings: { manuscript: { ...manuscriptSettingsSchema.parse({}), ...manuscript } }
    }),
    chapters,
    chapterReadIssues: []
  };
}

const DOOR = chapter("ch_epub0001", "The Door", 1, "The hall was cold.\n\nMara closed the door.\n");
const GATE = chapter("ch_epub0002", "The Gate", 2, "Morning came slowly.\n");

const PNG: DocxImage = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]),
  width: 4,
  height: 2,
  mimeType: "image/png",
  prompt: "A lighthouse in a storm"
};
const JPEG: DocxImage = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]),
  width: 2,
  height: 2,
  mimeType: "image/jpeg",
  prompt: "Gulls over the gate"
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

function entries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function text(bytes: Uint8Array, name: string): string {
  const entry = entries(bytes)[name];
  if (!entry) throw new Error(`${name} is missing`);
  return strFromU8(entry);
}

function asList<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Every local file header in the archive, in file order: name, method, extra length and DOS date. */
function localHeaders(bytes: Uint8Array): Array<{ name: string; method: number; extra: number; time: number; date: number }> {
  const view = Buffer.from(bytes);
  const headers: Array<{ name: string; method: number; extra: number; time: number; date: number }> = [];
  let offset = 0;
  while (view.readUInt32LE(offset) === 0x04034b50) {
    const nameLength = view.readUInt16LE(offset + 26);
    const extra = view.readUInt16LE(offset + 28);
    const size = view.readUInt32LE(offset + 18);
    headers.push({
      name: view.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"),
      method: view.readUInt16LE(offset + 8),
      extra,
      time: view.readUInt16LE(offset + 10),
      date: view.readUInt16LE(offset + 12)
    });
    offset += 30 + nameLength + extra + size;
  }
  return headers;
}

describe("buildEpub", () => {
  test("starts with the stored mimetype entry and no extra field", () => {
    const bytes = Buffer.from(buildEpub(book([DOOR])));
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.readUInt16LE(28)).toBe(0);
    expect(bytes.subarray(30, 38).toString("latin1")).toBe("mimetype");
    expect(bytes.subarray(38, 58).toString("latin1")).toBe("application/epub+zip");
  });

  test("lays out the container in a fixed order", () => {
    const bytes = buildEpub(book([GATE, DOOR]), new Map([[DOOR.id, PNG]]));
    const order = [
      "mimetype",
      "META-INF/container.xml",
      "EPUB/package.opf",
      "EPUB/nav.xhtml",
      "EPUB/styles.css",
      "EPUB/title.xhtml",
      "EPUB/chapter-001.xhtml",
      "EPUB/chapter-002.xhtml",
      "EPUB/images/chapter-001.png"
    ];
    expect(localHeaders(bytes).map((header) => header.name)).toEqual(order);
    expect(Object.keys(entries(bytes))).toEqual(order);
    const container = parser.parse(text(bytes, "META-INF/container.xml"));
    expect(container.container.rootfiles.rootfile["@full-path"]).toBe("EPUB/package.opf");
    expect(container.container.rootfiles.rootfile["@media-type"]).toBe("application/oebps-package+xml");
  });

  test("the package names the book and lists every file in its manifest and spine", () => {
    const bytes = buildEpub(
      book([GATE, DOOR]),
      new Map([
        [DOOR.id, PNG],
        [GATE.id, JPEG]
      ])
    );
    const opf = parser.parse(text(bytes, "EPUB/package.opf")).package;
    expect(opf["@version"]).toBe("3.0");
    expect(opf["@unique-identifier"]).toBe("book-id");
    const metadata = opf.metadata;
    expect(metadata["dc:identifier"]["@id"]).toBe("book-id");
    expect(metadata["dc:identifier"]["#text"]).toBe(epubIdentifier("book_epub0001"));
    expect(epubIdentifier("book_epub0001")).toBe("urn:ai-book-studio:book_epub0001");
    expect(metadata["dc:title"]).toBe("The Salt Road");
    expect(metadata["dc:language"]).toBe("en");
    expect(metadata["dc:description"]).toBe("A crossing at low tide.");
    expect(metadata.meta["@property"]).toBe("dcterms:modified");
    expect(metadata.meta["#text"]).toBe("2026-11-03T12:34:56Z");

    const items = asList<Record<string, string>>(opf.manifest.item);
    const files = entries(bytes);
    for (const item of items) expect(files[`EPUB/${item["@href"]}`]).toBeDefined();
    const byId = new Map(items.map((item) => [item["@id"], item]));
    expect(byId.get("nav")?.["@properties"]).toBe("nav");
    expect(byId.get("style")?.["@media-type"]).toBe("text/css");
    expect(byId.get("image-001")).toMatchObject({ "@href": "images/chapter-001.png", "@media-type": "image/png" });
    expect(byId.get("image-002")).toMatchObject({ "@href": "images/chapter-002.jpg", "@media-type": "image/jpeg" });
    // Every file but the container's own is in the manifest.
    const listed = new Set(items.map((item) => `EPUB/${item["@href"]}`));
    expect(Object.keys(files).filter((name) => name.startsWith("EPUB/") && name !== "EPUB/package.opf").sort()).toEqual(
      [...listed].sort()
    );

    const spine = asList<Record<string, string>>(opf.spine.itemref).map((itemref) => itemref["@idref"]);
    expect(spine).toEqual(["title-page", "chapter-001", "chapter-002"]);
    expect(text(bytes, "EPUB/chapter-001.xhtml")).toContain('<h1 class="chapter-title">The Door</h1>');
    expect(text(bytes, "EPUB/chapter-002.xhtml")).toContain('<h1 class="chapter-title">The Gate</h1>');
  });

  test("the contents page joins the reading order only when the book asks for one", () => {
    const spineOf = (detail: BookDetail): string[] =>
      asList<Record<string, string>>(parser.parse(text(buildEpub(detail), "EPUB/package.opf")).package.spine.itemref).map(
        (itemref) => itemref["@idref"] ?? ""
      );
    expect(spineOf(book([DOOR, GATE]))).toEqual(["title-page", "chapter-001", "chapter-002"]);
    expect(spineOf(book([DOOR, GATE], { includeTableOfContents: true }))).toEqual([
      "title-page",
      "nav",
      "chapter-001",
      "chapter-002"
    ]);
  });

  test("the navigation document lists the chapters in reading order", () => {
    const nav = parser.parse(text(buildEpub(book([GATE, DOOR])), "EPUB/nav.xhtml")).html.body.nav;
    expect(nav["@epub:type"]).toBe("toc");
    expect(asList<Record<string, unknown>>(nav.ol.li).map((li) => li.a)).toEqual([
      { "@href": "chapter-001.xhtml", "#text": "The Door" },
      { "@href": "chapter-002.xhtml", "#text": "The Gate" }
    ]);
  });

  test("every document is well-formed, even with hostile and invalid characters", () => {
    const hostile = 'The <b>"Bold"</b> & the <script>alert(\'x\')</script>';
    const bytes = buildEpub(
      book([chapter("ch_epub0003", hostile, 1, `${hostile}\nA bell\u0007 rang.\n\udc00 alone.\n`)], { includeTableOfContents: true }, {
        title: hostile,
        description: hostile
      }),
      new Map([["ch_epub0003", { ...PNG, prompt: hostile }]])
    );
    const documents = Object.keys(entries(bytes)).filter((name) => /\.(xhtml|opf|xml)$/.test(name));
    // container.xml, package.opf, nav.xhtml, title.xhtml and the one chapter.
    expect(documents).toHaveLength(5);
    for (const name of documents) {
      expect({ name, valid: XMLValidator.validate(text(bytes, name)) }).toEqual({ name, valid: true });
    }
    const page = text(bytes, "EPUB/chapter-001.xhtml");
    expect(page).not.toContain("<script>");
    expect(page).toContain("<p>The &lt;b&gt;&quot;Bold&quot;&lt;/b&gt; &amp; the &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</p>");
    expect(page).toContain("<p>A bell rang.</p>");
    expect(page).toContain("<p>� alone.</p>");
    expect(text(bytes, "EPUB/package.opf")).toContain("<dc:title>The &lt;b&gt;&quot;Bold&quot;");
  });

  test("chapter files carry the text and illustration, and the stylesheet the settings", () => {
    const bytes = buildEpub(
      book([DOOR], { bodyFont: "Georgia", bodyFontSize: 14, firstLineIndent: 0.5, chapterTitleAlignment: "Left" }),
      new Map([[DOOR.id, PNG]])
    );
    const page = text(bytes, "EPUB/chapter-001.xhtml");
    expect(page).toContain('<p>The hall was cold.</p>\n<p class="blank">&#160;</p>\n<p>Mara closed the door.</p>');
    expect(page).toContain('<img src="images/chapter-001.png" alt="A lighthouse in a storm" width="480" height="240" />');
    expect(page).toContain('<link rel="stylesheet" type="text/css" href="styles.css" />');
    expect(page.indexOf("<figure")).toBeGreaterThan(page.indexOf("Mara closed the door."));
    const css = text(bytes, "EPUB/styles.css");
    expect(css).toContain("font-family: 'Georgia', serif; font-size: 14pt;");
    expect(css).toContain("text-indent: 0.5in;");
    expect(css).toContain("text-align: left;");
    expect(css).not.toMatch(/url\(|@import/);
  });

  test("stores each illustration byte for byte", () => {
    const bytes = buildEpub(
      book([DOOR, GATE]),
      new Map([
        [DOOR.id, PNG],
        [GATE.id, JPEG]
      ])
    );
    const files = entries(bytes);
    expect(files["EPUB/images/chapter-001.png"]).toEqual(PNG.bytes);
    expect(files["EPUB/images/chapter-002.jpg"]).toEqual(JPEG.bytes);
    const stored = localHeaders(bytes).filter((header) => header.name.startsWith("EPUB/images/"));
    expect(stored.map((header) => header.method)).toEqual([0, 0]);
  });

  test("two builds of the same book are byte-identical, with fixed entry dates", () => {
    const detail = book([DOOR, GATE], { includeTableOfContents: true });
    const images = new Map([[DOOR.id, PNG]]);
    const first = buildEpub(detail, images);
    const second = buildEpub(structuredClone(detail), new Map([[DOOR.id, { ...PNG, bytes: PNG.bytes.slice() }]]));
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    // 1 January 1980 at midnight in every entry: DOS date (0 << 9) | (1 << 5) | 1 and time 0.
    for (const header of localHeaders(first)) expect({ date: header.date, time: header.time }).toEqual({ date: 33, time: 0 });
  });

  test("the modified date follows the book's updatedAt", () => {
    const earlier = buildEpub(book([DOOR]));
    const later = buildEpub(book([DOOR], {}, { updatedAt: "2026-12-01T08:00:00.000Z" }));
    expect(text(later, "EPUB/package.opf")).toContain('<meta property="dcterms:modified">2026-12-01T08:00:00Z</meta>');
    expect(Buffer.from(earlier).equals(Buffer.from(later))).toBe(false);
  });

  test("refers to nothing outside the container", () => {
    const bytes = buildEpub(book([DOOR, GATE], { includeTableOfContents: true }), new Map([[DOOR.id, PNG]]));
    const files = entries(bytes);
    for (const name of Object.keys(files).filter((entry) => entry.endsWith(".xhtml"))) {
      const references = [...strFromU8(files[name] ?? new Uint8Array()).matchAll(/\b(?:src|href)="([^"]*)"/g)].map(
        (match) => match[1] ?? ""
      );
      for (const reference of references) {
        expect(reference).not.toMatch(/^[a-z]+:/i);
        expect(files[`EPUB/${reference}`]).toBeDefined();
      }
    }
  });

  test("a book without chapters keeps its title page in the spine and the contents list", () => {
    const bytes = buildEpub(book([], { includeTableOfContents: true }, { title: "", description: "" }));
    const opf = parser.parse(text(bytes, "EPUB/package.opf")).package;
    expect(asList<Record<string, string>>(opf.spine.itemref).map((itemref) => itemref["@idref"])).toEqual([
      "title-page",
      "nav"
    ]);
    expect(opf.metadata["dc:title"]).toBe("Untitled book");
    expect(opf.metadata["dc:description"]).toBeUndefined();
    const nav = parser.parse(text(bytes, "EPUB/nav.xhtml")).html.body.nav;
    expect(nav.ol.li.a).toEqual({ "@href": "title.xhtml", "#text": "Untitled book" });
  });
});
