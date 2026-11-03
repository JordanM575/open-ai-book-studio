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
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { BookDetail, ManuscriptSettings } from "@ai-book-studio/core/schema";
import type { ImageList, StoredImage } from "@ai-book-studio/core/images";
import { LibraryError } from "./library/errors";
import { writeFileAtomic } from "./library/atomic";

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

/** The image-store surface the DOCX journey reads. The desktop Library satisfies this. */
export interface DocxImageSource {
  listImages(bookId: string): Promise<ImageList>;
  readImage(bookId: string, imageId: string): Promise<StoredImage | null>;
}

/**
 * Resolves the chapter illustrations for a DOCX export through the image store.
 *
 * Illustration problems never fail the export: an unreadable manifest yields no illustrations,
 * and unattached images, WebP images (no Word-compatible variant) and unreadable bytes are
 * skipped with a warning. The first readable image per chapter wins.
 */
export async function collectDocxImages(
  detail: BookDetail,
  images: DocxImageSource
): Promise<Map<string, DocxImage>> {
  const collected = new Map<string, DocxImage>();
  try {
    const { manifest } = await images.listImages(detail.book.id);
    for (const record of manifest.images) {
      if (!record.chapterId || record.mimeType === "image/webp") continue;
      if (collected.has(record.chapterId)) continue;
      try {
        const stored = await images.readImage(detail.book.id, record.id);
        if (stored) {
          collected.set(record.chapterId, {
            bytes: stored.bytes,
            width: record.width,
            height: record.height,
            mimeType: record.mimeType,
            prompt: record.prompt
          });
        }
      } catch (error) {
        console.warn("[export] Skipping an unavailable illustration:", (error as Error).message);
      }
    }
  } catch (error) {
    console.warn("[export] Could not read illustrations:", (error as Error).message);
  }
  return collected;
}

/** A safe file name for the export dialog, derived from the book title. */
function suggestStem(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "manuscript"
  );
}

/** A safe file name for the export dialog, derived from the book title. */
export function suggestDocxName(title: string): string {
  return `${suggestStem(title)}.docx`;
}

/** A safe file name for the Markdown export dialog, derived from the book title. */
export function suggestMarkdownName(title: string): string {
  return `${suggestStem(title)}.md`;
}

/**
 * Builds a Markdown manuscript from the book's files.
 *
 * The Markdown body is already the source of truth, so chapters join in reading order under
 * their own headings with their text unchanged, one blank line between blocks. Nothing is
 * written to the library.
 */
export function buildMarkdown(detail: BookDetail): string {
  const { book, chapters } = detail;
  const blocks: string[] = [];
  if (book.title.trim()) blocks.push(`# ${book.title.trim()}`);
  if (book.description.trim()) blocks.push(`_${book.description.trim()}_`);
  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  for (const chapter of ordered) {
    blocks.push(`## ${chapter.title || `Chapter ${chapter.order}`}`);
    const body = chapter.content.replace(/\r\n/g, "\n").replace(/^\n+/, "").trimEnd();
    if (body) blocks.push(body);
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * True when the candidate destination is the library root or inside it. An export there could
 * alias a source file or land inside the managed source directory, so the boundary refuses it
 * and asks the author to choose another folder. This is a path-prefix check: it does not
 * resolve symlinks that point back into the library from outside.
 */
export function isInsideLibrary(libraryRoot: string, candidate: string): boolean {
  const comparison = relative(resolve(libraryRoot), resolve(candidate));
  return comparison === "" || (comparison !== ".." && !comparison.startsWith(`..${sep}`) && !isAbsolute(comparison));
}

export interface ExportState {
  mtimeMs: number;
  size: number;
}

/** Kept for the DOCX journey's existing imports; new code uses ExportDeps. */
export type DocxExportState = ExportState;

export interface ExportDeps {
  pickDestination: (suggestedName: string) => Promise<string | null>;
  confirmReplace: (path: string) => Promise<boolean>;
  statDestination: (path: string) => Promise<ExportState | null>;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
}

/** Kept for the DOCX journey's existing imports; new code uses ExportDeps. */
export type DocxExportDeps = ExportDeps;

function sameExportState(before: ExportState | null, after: ExportState | null): boolean {
  if (!before || !after) return before === after;
  return before.mtimeMs === after.mtimeMs && before.size === after.size;
}

/**
 * Publishes a DOCX export through the safe-publication boundary.
 *
 * A cancelled picker or a declined replacement returns null and writes nothing, exactly like a
 * cancelled save dialog. A destination inside the open library, a file that changed after the
 * replacement consent, or a failed write throws and never leaves a partial file: the write goes
 * through the atomic writer, which stages to a sibling temp file and renames over the target.
 */
export async function exportManuscriptDocx(
  detail: BookDetail,
  illustrations: Map<string, DocxImage>,
  libraryRoot: string,
  deps: ExportDeps
): Promise<string | null> {
  const destination = await deps.pickDestination(suggestDocxName(detail.book.title));
  if (!destination) return null;
  if (isInsideLibrary(libraryRoot, destination)) {
    throw new LibraryError(
      "invalid",
      "That location is inside the open library. Choose another folder so the export cannot overwrite the book's own files."
    );
  }
  const data = await buildDocx(detail, illustrations);
  const observed = await deps.statDestination(destination);
  if (observed && !(await deps.confirmReplace(destination))) return null;
  const reread = await deps.statDestination(destination);
  if (!sameExportState(observed, reread)) {
    throw new LibraryError("io", "The file changed before the export was saved. Nothing was written. Try the export again.");
  }
  const write = deps.writeFile ?? ((path, bytes) => writeFileAtomic(path, Buffer.from(bytes)));
  await write(destination, new Uint8Array(data));
  return destination;
}

/**
 * Publishes a Markdown export through the same safe-publication boundary as the Word
 * export: a cancelled picker or a declined replacement returns null and writes nothing,
 * a destination inside the open library is refused, and a file that changed after the
 * replacement consent throws without leaving a partial file.
 */
export async function exportManuscriptMarkdown(
  detail: BookDetail,
  libraryRoot: string,
  deps: ExportDeps
): Promise<string | null> {
  const destination = await deps.pickDestination(suggestMarkdownName(detail.book.title));
  if (!destination) return null;
  if (isInsideLibrary(libraryRoot, destination)) {
    throw new LibraryError(
      "invalid",
      "That location is inside the open library. Choose another folder so the export cannot overwrite the book's own files."
    );
  }
  const data = buildMarkdown(detail);
  const observed = await deps.statDestination(destination);
  if (observed && !(await deps.confirmReplace(destination))) return null;
  const reread = await deps.statDestination(destination);
  if (!sameExportState(observed, reread)) {
    throw new LibraryError("io", "The file changed before the export was saved. Nothing was written. Try the export again.");
  }
  const write = deps.writeFile ?? ((path, bytes) => writeFileAtomic(path, Buffer.from(bytes)));
  await write(destination, new TextEncoder().encode(data));
  return destination;
}
