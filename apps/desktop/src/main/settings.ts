import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./library/atomic";

export interface AppSettings {
  libraryRoot: string | null;
  windowBounds?: { width: number; height: number; x?: number; y?: number };
  /**
   * The folder of TypeScript tools the author points the app at (D-150).
   *
   * It is a library-level setting, not a book setting, because it points at code on the author's
   * disk: a book that travels to another machine never carries the path with it.
   */
  pluginFolder?: string | null;
  /**
   * Minutes between drift scans when the window regains focus. The scan itself is read-only;
   * raising this only spaces the reminders out.
   */
  syncCheckIntervalMinutes?: number;
  /** When the drift scan last ran, as an ISO timestamp. Display only. */
  lastSyncScanAt?: string | null;
}

/** The focus-scan interval when nothing is configured. */
export const DEFAULT_SYNC_CHECK_INTERVAL_MINUTES = 15;

const DEFAULTS: AppSettings = { libraryRoot: null };

/**
 * The profile file lives directly under Electron's per-app userData directory,
 * which carries the app name but no version. Two compatible builds therefore
 * share one settings file; local install/upgrade never relocates it.
 */
export function settingsFilePath(userDataDir: string): string {
  return join(userDataDir, "studio.json");
}

export class SettingsStore {
  private readonly path = settingsFilePath(app.getPath("userData"));
  private value: AppSettings = { ...DEFAULTS };

  async load(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<AppSettings>;
      this.value = {
        libraryRoot: typeof parsed.libraryRoot === "string" ? parsed.libraryRoot : null,
        ...(parsed.windowBounds ? { windowBounds: parsed.windowBounds } : {}),
        ...(typeof parsed.pluginFolder === "string" ? { pluginFolder: parsed.pluginFolder } : {}),
        ...(typeof parsed.syncCheckIntervalMinutes === "number" &&
        Number.isFinite(parsed.syncCheckIntervalMinutes)
          ? { syncCheckIntervalMinutes: parsed.syncCheckIntervalMinutes }
          : {}),
        ...(typeof parsed.lastSyncScanAt === "string" ? { lastSyncScanAt: parsed.lastSyncScanAt } : {})
      };
    } catch {
      this.value = { ...DEFAULTS };
    }
    return this.value;
  }

  get(): AppSettings {
    return this.value;
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    this.value = { ...this.value, ...patch };
    await writeFileAtomic(this.path, `${JSON.stringify(this.value, null, 2)}\n`);
  }
}
