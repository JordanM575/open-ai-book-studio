/** Safe, author-facing archive failures. Messages never include file bytes or credentials. */
export type ArchiveErrorCode =
  | "invalid-manifest"
  | "unsupported-version"
  | "unsafe-path"
  | "duplicate-path"
  | "too-many-entries"
  | "too-large"
  | "hash-mismatch"
  | "missing-entry"
  | "unexpected-entry"
  | "destination-not-empty"
  | "changed-during-export"
  | "io";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}
