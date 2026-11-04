import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockElectron } from "./support/mock-electron";

/*
 * `studio.json` in the profile: the library pointer, the window, the plugin folder and the drift
 * scan. The file is the author's to edit or damage, so loading keeps only well-formed values.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

afterAll(() => {
  mockElectron(tmpdir());
});

async function store() {
  const userData = await mkdtemp(join(tmpdir(), "abs-settings-"));
  cleanups.push(userData);
  mockElectron(userData);
  const { SettingsStore } = await import("../src/main/settings");
  return { userData, settings: new SettingsStore() };
}

describe("settings store", () => {
  test("loads every setting the file holds", async () => {
    const { userData, settings } = await store();
    const saved = {
      libraryRoot: "/Users/author/Books",
      windowBounds: { width: 1440, height: 900, x: 10, y: 20 },
      pluginFolder: "/Users/author/Plugins",
      syncCheckIntervalMinutes: 30,
      lastSyncScanAt: "2026-11-03T12:00:00.000Z"
    };
    await writeFile(join(userData, "studio.json"), JSON.stringify(saved));
    expect(await settings.load()).toEqual(saved);
    expect(settings.get()).toEqual(saved);
  });

  test("drops values of the wrong type instead of trusting them", async () => {
    const { userData, settings } = await store();
    await writeFile(
      join(userData, "studio.json"),
      JSON.stringify({
        libraryRoot: 42,
        pluginFolder: ["not", "a", "path"],
        syncCheckIntervalMinutes: "15",
        lastSyncScanAt: null,
        unknown: "ignored"
      })
    );
    expect(await settings.load()).toEqual({ libraryRoot: null });
  });

  test("a damaged file reads as the defaults", async () => {
    const { userData, settings } = await store();
    await writeFile(join(userData, "studio.json"), "{ not json");
    expect(await settings.load()).toEqual({ libraryRoot: null });
  });

  test("an update keeps the other settings and lands in the file", async () => {
    const { userData, settings } = await store();
    await settings.update({ libraryRoot: "/Users/author/Books" });
    await settings.update({ syncCheckIntervalMinutes: 60 });
    expect(settings.get()).toEqual({ libraryRoot: "/Users/author/Books", syncCheckIntervalMinutes: 60 });
    expect(JSON.parse(await readFile(join(userData, "studio.json"), "utf8"))).toEqual({
      libraryRoot: "/Users/author/Books",
      syncCheckIntervalMinutes: 60
    });
  });
});
