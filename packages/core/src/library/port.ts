import type { LibraryPath } from "./path";

export type { LibraryPath } from "./path";

/**
 * Target-neutral storage boundary for a library.
 *
 * Paths are library-relative segments, never host paths. The caller validates them before
 * use, and adapters validate again at their boundary. A committed write must not expose a
 * partial file if the adapter reports failure.
 */
export interface LibraryFileSnapshot {
  /** Exact raw file bytes. Manuscript text is not normalized by the storage adapter. */
  bytes: Uint8Array;
  /** SHA-256 of the exact raw bytes, lowercase hexadecimal. */
  sha256: string;
  /** Creation time when the platform reports one. */
  createdAt: string | null;
  modifiedAt: string | null;
}

export type FileExpectation =
  /** The file must not exist yet. */
  | { kind: "absent" }
  /** The file's current bytes must have this hash. */
  | { kind: "sha256"; value: string }
  /** Replace whatever is there (derived files such as the catalog). */
  | { kind: "any" };

export type CommitFileResult =
  | { status: "written"; snapshot: LibraryFileSnapshot }
  | { status: "changed"; current: LibraryFileSnapshot | null };

export type LibraryEntry = { name: string; kind: "file" | "directory" };
export type LibraryInspectedEntry = LibraryEntry | { name: string; kind: "unsupported" };

export interface LibraryDeviceInfo {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Primitive operations only. Library policy, schema checks, save conflicts, trash and
 * catalog rebuilding live above this port in the shared library service.
 */
export interface LibraryPort {
  readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null>;
  listDirectory(path: LibraryPath): Promise<LibraryEntry[]>;
  /** Metadata only: expose unsupported names without following them, for unavailable-file UI. */
  inspectDirectory?(path: LibraryPath): Promise<LibraryInspectedEntry[]>;
  stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null>;
  /** Create a directory and any missing parents. Existing directories are not an error. */
  ensureDirectory(path: LibraryPath): Promise<void>;
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
  moveFile(from: LibraryPath, to: LibraryPath): Promise<void>;
  /**
   * Move an entire directory tree. The destination must not exist. Whether readers see
   * either the old location or the new one — never a partial tree — depends on the
   * adapter: a same-filesystem rename publishes atomically, while a copy fallback does
   * not. Publication-critical callers (spec 029 imports) must use only adapters whose
   * atomic publication has passed conformance; a cross-device staging move is refused
   * with `unsupported` instead of copying file by file.
   */
  moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void>;
  removeFile(path: LibraryPath): Promise<void>;
  /**
   * Remove a directory tree and everything under it. This exists for unpublished
   * staging cleanup (an import that never became visible); it must not be used to
   * delete author-visible books, which retire through trash instead.
   */
  removeDirectory(path: LibraryPath): Promise<void>;
  /** Notifications are advisory; callers still compare versions and hashes before saving. */
  watch?(path: LibraryPath, onChange: (changedPath: LibraryPath) => void): () => void;
  deviceInfo(): Promise<LibraryDeviceInfo>;
}

/** Runtime primitives are injected so shared policy does not import node:crypto or DOM APIs. */
export interface LibraryRuntime {
  now(): string;
  newId(prefix: string): string;
  sha256(bytes: Uint8Array): Promise<string>;
}

/** A store and its platform services are constructed together by the host adapter. */
export interface LibraryEnvironment {
  storage: LibraryPort;
  runtime: LibraryRuntime;
}
