import { describe, expect, test } from "bun:test";
import {
  IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PROMPT,
  imageExtension,
  imageManifestSchema,
  imageMimeType,
  imageRecordSchema,
  inspectImage
} from "../src/images/schema";

/**
 * Reading an image from its bytes.
 *
 * The library trusts these bytes rather than a file extension or a client-supplied MIME type,
 * because a wrong one is permanent: an image recorded as PNG that is really a JPEG opens as a broken
 * picture forever. So each format is built here from its real header bytes — PNG, three kinds of
 * WebP and a JPEG — and each way of being wrong is checked as well.
 */

const SHA = "a".repeat(64);
const ISO = "2026-10-26T12:00:00.000Z";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk: length, type, then the width and height as big-endian uint32.
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

/** A minimal JPEG: SOI, an APP0 segment, then a baseline SOF0 carrying the size. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const bytes = new Uint8Array(2 + app0.length + sof.length + 2);
  bytes.set([0xff, 0xd8], 0);
  bytes.set(app0, 2);
  bytes.set(sof, 2 + app0.length);
  const view = new DataView(bytes.buffer);
  // The segment length counts itself, so the height sits at offset + 3 and the width at + 5.
  view.setUint16(2 + app0.length + 5, height, false);
  view.setUint16(2 + app0.length + 7, width, false);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

/** A lossy WebP ("VP8 "), whose size is in the frame header after the 0x9d 0x01 0x2a signature. */
function webpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  bytes.set([0x9d, 0x01, 0x2a], 23);
  const view = new DataView(bytes.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}

/** An extended WebP ("VP8X"), whose canvas size is three bytes less one in each direction. */
function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

/** A lossless WebP ("VP8L"), whose size is packed into one little-endian word. */
function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  new DataView(bytes.buffer).setUint32(21, bits, true);
  return bytes;
}

describe("detecting a format from its bytes", () => {
  test("a PNG reports the size in its header", () => {
    expect(inspectImage(png(1024, 768))).toEqual({ format: "png", mimeType: "image/png", width: 1024, height: 768 });
  });

  test("a JPEG walks its segments to the frame header", () => {
    expect(inspectImage(jpeg(1200, 900))).toEqual({ format: "jpeg", mimeType: "image/jpeg", width: 1200, height: 900 });
  });

  test("a lossy WebP reads the frame header", () => {
    expect(inspectImage(webpLossy(640, 480))).toEqual({ format: "webp", mimeType: "image/webp", width: 640, height: 480 });
  });

  test("an extended WebP reads the canvas size, which is stored one less", () => {
    expect(inspectImage(webpExtended(800, 600))).toEqual({ format: "webp", mimeType: "image/webp", width: 800, height: 600 });
  });

  test("a lossless WebP unpacks the packed word", () => {
    expect(inspectImage(webpLossless(320, 240))).toEqual({ format: "webp", mimeType: "image/webp", width: 320, height: 240 });
  });
});

describe("refusing what it cannot trust", () => {
  test("nothing at all", () => {
    expect(inspectImage(new Uint8Array())).toBeNull();
    expect(inspectImage(new TextEncoder().encode("not an image"))).toBeNull();
  });

  test("an empty file is not a zero-sized image", () => {
    expect(inspectImage(new Uint8Array(8))).toBeNull();
  });

  test("a PNG whose header is cut off before its size", () => {
    expect(inspectImage(png(10, 10).subarray(0, 20))).toBeNull();
  });

  test("a JPEG that ends before its frame header", () => {
    const truncated = jpeg(100, 100).subarray(0, 24);
    expect(inspectImage(truncated)).toBeNull();
  });

  test("a JPEG whose segment length lies about the file", () => {
    const bytes = jpeg(100, 100);
    // The segment length sits right after the 0xff 0xe0 marker. A length longer than the bytes
    // left is the corruption a half-finished download leaves.
    new DataView(bytes.buffer).setUint16(4, 0xffff, false);
    expect(inspectImage(bytes)).toBeNull();
  });

  test("a JPEG with a restart marker before its frame header", () => {
    // Restart markers carry no length, so a reader that treated every 0xff as a segment would
    // walk off into the middle of the image data.
    const base = jpeg(640, 480);
    const withRestart = new Uint8Array(base.length + 2);
    withRestart.set(base.subarray(0, 20), 0);
    withRestart.set([0xff, 0xd0], 20);
    withRestart.set(base.subarray(20), 22);
    expect(inspectImage(withRestart)).toEqual({ format: "jpeg", mimeType: "image/jpeg", width: 640, height: 480 });
  });

  test("a JPEG with a nonsense segment length", () => {
    const bytes = jpeg(100, 100);
    new DataView(bytes.buffer).setUint16(4, 1, false);
    expect(inspectImage(bytes)).toBeNull();
  });

  test("a lossless WebP without its signature byte", () => {
    const bytes = webpLossless(64, 64);
    bytes[20] = 0x00;
    expect(inspectImage(bytes)).toBeNull();
  });

  test("a WebP that is only the container, with no frame", () => {
    const bytes = new Uint8Array(20);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(inspectImage(bytes)).toBeNull();
  });

  test("a WebP with a chunk it does not know", () => {
    const bytes = new Uint8Array(40);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x41, 0x4c, 0x50, 0x48], 12); // "ALPH"
    expect(inspectImage(bytes)).toBeNull();
  });

  test("something larger than the library will accept", () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectImage(huge)).toBeNull();
  });

  test("a RIFF that is not a WebP", () => {
    const bytes = new Uint8Array(40);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(inspectImage(bytes)).toBeNull();
  });

  test("a JPEG whose bytes start with 0xff but are not a JPEG", () => {
    const bytes = new Uint8Array(40);
    bytes.set([0xff, 0xd8, 0x00], 0);
    // No marker follows, so there is nothing to walk to.
    expect(inspectImage(bytes)).toBeNull();
  });
});

