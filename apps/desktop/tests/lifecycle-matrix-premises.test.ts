import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { mockElectron } from "./support/mock-electron";

const root = join(import.meta.dir, "..", "..", "..");

async function settingsFilePath(userData: string): Promise<string> {
  mockElectron(userData);
  const { settingsFilePath: pure } = (await import("../src/main/settings")) as unknown as {
    settingsFilePath: (dir: string) => string;
  };
  return pure(userData);
}

/**
 * Spec 009 T024 premises. These pin the identity facts the lifecycle matrix
 * rests on; they choose nothing. The profile directory key (productName) and
 * the update identity (appId) must stay version-free, or a rename orphans
 * every existing profile — and one settings-file rule must hold on every
 * target's profile root.
 */
describe("lifecycle matrix premises", () => {
  test("the profile identity keys carry no version", async () => {
    const builder = parseYaml(await readFile(join(root, "apps/desktop/electron-builder.yml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(builder.productName).toBe("AI Book Studio");
    expect(builder.appId).toBe("studio.aibook.app");
    for (const key of [builder.productName, builder.appId]) {
      expect(typeof key).toBe("string");
      expect(key as string).not.toMatch(/\d+\.\d+/);
    }
  });

  test("one settings-file rule holds for every target profile root", async () => {
    const roots = [
      "/Users/author/Library/Application Support/AI Book Studio",
      "C:\\Users\\author\\AppData\\Roaming\\AI Book Studio",
      "/home/author/.config/AI Book Studio"
    ];
    for (const userData of roots) {
      expect(await settingsFilePath(userData)).toBe(join(userData, "studio.json"));
    }
  });
});
