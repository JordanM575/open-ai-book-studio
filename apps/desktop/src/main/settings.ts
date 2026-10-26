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
}

const DEFAULTS: AppSettings = { libraryRoot: null };

export class SettingsStore {
  private readonly path = join(app.getPath("userData"), "studio.json");
  private value: AppSettings = { ...DEFAULTS };

  async load(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<AppSettings>;
      this.value = {
        libraryRoot: typeof parsed.libraryRoot === "string" ? parsed.libraryRoot : null,
        ...(parsed.windowBounds ? { windowBounds: parsed.windowBounds } : {}),
        ...(typeof parsed.pluginFolder === "string" ? { pluginFolder: parsed.pluginFolder } : {})
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
