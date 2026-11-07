import type { SaveStatus } from "../components/ManuscriptEditor";

/** Additive integration seam: the parent-owned IPC contract can replace legacy path-only replies. */
export interface ManuscriptExportReceipt {
  path: string;
  warnings: string[];
}

export function exportReceipt(result: string | ManuscriptExportReceipt | null): ManuscriptExportReceipt | null {
  return typeof result === "string" ? { path: result, warnings: [] } : result;
}

/**
 * Why an export did not start: the open chapter's save did not confirm. One wording,
 * shared by the Format dialog and the workspace header export, so the author reads
 * the same sentence wherever they exported from.
 */
export function exportBlockedMessage(status: Exclude<SaveStatus, { kind: "saved" }>): string {
  switch (status.kind) {
    case "conflict":
      return "This chapter has a conflicting copy, so nothing was exported. Resolve the conflict, then export again.";
    case "error":
      return `Your latest change couldn't be saved, so nothing was exported. ${status.message}`;
    default:
      return "The chapter has not finished saving, so nothing was exported. Try the export again in a moment.";
  }
}
