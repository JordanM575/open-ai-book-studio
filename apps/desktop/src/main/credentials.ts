import { app, safeStorage } from "electron";
import { join } from "node:path";
import { FileCredentialVault, type Cipher } from "./credential-file";

export { newConnectionId } from "./credential-file";

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

  /**
   * Force one encryption/decryption round-trip. On macOS this uses the Keychain item created by
   * Electron's safeStorage, so a locked login keychain fails here even when `isAvailable()` is true.
   * The probe never leaves memory and no keychain password is read or stored.
   */
  override async status(): Promise<{ available: boolean; backend: string; detail: string }> {
    const backend =
      process.platform === "darwin"
        ? "macOS Keychain"
        : process.platform === "win32"
          ? "Windows protected storage"
          : "OS protected storage";
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
    try {
      const probe = `ai-book-studio-probe-${Date.now()}`;
      const encrypted = safeStorage.encryptString(probe);
      if (safeStorage.decryptString(encrypted) !== probe) throw new Error("probe mismatch");
      return { available: true, backend, detail: "" };
    } catch {
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
}
