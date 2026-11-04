import { strToU8, zipSync, type Zippable } from "fflate";
import { sectionName, type MatterKind, type MatterPosition, type MatterSection } from "@ai-book-studio/core/matter";
import type { BookDetail } from "@ai-book-studio/core/schema";
import type { DocxImage } from "./export";
import {
  bookTitle,
  chapterHeading,
  chapterParagraphs,
  escapeText,
  exportPlan,
  illustrationFigure,
  manuscriptCss,
  matterCss,
  matterSection,
  readingOrder,
  titlePageLines
} from "./manuscript-html";

/*
 * An EPUB 3 container assembled in memory (D-108): the `mimetype` entry first and stored, the
 * container file, a package document with its manifest and spine, a navigation document, one
 * XHTML file per chapter and per section of front and back matter, a stylesheet and the
 * illustrations as unmodified files under `images/`.
 *
 * Nothing in it depends on the clock or the machine. Every zip entry carries the same fixed date,
 * the identifier comes from the book's id and the modified date from its `updatedAt`, so the same
 * book always gives the same bytes. Nothing refers to a remote resource.
 */

/**
 * 1 January 1980, the earliest date a zip entry can hold. fflate writes an entry's date from the
 * local-time fields, so it is built from local fields too, and every time zone writes the same bytes.
 */
const ENTRY_DATE = new Date(1980, 0, 1, 0, 0, 0);

/** The book carries no language of its own yet, so the e-book declares English. */
const LANGUAGE = "en";

const EXTENSIONS: Record<DocxImage["mimeType"], string> = { "image/png": "png", "image/jpeg": "jpg" };

/** The EPUB structural semantics for each kind; a kind without its own term takes its partition's. */
const EPUB_TYPES: Partial<Record<MatterKind, string>> = {
  copyright: "copyright-page",
  dedication: "dedication",
  epigraph: "epigraph",
  acknowledgements: "acknowledgments"
};

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** A stable identifier for the book: the same book id always gives the same e-book identity. */
export function epubIdentifier(bookId: string): string {
  return `urn:ai-book-studio:${bookId}`;
}