describe("the names a format has", () => {
  test("the extension is what a file manager expects", () => {
    expect(IMAGE_FORMATS.map(imageExtension)).toEqual(["png", "webp", "jpg"]);
  });

  test("the MIME type is the one a browser serves", () => {
    expect(IMAGE_FORMATS.map(imageMimeType)).toEqual(["image/png", "image/webp", "image/jpeg"]);
  });
});

describe("the record a manifest holds", () => {
  const record = {
    id: "img_00000001",
    kind: "chapter",
    fileName: "img_00000001.png",
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    bytes: 20_754,
    sha256: SHA,
    provider: "meta",
    model: "muse-image",
    source: "generated",
    createdAt: ISO
  };

  test("fills in what the writer left out", () => {
    const parsed = imageRecordSchema.parse(record);
    expect(parsed.prompt).toBe("");
    expect(parsed.size).toBe("");
    expect(parsed.chapterId).toBeNull();
    expect(parsed.characterId).toBeNull();
    expect(parsed.cutoutOf).toBeNull();
    expect(parsed.costUsd).toBeNull();
    expect(parsed.revisedPrompt).toBeNull();
    expect(parsed.confidence).toBeNull();
  });

  test("refuses an id that is not an image id", () => {
    expect(imageRecordSchema.safeParse({ ...record, id: "img_1" }).success).toBe(false);
  });

  test("refuses a file name that is a path", () => {
    expect(imageRecordSchema.safeParse({ ...record, fileName: "../outside.png" }).success).toBe(false);
  });

  test("refuses a hash that is not a sha256", () => {
    expect(imageRecordSchema.safeParse({ ...record, sha256: "not-a-hash" }).success).toBe(false);
  });

  test("refuses a size of zero pixels or zero bytes", () => {
    expect(imageRecordSchema.safeParse({ ...record, width: 0 }).success).toBe(false);
    expect(imageRecordSchema.safeParse({ ...record, height: 0 }).success).toBe(false);
    expect(imageRecordSchema.safeParse({ ...record, bytes: 0 }).success).toBe(false);
  });

  test("refuses an image larger than the library will hold", () => {
    expect(imageRecordSchema.safeParse({ ...record, bytes: MAX_IMAGE_BYTES + 1 }).success).toBe(false);
  });

  test("refuses a prompt longer than a prompt", () => {
    expect(imageRecordSchema.safeParse({ ...record, prompt: "x".repeat(MAX_IMAGE_PROMPT + 1) }).success).toBe(false);
  });

  test("refuses a confidence outside zero to one", () => {
    expect(imageRecordSchema.safeParse({ ...record, confidence: 1.5 }).success).toBe(false);
  });

  test("refuses a kind or source it does not know", () => {
    expect(imageRecordSchema.safeParse({ ...record, kind: "poster" }).success).toBe(false);
    expect(imageRecordSchema.safeParse({ ...record, source: "stolen" }).success).toBe(false);
  });

  test("a manifest with no images is a valid, empty manifest", () => {
    expect(imageManifestSchema.parse({ schemaVersion: 1 })).toEqual({ schemaVersion: 1, images: [] });
  });

  test("a manifest refuses a version that is not a version", () => {
    expect(imageManifestSchema.safeParse({ schemaVersion: 0 }).success).toBe(false);
  });
});
