import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);

describe("sandboxed preload bundle", () => {
  test("bundles runtime validators instead of emitting external requires", () => {
    const config = readFileSync(new URL("apps/desktop/electron.vite.config.ts", root), "utf8");

    expect(config).toMatch(/const preloadExternalize = externalizeDepsPlugin\(\{\s*exclude:\s*\[[^\]]*"zod"[^\]]*"yaml"[^\]]*\]\s*\}\);/s);
    expect(config).toMatch(/preload:\s*\{[\s\S]*?plugins:\s*\[preloadExternalize,/);
  });
});