/** `dcterms:modified` wants UTC to the second, with no fraction. */
function modifiedDate(updatedAt: string): string {
  return new Date(updatedAt).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function xhtml(title: string, body: string[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${LANGUAGE}" xml:lang="${LANGUAGE}">`,
    `<head>`,
    `<title>${escapeText(title)}</title>`,
    `<link rel="stylesheet" type="text/css" href="styles.css" />`,
    `</head>`,
    `<body>`,
    ...body.filter(Boolean),
    `</body>`,
    `</html>`,
    ``
  ].join("\n");
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

/** Builds the e-book. The chapter illustrations are the ones the Word export embeds, in the same order. */
export function buildEpub(detail: BookDetail, illustrations: Map<string, DocxImage> = new Map()): Uint8Array {
  const { book } = detail;
  const settings = book.settings.manuscript;
  const title = bookTitle(detail);
  const description = book.description.trim();
  const plan = exportPlan(detail);
  const chapters = readingOrder(detail);
  const width = Math.max(3, String(chapters.length).length);

  const titlePage = {
    item: { id: "title-page", href: "title.xhtml", mediaType: "application/xhtml+xml" },
    text: xhtml(title, [
      `<section epub:type="titlepage" class="title-page">`,
      `<h1 class="book-title">${escapeText(title)}</h1>`,
      ...titlePageLines(plan),
      `</section>`
    ])
  };
  // A book with nothing else in it keeps its title page, so the reading order is never empty.
  const withTitlePage = plan.titlePage || chapters.length + plan.front.length + plan.back.length === 0;
  const matterPage = (section: MatterSection, position: MatterPosition, index: number) => {
    const id = `${position}-${String(index + 1).padStart(2, "0")}`;
    const type = EPUB_TYPES[section.kind] ?? `${position}matter`;
    return {
      item: { id, href: `${id}.xhtml`, mediaType: "application/xhtml+xml" },
      heading: sectionName(section),
      text: xhtml(sectionName(section), [matterSection(section, "h1", ` epub:type="${type}"`)])
    };
  };
  const frontPages = plan.front.map((section, index) => matterPage(section, "front", index));
  const backPages = plan.back.map((section, index) => matterPage(section, "back", index));
  const chapterPages: Array<{ item: ManifestItem; heading: string; text: string }> = [];
  const images: Array<{ item: ManifestItem; bytes: Uint8Array }> = [];
  chapters.forEach((chapter, index) => {
    const number = String(index + 1).padStart(width, "0");
    const heading = chapterHeading(chapter);
    const image = illustrations.get(chapter.id);
    let figure = "";
    if (image) {
      const href = `images/chapter-${number}.${EXTENSIONS[image.mimeType]}`;
      images.push({ item: { id: `image-${number}`, href, mediaType: image.mimeType }, bytes: image.bytes });
      figure = illustrationFigure(image, href, heading);
    }
    chapterPages.push({
      item: { id: `chapter-${number}`, href: `chapter-${number}.xhtml`, mediaType: "application/xhtml+xml" },
      heading,
      text: xhtml(heading, [
        `<section epub:type="chapter" class="chapter">`,
        `<h1 class="chapter-title">${escapeText(heading)}</h1>`,
        chapterParagraphs(chapter.content),
        figure,
        `</section>`
      ])
    });
  });

  // The navigation list may not be empty, so a book without chapters lists its title page. With
  // matter, it lists every document in reading order, the title page first.
  const titleEntry = { item: titlePage.item, heading: title };
  const listed = plan.present
    ? [...(withTitlePage ? [titleEntry] : []), ...frontPages, ...chapterPages, ...backPages]
    : chapterPages;
  const entries =
    listed.length > 0
      ? listed.map((page) => ({ href: page.item.href, label: page.heading }))
      : [{ href: titlePage.item.href, label: title }];
  const nav = xhtml("Contents", [
    `<nav epub:type="toc" id="toc" class="contents">`,
    `<h1 class="contents-title">Contents</h1>`,
    `<ol>`,
    ...entries.map((entry) => `<li><a href="${entry.href}">${escapeText(entry.label)}</a></li>`),
    `</ol>`,
    `</nav>`
  ]);

  const navItem: ManifestItem = { id: "nav", href: "nav.xhtml", mediaType: "application/xhtml+xml", properties: "nav" };
  const styleItem: ManifestItem = { id: "style", href: "styles.css", mediaType: "text/css" };
  const documents = [...(withTitlePage ? [titlePage] : []), ...frontPages, ...chapterPages, ...backPages];
  const manifest: ManifestItem[] = [navItem, styleItem, ...documents.map((page) => page.item), ...images.map((image) => image.item)];
  // The contents page joins the reading order only when the book asks for one, after the front
  // matter; readers list it either way.
  const spine = [
    ...(withTitlePage ? [titlePage.item.id] : []),
    ...frontPages.map((page) => page.item.id),
    ...(settings.includeTableOfContents ? [navItem.id] : []),
    ...chapterPages.map((page) => page.item.id),
    ...backPages.map((page) => page.item.id)
  ];
  const metadata = [
    `<dc:identifier id="book-id">${escapeText(epubIdentifier(book.id))}</dc:identifier>`,
    `<dc:title>${escapeText(title)}</dc:title>`,
    ...(plan.author ? [`<dc:creator>${escapeText(plan.author)}</dc:creator>`] : []),
    `<dc:language>${LANGUAGE}</dc:language>`,
    ...(description ? [`<dc:description>${escapeText(description)}</dc:description>`] : []),
    `<meta property="dcterms:modified">${modifiedDate(book.updatedAt)}</meta>`
  ];
  const opf = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${LANGUAGE}">`,
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    ...metadata,
    `</metadata>`,
    `<manifest>`,
    ...manifest.map(
      (item) =>
        `<item id="${item.id}" href="${item.href}" media-type="${item.mediaType}"${item.properties ? ` properties="${item.properties}"` : ""}/>`
    ),
    `</manifest>`,
    `<spine>`,
    ...spine.map((idref) => `<itemref idref="${idref}"/>`),
    `</spine>`,
    `</package>`,
    ``
  ].join("\n");

  // Insertion order is entry order: `mimetype` comes first and is stored, never deflated. The
  // pictures are already compressed, so they are stored too, byte for byte.
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER),
    "EPUB/package.opf": strToU8(opf),
    "EPUB/nav.xhtml": strToU8(nav),
    "EPUB/styles.css": strToU8(`${manuscriptCss(settings)}\n${plan.present ? `${matterCss()}\n` : ""}`)
  };
  for (const page of documents) files[`EPUB/${page.item.href}`] = strToU8(page.text);
  for (const image of images) files[`EPUB/${image.item.href}`] = [image.bytes, { level: 0 }];
  return zipSync(files, { mtime: ENTRY_DATE });
}
