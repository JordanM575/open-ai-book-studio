import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import type { ChapterMeta } from "@ai-book-studio/core/schema";
import { writeFileAtomic } from "../library/atomic";
import { noteOwnRemoval } from "../library/own-writes";
import type { Library } from "../library/store";

/** The chapter details a turn can change and undo puts back. Order, version and dates are not among them. */
export type CheckpointMeta = Pick<ChapterMeta, "title" | "synopsis" | "purpose" | "notes" | "arc" | "color" | "isPrologue">;

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
   * this hash, because someone wrote it during or after the turn. Older checkpoints have none.
   */
  afterHash?: string;
  /** The chapter's details before the turn first changed them. Undo puts them back. */
  meta?: CheckpointMeta;
  /** The SHA-256 of the details the turn left. Undo leaves a chapter whose details changed since. */
  afterMetaHash?: string;
  /**
   * Someone else wrote in the chapter between two of the turn's own changes, so its history holds
   * words the turn did not write. Undo keeps the chapter's file as a conflict copy before restoring it.
   */
  outsideEdit?: boolean;
  /** Where a deleted chapter's file went in the trash, so undo can bring back the chapter itself. */
  trashedAt?: string;
}

/** One change as a tool reports it: an entry, and what the tool found before it wrote. */
export interface CheckpointChange extends CheckpointEntry {
  /** The SHA-256 of the body text the tool found. Compared with the turn's last write, never stored. */
  beforeHash?: string;
  /** The SHA-256 of the details the tool found. Compared with the turn's last write, never stored. */
  beforeMetaHash?: string;
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

/** The details a checkpoint keeps, picked from a chapter or from details read back from a file. */
export function checkpointMeta(chapter: CheckpointMeta): CheckpointMeta {
  return {
    title: chapter.title,
    synopsis: chapter.synopsis,
    purpose: chapter.purpose,
    notes: chapter.notes,
    arc: chapter.arc,
    color: chapter.color,
    isPrologue: chapter.isPrologue
  };
}

/**
 * The SHA-256 of a chapter's details, in a fixed order. Like the body hash it leaves out order,
 * version and dates, so renumbering a chapter does not look like a change to its details.
 */
export function metaHash(meta: CheckpointMeta): Promise<string> {
  return bodyHash(
    JSON.stringify([meta.title, meta.synopsis, meta.purpose, meta.notes, meta.arc, meta.color, meta.isPrologue])
  );
}

/**
 * Fold one change into a turn's entries, which hold one entry per chapter.
 *
 * The first change to a chapter fixes its `before` and title: the text it had before the turn first
 * wrote it. Its first change to the details fixes `meta` the same way. A later change only moves the
 * after-hashes on, and marks the entry `outsideEdit` when the tool found text or details the turn had
 * not left, because someone else wrote in between. When a chapter the turn already changed is then
 * moved or deleted, its entry takes that position and goes to the end of the list, because undo walks
 * the list backwards and must meet it in the order the change was made. A chapter the turn created
 * and then deleted leaves nothing to undo.
 */
export function recordChange(entries: CheckpointEntry[], change: CheckpointChange): void {
  const { beforeHash, beforeMetaHash, ...recorded } = change;
  const index = entries.findIndex((entry) => entry.chapterId === change.chapterId);
  const existing = entries[index];
  if (!existing) {
    entries.push(recorded);
    return;
  }
  if (existing.created && change.deleted) {
    entries.splice(index, 1);
    return;
  }
  const textMoved = beforeHash !== undefined && existing.afterHash !== undefined && beforeHash !== existing.afterHash;
  const metaMoved =
    beforeMetaHash !== undefined && existing.afterMetaHash !== undefined && beforeMetaHash !== existing.afterMetaHash;
  if (textMoved || metaMoved) existing.outsideEdit = true;
  if (change.afterHash !== undefined) existing.afterHash = change.afterHash;
  if (change.afterMetaHash !== undefined) existing.afterMetaHash = change.afterMetaHash;
  if (existing.created) return;
  if (change.meta !== undefined && existing.meta === undefined) existing.meta = change.meta;
  if (change.trashedAt !== undefined) existing.trashedAt = change.trashedAt;
  if (change.deleted) existing.deleted = true;
  if (change.order !== undefined && existing.order === undefined) {
    existing.order = change.order;
    entries.splice(index, 1);
    entries.push(existing);
  }
}

/**
 * Where a store writes: the open library, whose sync baseline also learns of every checkpoint the
 * store writes or removes, or a bare library folder, which has no baseline to tell.
 */
export type CheckpointLibrary = string | Pick<Library, "root" | "noteOwnFiles">;

/**
 * A turn's restore point. Every time the agent changes a chapter, the turn's checkpoint is written
 * again, whole and under the same file name, so it always holds the text each changed chapter had
 * before the turn first wrote it. One checkpoint per turn keeps undo predictable and bounded.
 *
 * A checkpoint lives under `books/`, where the drift scan looks, but is written beside the library
 * service. So each write and removal is noted in this device's sync baseline as its own; otherwise
 * the next scan would list the turn's checkpoint as a file someone else added.
 */
export class CheckpointStore {
  constructor(private readonly library: CheckpointLibrary | (() => CheckpointLibrary | null)) {}

  async save(checkpoint: TurnCheckpoint): Promise<string> {
    const { dir, library } = this.folder(checkpoint.bookId);
    await mkdir(dir, { recursive: true });
    const stamp = checkpoint.at.replace(/[:.]/g, "-");
    const file = `${stamp}-${checkpoint.turnId}.json`;
    await writeFileAtomic(join(dir, file), `${JSON.stringify(checkpoint, null, 2)}\n`);
    await noteOwn(library, { written: [archivePath(checkpoint.bookId, file)] });
    return file;
  }

  async latest(bookId: string): Promise<LoadedCheckpoint | null> {
    const { dir } = this.folder(bookId);
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
    const { dir, library } = this.folder(bookId);
    const path = join(dir, file);
    const removed = await unlink(path).then(
      () => true,
      () => false
    );
    if (!removed) return;
    noteOwnRemoval(path);
    await noteOwn(library, { removed: [archivePath(bookId, file)] });
  }

  /** The book's checkpoint folder, and the library it belongs to. */
  private folder(bookId: string): { dir: string; library: CheckpointLibrary } {
    if (!BOOK_ID.test(bookId)) throw new Error("Invalid book id.");
    const library = typeof this.library === "function" ? this.library() : this.library;
    if (!library) throw new Error("No library is open.");
    const root = typeof library === "string" ? library : library.root;
    return { dir: join(root, "books", bookId, ".studio", "checkpoints"), library };
  }
}

/** A checkpoint's path as the sync baseline keys it: library-relative, with `/` separators. */
function archivePath(bookId: string, file: string): string {
  return `books/${bookId}/.studio/checkpoints/${file}`;
}

/** Best-effort, like every baseline note: a failed note leaves a reviewable report, never a failed save. */
async function noteOwn(library: CheckpointLibrary, files: { written?: string[]; removed?: string[] }): Promise<void> {
  if (typeof library === "string") return;
  try {
    await library.noteOwnFiles(files);
  } catch {
    // The next scan lists the checkpoint, and the author can keep it.
  }
}
