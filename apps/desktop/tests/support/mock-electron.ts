import { mock } from "bun:test";
import { tmpdir } from "node:os";

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

/** What the file under test wants recorded; the mock reads these on every call. */
export interface ElectronHooks {
  handle?: (channel: string, handler: Handler) => void;
  showItemInFolder?: (path: string) => void;
}

const current: { userData: string; hooks: ElectronHooks } = { userData: tmpdir(), hooks: {} };

/**
 * The single Electron mock for tests. Bun caches the first resolution of the
 * "electron" specifier process-wide, so every test file must register the
 * same complete namespace: a factory missing `safeStorage`, `dialog` (or
 * anything else a main-process module imports) poisons later files that need
 * it. The namespace below is every name `src/main` imports from Electron, and
 * per-file behaviour is read from `current` rather than captured, so the
 * namespace a file sees never depends on which file registered it first.
 */
export function mockElectron(userData: string, hooks: ElectronHooks = {}): void {
  current.userData = userData;
  current.hooks = hooks;
  mock.module("electron", () => ({
    app: { getPath: (name: string) => (name === "userData" ? current.userData : tmpdir()) },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    dialog: {},
    ipcMain: {
      handle: (channel: string, handler: Handler) => current.hooks.handle?.(channel, handler)
    },
    Menu: {},
    Notification: { isSupported: () => false },
    safeStorage: {
      isAsyncEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("unavailable in checks");
      },
      decryptString: () => {
        throw new Error("unavailable in checks");
      }
    },
    session: {},
    shell: { showItemInFolder: (path: string) => current.hooks.showItemInFolder?.(path) }
  }));
}
