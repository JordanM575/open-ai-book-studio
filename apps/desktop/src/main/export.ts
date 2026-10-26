import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  PageBreak,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import type { BookDetail, ManuscriptSettings } from "@ai-book-studio/core/schema";

const LINE_SPACING: Record<ManuscriptSettings["lineSpacing"], number> = {
  Single: 240,
  "1.15": 276,
  "1.5": 360,
  Double: 480
};

function twips(inches: number): number {
  return Math.round(inches * 1440);
}

export interface DocxImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  prompt: string;
}

/**
 * Builds a Word manuscript from the book's files.
 *
 * The Markdown body is the source of truth. A paragraph is a line, so each non-empty line becomes
 * its own paragraph with the book's manuscript settings applied. Nothing is written to the library.
 */
export function buildDocx(detail: BookDetail, illustrations: Map<string, DocxImage> = new Map()): Promise<Buffer> {
  const { book, chapters } = detail;
  const settings = book.settings.manuscript;
  const bodyFont = settings.bodyFont;
  const bodySize = Math.round(settings.bodyFontSize * 2);
  const alignment = settings.chapterTitleAlignment === "Center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const line = LINE_SPACING[settings.lineSpacing];
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: book.title, bold: true, font: bodyFont, size: 64 })]
    })
  );
  if (book.description.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: book.description.trim(), italics: true, font: bodyFont, size: 24 })]
      })
    );
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  ordered.forEach((chapter, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
        alignment,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: chapter.title || `Chapter ${chapter.order}`,
            bold: true,
            font: bodyFont,
            size: 36
          })
        ]
      })
    );

    const lines = chapter.content.replace(/\r\n/g, "\n").split("\n");
    for (const value of lines) {
      const text = value.trimEnd();
      if (!text.trim()) {
        children.push(new Paragraph({ spacing: { line, lineRule: LineRuleType.AUTO }, children: [] }));
        continue;
      }
      children.push(
        new Paragraph({
          spacing: { line, lineRule: LineRuleType.AUTO, after: 0 },
          ...(settings.firstLineIndent > 0 ? { indent: { firstLine: twips(settings.firstLineIndent) } } : {}),
          children: [new TextRun({ text, font: bodyFont, size: bodySize })]
        })
      );
    }

    const illustration = illustrations.get(chapter.id);
    if (illustration) {
      const ratio = Math.min(480 / illustration.width, 640 / illustration.height);
      const caption = illustration.prompt.trim();
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 120 },
          children: [
            new ImageRun({
              type: illustration.mimeType === "image/png" ? "png" : "jpg",
              data: illustration.bytes,
              transformation: {
                width: Math.max(1, Math.round(illustration.width * ratio)),
                height: Math.max(1, Math.round(illustration.height * ratio))
              },
              altText: {
                name: chapter.title,
                description: caption || `Illustration for ${chapter.title}`,
                title: chapter.title
              }
            })
          ]
        })
      );
      if (caption) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: caption.length > 160 ? `${caption.slice(0, 159)}…` : caption,
                italics: true,
                font: bodyFont,
                size: 20
              })
            ]
          })
        );
      }
    }
  });

  return Packer.toBuffer(
    new Document({
      creator: "AI Book Studio",
      title: book.title,
      description: book.description,
      sections: [{ properties: {}, children }]
    })
  );
}
