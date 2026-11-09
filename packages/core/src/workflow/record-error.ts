/**
 * Refusals for checked workflow records (037 T023 / D-195 / ADR 0019).
 *
 * These messages are the ones a caller can surface to the author. They always say what happened to
 * the file and what is still safe: nothing here deletes, trims, rewrites or replays an unreadable or
 * uncertain record.
 */
export type WorkflowRecordErrorCode =
  | "invalid"
  | "exists"
  | "conflict"
  | "not-found"
  | "corrupt"
  | "unavailable"
  | "newer-schema"
  | "too-large"
  | "uncertain"
  | "not-kept"
  | "io";

export class WorkflowRecordError extends Error {
  constructor(
    readonly code: WorkflowRecordErrorCode,
    message: string,
    /** Library-relative path of the kept copy, when the failure preserved the caller's version. */
    readonly savedAs?: string
  ) {
    super(message);
    this.name = "WorkflowRecordError";
  }
}
