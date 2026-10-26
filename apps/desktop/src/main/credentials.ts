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
}
