import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";
import { mockElectron, type ElectronHooks } from "./support/mock-electron";

/**
 * D-184. The in-memory credential vault exists so an end-to-end run of the built app can make a
 * real agent turn against a fake provider without the author's keychain. These tests hold it to
 * that: it appears only in an unpackaged run started with both test flags; a packaged build or a
 * run without `STUDIO_TEST` refuses it and says so once; it never calls safeStorage and never
 * writes a file; and a computer without protected storage still refuses to save a key, exactly as
 * before.
 */

const FLAG = "STUDIO_TEST_MEMORY_VAULT";
const SECRET = "memory-vault-test-key-0123456789";
const REFUSAL = "protected storage is not available, so the key was not saved";
const root = new URL("../../../", import.meta.url);

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// Later files register their own hooks; leave the shared mock unpackaged and silent for them.
afterAll(() => mockElectron(tmpdir()));

async function electronProfile(hooks: Pick<ElectronHooks, "isPackaged"> = {}) {
  const userData = await mkdtemp(join(tmpdir(), "abs-memory-vault-"));
  cleanups.push(userData);
  const safeStorageCalls: string[] = [];
  mockElectron(userData, { ...hooks, safeStorageCalls: (method) => safeStorageCalls.push(method) });
  const credentials = await import("../src/main/credentials");
  return { userData, safeStorageCalls, credentials };
}

