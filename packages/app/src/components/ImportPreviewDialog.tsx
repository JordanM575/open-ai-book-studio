import { useMemo, useState, type ReactElement } from "react";
import {
  previewImport,
  type ImportManuscriptInput,
  type ImportPreview,
  type ValidatedSource
} from "@ai-book-studio/core/manuscript-import";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { formatCount, formatWords, pluralize } from "../lib/utils";

export type ImportPreviewInput =
  | { kind: "source"; source: ValidatedSource }
  | { kind: "refusal"; refusal: { status: "refused"; message: string } };

/**
 * The author's confirmed mapping. This is the IPC input by construction, so the
 * main process can publish it without re-reading: titles and full bodies only,
 * never a filesystem path.
 */
export type ConfirmedImportMapping = ImportManuscriptInput;

interface Props {
  open: boolean;
  input: ImportPreviewInput;
  /**
   * The confirmed mapping plus the preview it was taken from, so the caller can
   * report the author's split mapping without re-deriving it.
   */
  onConfirm: (mapping: ConfirmedImportMapping, preview: ImportPreview) => void;
  onCancel: () => void;
  onOpenChange?: (open: boolean) => void;
}

function defaultChapterTitle(order: number): string {
  return `Chapter ${order}`;
}

function normalizationNote(input: { strippedBom: boolean; newlineStyle: string; edgeBlankLines: Array<{ leadingRemoved: number; trailingRemoved: number }> }): string | null {
  const notes: string[] = [];
  if (input.newlineStyle === "crlf") notes.push("Windows line endings");
  else if (input.newlineStyle === "cr") notes.push("classic Mac line endings");
  else if (input.newlineStyle === "mixed") notes.push("mixed line endings");
  if (input.strippedBom) notes.push("a byte-order mark was set aside");
  const edgeBlankLines = input.edgeBlankLines.reduce(
    (total, entry) => total + entry.leadingRemoved + entry.trailingRemoved,
    0
  );
  if (edgeBlankLines > 0) {
    notes.push(
      `${formatCount(edgeBlankLines)} edge blank ${pluralize(edgeBlankLines, "line")} set aside`
    );
  }
  if (notes.length === 0) return null;
  return `Source uses ${notes.join(", ")}. Text is unchanged.`;
}

/**
 * The manuscript import preview (spec 029 T007). Presentational only: it derives
 * the preview from accepted source bytes with shared core, keeps every edit in
 * local state, and reports the confirmed mapping through `onConfirm`. It never
 * calls the library, so nothing is written before the author confirms.
 */
