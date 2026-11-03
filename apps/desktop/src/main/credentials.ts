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
