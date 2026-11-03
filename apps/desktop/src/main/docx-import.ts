/**
 * Word (DOCX) manuscript conversion in the main process (D-183).
 *
 * Shared core owns the container sniff, the size caps, the HTML-to-Markdown transform
 * and the loss report; this module only runs mammoth between them. Mammoth reads the
 * stored-only package core returns, so it never inflates an unbounded part, and its
 * image hook records each picture without reading a byte: images are reported, never
 * embedded, and never become base64.
 */
import mammoth from "mammoth";
import type { ValidatedSource } from "@ai-book-studio/core/manuscript-import";
import {
  DOCX_STYLE_MAP,
  convertDocxHtml,
  mammothInput,
  openDocxPackage,
  scanDocxPackage,
  type DocxRefusal
} from "@ai-book-studio/core/manuscript-import/docx";

export async function readDocxSource(fileName: string, bytes: Uint8Array): Promise<ValidatedSource | DocxRefusal> {
  const pkg = openDocxPackage(fileName, bytes);
  if (pkg.status === "refused") return pkg;
  const packed = mammothInput(pkg);
  let converted: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    converted = await mammoth.convertToHtml(
      { buffer: Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength) },
      {
        styleMap: [...DOCX_STYLE_MAP],
        // A style map embedded in the document could reshape or drop its own text.
        includeEmbeddedStyleMap: false,
        // Empty paragraphs are the author's spacing; the transform keeps them as blank lines.
        ignoreEmptyParagraphs: false,
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: "" }))
      }
    );
  } catch {
    return {
      status: "refused",
      reason: "corrupt",
      message: `“${fileName}” is damaged and cannot be read. Open it in Word, save a new copy and choose that.`
    };
  }
  return convertDocxHtml({
    fileName,
    html: converted.value,
    messages: converted.messages,
    scanned: scanDocxPackage(pkg)
  });
}
