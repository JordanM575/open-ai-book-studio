import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import { LibraryError, LibraryPortError } from "@ai-book-studio/core/library/errors";
import type { LibraryPort, LibraryRuntime } from "@ai-book-studio/core/library/port";
import { LibraryService } from "@ai-book-studio/core/library/service";
import type { StorageSummary } from "@ai-book-studio/core/library/storage";
import { chooseFolder, folderPermission, folderPort, folderSummary, requestFolderPermission } from "../storage/fsa";
import { readStorageSetting, writeStorageSetting } from "../storage/indexeddb";
import { newBrowserLibraryId, openBrowserLibrary, removeBrowserLibrary } from "../storage/opfs";

const SELECTION_KEY = "library-selection";

export type BrowserSelection =
  | { tier: "browser"; libraryId: string }
  | { tier: "folder"; handle: FileSystemDirectoryHandle };

export const browserRuntime: LibraryRuntime = {
  now: () => new Date().toISOString(),
  newId: (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
  sha256: async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
};

/**
 * Owns the selected library in the web build.
 *
 * A selection is either a folder handle or a browser-storage id. The library itself is always
 * the ordinary file tree behind a `LibraryPort`; this class only decides which port is open.
 */
export class BrowserLibraries {
  service: LibraryService | null = null;
  port: LibraryPort | null = null;
  summary: StorageSummary | null = null;
  pendingFolder: FileSystemDirectoryHandle | null = null;
  restoreError: string | null = null;

  private selection: BrowserSelection | null = null;

  async restore(): Promise<void> {
    try {
      const saved = await readStorageSetting<BrowserSelection>(SELECTION_KEY);
      if (!saved) return;
      if (saved.tier === "browser") {
        const library = await openBrowserLibrary(saved.libraryId);
        this.service = await LibraryService.open({ storage: library.port, runtime: browserRuntime });
        this.port = library.port;
        this.summary = library.summary;
        this.selection = saved;
        return;
      }

      const permission = await folderPermission(saved.handle);
      if (permission !== "granted") {
        this.pendingFolder = saved.handle;
        this.summary = folderSummary(saved.handle, permission);
        return;
      }
      await this.openFolder(saved.handle, false);
    } catch (error) {
      this.restoreError = error instanceof Error ? error.message : String(error);
    }
  }

  info(): LibraryInfo | null {
    if (!this.service) return null;
    return {
      root: this.rootLabel(),
      deviceId: this.service.deviceId,
      deviceName: this.service.deviceName,
      storage: this.summary ?? undefined
    };
  }

  require(): LibraryService {
    if (!this.service) throw new LibraryError("not-found", "No library is open. Choose where to keep it first.");
    return this.service;
  }

  requirePort(): LibraryPort {
    if (!this.port) throw new LibraryError("not-found", "No library is open.");
    return this.port;
  }

  rootLabel(): string {
    if (!this.selection) return "This browser";
    if (this.selection.tier === "browser") return `browser://${this.selection.libraryId}`;
    return `folder://${this.selection.handle.name}`;
  }

  async openBrowserStorage(): Promise<LibraryInfo> {
    const libraryId = newBrowserLibraryId();
    const library = await openBrowserLibrary(libraryId);
    const service = await LibraryService.open({ storage: library.port, runtime: browserRuntime });
    await this.activate({ tier: "browser", libraryId }, library.port, library.summary, service);
    return this.info()!;
  }

  async chooseFolder(): Promise<LibraryInfo | null> {
    const handle = await chooseFolder();
    if (!handle) return null;
    return this.openFolder(handle, true);
  }

  async reconnectFolder(): Promise<LibraryInfo> {
    if (!this.pendingFolder) throw new LibraryPortError("not-found", "There is no folder waiting to reconnect.");
    return this.openFolder(this.pendingFolder, true);
  }

  /**
   * Create a new browser library and return it without activating it, so an archive can be
   * validated into an empty destination first.
   */
  async createImportDestination(): Promise<{ libraryId: string; port: LibraryPort; summary: StorageSummary }> {
    const libraryId = newBrowserLibraryId();
    const library = await openBrowserLibrary(libraryId);
    return { libraryId, port: library.port, summary: library.summary };
  }

  async activateImport(
    destination: { libraryId: string; port: LibraryPort; summary: StorageSummary }
  ): Promise<LibraryInfo> {
    const service = await LibraryService.open({ storage: destination.port, runtime: browserRuntime });
    await this.activate({ tier: "browser", libraryId: destination.libraryId }, destination.port, destination.summary, service);
    return this.info()!;
  }

  async discardImport(destination: { libraryId: string }): Promise<void> {
    await removeBrowserLibrary(destination.libraryId);
  }

  private async openFolder(handle: FileSystemDirectoryHandle, request: boolean): Promise<LibraryInfo> {
    const permission = request ? await requestFolderPermission(handle) : await folderPermission(handle);
    if (permission !== "granted") {
      this.pendingFolder = handle;
      this.summary = folderSummary(handle, permission);
      throw new LibraryPortError(
        "permission-required",
        permission === "read-only"
          ? "The folder is read-only. Choose another folder or grant write access."
          : "The browser needs permission to open this folder. Grant access to continue."
      );
    }

    const port = folderPort(handle);
    const service = await LibraryService.open({ storage: port, runtime: browserRuntime });
    await this.activate({ tier: "folder", handle }, port, folderSummary(handle, permission), service);
    return this.info()!;
  }

  private async activate(
    selection: BrowserSelection,
    port: LibraryPort,
    summary: StorageSummary,
    service: LibraryService
  ): Promise<void> {
    this.selection = selection;
    this.port = port;
    this.summary = summary;
    this.service = service;
    this.pendingFolder = null;
    await writeStorageSetting(SELECTION_KEY, selection);
  }
}
