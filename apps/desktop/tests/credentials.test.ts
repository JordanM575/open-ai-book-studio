import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { FileCredentialVault, newConnectionId, type Cipher } from "../src/main/credential-file";

const cipher: Cipher = {
  available: () => true,
  encrypt: (value) => `enc:${Buffer.from(value, "utf8").toString("base64")}`,
  decrypt: (value) => {
    if (!value.startsWith("enc:")) throw new Error("tampered");
    return Buffer.from(value.slice(4), "base64").toString("utf8");
  }
};

async function workspace(): Promise<{ dir: string; path: string; vault: FileCredentialVault }> {
  const dir = await mkdtemp(join(tmpdir(), "abs-credentials-"));
  const path = join(dir, "credentials.json");
  return { dir, path, vault: new FileCredentialVault(path, cipher) };
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

describe("credential vault", () => {
  test("repairs a vault file that others can read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-credentials-mode-"));
    const path = join(dir, "credentials.json");
    try {
      await writeFile(path, '{"version":1,"records":[]}\n');
      await chmod(path, 0o644);
      const vault = new FileCredentialVault(path, cipher);

      expect(await vault.repairPermissions()).toBe("corrected");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await vault.repairPermissions()).toBe("owner-only");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a stored connection leaves no secret in settings or the library", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-secret-scan-"));
    try {
      const vault = new FileCredentialVault(join(dir, "credentials.json"), cipher);
      const secret = "sk-or-v1-scan-secret-1234567890";
      const id = newConnectionId();
      await vault.set({
        id,
        provider: "openrouter",
        label: "OpenRouter",
        kind: "openrouter-oauth",
        createdAt: "2026-10-25T12:00:00.000Z",
        secret
      });
      await vault.touch(id);
      expect(JSON.stringify(await vault.list())).not.toContain(secret);

      await writeFile(join(dir, "studio.json"), `${JSON.stringify({ libraryRoot: join(dir, "library") }, null, 2)}\n`);
      const library = await Library.open(join(dir, "library"));
      const book = await library.createBook({ title: "Scan" });
      await library.createChapter(book.id, { title: "One", content: "Plain prose.\n" });

      for (const file of await filesUnder(dir)) {
        expect((await readFile(file)).includes(Buffer.from(secret))).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("round-trips a secret without writing it in plaintext", async () => {
    const { dir, path, vault } = await workspace();
    try {
      const id = newConnectionId();
      await vault.set({
        id,
        provider: "openrouter",
        label: "OpenRouter",
        kind: "openrouter-oauth",
        createdAt: "2026-10-24T10:00:00.000Z",
        secret: "sk-or-v1-super-secret-value"
      });

      const stored = await vault.get(id);
      expect(stored?.secret).toBe("sk-or-v1-super-secret-value");

      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain("super-secret-value");

      const summaries = await vault.list();
      expect(summaries).toHaveLength(1);
      expect(JSON.stringify(summaries)).not.toContain("secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("touch updates last use without changing the secret", async () => {
    const { dir, vault } = await workspace();
    try {
      const id = newConnectionId();
      await vault.set({
        id,
        provider: "openai",
        label: "OpenAI",
        kind: "api-key",
        createdAt: "2026-10-24T10:00:00.000Z",
        secret: "sk-test-1234567890"
      });
      await vault.touch(id, "2026-10-25T10:00:00.000Z");
      expect((await vault.list())[0]?.lastUsedAt).toBe("2026-10-25T10:00:00.000Z");
      expect((await vault.get(id))?.secret).toBe("sk-test-1234567890");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("remove deletes the record", async () => {
    const { dir, vault } = await workspace();
    try {
      const id = newConnectionId();
      await vault.set({
        id,
        provider: "openrouter",
        label: "OpenRouter",
        kind: "openrouter-oauth",
        createdAt: "2026-10-24T10:00:00.000Z",
        secret: "sk-or-v1-abc"
      });
      await vault.remove(id);
      expect(await vault.list()).toEqual([]);
      expect(await vault.get(id)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a tampered record fails with a reconnect message", async () => {
    const { dir, path } = await workspace();
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          records: [
            {
              id: "conn_tampered0001",
              provider: "openrouter",
              label: "OpenRouter",
              kind: "openrouter-oauth",
              createdAt: "2026-10-24T10:00:00.000Z",
              secretCipher: "not-encrypted"
            }
          ]
        }),
        "utf8"
      );
      const fresh = new FileCredentialVault(path, cipher);
      await expect(fresh.get("conn_tampered0001")).rejects.toThrow(/could not be read/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses to save when protected storage is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abs-credentials-"));
    try {
      const vault = new FileCredentialVault(join(dir, "credentials.json"), { ...cipher, available: () => false });
      await expect(
        vault.set({
          id: newConnectionId(),
          provider: "openrouter",
          label: "OpenRouter",
          kind: "openrouter-oauth",
          createdAt: "2026-10-24T10:00:00.000Z",
          secret: "sk-or-v1-abc"
        })
      ).rejects.toThrow(/protected storage/);
      expect(await vault.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
