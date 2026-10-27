/**
 * Sync journal and drift vocabulary.
 *
 * There is no server. The journal is this device's memory of the last scan, so a later scan can tell
 * "these bytes are not the ones I saw" apart from "these bytes are the ones I wrote".
 */
export const SYNC_SCHEMA_VERSION = 1;

export interface SyncFileRecord {
  /** Last hash observed on disk. */
  sha256: string;
  /** Hash this device last wrote, when it differs from the observed hash. */
  writtenSha256?: string | undefined;
  version?: number | undefined;
  size?: number | undefined;
  observedAt: string;
  /** A deletion this device recorded, so a stale copy cannot silently resurrect the file. */
  deleted?: boolean;
}

export interface SyncJournal {
  schemaVersion: number;
  deviceId: string;
  generation: number;
  scannedAt: string;
  /** Library-relative path → record. Never contains credentials or prose. */
  files: Record<string, SyncFileRecord>;
}

/** One file as the scan sees it now. The caller enumerates and hashes; the detector stays pure. */
export interface SyncFile {
  /** Library-relative path with `/` separators. */
  path: string;
  /** Null for a placeholder or an unreadable file. */
  sha256: string | null;
  size: number | null;
  version?: number | undefined;
  bookId?: string | undefined;
  chapterId?: string | undefined;
  /** The provider reports an online-only placeholder. */
  placeholder?: boolean;
  /** A short, author-readable reason the file could not be read. */
  unreadable?: string;
  /** True for a conflict copy under `books/<id>/conflicts/` or `conflicts/`. */
  conflict?: boolean;
  /** Set for `books/<id>/book.json` when its schema version is known. */
  schemaVersion?: number;
}

export type DriftKind =
  | "new-remote"
  | "remote-changed"
  | "local-changed"
  | "both-changed"
  | "remote-deleted"
  | "local-deleted"
  | "renamed"
  | "conflict-copy"
  | "placeholder"
  | "unreadable"
  | "schema-newer";

export interface DriftEntry {
  kind: DriftKind;
  path: string;
  /** For a rename, the path this file had in the journal. */
  renamedFrom?: string | undefined;
  /*
   * These are `| undefined` on purpose. The detector builds an entry from paths that are not
   * always inside a book, and it should be able to say "no book" explicitly rather than omit the
   * key. With `exactOptionalPropertyTypes` the two are different things, and the explicit one is
   * what the code means.
   */
  bookId?: string | undefined;
  chapterId?: string | undefined;
  previous?: SyncFileRecord | undefined;
  current?: Pick<SyncFile, "sha256" | "size" | "version"> | undefined;
  /** Author-readable, never a raw stack trace. */
  message: string;
}

export interface DriftReport {
  clean: boolean;
  scannedAt: string;
  entries: DriftEntry[];
  counts: Record<DriftKind, number>;
  /** Set when there was no usable baseline, so the interface can say why the report is thin. */
  warning?: string | undefined;
}

export const DRIFT_KINDS: DriftKind[] = [
  "new-remote",
  "remote-changed",
  "local-changed",
  "both-changed",
  "remote-deleted",
  "local-deleted",
  "renamed",
  "conflict-copy",
  "placeholder",
  "unreadable",
  "schema-newer"
];

export function emptyDriftCounts(): Record<DriftKind, number> {
  return Object.fromEntries(DRIFT_KINDS.map((kind) => [kind, 0])) as Record<DriftKind, number>;
}
