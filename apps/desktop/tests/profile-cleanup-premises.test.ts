import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockElectron } from "./support/mock-electron";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * Spec 009 T025 premises. These pin the inventory facts the profile-cleanup
 * decision rests on; they choose nothing. A future cleanup action must respect
 * what is proven here: the profile holds pointers and secrets, never
 * manuscript prose; a missing profile reads as defaults; and the whole
 * deletable profile is exactly the files under one root.
 */

const PROSE = "The hall was cold. Mara closed the door and listened to the rain.";

async function electronModules(userData: string): Promise<{
  SettingsStore: new () => {
    load(): Promise<unknown>;
    update(patch: unknown): Promise<void>;
  };
  DesktopCredentialVault: new () => unknown;
}> {
  mockElectron(userData);
  const settings = (await import("../src/main/settings")) as unknown as {
    SettingsStore: new () => { load(): Promise<unknown>; update(patch: unknown): Promise<void> };
  };
  const credentials = (await import("../src/main/credentials")) as unknown as {
    DesktopCredentialVault: new () => unknown;
  };
  return { SettingsStore: settings.SettingsStore, DesktopCredentialVault: credentials.DesktopCredentialVault };
}

describe("profile cleanup premises", () => {
  test("the settings file holds a library pointer, never manuscript prose", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-cleanup-"));
    cleanups.push(userData);
    const { SettingsStore } = await electronModules(userData);
    const store = new SettingsStore();
    await store.update({ libraryRoot: "/tmp/author-library", windowBounds: { width: 1024, height: 700 } });

    const raw = await readFile(join(userData, "studio.json"), "utf8");
    expect(raw).toContain("/tmp/author-library");
    expect(raw).not.toContain(PROSE);
    expect(raw).not.toContain("Mara");
    // The file carries only the settings just written: nothing cached, nothing extra.
    expect(JSON.parse(raw)).toEqual({ libraryRoot: "/tmp/author-library", windowBounds: { width: 1024, height: 700 } });
  });

  test("a missing profile file reads as defaults without throwing", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-cleanup-missing-"));
    cleanups.push(userData);
    const { SettingsStore } = await electronModules(userData);
    const store = new SettingsStore();
    const loaded = (await store.load()) as { libraryRoot: string | null };
    expect(loaded.libraryRoot).toBeNull();
  });

  test("the credential vault lives under the same profile root", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-cleanup-vault-"));
    cleanups.push(userData);
    const { DesktopCredentialVault } = await electronModules(userData);
    const vault = new DesktopCredentialVault() as unknown as { path: string };
    expect(vault.path).toBe(join(userData, "credentials.json"));
  });
});
