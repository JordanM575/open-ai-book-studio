/**
 * Pure pixel comparison for the T017 visual gate (spec 012). Imported by both the Playwright
 * driver (`scripts/visual-check.mjs`) and the committed unit tests, so thresholds are tested
 * without launching a browser.
 */
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * Count the pixels that differ between two PNG buffers. A dimension mismatch is itself a
 * failure and reports every pixel of the larger image as different.
 */
export function diffPixels(expected, actual) {
  const baseline = PNG.sync.read(Buffer.from(expected));
  const current = PNG.sync.read(Buffer.from(actual));
  const width = Math.max(baseline.width, current.width);
  const height = Math.max(baseline.height, current.height);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { width, height, different: width * height };
  }
  const output = new PNG({ width, height });
  const different = pixelmatch(baseline.data, current.data, output.data, width, height, {
    threshold: 0.1
  });
  return { width, height, different };
}

/** Fail when more than a hair of pixels differ: an absolute floor plus a relative allowance. */
export function exceedsThreshold(different, width, height) {
  return different > Math.max(100, width * height * 0.001);
}
