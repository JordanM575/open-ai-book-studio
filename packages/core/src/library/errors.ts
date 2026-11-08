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

/**
 * Why a chapter save failed, in the words the author reads. The library's messages are already plain,
 * except the one that names a chapter by its id when its file is not where the book expects it: a file
 * moved or deleted outside the studio, or a library folder renamed while it was open. The message
 * itself stays as it is, because agents and logs read it too.
 */
export function plainSaveReason(message: string): string {
  return /^No chapter \S+ in this book\.$/.test(message.trim())
    ? "This chapter's file is not in your library folder. It may have been moved, renamed or deleted."
    : message;
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
  | "too-large"
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