export function ImportPreviewDialog({ open, input, onConfirm, onCancel, onOpenChange }: Props): ReactElement {
  const [bookTitle, setBookTitle] = useState(() =>
    input.kind === "source" ? input.source.proposedTitle : ""
  );
  const [splits, setSplits] = useState<number[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [newSplitLine, setNewSplitLine] = useState("2");

  const preview = useMemo(
    () => (input.kind === "source" ? previewImport(input.source, splits) : null),
    [input, splits]
  );

  if (input.kind === "refusal" || preview === null) {
    const refusal = input.kind === "refusal" ? input.refusal : null;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title="Cannot import this file"
          data-testid="import-preview-dialog"
          className="sm:max-w-md"
          footer={
            <DialogFooter>
              <Button variant="secondary" onClick={onCancel} data-testid="import-cancel">
                Close
              </Button>
            </DialogFooter>
          }
        >
          <p data-testid="import-refusal" role="status" className="text-[var(--text-body-size)] text-muted-foreground">
            {refusal?.message ?? "The selected file could not be read."}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const source = input.source;
  const lineCount = source.text.split("\n").length;

  const clampLine = (value: number): number =>
    Math.min(Math.max(Math.floor(value) || 2, 2), lineCount);

  const updateSplits = (order: number, startLine: number): void => {
    const next = preview.chapters.map((chapter) => chapter.startLine);
    next[order - 1] = clampLine(startLine);
    setSplits([...new Set(next.slice(1))].sort((a, b) => a - b));
  };

  const addSplit = (): void => {
    const line = clampLine(Number(newSplitLine));
    if (splits.includes(line)) return;
    setSplits([...splits, line].sort((a, b) => a - b));
  };

  const removeSplit = (startLine: number): void => {
    setSplits(splits.filter((line) => line !== startLine));
  };

  const chapterTitle = (order: number): string => titles[order - 1] ?? defaultChapterTitle(order);

  const handleConfirm = (): void => {
    onConfirm(
      {
        bookTitle: bookTitle.trim() === "" ? source.proposedTitle : bookTitle,
        chapters: preview.chapters.map((chapter) => ({
          title: chapterTitle(chapter.order),
          content: chapter.body
        }))
      },
      preview
    );
  };

  const note = normalizationNote(preview.normalization);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Preview import"
        description={`${source.fileName} · ${formatWords(preview.wordCount)} · ${preview.chapters.length} ${pluralize(preview.chapters.length, "chapter")}`}
        data-testid="import-preview-dialog"
        className="sm:max-w-2xl"
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel} data-testid="import-cancel">
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleConfirm} data-testid="import-confirm">
              Import book
            </Button>
          </DialogFooter>
        }
      >
        <label
          className="block text-[var(--text-subheadline-size)] font-medium"
          htmlFor="import-book-title"
        >
          Book title
        </label>
        <input
          id="import-book-title"
          data-testid="import-book-title"
          className="w-full rounded-[var(--corner-md)] border border-input bg-background px-3 py-2 text-[var(--text-body-size)]"
          value={bookTitle}
          onChange={(event) => setBookTitle(event.target.value)}
        />
        {note !== null ? (
          <p data-testid="import-normalization" role="note" className="text-[var(--text-caption-size)] text-muted-foreground">
            {note}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-[var(--text-subheadline-size)] font-medium"
            htmlFor="import-new-split"
          >
            Start a new chapter at line
          </label>
          <input
            id="import-new-split"
            data-testid="import-new-split"
            type="number"
            min={2}
            max={lineCount}
            value={newSplitLine}
            onChange={(event) => setNewSplitLine(event.target.value)}
            className="w-20 rounded-[var(--corner-md)] border border-input bg-background px-2 py-1 text-[var(--text-body-size)]"
          />
          <Button variant="secondary" onClick={addSplit} data-testid="import-add-split">
            Add split
          </Button>
        </div>
        <ol className="max-h-[40vh] space-y-4 overflow-y-auto pr-1">
          {preview.chapters.map((chapter) => (
            <li key={chapter.order} className="rounded-[var(--corner-md)] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="text-[var(--text-subheadline-size)] font-medium"
                  htmlFor={`import-chapter-title-${chapter.order}`}
                >
                  Chapter {chapter.order} title
                </label>
                <input
                  id={`import-chapter-title-${chapter.order}`}
                  data-testid={`import-chapter-title-${chapter.order}`}
                  className="min-w-40 flex-1 rounded-[var(--corner-md)] border border-input bg-background px-3 py-1.5 text-[var(--text-body-size)]"
                  value={chapterTitle(chapter.order)}
                  onChange={(event) => {
                    const next = [...titles];
                    next[chapter.order - 1] = event.target.value;
                    setTitles(next);
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p data-testid={`import-chapter-lines-${chapter.order}`} className="text-[var(--text-caption-size)] text-muted-foreground">
                  Lines {chapter.startLine} to {chapter.endLine} · {formatWords(chapter.wordCount)}
                </p>
                {chapter.order > 1 ? (
                  <>
                    <label
                      className="text-[var(--text-caption-size)] text-muted-foreground"
                      htmlFor={`import-split-${chapter.order}`}
                    >
                      Starts at line
                    </label>
                    <input
                      id={`import-split-${chapter.order}`}
                      data-testid={`import-split-${chapter.order}`}
                      type="number"
                      min={2}
                      max={lineCount}
                      value={chapter.startLine}
                      onChange={(event) => updateSplits(chapter.order, Number(event.target.value))}
                      className="w-20 rounded-[var(--corner-md)] border border-input bg-background px-2 py-1 text-[var(--text-body-size)]"
                    />
                    <Button
                      variant="ghost"
                      onClick={() => removeSplit(chapter.startLine)}
                      data-testid={`import-remove-split-${chapter.order}`}
                    >
                      Remove split
                    </Button>
                  </>
                ) : null}
              </div>
              <pre
                data-testid={`import-chapter-body-${chapter.order}`}
                className="mt-2 max-h-48 overflow-y-auto rounded-[var(--corner-sm)] bg-[var(--secondary)] p-3 text-[var(--text-body-size)] whitespace-pre-wrap"
              >
                {chapter.body}
              </pre>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
