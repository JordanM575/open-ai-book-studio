import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { diffPixels, exceedsThreshold } from "../../../scripts/visual-compare.mjs";

function png(width: number, height: number, paint: (png: PNG) => void): Uint8Array {
  const image = new PNG({ width, height });
  paint(image);
  return PNG.sync.write(image);
}

function solid(width: number, height: number, gray: number): Uint8Array {
  return png(width, height, (image) => {
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = gray;
      image.data[i + 1] = gray;
      image.data[i + 2] = gray;
      image.data[i + 3] = 255;
    }
  });
}

describe("visual gate", () => {
  test("identical captures do not differ", () => {
    expect(diffPixels(solid(8, 8, 200), solid(8, 8, 200))).toEqual({ width: 8, height: 8, different: 0 });
  });

  test("one changed pixel is counted", () => {
    const changed = png(8, 8, (image) => {
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 200;
        image.data[i + 1] = 200;
        image.data[i + 2] = 200;
        image.data[i + 3] = 255;
      }
      image.data[0] = 0;
      image.data[1] = 0;
      image.data[2] = 0;
    });
    expect(diffPixels(solid(8, 8, 200), changed).different).toBe(1);
  });

  test("a dimension mismatch fails outright", () => {
    const result = diffPixels(solid(400, 400, 200), solid(500, 400, 200));
    expect(result).toEqual({ width: 500, height: 400, different: 200_000 });
    expect(exceedsThreshold(result.different, result.width, result.height)).toBe(true);
  });

  test("a hair of pixels passes, a smear fails", () => {
    expect(exceedsThreshold(100, 10, 10)).toBe(false);
    expect(exceedsThreshold(101, 10, 10)).toBe(true);
    expect(exceedsThreshold(1000, 1000, 1000)).toBe(false);
    expect(exceedsThreshold(1001, 1000, 1000)).toBe(true);
  });
});
