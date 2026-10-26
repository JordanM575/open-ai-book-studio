import { z } from "zod";

export const IMAGE_SCHEMA_VERSION = 1;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PROMPT = 4_000;
export const IMAGE_KINDS = ["chapter", "character", "cover", "other"] as const;
export const IMAGE_SOURCES = ["generated", "imported", "cutout"] as const;
export const IMAGE_FORMATS = ["png", "webp", "jpeg"] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];
export type ImageSource = (typeof IMAGE_SOURCES)[number];
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const imageIdSchema = z.string().regex(/^img_[A-Za-z0-9-]{6,}$/, "invalid image id");
const chapterId = z.string().regex(/^ch_[A-Za-z0-9-]{6,}$/, "invalid chapter id").nullable().default(null);
const characterId = z.string().regex(/^char_[A-Za-z0-9-]{6,}$/, "invalid character id").nullable().default(null);
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

export const imageRecordSchema = z.object({
  id: imageIdSchema,
  kind: z.enum(IMAGE_KINDS),
  chapterId,
  characterId,
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "invalid image file name").max(200),
  mimeType: z.enum(["image/png", "image/webp", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prompt: z.string().max(MAX_IMAGE_PROMPT).default(""),
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(200),
  size: z.string().max(40).default(""),
  source: z.enum(IMAGE_SOURCES),
  createdAt: isoDate,
  cutoutOf: imageIdSchema.nullable().default(null),
  costUsd: z.number().nonnegative().nullable().default(null),
  revisedPrompt: z.string().max(MAX_IMAGE_PROMPT).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null)
});

export type ImageRecord = z.infer<typeof imageRecordSchema>;

export const imageManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  images: z.array(imageRecordSchema).default([])
});

export type ImageManifest = z.infer<typeof imageManifestSchema>;

export interface ImageInspection {
  format: ImageFormat;
  mimeType: "image/png" | "image/webp" | "image/jpeg";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Detect the real format and dimensions from bytes. The manifest and the UI use this rather than
 * a client-supplied MIME type, because a wrong extension is a permanent library mistake.
 */
export function inspectImage(bytes: Uint8Array): ImageInspection | null {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    if (bytes.byteLength < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      format: "png",
      mimeType: "image/png",
      width: view.getUint32(16, false),
      height: view.getUint32(20, false)
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return jpegSize(bytes);
  }
  if (
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP" &&
    bytes.byteLength >= 30
  ) {
    return webpSize(bytes);
  }
  return null;
}

export function imageExtension(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function imageMimeType(format: ImageFormat): ImageInspection["mimeType"] {
  switch (format) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpeg":
      return "image/jpeg";
  }
}

function jpegSize(bytes: Uint8Array): ImageInspection | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1] ?? 0;
    while (marker === 0xff && offset + 2 < bytes.byteLength) {
      offset += 1;
      marker = bytes[offset + 1] ?? 0;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.byteLength) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 7 > bytes.byteLength) return null;
      return {
        format: "jpeg",
        mimeType: "image/jpeg",
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false)
      };
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageInspection | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { format: "webp", mimeType: "image/webp", width, height };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.byteLength >= 25) {
    const bits = view.getUint32(21, true);
    return {
      format: "webp",
      mimeType: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  if (chunk === "VP8 " && bytes.byteLength >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      format: "webp",
      mimeType: "image/webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff
    };
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}
