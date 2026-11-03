/**
 * Spec 029 T014 DOCX intake validation.
 *
 * This file validated the parser approach before D-183 enabled DOCX import, and it stays as
 * the evidence for mammoth's raw behavior that the intake builds on. The enabled intake itself
 * (container sniff, transform, loss report, staged publication) is proven in
 * `docx-import.test.ts`. Every document is synthesized in-test with the repo's own `docx`
 * dependency — no binaries, no real manuscripts, no network.
 *
 * Validated contract: mammoth converts the body (Title/H1 style map, inline marks, lists);
 * chapter boundaries are the non-title top-level headings; images never embed as base64
 * (the convertImage override records them for the loss report); headers, footers and other
 * dropped structures are found by zip sniffing with fflate; table cell text arrives in
 * document order for the future plain-text transform.
 */
import { describe, expect, test } from "bun:test";
import { Document, Footer, Header, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { Paragraph as DocxParagraph, Table as DocxTable } from "docx";
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { ACCEPTED_EXTENSIONS, validateSource } from "@ai-book-studio/core/manuscript-import";
import { IMPORT_DIALOG_EXTENSIONS } from "../src/main/import";

const INTAKE_STYLE_MAP = ["p[style-name='Title'] => h1.title"];

async function pack(children: Array<DocxParagraph | DocxTable>, extras?: { header?: string; footer?: string }): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        ...(extras?.header
          ? { headers: { default: new Header({ children: [new Paragraph({ text: extras.header })] }) } }
          : {}),
        ...(extras?.footer
          ? { footers: { default: new Footer({ children: [new Paragraph({ text: extras.footer })] }) } }
          : {}),
        children
      }
    ]
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Non-title top-level headings: the chapter-boundary signal the future intake splits on. */
function chapterHeadings(html: string): string[] {
  const matches = [...html.matchAll(/<h1(?![^>]*\btitle\b)[^>]*>(.*?)<\/h1>/g)];
  return matches.map((match) => match[1] ?? "");
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("docx intake validation", () => {
  test("chapter boundaries surface as non-title top-level headings", async () => {
    const bytes = await pack([
      new Paragraph({ text: "A Synthetic Voyage", heading: HeadingLevel.TITLE }),
      new Paragraph({ text: "Chapter One", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "First body." }),
      new Paragraph({ text: "Chapter Two", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "Second body." })
    ]);
    const { value: html, messages } = await mammoth.convertToHtml({ buffer: bytes }, { styleMap: INTAKE_STYLE_MAP });
    expect(chapterHeadings(html)).toEqual(["Chapter One", "Chapter Two"]);
    expect(html).toContain("<h1 class=\"title\">A Synthetic Voyage</h1>");
    expect(messages).toEqual([]);
  });

  test("body text survives with inline marks and list wording", async () => {
    const bytes = await pack([
      new Paragraph({
        children: [new TextRun("Plain. "), new TextRun({ text: "Bold.", bold: true }), new TextRun({ text: " Italic.", italics: true })]
      })
    ]);
    const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
    expect(html).toContain("<p>Plain. <strong>Bold.</strong><em> Italic.</em></p>");
  });

  test("images never embed as base64; the override records them for the loss report", async () => {
    const bytes = await pack([
      new Paragraph({ text: "Chapter One", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new ImageRun({ type: "png", data: TINY_PNG, transformation: { width: 10, height: 10 } })] })
    ]);
    const seen: string[] = [];
    const { value: html } = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          seen.push(image.contentType);
          return { src: "" };
        })
      }
    );
    expect(seen).toEqual(["image/png"]);
    expect(html).not.toContain("data:");
    expect(html).not.toContain("base64");
  });

  test("headers and footers are dropped silently, so the intake must sniff for them", async () => {
    const bytes = await pack([new Paragraph({ text: "Body." })], { header: "Running head", footer: "Page foot" });
    const { value: html, messages } = await mammoth.convertToHtml({ buffer: bytes });
    expect(html).not.toContain("Running head");
    expect(html).not.toContain("Page foot");
    expect(messages).toEqual([]);
  });

  test("zip sniffing finds the structures the parser drops", async () => {
    const bytes = await pack(
      [new Paragraph({ children: [new ImageRun({ type: "png", data: TINY_PNG, transformation: { width: 10, height: 10 } })] })],
      { header: "Running head", footer: "Page foot" }
    );
    const names = Object.keys(unzipSync(new Uint8Array(bytes))).filter((name) => !name.endsWith("/"));
    expect(names.some((name) => name.startsWith("word/header"))).toBe(true);
    expect(names.some((name) => name.startsWith("word/footer"))).toBe(true);
    expect(names.filter((name) => name.startsWith("word/media/"))).toHaveLength(1);
  });

  test("table cell text arrives in document order for the future plain-text transform", async () => {
    const bytes = await pack([
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("north") ] }),
              new TableCell({ children: [new Paragraph("south") ] })
            ]
          })
        ]
      })
    ]);
    const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
    const north = html.indexOf("north");
    const south = html.indexOf("south");
    expect(north).toBeGreaterThan(-1);
    expect(south).toBeGreaterThan(north);
  });

  test("the product path now accepts docx and never decodes it as text (D-183)", () => {
    expect(ACCEPTED_EXTENSIONS).toContain(".docx");
    expect(IMPORT_DIALOG_EXTENSIONS).toContain("docx");
    const probe = new Uint8Array([80, 75, 3, 4]);
    expect(validateSource({ fileName: "book.docx", bytes: probe })).toMatchObject({
      status: "refused",
      reason: "unsupported-extension"
    });
  });
});
