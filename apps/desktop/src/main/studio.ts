import type { LibraryChangeEvent, LibraryInfo } from "@ai-book-studio/core/ipc";
import { ChangeBatcher } from "./library/changes";
import { Library } from "./library/store";
import type { DraftBuffer, FlushTarget } from "./drafts";
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
    this.library = library;
    this.restoreError = null;
    const changes = new ChangeBatcher(library.root, (event) => {
      if (this.library === library) this.onExternalChange?.(event);
    });
    const stop = library.watch((path) => changes.add(path));
    this.stopWatch = () => {
      stop();
      changes.stop();
    };
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

  /** Save every held draft, asking `window` for its newest text first when there is one. */
  async flushDrafts(window: FlushTarget | null = null): Promise<void> {
    if (this.library) await this.drafts.flushBeforeExit(this.library, window);
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
}

function info(library: Library): LibraryInfo {
  return { root: library.root, deviceId: library.deviceId, deviceName: library.deviceName };
}
