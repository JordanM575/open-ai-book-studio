import type { ReactElement } from "react";
import type { ImportResultReport } from "@ai-book-studio/core/manuscript-import";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { formatCount, formatWords, pluralize } from "../lib/utils";

interface Props {
  open: boolean;
  report: ImportResultReport;
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
}

function normalizationSummary(report: ImportResultReport): string | null {
  const notes: string[] = [];
  if (report.normalization.newlineStyle === "crlf") notes.push("Windows line endings");
  else if (report.normalization.newlineStyle === "cr") notes.push("classic Mac line endings");
  else if (report.normalization.newlineStyle === "mixed") notes.push("mixed line endings");
  if (report.normalization.strippedBom) notes.push("a byte-order mark was set aside");
  const edgeBlankLines = report.normalization.edgeBlankLines.reduce(
    (total, entry) => total + entry.leadingRemoved + entry.trailingRemoved,
    0
  );
  if (edgeBlankLines > 0) {
    notes.push(`${formatCount(edgeBlankLines)} edge blank ${pluralize(edgeBlankLines, "line")} set aside`);
  }
  if (notes.length === 0) return null;
  return `Source uses ${notes.join(", ")}. Text is unchanged.`;
}

/**
 * The manuscript import result (spec 029 T012). Every count is read from the
 * committed book the library read back, and the report names the source file
 * without its host path.
 */
export function ImportResultDialog({ open, report, onClose, onOpenChange }: Props): ReactElement {
  const note = normalizationSummary(report);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import finished"
        description={`${report.bookTitle} · ${formatWords(report.totalWords)} · ${report.chapters.length} ${pluralize(report.chapters.length, "chapter")}`}
        data-testid="import-result-dialog"
        className="sm:max-w-2xl"
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} data-testid="import-result-close">
              Done
            </Button>
          </DialogFooter>
        }
      >
        <p data-testid="import-result-source" className="text-[var(--text-body-size)] text-muted-foreground">
          From {report.sourceName}
        </p>
        <ol className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1" data-testid="import-result-chapters">
          {report.chapters.map((chapter) => (
            <li
              key={chapter.order}
              className="rounded-[var(--corner-md)] border border-border p-3"
              data-testid={`import-result-chapter-${chapter.order}`}
            >
              <p className="text-[var(--text-subheadline-size)] font-medium">
                {chapter.order}. {chapter.title}
              </p>
              <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground">
                Lines {chapter.startLine} to {chapter.endLine} · {formatWords(chapter.wordCount)}
              </p>
            </li>
          ))}
        </ol>
        {note !== null ? (
          <p data-testid="import-result-normalization" role="note" className="mt-3 text-[var(--text-caption-size)] text-muted-foreground">
            {note}
          </p>
        ) : null}
        <p data-testid="import-result-not-imported" role="note" className="mt-3 text-[var(--text-caption-size)] text-muted-foreground">
          {report.notImportedNote}
        </p>
      </DialogContent>
    </Dialog>
  );
}
