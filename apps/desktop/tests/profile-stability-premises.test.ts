import { afterEach, describe, expect, test } from "bun:test";
import { mockElectron } from "./support/mock-electron";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * Spec 009 T023 premises. These pin the profile facts the local install/upgrade
 * decision rests on; they choose nothing. A compatible upgrade keeps one shared
 * settings file because the profile root carries the app name but no version;
 * settings writes stay inside that root, carry no app version, and tolerate
 * unknown future keys on read.
 */

async function storeFor(userData: string): Promise<{
  SettingsStore: new () => { load(): Promise<unknown>; update(patch: unknown): Promise<void> };
}> {
  mockElectron(userData);
  return (await import("../src/main/settings")) as unknown as {
    SettingsStore: new () => { load(): Promise<unknown>; update(patch: unknown): Promise<void> };
  };
}

describe("profile stability premises", () => {
  test("two compatible builds share one settings file under the same profile root", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-profile-"));
    cleanups.push(userData);
    const first = await storeFor(userData);
    const v1 = new first.SettingsStore();
    await v1.update({ libraryRoot: "/tmp/author-library" });

    const second = await storeFor(userData);
    const v2 = new second.SettingsStore();
    const loaded = (await v2.load()) as { libraryRoot: string | null };
    expect(loaded.libraryRoot).toBe("/tmp/author-library");
  });

  test("settings writes stay inside the profile root as a single file", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "abs-profile-sandbox-"));
    cleanups.push(sandbox);
    const userData = join(sandbox, "profile");
    // Electron always creates userData; the sandbox mirrors that guarantee.
    await mkdir(userData, { recursive: true });
    const { SettingsStore } = await storeFor(userData);
    const store = new SettingsStore();
    await store.update({ libraryRoot: "/tmp/author-library" });

    const names: string[] = [];
    async function walk(dir: string, prefix: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await walk(join(dir, entry.name), relative);
        else names.push(relative);
      }
    }
    await walk(sandbox, "");
    expect(names).toEqual(["profile/studio.json"]);
  });

  test("the profile file carries no app version", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-profile-version-"));
    cleanups.push(userData);
    const { SettingsStore } = await storeFor(userData);
    const store = new SettingsStore();
    await store.update({ libraryRoot: "/tmp/author-library" });

    const raw = JSON.parse(await readFile(join(userData, "studio.json"), "utf8")) as Record<string, unknown>;
    expect(raw).toEqual({ libraryRoot: "/tmp/author-library" });
    expect("version" in raw).toBe(false);
    expect("commit" in raw).toBe(false);
  });

  test("an unknown future key does not break an older reader", async () => {
    const userData = await mkdtemp(join(tmpdir(), "abs-profile-future-"));
    cleanups.push(userData);
    const { SettingsStore } = await storeFor(userData);
    const store = new SettingsStore();
    await store.update({ libraryRoot: "/tmp/author-library" });
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        join(userData, "studio.json"),
        JSON.stringify({ libraryRoot: "/tmp/author-library", futureSection: { v: 2 } })
      )
    );

    const loaded = (await store.load()) as { libraryRoot: string | null };
    expect(loaded.libraryRoot).toBe("/tmp/author-library");
  });
});
