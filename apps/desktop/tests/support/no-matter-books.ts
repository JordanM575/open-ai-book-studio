/// <reference types="bun" />
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  bookSchema,
  chapterMetaSchema,
  manuscriptSettingsSchema,
  type BookDetail,
  type Chapter,
  type ManuscriptSettings
} from "@ai-book-studio/core/schema";
import { buildEpub } from "../../src/main/epub";
import { buildDocx, buildMarkdown, type DocxImage } from "../../src/main/export";
import { buildManuscriptHtml } from "../../src/main/manuscript-html";

/*
 * Books without front or back matter, and what the exporters made of them before matter existed
 * (spec 035 T013). The goldens in `tests/fixtures/no-matter/` were written by this file from the
 * exporters at 3a234cc; `no-matter-identity.test.ts` renders the same books with today's code and
 * requires the same output. Regenerate them only for a change that is meant to alter how a book
 * without matter exports:
 *
 *   bun apps/desktop/tests/support/no-matter-books.ts
 */

export const GOLDEN_DIR = join(import.meta.dir, "..", "fixtures", "no-matter");

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

function detail(
  id: string,
  fields: Record<string, unknown>,
  manuscript: Partial<ManuscriptSettings>,
  chapters: Chapter[]
): BookDetail {
  return {
    book: bookSchema.parse({
      id,
      createdAt: NOW,
      updatedAt: NOW,
      ...fields,
      settings: { manuscript: { ...manuscriptSettingsSchema.parse({}), ...manuscript } }
    }),
    chapters,
    chapterReadIssues: []
  };
}

const PNG: DocxImage = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 3, 2, 1]),
  width: 800,
  height: 600,
  mimeType: "image/png",
  prompt: "A lighthouse in a storm, with a keeper's lamp & a bell"
};

const JPEG: DocxImage = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 0xff, 0xd9]),
  width: 300,
  height: 900,
  mimeType: "image/jpeg",
  prompt: `Gulls over the gate. ${"A very long caption that runs on. ".repeat(8)}`
};

export interface NoMatterBook {
  name: string;
  detail: BookDetail;
  illustrations: Map<string, DocxImage>;
}

/** Every case the exporters branch on, each without a `matter` value. */
export function noMatterBooks(): NoMatterBook[] {
  return [
    {
      name: "full",
      detail: detail(
        "book_nomatter01",
        { title: `The Salt Road <&> "Tide" 'Mara'`, description: "A crossing at low tide & a bell." },
        { bodyFont: "Georgia", bodyFontSize: 13, includeTableOfContents: true, chapterTitleAlignment: "Center" },
        [
          chapter("ch_nomatter03", "The Gate", 3, "Morning came slowly.\r\nThe gate held.\r\n"),
          chapter("ch_nomatter01", "The Door", 1, "The hall was cold.\n\nMara closed the door.\n"),
          chapter("ch_nomatter04", "Bell \u0007 & tide", 4, "Ünïcödé — “quotes” and a lone \uD800 surrogate.\n\u0001control\n"),
          chapter("ch_nomatter02", "", 2, "Salt on the step,   \n  salt in the bell\n\n\nTide goes out.\n")
        ]
      ),
      illustrations: new Map([
        ["ch_nomatter01", PNG],
        ["ch_nomatter03", JPEG]
      ])
    },
    {
      name: "plain",
      detail: detail(
        "book_nomatter02",
        { title: "Plain", description: "" },
        {
          bodyFont: "Arial",
          bodyFontSize: 14,
          firstLineIndent: 0,
          lineSpacing: "Single",
          chapterTitleAlignment: "Left",
          includeTableOfContents: false,
          preserveLineBreaks: false
        },
        [chapter("ch_nomatter11", "Only", 1, "One line.\n")]
      ),
      illustrations: new Map()
    },
    {
      name: "empty",
      detail: detail("book_nomatter03", { title: "", description: "" }, { includeTableOfContents: true }, []),
      illustrations: new Map()
    },
    {
      name: "legacy",
      detail: detail(
        "book_nomatter04",
        {
          title: "Tidewater",
          description: "A tale told twice.",
          frontMatter: {
            subtitle: "A tidewater tale",
            author: "Ana Reyes",
            dedication: "For those who wait.",
            disclaimer: "Any resemblance is coincidental.",
            aboutAuthor: "Ana lives by the sea.",
            colophon: "Set in Garamond."
          }
        },
        { bodyFont: "Garamond", bodyFontSize: 11, firstLineIndent: 0.5, lineSpacing: "1.5" },
        [
          chapter("ch_nomatter21", "Low tide", 1, "The water left.\n"),
          chapter("ch_nomatter22", "High tide", 2, "The water came back.\n")
        ]
      ),
      illustrations: new Map()
    },
    {
      name: "padded",
      detail: detail(
        "book_nomatter05",
        { title: "   ", description: "  padded premise  " },
        { lineSpacing: "1.15", firstLineIndent: 0.1 },
        [chapter("ch_nomatter31", "  Spaced  ", 1, "\n\nStarts late.\n")]
      ),
      illustrations: new Map()
    }
  ];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Zip entries in order: markup as text, anything else as its hash. */
function entries(zip: Uint8Array, normalize: (name: string, text: string) => string = (_, text) => text): Array<[string, string]> {
  return Object.entries(unzipSync(zip)).map(([name, bytes]) =>
    /\.(xml|rels|xhtml|opf|css)$|^mimetype$/.test(name) ? [name, normalize(name, strFromU8(bytes))] : [name, `sha256:${sha256(bytes)}`]
  );
}

/**
 * Word writes the build time into the core properties, and the `docx` library numbers drawings
 * from a counter that lives as long as the process, so a picture's id depends on how many were
 * built before it. Neither is content; everything else is compared as written.
 */
function withoutBuildTime(name: string, text: string): string {
  if (name === "word/document.xml") return text.replace(/(<(?:wp:docPr|pic:cNvPr) id=")\d+"/g, '$1N"');
  if (name !== "docProps/core.xml") return text;
  return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:\w+>)/g, "$1BUILD-TIME$2");
}

/** The text a reader sees in the PDF: the printed HTML without its markup and stylesheet. */
export function printedText(html: string): string {
  return html
    .replace(/<head>[\s\S]*<\/head>/, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export interface NoMatterOutput {
  docx: Array<[string, string]>;
  epub: { sha256: string; entries: Array<[string, string]> };
  markdown: string;
  pdfHtml: string;
  pdfText: string;
}

export async function renderNoMatter(book: NoMatterBook): Promise<NoMatterOutput> {
  const docx = await buildDocx(book.detail, book.illustrations);
  const epub = buildEpub(book.detail, book.illustrations);
  const html = buildManuscriptHtml(book.detail, book.illustrations);
  return {
    docx: entries(new Uint8Array(docx), withoutBuildTime),
    epub: { sha256: sha256(epub), entries: entries(epub) },
    markdown: buildMarkdown(book.detail),
    pdfHtml: html,
    pdfText: printedText(html)
  };
}

if (import.meta.main) {
  await mkdir(GOLDEN_DIR, { recursive: true });
  for (const book of noMatterBooks()) {
    const first = await renderNoMatter(book);
    const second = await renderNoMatter(book);
    // A golden is only worth keeping if the same book always gives it.
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(`${book.name} does not render deterministically`);
    await writeFile(join(GOLDEN_DIR, `${book.name}.json`), `${JSON.stringify(first, null, 2)}\n`);
    console.log(`wrote ${book.name}.json`);
  }
}
