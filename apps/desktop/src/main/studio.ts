import type { LibraryChangeEvent, LibraryInfo } from "@ai-book-studio/core/ipc";
import { Library } from "./library/store";
import type { DraftBuffer } from "./drafts";
import type { SettingsStore } from "./settings";

export class Studio {
  library: Library | null = null;
  /** Set when the remembered library folder was missing on launch, so the UI can explain it. */
  restoreError: string | null = null;
  /** Wired by the app to the renderer event channel. */
  onExternalChange?: (event: LibraryChangeEvent) => void;
  /** Wired by the app to run the drift scan after a library opens. */
  onLibraryOpened?: (info: LibraryInfo) => void;

  constructor(
    private readonly settings: SettingsStore,
    readonly drafts: DraftBuffer
  ) {}

  async restore(): Promise<void> {
    const root = this.settings.get().libraryRoot;
    if (!root) return;
    try {
      await this.openLibrary(root);
    } catch (error) {
      this.restoreError = (error as Error).message;
      console.warn("[studio] Could not reopen the last library:", this.restoreError);
    }
  }

  async openLibrary(root: string): Promise<LibraryInfo> {
    const library = await Library.open(root);
    this.stopWatch?.();
    this.stopWatch = null;
    this.watchedPaths.clear();
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    this.library = library;
    this.restoreError = null;
    this.stopWatch = library.watch((path) => {
      this.watchedPaths.add(path);
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        this.watchTimer = null;
        const paths = [...this.watchedPaths];
        this.watchedPaths.clear();
        this.onExternalChange?.({ paths, at: new Date().toISOString() });
      }, 500);
    });
    await this.settings.update({ libraryRoot: library.root });
    const opened = info(library);
    this.onLibraryOpened?.(opened);
    return opened;
  }

  current(): LibraryInfo | null {
    return this.library ? info(this.library) : null;
  }

  requireLibrary(): Library {
    if (!this.library) {
      throw new Error("No library is open. Choose a folder first.");
    }
    return this.library;
  }

  async flushDrafts(): Promise<void> {
    if (this.library) await this.drafts.flush(this.library);
  }

  settingsWindowBounds(): { width: number; height: number; x?: number; y?: number } | undefined {
    return this.settings.get().windowBounds;
  }

  /** Called on every resize/move; debounced so the settings file is not rewritten per frame. */
  rememberWindowBounds(bounds: { width: number; height: number; x: number; y: number }): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null;
      void this.settings.update({ windowBounds: bounds }).catch(() => {});
    }, 800);
  }

  private boundsTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatch: (() => void) | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watchedPaths = new Set<string>();
}

function info(library: Library): LibraryInfo {
  return { root: library.root, deviceId: library.deviceId, deviceName: library.deviceName };
}
