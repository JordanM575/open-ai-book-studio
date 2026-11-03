import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

/**
 * Production hardening that must survive edits. The packaged app is born with fuses that allow
 * running Electron as Node and only loading from the asar; the hook text below is the maintained
 * guard, and the real proof is the fuse readback from a packaged build (spec 012 T015 evidence).
 * The renderer side is covered too: the window must stay sandboxed with no Node integration, so
 * compromising it never means filesystem access.
 */
describe("production hardening", () => {
  test("the afterPack hook flips the unsafe default fuses", () => {
    const hook = read("scripts/flip-fuses.mjs");
    expect(hook).toContain("[FuseV1Options.RunAsNode]: false");
    expect(hook).toContain("[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false");
    expect(hook).toContain("[FuseV1Options.EnableNodeCliInspectArguments]: false");
    expect(hook).toContain("[FuseV1Options.OnlyLoadAppFromAsar]: true");
    expect(hook).toContain("[FuseV1Options.EnableCookieEncryption]: false");
    expect(hook).toContain("[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false");
    expect(hook).toContain("[FuseV1Options.GrantFileProtocolExtraPrivileges]: true");
    expect(hook).toContain("[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false");
    expect(hook).toContain("[FuseV1Options.WasmTrapHandlers]: true");
    expect(hook).toContain("strictlyRequireAllFuses: true");
    expect(hook).toContain("resetAdHocDarwinSignature");
  });

  test("packaging runs the hook and ships an asar bundle", () => {
    const config = read("apps/desktop/electron-builder.yml");
    expect(config).toContain("afterPack:");
    expect(config).toMatch(/^asar:\s*true$/m);
  });

  test("the window keeps Node out of the renderer", () => {
    const main = read("apps/desktop/src/main/index.ts");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("contextIsolation: true");
  });
});
