import type { SegmentationMatch } from "@ai-book-studio/core/images/segmentation";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Apply a SAM mask to a decoded image. The mask raster covers `bounds`; outside it the pixel is
 * transparent. The source is copied, never mutated.
 */
export function applyCutoutMask(image: RgbaImage, match: SegmentationMatch): RgbaImage {
  const data = new Uint8ClampedArray(image.data);
  const left = Math.max(0, Math.floor(match.bounds.left));
  const top = Math.max(0, Math.floor(match.bounds.top));
  const right = Math.min(image.width, Math.ceil(match.bounds.right));
  const bottom = Math.min(image.height, Math.ceil(match.bounds.bottom));
  const spanX = Math.max(1, match.bounds.right - match.bounds.left);
  const spanY = Math.max(1, match.bounds.bottom - match.bounds.top);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      let keep = false;
      if (x >= left && x < right && y >= top && y < bottom) {
        const maskX = Math.min(match.width - 1, Math.max(0, Math.floor(((x - match.bounds.left) / spanX) * match.width)));
        const maskY = Math.min(match.height - 1, Math.max(0, Math.floor(((y - match.bounds.top) / spanY) * match.height)));
        keep = (match.raster[maskY * match.width + maskX] ?? 0) !== 0;
      }
      if (!keep) data[offset + 3] = 0;
    }
  }
  return { width: image.width, height: image.height, data };
}

/** Decode the source data URL, apply the mask and return a transparent PNG blob. */
export async function cutoutPng(sourceDataUrl: string, match: SegmentationMatch): Promise<Blob> {
  const response = await fetch(sourceDataUrl);
  const source = await response.blob();
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The canvas is unavailable. Cutouts need a working graphics context.");
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const cut = applyCutoutMask(
    { width: image.width, height: image.height, data: image.data },
    match
  );
  const pixels = new Uint8ClampedArray(cut.data.length);
  pixels.set(cut.data);
  context.putImageData(new ImageData(pixels, cut.width, cut.height), 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The cutout could not be encoded as a PNG.");
  return blob;
}
