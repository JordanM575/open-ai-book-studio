/**
 * Refusals for saved review records (039 T014 / D-199 / ADR 0020).
 *
 * The messages are the ones an author reads. They always say what happened to the file and what is
 * still safe: nothing here deletes, trims or rewrites an unreadable record.
 */
export type ReviewRecordErrorCode =
  | "invalid"
  | "exists"
  | "conflict"
  | "not-found"
  | "corrupt"
  | "newer-schema"
  | "unsupported"
  | "too-large"
  | "uncertain"
  | "not-kept"
  | "io";

export class ReviewRecordError extends Error {
  constructor(
    readonly code: ReviewRecordErrorCode,
    message: string,
    /** Library-relative path of the kept copy, when the failure preserved the author's version. */
    readonly savedAs?: string
  ) {
    super(message);
    this.name = "ReviewRecordError";
  }
}
