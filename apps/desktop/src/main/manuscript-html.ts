import type { BookDetail, Chapter, ManuscriptSettings } from "@ai-book-studio/core/schema";
import type { DocxImage } from "./export";

/*
 * The manuscript as HTML, for the PDF export and for the EPUB's chapter files.
 *
 * It follows the Word export: a title page, then each chapter in reading order with the book's
 * manuscript settings, and the chapter's illustration after its text. The markup is also
 * well-formed XHTML, so the EPUB can use the same pieces. Every piece of author text is escaped,
 * and nothing depends on the clock, so the same book always gives the same document.
 */

const LINE_HEIGHT: Record<ManuscriptSettings["lineSpacing"], string> = {
  Single: "1",
  "1.15": "1.15",
  "1.5": "1.5",
  Double: "2"
};

const FONT_FALLBACK: Partial<Record<ManuscriptSettings["bodyFont"], string>> = {
  "Courier New": "monospace",
  Arial: "sans-serif",
  Helvetica: "sans-serif",
  Calibri: "sans-serif"
};

/** Characters XML 1.0 cannot carry at all. They are dropped rather than breaking the document. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the ranges ARE the list of characters XML refuses
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
/** Half of a surrogate pair on its own, which no encoder can write. It becomes U+FFFD. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Author text, safe inside an element or a quoted attribute in both HTML and XHTML. */
export function escapeText(text: string): string {
  return text
    .replace(LONE_SURROGATE, "�")
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function readingOrder(detail: BookDetail): Chapter[] {
  return [...detail.chapters].sort((a, b) => a.order - b.order);
}

/** The heading a chapter gets in every export: its title, or its number when it has none. */
export function chapterHeading(chapter: Chapter): string {
  return chapter.title.trim() || `Chapter ${chapter.order}`;
}

export function bookTitle(detail: BookDetail): string {
  return detail.book.title.trim() || "Untitled book";
}

/**
 * The chapter body, one paragraph per line as in the Word export. A blank line keeps its height,
 * so stanza gaps survive. The final newline every chapter file ends with is not a blank line.
 */
export function chapterParagraphs(content: string): string {
  const body = content.replace(/\r\n/g, "\n");
  if (!body.trim()) return "";
  return body
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      const text = line.trimEnd();
      return text.trim() ? `<p>${escapeText(text)}</p>` : `<p class="blank">&#160;</p>`;
    })
    .join("\n");
}

/** The Word export's picture box: the image scaled to fit 480 by 640 pixels. */
function illustrationSize(image: DocxImage): { width: number; height: number } {
  const ratio = Math.min(480 / image.width, 640 / image.height);
  return {
    width: Math.max(1, Math.round(image.width * ratio)),
    height: Math.max(1, Math.round(image.height * ratio))
  };
}

/** A chapter's illustration with the Word export's alt text and caption. `src` is already safe. */
export function illustrationFigure(image: DocxImage, src: string, heading: string): string {
  const prompt = image.prompt.trim();
  const { width, height } = illustrationSize(image);
  const alt = escapeText(prompt || `Illustration for ${heading}`);
  const characters = Array.from(prompt);
  const caption = characters.length > 160 ? `${characters.slice(0, 159).join("")}…` : prompt;
  return [
    `<figure class="illustration">`,
    `<img src="${src}" alt="${alt}" width="${width}" height="${height}" />`,
    caption ? `<figcaption>${escapeText(caption)}</figcaption>` : "",
    `</figure>`
  ].join("");
}

/**
 * The manuscript settings as CSS: body font and size, first-line indent, line spacing, chapter
 * title alignment and whether runs of spaces are kept. Sizes follow the Word export: a 32 pt
 * title, 18 pt chapter titles and 10 pt captions.
 */
export function manuscriptCss(settings: ManuscriptSettings): string {
  const font = `'${settings.bodyFont}', ${FONT_FALLBACK[settings.bodyFont] ?? "serif"}`;
  const align = settings.chapterTitleAlignment === "Center" ? "center" : "left";
  const indent = settings.firstLineIndent > 0 ? `${settings.firstLineIndent}in` : "0";
  return [
    `body { margin: 0; font-family: ${font}; font-size: ${settings.bodyFontSize}pt; }`,
    `.title-page { text-align: center; }`,
    `.book-title { font-size: 32pt; font-weight: bold; margin: 0 0 12pt; }`,
    `.book-description { font-size: 12pt; font-style: italic; margin: 0; }`,
    `.contents-title, .chapter-title { text-align: ${align}; font-size: 18pt; font-weight: bold; margin: 0 0 12pt; }`,
    `.contents ol { list-style: none; margin: 0; padding: 0; }`,
    `.contents li { margin: 0 0 6pt; }`,
    `.contents a { color: inherit; text-decoration: none; }`,
    `.chapter p { margin: 0; text-indent: ${indent}; line-height: ${LINE_HEIGHT[settings.lineSpacing]}; white-space: ${settings.preserveLineBreaks ? "pre-wrap" : "normal"}; }`,
    `.chapter p.blank { text-indent: 0; }`,
    `.illustration { margin: 12pt 0 0; text-align: center; break-inside: avoid; }`,
    `.illustration img { max-width: 100%; height: auto; }`,
    `.illustration figcaption { font-size: 10pt; font-style: italic; margin: 6pt 0 12pt; }`
  ].join("\n");
}

function dataUri(image: DocxImage): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

/**
 * The whole manuscript as one HTML document for the PDF export: the title page, a contents page
 * when the book asks for one, then each chapter on a new page. Illustrations are inlined as data
 * URIs in this transient document only, and the content security policy refuses anything remote.
 */
export function buildManuscriptHtml(detail: BookDetail, illustrations: Map<string, DocxImage> = new Map()): string {
  const settings = detail.book.settings.manuscript;
  const title = bookTitle(detail);
  const description = detail.book.description.trim();
  const chapters = readingOrder(detail);
  const sections: string[] = [
    [
      `<section class="title-page">`,
      `<h1 class="book-title">${escapeText(title)}</h1>`,
      description ? `<p class="book-description">${escapeText(description)}</p>` : "",
      `</section>`
    ]
      .filter(Boolean)
      .join("\n")
  ];
  if (settings.includeTableOfContents && chapters.length > 0) {
    sections.push(
      [
        `<nav class="contents">`,
        `<h2 class="contents-title">Contents</h2>`,
        `<ol>`,
        ...chapters.map(
          (chapter, index) => `<li><a href="#chapter-${index + 1}">${escapeText(chapterHeading(chapter))}</a></li>`
        ),
        `</ol>`,
        `</nav>`
      ].join("\n")
    );
  }
  chapters.forEach((chapter, index) => {
    const heading = chapterHeading(chapter);
    const image = illustrations.get(chapter.id);
    sections.push(
      [
        `<section class="chapter" id="chapter-${index + 1}">`,
        `<h2 class="chapter-title">${escapeText(heading)}</h2>`,
        chapterParagraphs(chapter.content),
        image ? illustrationFigure(image, dataUri(image), heading) : "",
        `</section>`
      ]
        .filter(Boolean)
        .join("\n")
    );
  });
  return [
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />`,
    `<title>${escapeText(title)}</title>`,
    `<style>`,
    `@page { size: A4; margin: 1in; }`,
    manuscriptCss(settings),
    `.contents, .chapter { break-before: page; }`,
    `</style>`,
    `</head>`,
    `<body>`,
    sections.join("\n"),
    `</body>`,
    `</html>`,
    ``
  ].join("\n");
}
