import {
  AlignmentType,
  Document,
  HeadingLevel,
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

/**
 * Builds a Word manuscript from the book's files.
 *
 * The Markdown body is the source of truth. A paragraph is a line, so each non-empty line becomes
 * its own paragraph with the book's manuscript settings applied. Nothing is written to the library.
 */
export function buildDocx(detail: BookDetail): Promise<Buffer> {
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
