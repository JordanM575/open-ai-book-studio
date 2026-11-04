import { app, safeStorage } from "electron";
import { join } from "node:path";
import { MemoryVault, type CredentialVault } from "@ai-book-studio/core/providers/credentials";
import type { CredentialStatus } from "@ai-book-studio/core/providers/types";
import { FileCredentialVault, type Cipher } from "./credential-file";

export { newConnectionId } from "./credential-file";

/** The flag that asks an unpackaged test run for the in-memory vault (D-184). */
export const MEMORY_VAULT_FLAG = "STUDIO_TEST_MEMORY_VAULT";

/** What the app needs from its vault: the shared boundary plus the startup permission repair. */
export type DesktopVault = CredentialVault & Pick<FileCredentialVault, "repairPermissions">;

/** The operating system's protected storage, used as the cipher for the credential file. */
const osCipher: Cipher = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
};

export class DesktopCredentialVault extends FileCredentialVault {
  constructor() {
    super(join(app.getPath("userData"), "credentials.json"), osCipher);
  }

  private static backend(): string {
    if (process.platform === "darwin") return "macOS Keychain";
    if (process.platform === "win32") return "Windows protected storage";
    return "OS protected storage";
  }

  /**
   * Fast availability read for view opens (D-161: opening Settings never probes). The keychain
   * round-trip lives in `check()` behind the explicit control: when the operating system wants
   * the author's confirmation, that call waits for them instead of wedging the open path.
   */
  override async status(): Promise<{ available: boolean; backend: string; detail: string }> {
    const backend = DesktopCredentialVault.backend();
    if (!safeStorage.isAsyncEncryptionAvailable()) {
      return {
        available: false,
        backend,
        detail:
          process.platform === "darwin"
            ? "The login keychain is locked or unavailable. Unlock it in Keychain Access, then check again."
            : "The system keyring is locked or unavailable. Unlock it, then check again."
      };
    }
    return { available: true, backend, detail: "" };
  }

  /**
   * Force one encryption/decryption round-trip. On macOS this uses the Keychain item created by
   * Electron's safeStorage, so a locked login keychain fails here even when `isAvailable()` is true.
   * The probe never leaves memory and no keychain password is read or stored.
   */
  override async check(): Promise<{ available: boolean; backend: string; detail: string }> {
    const backend = DesktopCredentialVault.backend();
    const state = await super.check();
    if (state.available) return { available: true, backend, detail: "" };
    return {
      available: false,
      backend,
      detail:
        process.platform === "darwin"
          ? "The login keychain is locked. Unlock it in Keychain Access or run `security unlock-keychain`, then check again."
          : "The system keyring is locked. Unlock it, then check again."
    };
  }
}

/**
 * Connections held in this process's memory and nowhere else (D-184), for an end-to-end run
 * against a fake provider. It never calls safeStorage and never writes a file, so a key given to it
 * is gone when the run ends.
 */
class TestMemoryVault extends MemoryVault implements DesktopVault {
  /** The explicit Check control reads the same status: there is no cipher to round-trip. */
  async check(): Promise<Omit<CredentialStatus, "connections">> {
    return this.status();
  }

  /** Nothing is on disk, so there is nothing to repair. */
  async repairPermissions(): Promise<"owner-only"> {
    return "owner-only";
  }
}

/**
 * The vault the app runs with: protected storage, except in one case (D-184). An unpackaged run
 * started with both `STUDIO_TEST=1` and `STUDIO_TEST_MEMORY_VAULT=1` keeps its connections in
 * memory, so an end-to-end check can run a real turn without the author's keychain.
 *
 * The choice reads the flags and `app.isPackaged`, never whether protected storage is available:
 * the memory vault is not a fallback, and a computer without protected storage still refuses to
 * save a key and says why. A packaged build, or a run without `STUDIO_TEST`, refuses the flag and
 * says so in one line.
 */
export function createDesktopVault(env: NodeJS.ProcessEnv = process.env): DesktopVault {
  if (env[MEMORY_VAULT_FLAG] !== "1") return new DesktopCredentialVault();
  if (env.STUDIO_TEST === "1" && !app.isPackaged) {
    console.log("[credentials] This test run keeps connections in memory only; nothing is written to disk.");
    return new TestMemoryVault();
  }
  console.warn(
    `[credentials] Ignored ${MEMORY_VAULT_FLAG}: the in-memory vault is only for an unpackaged run with STUDIO_TEST=1. Using protected storage.`
  );
  return new DesktopCredentialVault();
}
