import type { LibraryChangeEvent } from "@ai-book-studio/core/ipc";
import { isAtomicTempName } from "./atomic";
import { isOwnState } from "./own-writes";
import { safeJoin } from "./paths";

/**
 * Turns the library watcher's raw events into one batch per quiet spell, and keeps only another
 * writer's changes.
 *
 * The studio's own atomic temp files are never reported, and a path whose bytes are exactly what the
 * studio last left there (`own-writes.ts`) is the studio's own change. Every event, a temp file's
 * included, restarts the quiet spell, so a write still in flight is checked once it has landed. Nothing
 * is dropped by time: a change from another writer is reported however soon it follows a local save.
 */
export class ChangeBatcher {
  private readonly paths = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    readonly root: string,
    private readonly onBatch: (event: LibraryChangeEvent) => void,
    private readonly quietMs = 500
  ) {}

  add(path: string): void {
    if (this.stopped) return;
    if (!isAtomicTempName(path.slice(path.lastIndexOf("/") + 1))) this.paths.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.quietMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.paths.clear();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const paths = [...this.paths];
    this.paths.clear();
    const outside: string[] = [];
    for (const path of paths) {
      if (!(await this.isOwn(path))) outside.push(path);
    }
    if (outside.length > 0 && !this.stopped) this.onBatch({ paths: outside, at: new Date().toISOString() });
  }

  private async isOwn(path: string): Promise<boolean> {
    try {
      return await isOwnState(safeJoin(this.root, ...path.split("/")));
    } catch {
      // A path that escapes the library is never taken for the studio's own.
      return false;
    }
  }
}