async function filesUnder(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

function credential(secret: string): StoredCredential {
  return {
    id: "conn_memoryvault01",
    provider: "meta",
    label: "Meta",
    kind: "api-key",
    createdAt: "2026-11-03T12:00:00.000Z",
    secret,
    metadata: { baseUrl: "http://127.0.0.1:9/v1" }
  };
}

/** A provider that accepts the key, so `addKey` reaches the vault. It records what it was sent. */
function acceptingProvider(): { fetch: typeof fetch; requests: Array<{ url: string; authorization: string | null }> } {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ data: [{ id: "muse-spark-1.3" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { fetch: fake as typeof fetch, requests };
}

function consoleSpies() {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  return {
    log,
    warn,
    restore: () => {
      log.mockRestore();
      warn.mockRestore();
    }
  };
}

describe("in-memory test vault (D-184)", () => {
  test("the flag keeps its documented name", async () => {
    const { credentials } = await electronProfile();
    expect(credentials.MEMORY_VAULT_FLAG).toBe(FLAG);
  });

  test("an unpackaged test run with the flag keeps connections in memory, off the disk and away from safeStorage", async () => {
    // The mock's protected storage is unavailable. The memory vault is still chosen, because the
    // choice reads the flags and never asks protected storage anything: it is not a fallback.
    const { userData, safeStorageCalls, credentials } = await electronProfile({ isPackaged: false });
    const output = consoleSpies();
    try {
      const vault = credentials.createDesktopVault({ STUDIO_TEST: "1", [FLAG]: "1" });
      expect(vault).not.toBeInstanceOf(credentials.DesktopCredentialVault);
      const status = { available: true, backend: "In-memory test vault", detail: "" };
      expect(await vault.status?.()).toEqual(status);
      expect(await vault.check?.()).toEqual(status);
      expect(await vault.repairPermissions()).toBe("owner-only");

      const provider = acceptingProvider();
      const providers = new ProviderService(vault, async () => {}, provider.fetch);
      const summary = await providers.addKey({ provider: "meta", secret: SECRET, baseUrl: "http://127.0.0.1:9/v1" });
      expect(provider.requests).toEqual([{ url: "http://127.0.0.1:9/v1/models", authorization: `Bearer ${SECRET}` }]);
      expect((await providers.credential(summary.id)).secret).toBe(SECRET);
      expect(JSON.stringify(await providers.list())).not.toContain(SECRET);
      expect((await providers.models(summary.id)).models.map((model) => model.id)).toEqual(["muse-spark-1.3"]);
      expect((await providers.status()).connections).toBe(1);

      expect(safeStorageCalls).toEqual([]);
      expect(await filesUnder(userData)).toEqual([]);

      await providers.remove(summary.id);
      expect(await providers.list()).toEqual([]);
      expect(await filesUnder(userData)).toEqual([]);

      expect(output.warn).not.toHaveBeenCalled();
      expect(output.log).toHaveBeenCalledTimes(1);
      expect(String(output.log.mock.calls[0]?.[0])).toContain("in memory only");
    } finally {
      output.restore();
    }
  });

  const refusals = [
    { name: "a packaged build, even in a test run", isPackaged: true, env: { STUDIO_TEST: "1", [FLAG]: "1" } },
    { name: "an unpackaged run without STUDIO_TEST", isPackaged: false, env: { [FLAG]: "1" } },
    { name: "a packaged build without STUDIO_TEST", isPackaged: true, env: { STUDIO_TEST: "0", [FLAG]: "1" } }
  ];

  for (const refusal of refusals) {
    test(`${refusal.name} refuses the memory vault, says so in one line and keeps protected storage`, async () => {
      const { userData, safeStorageCalls, credentials } = await electronProfile({ isPackaged: refusal.isPackaged });
      const output = consoleSpies();
      try {
        // A key in the environment must never be echoed by the refusal.
        const vault = credentials.createDesktopVault({ ...refusal.env, META_API_KEY: SECRET });
        expect(vault).toBeInstanceOf(credentials.DesktopCredentialVault);
        expect(output.log).not.toHaveBeenCalled();
        expect(output.warn).toHaveBeenCalledTimes(1);
        const args = output.warn.mock.calls[0] ?? [];
        expect(args).toHaveLength(1);
        const line = String(args[0]);
        expect(line).toContain(FLAG);
        expect(line).toContain("Using protected storage");
        expect(line).not.toContain("\n");
        expect(line).not.toContain(SECRET);

        // It is the real vault: with protected storage unavailable it refuses, and writes nothing.
        await expect(vault.set(credential(SECRET))).rejects.toThrow(REFUSAL);
        expect(safeStorageCalls).toContain("isAsyncEncryptionAvailable");
        expect(await filesUnder(userData)).toEqual([]);
      } finally {
        output.restore();
      }
    });
  }

  const unflagged = [
    { name: "a test run", isPackaged: false, env: { STUDIO_TEST: "1" } },
    { name: "an ordinary development run", isPackaged: false, env: {} },
    { name: "a packaged test run", isPackaged: true, env: { STUDIO_TEST: "1" } }
  ];

  for (const run of unflagged) {
    test(`${run.name} without the flag uses protected storage and says nothing`, async () => {
      const { credentials } = await electronProfile({ isPackaged: run.isPackaged });
      const output = consoleSpies();
      try {
        expect(credentials.createDesktopVault(run.env)).toBeInstanceOf(credentials.DesktopCredentialVault);
        expect(output.log).not.toHaveBeenCalled();
        expect(output.warn).not.toHaveBeenCalled();
      } finally {
        output.restore();
      }
    });
  }

  test("without protected storage a test run still refuses to save a key and explains why", async () => {
    const { userData, credentials } = await electronProfile({ isPackaged: false });
    const vault = credentials.createDesktopVault({ STUDIO_TEST: "1" });
    const status = await vault.status?.();
    expect(status?.available).toBe(false);
    expect(status?.detail).toMatch(/locked or unavailable/);

    const provider = acceptingProvider();
    const providers = new ProviderService(vault, async () => {}, provider.fetch);
    await expect(
      providers.addKey({ provider: "meta", secret: SECRET, baseUrl: "http://127.0.0.1:9/v1" })
    ).rejects.toThrow(REFUSAL);
    // The provider accepted the key; the refusal is the vault's, and nothing was kept.
    expect(provider.requests).toHaveLength(1);
    expect(await providers.list()).toEqual([]);
    expect(await filesUnder(userData)).toEqual([]);
  });

  test("the app builds its vault through the gated factory, and nothing else reaches the memory vault", () => {
    const main = readFileSync(new URL("apps/desktop/src/main/index.ts", root), "utf8");
    expect(main).toContain("createDesktopVault()");
    expect(main).not.toContain("new DesktopCredentialVault(");

    const mainDir = new URL("apps/desktop/src/main/", root);
    const others = (readdirSync(mainDir, { recursive: true }) as string[])
      .filter((path) => /\.ts$/.test(path) && path !== "credentials.ts")
      .filter((path) => readFileSync(new URL(path, mainDir), "utf8").includes("MemoryVault"));
    expect(others).toEqual([]);
  });
});
