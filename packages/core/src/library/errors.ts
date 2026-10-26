/**
 * Safe errors for library policy (as opposed to adapter failures).
 *
 * `code` is stable across IPC so the interface can branch on it without parsing prose.
 */
export type LibraryErrorCode = "not-found" | "invalid" | "format" | "newer-schema" | "io";

export class LibraryError extends Error {
  constructor(
    readonly code: LibraryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/** Safe adapter failures shared across filesystem targets. Never include file bytes or secrets. */
export type LibraryPortErrorCode =
  | "permission-required"
  | "read-only"
  | "storage-full"
  | "not-found"
  | "already-exists"
  | "invalid-path"
  | "conflict"
  | "unsupported"
  | "io";

export class LibraryPortError extends Error {
  constructor(
    readonly code: LibraryPortErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "LibraryPortError";
  }
}
