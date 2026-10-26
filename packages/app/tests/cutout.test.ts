import { describe, expect, test } from "bun:test";
import { applyCutoutMask } from "../src/lib/cutout";
import type { SegmentationMatch } from "@ai-book-studio/core/images/segmentation";

function image(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 10;
    data[index + 1] = 20;
    data[index + 2] = 30;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

function match(overrides: Partial<SegmentationMatch> = {}): SegmentationMatch {
  const raster = new Uint8Array(16);
  raster[0] = 1;
  raster[15] = 1;
  return {
    objectId: "1",
    confidence: 0.9,
    width: 4,
    height: 4,
    bounds: { left: 0, top: 0, right: 4, bottom: 4 },
    raster,
    ...overrides
  };
}

describe("cutout compositor", () => {
  test("clears alpha where the mask is zero and keeps the source colours", () => {
    const result = applyCutoutMask(image(4, 4), match());
    expect(result.data[0]).toBe(10);
    expect(result.data[3]).toBe(255);
    expect(result.data[(0 * 4 + 1) * 4 + 3]).toBe(0);
    expect(result.data[(3 * 4 + 0) * 4 + 3]).toBe(0);
    expect(result.data[(3 * 4 + 3) * 4 + 3]).toBe(255);
  });

  test("restricts the mask to its source bounds", () => {
    const result = applyCutoutMask(
      image(4, 4),
      match({
        width: 2,
        height: 2,
        bounds: { left: 2, top: 2, right: 4, bottom: 4 },
        raster: new Uint8Array([1, 1, 1, 1])
      })
    );
    expect(result.data[3]).toBe(0);
    expect(result.data[(2 * 4 + 2) * 4 + 3]).toBe(255);
    expect(result.data[(3 * 4 + 3) * 4 + 3]).toBe(255);
  });

  test("does not mutate the source image", () => {
    const source = image(2, 2);
    const before = new Uint8ClampedArray(source.data);
    applyCutoutMask(source, match({ bounds: { left: 0, top: 0, right: 2, bottom: 2 } }));
    expect(source.data).toEqual(before);
  });
});
