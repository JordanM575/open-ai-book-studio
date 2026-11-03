import type { DriftEntry, DriftKind, DriftReport } from "@ai-book-studio/core/sync/types";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";

export interface DriftReviewTarget {
  bookId: string;
  chapterId?: string;
}

interface Props {
  open: boolean;
  report: DriftReport;
  /** An action is running; every button waits. */
  busy: boolean;
  /** Book titles for readable entry headings, keyed by book id. */
  bookTitles?: Record<string, string>;
  onReview: (target: DriftReviewTarget) => void;
  /** Accept the disk bytes for one entry into the sync baseline. */
  onKeepDisk: (entry: DriftEntry) => void;
  /** Save one chapter's unsent text through the normal checked path. */
  onKeepMine: (entry: DriftEntry) => void;
  /** Open the chapter and its conflict copies together. */
  onOpenBoth: (entry: DriftEntry) => void;
  /** Export the whole library as a safety snapshot before resolving. */
  onExportLibrary: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<DriftKind, string> = {
  "new-remote": "New file",
  "remote-changed": "Changed elsewhere",
  "local-changed": "Changed here",
  "both-changed": "Changed in both places",
  "remote-deleted": "Deleted elsewhere",
  "local-deleted": "Back after deletion",
  renamed: "Renamed elsewhere",
  "conflict-copy": "Conflict copy",
  placeholder: "Not downloaded",
  unreadable: "Could not read",
  "schema-newer": "Newer app version"
};

/** Entries the author can act on; the rest are read-only notices. */
function actionsFor(entry: DriftEntry): Array<"review" | "keepDisk" | "keepMine" | "openBoth"> {
  switch (entry.kind) {
    case "both-changed":
      return ["review", "keepMine", "openBoth", "keepDisk"];
    case "conflict-copy":
      return ["openBoth", "keepDisk"];
    case "remote-changed":
    case "new-remote":
    case "remote-deleted":
    case "local-deleted":
    case "renamed":
      return entry.bookId && entry.chapterId ? ["review", "keepDisk"] : ["keepDisk"];
    default:
      return entry.bookId && entry.chapterId ? ["review"] : [];
  }
}

function entryTitle(entry: DriftEntry, bookTitles: Record<string, string>): string {
  const book = entry.bookId ? (bookTitles[entry.bookId] ?? entry.bookId) : null;
  return book ? `${book} · ${entry.path}` : entry.path;
}

function countLine(report: DriftReport): string {
  const parts: string[] = [];
  for (const [kind, count] of Object.entries(report.counts)) {
    if (count > 0) parts.push(`${count} ${KIND_LABEL[kind as DriftKind].toLowerCase()}`);
  }
  return parts.join(" · ");
}

/**
 * The drift review. It changes nothing itself: every button calls back into the app, which runs
 * the existing save, export and baseline paths. Closing without choosing leaves the report
 * exactly as it was, and the next scan reports the same entries.
 */
export function DriftReportDialog({
  open,
  report,
  busy,
  bookTitles = {},
  onReview,
  onKeepDisk,
  onKeepMine,
  onOpenBoth,
  onExportLibrary,
  onClose
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        title="Review changes"
        description="Sync is the folder you chose — iCloud Drive, Google Drive, or a local folder — not a studio account. Nothing here uploads."
      >
        {report.warning ? (
          <p className="mt-2 text-[var(--text-subheadline-size)] text-muted-foreground" data-testid="drift-warning">
            {report.warning}
          </p>
        ) : null}
        {report.clean ? (
          <p className="mt-2 text-[var(--text-body-size)]" data-testid="drift-clean">
            Everything matches. Nothing to review.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[var(--text-subheadline-size)] text-muted-foreground" data-testid="drift-counts">
              {countLine(report)}
            </p>
            <ul className="mt-3 space-y-3" data-testid="drift-entries">
              {report.entries.map((entry, index) => {
                const actions = actionsFor(entry);
                return (
                  <li key={`${entry.kind}:${entry.path}`} className="rounded-[var(--corner-md)] border border-border p-3" data-testid={`drift-entry-${index}`}>
                    <p className="text-[var(--text-caption-size)] text-muted-foreground">
                      {KIND_LABEL[entry.kind]}
                    </p>
                    <p className="mt-0.5 text-[var(--text-body-size)] font-medium">
                      {entryTitle(entry, bookTitles)}
                    </p>
                    <p className="mt-1 text-[var(--text-subheadline-size)] text-muted-foreground">
                      {entry.message}
                    </p>
                    {actions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actions.includes("review") && entry.bookId ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              onReview(
                                entry.chapterId
                                  ? { bookId: entry.bookId as string, chapterId: entry.chapterId }
                                  : { bookId: entry.bookId as string }
                              )
                            }
                            data-testid={`drift-review-${index}`}
                          >
                            Review
                          </Button>
                        ) : null}
                        {actions.includes("keepMine") ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => onKeepMine(entry)}
                            data-testid={`drift-keep-mine-${index}`}
                          >
                            Keep mine
                          </Button>
                        ) : null}
                        {actions.includes("openBoth") ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => onOpenBoth(entry)}
                            data-testid={`drift-open-both-${index}`}
                          >
                            Open both
                          </Button>
                        ) : null}
                        {actions.includes("keepDisk") ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => onKeepDisk(entry)}
                            data-testid={`drift-keep-disk-${index}`}
                          >
                            Keep the disk version
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onExportLibrary} data-testid="drift-export">
            Export the library
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={onClose} data-testid="drift-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
