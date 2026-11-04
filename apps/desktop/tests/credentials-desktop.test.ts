import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronHooks, mockElectron } from "./support/mock-electron";

/*
 * The desktop vault: the credential file sealed by the operating system's protected storage.
 * `credentials.test.ts` covers the file format with a test cipher; this file covers the wrapper the
 * app actually constructs, with Electron's safeStorage replaced by a fake in its real shape.
 */

type Storage = NonNullable<ElectronHooks["safeStorage"]>;

const cleanups: string[] = [];
const platform = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(async () => {
  if (platform) Object.defineProperty(process, "platform", platform);
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

afterAll(() => {
  // Later files share the one Electron mock, so it goes back to its defaults.
  mockElectron(tmpdir());
});

/** Storage that seals by reversing and tagging, so a plaintext secret on disk would show. */
function sealing(calls = { encrypt: 0, decrypt: 0 }): Storage & { calls: typeof calls } {
  return {
    calls,
    isAsyncEncryptionAvailable: async () => true,
    encryptString: (value) => {
      calls.encrypt += 1;
      return Buffer.from(`sealed:${[...value].reverse().join("")}`, "utf8");
    },
    decryptString: (sealed) => {
      calls.decrypt += 1;
      const text = sealed.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not sealed by this storage");
      return [...text.slice("sealed:".length)].reverse().join("");
    }
  };
}

/** Storage that says it is there but refuses to seal, as a locked login keychain does. */
const locked: Storage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptString: () => {
    throw new Error("The keychain is locked.");
  },
  decryptString: () => {
    throw new Error("The keychain is locked.");
  }
};

const unavailable: Storage = { ...locked, isAsyncEncryptionAvailable: async () => false };

async function vaultWith(storage: Storage, onPlatform?: NodeJS.Platform) {
  const userData = await mkdtemp(join(tmpdir(), "abs-desktop-vault-"));
  cleanups.push(userData);
  mockElectron(userData, { safeStorage: storage });
  if (onPlatform) Object.defineProperty(process, "platform", { value: onPlatform, configurable: true });
  const { DesktopCredentialVault } = await import("../src/main/credentials");
  return { vault: new DesktopCredentialVault(), file: join(userData, "credentials.json") };
}

const SECRET = ["synthetic", "secret", "for", "checks"].join("-");

const credential = {
  id: "conn_desktop0001",
  provider: "openrouter" as const,
  label: "OpenRouter",
  kind: "api-key" as const,
  createdAt: "2026-11-03T12:00:00.000Z",
  secret: SECRET
};

describe("desktop credential vault", () => {
  test("a key is sealed by protected storage on disk and read back only through it", async () => {
    const storage = sealing();
    const { vault, file } = await vaultWith(storage);
    await vault.set(credential);

    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain(SECRET);
    const record = (JSON.parse(raw) as { records: Array<{ secretCipher: string }> }).records[0];
    expect(Buffer.from(record?.secretCipher ?? "", "base64").toString("utf8")).toBe(
      `sealed:${[...SECRET].reverse().join("")}`
    );
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);

    expect((await vault.get(credential.id))?.secret).toBe(SECRET);
    expect(await vault.list()).toEqual([
      { id: credential.id, provider: "openrouter", label: "OpenRouter", kind: "api-key", createdAt: credential.createdAt }
    ]);
  });

  test("the status read on open names the storage and never touches a secret", async () => {
    const storage = sealing();
    const { vault } = await vaultWith(storage, "darwin");
    expect(await vault.status()).toEqual({ available: true, backend: "macOS Keychain", detail: "" });
    // D-161: opening Settings must not make the keychain ask the author anything.
    expect(storage.calls).toEqual({ encrypt: 0, decrypt: 0 });
  });

  test("the explicit check proves a round trip through protected storage", async () => {
    const storage = sealing();
    const { vault } = await vaultWith(storage, "darwin");
    expect(await vault.check()).toEqual({ available: true, backend: "macOS Keychain", detail: "" });
    expect(storage.calls).toEqual({ encrypt: 1, decrypt: 1 });
  });

  test("a locked keychain fails the check and says how to unlock it", async () => {
    const { vault } = await vaultWith(locked, "darwin");
    expect(await vault.check()).toEqual({
      available: false,
      backend: "macOS Keychain",
      detail: "The login keychain is locked. Unlock it in Keychain Access or run `security unlock-keychain`, then check again."
    });
  });

  test("on Windows and Linux the storage is named for the system and the advice follows it", async () => {
    const windows = await vaultWith(sealing(), "win32");
    expect((await windows.vault.status()).backend).toBe("Windows protected storage");
    expect(await (await vaultWith(locked, "win32")).vault.check()).toEqual({
      available: false,
      backend: "Windows protected storage",
      detail: "The system keyring is locked. Unlock it, then check again."
    });

    const linux = await vaultWith(sealing(), "linux");
    expect((await linux.vault.status()).backend).toBe("OS protected storage");
    expect((await (await vaultWith(unavailable, "linux")).vault.check()).detail).toBe(
      "The system keyring is locked. Unlock it, then check again."
    );
  });

  test("without protected storage a key is refused and no credential file is written", async () => {
    const { vault, file } = await vaultWith(unavailable);
    expect(await vault.isAvailable()).toBe(false);
    await expect(vault.set(credential)).rejects.toThrow(
      "This computer's protected storage is not available, so the key was not saved."
    );
    await expect(stat(file)).rejects.toThrow();
    expect(await vault.list()).toEqual([]);
  });
});
