import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import {
  browserStorageWarning,
  type StoragePersistence,
  type StorageSummary
} from "@ai-book-studio/core/library/storage";
import { DirectoryHandleLibraryPort, webLock } from "./directory-port";
import { detectStorageCapabilities } from "./capabilities";

const LIBRARIES = "libraries";

export interface BrowserLibrary {
  libraryId: string;
  port: DirectoryHandleLibraryPort;
  summary: StorageSummary;
}

export interface OpenBrowserLibraryOptions {
  /** A browser can expose the API and still hang. Keep the welcome responsive. */
  timeoutMs?: number;
}

const OPEN_TIMEOUT_MS = 5_000;
const OPEN_FAILED =
  "This browser could not open origin storage. Choose a folder, or export an archive to keep your work.";

/**
 * Origin-private storage uses the same ordinary directory tree as a desktop library.
 *
 * The library id names a folder under `libraries/` in OPFS; the author-visible label stays
 * “This browser”, and the archive remains the way to move or back it up.
 */
export async function openBrowserLibrary(
  libraryId: string,
  options: OpenBrowserLibraryOptions = {}
): Promise<BrowserLibrary> {
  if (!detectStorageCapabilities().browserStorage) {
    throw new LibraryPortError("unsupported", "This browser cannot keep a library in site storage. Export an archive instead.");
  }
  let root: FileSystemDirectoryHandle;
  try {
    root = await within(
      navigator.storage.getDirectory(),
      options.timeoutMs ?? OPEN_TIMEOUT_MS,
      new LibraryPortError("unsupported", OPEN_FAILED, true)
    );
  } catch (error) {
    if (error instanceof LibraryPortError) throw error;
    throw new LibraryPortError("unsupported", OPEN_FAILED, true);
  }
  const timeout = options.timeoutMs ?? OPEN_TIMEOUT_MS;
  const failed = new LibraryPortError("unsupported", OPEN_FAILED, true);
  const libraries = await within(root.getDirectoryHandle(LIBRARIES, { create: true }), timeout, failed);
  const handle = await within(libraries.getDirectoryHandle(libraryId, { create: true }), timeout, failed);
  const persistence = await requestPersistence();
  const port = new DirectoryHandleLibraryPort(handle, { lock: webLock, deviceName: "This browser" });
  return {
    libraryId,
    port,
    summary: {
      tier: "browser",
      label: "This browser",
      permission: "granted",
      persistence,
      lastCommittedAt: null,
      warning: browserStorageWarning(persistence)
    }
  };
}

export async function requestPersistence(): Promise<StoragePersistence> {
  if (!navigator.storage?.persist) return "not-supported";
  try {
    return (await navigator.storage.persist()) ? "granted" : "not-granted";
  } catch {
    return "not-granted";
  }
}

/** Remove one browser library. Used by tests and by an explicit author delete. */
export async function removeBrowserLibrary(libraryId: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  try {
    const libraries = await root.getDirectoryHandle(LIBRARIES, { create: false });
    await libraries.removeEntry(libraryId, { recursive: true });
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

function within<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (failure) => {
        clearTimeout(timer);
        reject(failure);
      }
    );
  });
}

export function newBrowserLibraryId(): string {
  return `library_${randomId()}`;
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
