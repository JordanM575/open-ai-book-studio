import { mock } from "bun:test";
import { tmpdir } from "node:os";

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

/** What the file under test wants recorded; the mock reads these on every call. */
export interface ElectronHooks {
  handle?: (channel: string, handler: Handler) => void;
  showItemInFolder?: (path: string) => void;
  /** Protected storage in Electron 45's shape: availability is a promise, encryption is not. */
  safeStorage?: {
    isAsyncEncryptionAvailable: () => Promise<boolean>;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
  };
  /** Told the name of every safeStorage call, so a file can prove the keychain was never asked. */
  safeStorageCalls?: (method: string) => void;
  /** `app.isPackaged`. A file that does not say runs unpackaged, like a development build. */
  isPackaged?: boolean;
  /** The native dialogs, given the options and the window they were attached to, if any. */
  showOpenDialog?: (options: unknown, window: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog?: (options: unknown, window: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
  showMessageBox?: (options: unknown, window: unknown) => Promise<{ response: number }>;
  openExternal?: (url: string) => void;
  /**
   * Whether the desktop takes notifications; each one shown is handed to `posted`, so a file can
   * click it. A file that does not say has none, and nothing is ever shown.
   */
  notifications?: { supported: boolean; posted?: (notification: MockNotification) => void };
}

/** A notification in Electron's shape. It is never shown; a test clicks it instead. */
export class MockNotification {
  static isSupported(): boolean {
    return current.hooks.notifications?.supported ?? false;
  }

  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly options: { title?: string; body?: string } = {}) {}

  on(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  show(): void {
    current.hooks.notifications?.posted?.(this);
  }

  /** What the author's click on the notification does. */
  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

type Answer<T> = (options: unknown, window: unknown) => Promise<T>;

/** A dialog the file under test did not answer fails the call rather than opening anything. */
function answer<T>(name: string, hook: Answer<T> | undefined, args: unknown[]): Promise<T> {
  if (!hook) return Promise.reject(new Error(`No ${name} answer in checks.`));
  return hook(args.at(-1), args.length > 1 ? args[0] : null);
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
    app: {
      getPath: (name: string) => (name === "userData" ? current.userData : tmpdir()),
      getVersion: () => "0.0.0-checks",
      get isPackaged() {
        return current.hooks.isPackaged ?? false;
      }
    },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    dialog: {
      showOpenDialog: (...args: unknown[]) => answer("open dialog", current.hooks.showOpenDialog, args),
      showSaveDialog: (...args: unknown[]) => answer("save dialog", current.hooks.showSaveDialog, args),
      showMessageBox: (...args: unknown[]) => answer("message box", current.hooks.showMessageBox, args)
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => current.hooks.handle?.(channel, handler)
    },
    Menu: {},
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    Notification: MockNotification,
    safeStorage: {
      isAsyncEncryptionAvailable: () => {
        current.hooks.safeStorageCalls?.("isAsyncEncryptionAvailable");
        return current.hooks.safeStorage?.isAsyncEncryptionAvailable() ?? false;
      },
      encryptString: (value: string) => {
        current.hooks.safeStorageCalls?.("encryptString");
        if (current.hooks.safeStorage) return current.hooks.safeStorage.encryptString(value);
        throw new Error("unavailable in checks");
      },
      decryptString: (value: Buffer) => {
        current.hooks.safeStorageCalls?.("decryptString");
        if (current.hooks.safeStorage) return current.hooks.safeStorage.decryptString(value);
        throw new Error("unavailable in checks");
      }
    },
    session: {},
    shell: {
      showItemInFolder: (path: string) => current.hooks.showItemInFolder?.(path),
      openExternal: async (url: string) => current.hooks.openExternal?.(url)
    }
  }));
}
