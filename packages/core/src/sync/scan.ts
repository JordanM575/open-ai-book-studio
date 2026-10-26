import { isConflictCopyName, parseChapterFile } from "../markdown";
import { booksPath, trashPath } from "../library/paths";
import { toLibraryPath, type LibraryPath } from "../library/path";
import type { LibraryEntry, LibraryFileSnapshot, LibraryPort } from "../library/port";
import type { ChapterMeta } from "../schema";
import type { SyncFile } from "./types";

const MAX_DEPTH = 32;
const IGNORED_NAME = /(^|\/)(\.DS_Store)$|\.(tmp|lock|icloud)$/i;
const CHAPTER_FILE = /^books\/[^/]+\/chapters\/[^/]+\.md$/;
const decoder = new TextDecoder();

/** Metadata used only to read a chapter's front matter; never written to disk. */
const FALLBACK_META: ChapterMeta = {
  id: "ch_000000",
  title: "Untitled chapter",
  order: 1,
  arc: "middle",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 1,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z"
};

export interface SyncScanOptions {
  /**
   * Ask the provider whether a file is online-only. Called before the file is read, because a
   * placeholder must never be mistaken for an empty chapter.
   */
  isPlaceholder?: (path: string) => boolean | Promise<boolean>;
}

export interface SyncScanResult {
  files: SyncFile[];
  /** Author-readable problems that did not stop the scan. */
  warnings: string[];
}

/**
 * Enumerate the author-owned files for drift detection. Read-only.
 *
 * Only `books/**` and `.studio/trash/**` are scanned: the catalog, device identity, journals and
 * temporary/provider sidecars are not author data. A provider's `isPlaceholder` probe runs first;
 * bytes are hashed only for files that are actually materialized.
 */
export async function scanLibrary(storage: LibraryPort, options: SyncScanOptions = {}): Promise<SyncScanResult> {
  const files: SyncFile[] = [];
  const warnings: string[] = [];
  for (const root of [booksPath(), trashPath()]) {
    await walk(storage, root, 0, files, warnings, options);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, warnings };
}

async function walk(
  storage: LibraryPort,
  directory: LibraryPath,
  depth: number,
  files: SyncFile[],
  warnings: string[],
  options: SyncScanOptions
): Promise<void> {
  if (depth > MAX_DEPTH) {
    warnings.push(`A folder is nested too deeply to scan: ${directory.join("/")}.`);
    return;
  }

  let entries: LibraryEntry[];
  try {
    entries = await storage.listDirectory(directory);
  } catch {
    warnings.push(`A folder could not be read: ${directory.join("/")}.`);
    return;
  }

  for (const entry of entries) {
    const segments = [...directory, entry.name];
    if (entry.kind === "directory") {
      await walk(storage, toLibraryPath(segments), depth + 1, files, warnings, options);
      continue;
    }
    if (IGNORED_NAME.test(entry.name)) continue;

    const observed = await observe(storage, segments, options);
    if (observed) files.push(observed);
  }
}

async function observe(
  storage: LibraryPort,
  segments: readonly string[],
  options: SyncScanOptions
): Promise<SyncFile | null> {
  const path = segments.join("/");
  const bookId = bookIdOf(segments);
  const conflict = isConflictCopy(path);
  const base: SyncFile = {
    path,
    sha256: null,
    size: null,
    ...(bookId === undefined ? {} : { bookId }),
    ...(conflict ? { conflict: true } : {})
  };

  let placeholder = false;
  try {
    placeholder = (await options.isPlaceholder?.(path)) ?? false;
  } catch {
    // A probe failure must not turn an online-only file into an empty one.
    placeholder = true;
  }
  if (placeholder) return { ...base, placeholder: true };

  let snapshot: LibraryFileSnapshot | null;
  try {
    snapshot = await storage.readFile(toLibraryPath(segments));
  } catch {
    return {
      ...base,
      unreadable: "The file could not be read. The folder permission may have changed, or the file may be locked."
    };
  }
  if (!snapshot) return null;

  const file: SyncFile = { ...base, sha256: snapshot.sha256, size: snapshot.bytes.byteLength };

  if (path.endsWith("/book.json")) {
    const version = bookSchemaVersion(snapshot.bytes);
    if (version === "invalid") {
      return { ...file, sha256: null, size: null, unreadable: "The book file is not valid JSON." };
    }
    if (typeof version === "number") file.schemaVersion = version;
    return file;
  }

  if (!conflict && CHAPTER_FILE.test(path)) {
    const identity = chapterIdentity(snapshot.bytes);
    if (identity === "invalid") {
      return { ...file, sha256: null, size: null, unreadable: "The chapter's front matter is not valid." };
    }
    if (identity) {
      file.chapterId = identity.id;
      file.version = identity.version;
    }
  }

  return file;
}

function isConflictCopy(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /(^|\/)conflicts\//.test(path) || isConflictCopyName(name);
}

function chapterIdentity(bytes: Uint8Array): { id: string; version: number } | "invalid" | null {
  try {
    const parsed = parseChapterFile(decoder.decode(bytes), "", FALLBACK_META);
    if (!parsed.hadFrontMatter || parsed.meta.id === FALLBACK_META.id) return null;
    return { id: parsed.meta.id, version: parsed.meta.version };
  } catch {
    return "invalid";
  }
}

function bookSchemaVersion(bytes: Uint8Array): number | "invalid" | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return "invalid";
  }
  if (!parsed || typeof parsed !== "object") return "invalid";
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" ? version : null;
}

/** `books/<id>/…`, `.studio/trash/<id>/…` and `.studio/trash/books/<stamp>-<id>/…`. */
function bookIdOf(segments: readonly string[]): string | undefined {
  if (segments[0] === "books" && segments[1]) return segments[1];
  if (segments[0] !== ".studio" || segments[1] !== "trash") return undefined;
  if (segments[2] === "books" && segments[3]) {
    const index = segments[3].lastIndexOf("book_");
    return index === -1 ? undefined : segments[3].slice(index);
  }
  return segments[2];
}
