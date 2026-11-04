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
  /**
   * The 1-based position undo puts the chapter back at: where a deleted chapter stood, or where a
   * moved chapter stood before the turn first moved it.
   */
  order?: number;
  /**
   * The SHA-256 of the body text the turn left. Undo leaves a chapter whose text no longer has
   * this hash, because someone wrote it after the turn. Older checkpoints have none.
   */
  afterHash?: string;
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
 * The SHA-256 of a chapter's body text, in hex. The front matter is left out on purpose: moving a
 * chapter, or a neighbour, rewrites its order and version without touching its text.
 */
export async function bodyHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fold one change into a turn's entries, which hold one entry per chapter.
 *
 * The first change to a chapter fixes its `before` and title: the text it had before the turn first
 * wrote it. A later change only moves `afterHash` on. When a chapter the turn already changed is then
 * moved or deleted, its entry takes that position and goes to the end of the list, because undo walks
 * the list backwards and must meet it in the order the change was made. A chapter the turn created
 * and then deleted leaves nothing to undo.
 */
export function recordChange(entries: CheckpointEntry[], change: CheckpointEntry): void {
  const index = entries.findIndex((entry) => entry.chapterId === change.chapterId);
  const existing = entries[index];
  if (!existing) {
    entries.push({ ...change });
    return;
  }
  if (existing.created && change.deleted) {
    entries.splice(index, 1);
    return;
  }
  if (change.afterHash !== undefined) existing.afterHash = change.afterHash;
  if (existing.created) return;
  if (change.deleted) existing.deleted = true;
  if (change.order !== undefined && existing.order === undefined) {
    existing.order = change.order;
    entries.splice(index, 1);
    entries.push(existing);
  }
}

/**
 * A turn's restore point. Every time the agent changes a chapter, the turn's checkpoint is written
 * again, whole and under the same file name, so it always holds the text each changed chapter had
 * before the turn first wrote it. One checkpoint per turn keeps undo predictable and bounded.
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
