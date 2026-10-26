import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { writeFileAtomic } from "../library/atomic";

export interface CheckpointEntry {
  chapterId: string;
  title: string;
  before: string;
  /** A chapter this turn created; undo moves it to the trash instead of restoring text. */
  created?: boolean;
  /** A chapter this turn deleted; undo recreates it from `before` at `order`. */
  deleted?: boolean;
  order?: number;
}

export interface TurnCheckpoint {
  turnId: string;
  bookId: string;
  at: string;
  prompt: string;
  entries: CheckpointEntry[];
}

export interface LoadedCheckpoint extends TurnCheckpoint {
  file: string;
}

const BOOK_ID = /^book_[A-Za-z0-9-]{6,}$/;

/**
 * A turn's restore point. Before the agent changes a chapter for the first time in a turn, the
 * original text is written here. One checkpoint per turn keeps undo predictable and bounded.
 */
export class CheckpointStore {
  constructor(private readonly libraryRoot: string | (() => string | null)) {}

  async save(checkpoint: TurnCheckpoint): Promise<string> {
    const dir = this.dir(checkpoint.bookId);
    await mkdir(dir, { recursive: true });
    const stamp = checkpoint.at.replace(/[:.]/g, "-");
    const file = `${stamp}-${checkpoint.turnId}.json`;
    await writeFileAtomic(join(dir, file), `${JSON.stringify(checkpoint, null, 2)}\n`);
    return file;
  }

  async latest(bookId: string): Promise<LoadedCheckpoint | null> {
    const dir = this.dir(bookId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    const files = names.filter((name) => name.endsWith(".json")).sort().reverse();
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), "utf8")) as TurnCheckpoint;
        if (parsed.bookId === bookId && Array.isArray(parsed.entries)) return { ...parsed, file };
      } catch {
        // A half-written file from an interrupted save is skipped, not restored.
      }
    }
    return null;
  }

  async remove(bookId: string, file: string): Promise<void> {
    if (file.includes("/") || file.includes("\\")) return;
    await unlink(join(this.dir(bookId), file)).catch(() => {});
  }

  private dir(bookId: string): string {
    if (!BOOK_ID.test(bookId)) throw new Error("Invalid book id.");
    const root = typeof this.libraryRoot === "function" ? this.libraryRoot() : this.libraryRoot;
    if (!root) throw new Error("No library is open.");
    return join(root, "books", bookId, ".studio", "checkpoints");
  }
}
