import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Result } from "@ai-book-studio/core/ipc";
import type { Chapter, ManuscriptSettings } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@ai-book-studio/ui/components/native-select";
import { must } from "../lib/utils";
import type { SaveStatus } from "./ManuscriptEditor";

/**
 * The Format journey (spec 035). A local approximate preview bound to
 * `settings.manuscript` as the single canonical source: every control reads
 * and writes the saved settings, nothing duplicates them, and the preview
 * never calls a provider or writes chapters. Export saves the open chapter,
 * then writes the chosen target through the main process (D-108); the
 * workspace header keeps its own Word and Markdown buttons.
 */
export type FormatTarget = "DOCX" | "PDF" | "EPUB" | "Markdown";

const TARGETS: FormatTarget[] = ["DOCX", "PDF", "EPUB", "Markdown"];

/** What each target is called on its Export button, and what it does with the settings below. */
const TARGET_COPY: Record<FormatTarget, { name: string; note: string }> = {
  DOCX: { name: "Word document", note: "Uses the typography below. Word export does not add a table of contents yet." },
  PDF: { name: "PDF", note: "A4 pages with a title page and each chapter on a new page, in the typography below." },
  EPUB: { name: "EPUB", note: "An EPUB 3 e-book with one file per chapter. E-readers may change the font and size." },
  Markdown: { name: "Markdown", note: "Plain text with chapter headings. The typography below does not apply." }
};

const EXPORTS: Record<FormatTarget, (bookId: string) => Promise<Result<string | null>>> = {
  DOCX: (bookId) => window.studio.books.exportDocx(bookId),
  PDF: (bookId) => window.studio.books.exportPdf(bookId),
  EPUB: (bookId) => window.studio.books.exportEpub(bookId),
  Markdown: (bookId) => window.studio.books.exportMarkdown(bookId)
};

/** Why an export did not start: the open chapter's save did not confirm. */
function unsavedMessage(status: Exclude<SaveStatus, { kind: "saved" }>): string {
  switch (status.kind) {
    case "conflict":
      return "The chapter could not be saved, so nothing was exported. Your text was kept as a separate copy. Resolve the conflict, then export again.";
    case "error":
      return `The chapter could not be saved, so nothing was exported. ${status.message}`;
    default:
      return "The chapter has not finished saving, so nothing was exported. Try the export again in a moment.";
  }
}

type ExportNote = { kind: "saved"; message: string; path: string } | { kind: "error"; message: string };

const LINE_HEIGHT: Record<ManuscriptSettings["lineSpacing"], number> = {
  Single: 1,
  "1.15": 1.15,
  "1.5": 1.5,
  Double: 2
};

const FONT_FALLBACK: Record<string, string> = {
  "Courier New": "monospace",
  Arial: "sans-serif",
  Helvetica: "sans-serif",
  Calibri: "sans-serif"
};

interface FormatDialogProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  /** Last saved settings. The dialog reverts to these when a write fails. */
  settings: ManuscriptSettings;
  /** Saved chapter text. The dialog never edits or writes chapters. */
  chapters: Chapter[];
  /** Persists one manuscript patch; rejects when the write fails. */
  onSaveSettings: (next: ManuscriptSettings) => Promise<void>;
  /** Saves the open chapter before an export; null when no chapter is open. */
  onFlush: () => Promise<SaveStatus | null>;
}

export const FORMAT_LABELS: Record<string, string> = {
  bodyFont: "Font",
  bodyFontSize: "Size",
  firstLineIndent: "First-line indent",
  lineSpacing: "Line spacing",
  chapterTitleAlignment: "Chapter titles",
  includeTableOfContents: "Table of contents",
  preserveLineBreaks: "Keep line breaks"
};

export function FormatDialog({
  open,
  onClose,
  bookId,
  bookTitle,
  settings,
  chapters,
  onSaveSettings,
  onFlush
}: FormatDialogProps) {
  const [target, setTarget] = useState<FormatTarget>("DOCX");
  const [draft, setDraft] = useState<ManuscriptSettings>(settings);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<ExportNote | null>(null);
  // Exports write files through the main process, which the browser build does not have.
  const canExport = window.studio.platform !== "web";

  // Only the draft follows saved settings while open.
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // The target and the last export's note are this visit's alone: every open starts at DOCX.
  useEffect(() => {
    if (open) return;
    setTarget("DOCX");
    setNote(null);
  }, [open]);

  const change = (patch: Partial<ManuscriptSettings>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void onSaveSettings(next).catch(() => setDraft(settings));
  };

  const runExport = async (): Promise<void> => {
    if (exporting || !canExport) return;
    setExporting(true);
    setNote(null);
    try {
      let saved: SaveStatus | null;
      try {
        saved = await onFlush();
      } catch {
        saved = { kind: "error", message: "The chapter could not be saved." };
      }
      if (saved && saved.kind !== "saved") {
        setNote({ kind: "error", message: unsavedMessage(saved) });
        return;
      }
      const path = await must(EXPORTS[target](bookId));
      // A cancelled picker or a declined replacement wrote nothing, so there is nothing to say.
      if (path) setNote({ kind: "saved", message: `Saved ${path.split(/[\\/]/).pop() ?? path}`, path });
    } catch (error) {
      setNote({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    // The dialog stays open while an export runs, so its outcome is never shown to a closed dialog.
    <Dialog open={open} onOpenChange={(next) => !next && !exporting && onClose()}>
      <DialogContent
        title="Format"
        description={`Typography, preview and export for ${bookTitle}. An export is a copy; the book's own files do not change.`}
        className="w-[720px]"
        footer={
          <DialogFooter className="mt-0 justify-between gap-3">
            <div className="min-w-0 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)]">
              <p role="status" data-testid="format-export-note" className="truncate" title={note?.kind === "saved" ? note.path : undefined}>
                {canExport ? (note?.kind === "saved" ? note.message : "") : "Exporting is available in the desktop app."}
              </p>
              {note?.kind === "error" ? (
                <p role="alert" data-testid="format-export-error" className="text-[var(--destructive-text)]">
                  {note.message}
                </p>
              ) : null}
            </div>
            <Button
              variant="primary"
              className="shrink-0"
              onClick={() => void runExport()}
              disabled={!canExport || exporting}
              data-testid="format-export"
            >
              <Download size={15} />
              {exporting ? "Exporting…" : `Export ${TARGET_COPY[target].name}`}
            </Button>
          </DialogFooter>
        }
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-(length:--text-callout-size) font-medium">Target</legend>
            <div className="mt-2 flex flex-wrap gap-4" role="radiogroup" aria-label="Output target">
              {TARGETS.map((option) => (
                <label key={option} className="flex items-center gap-1.5 text-(length:--text-body-size)">
                  <input
                    type="radio"
                    name="format-target"
                    value={option}
                    checked={target === option}
                    disabled={exporting}
                    onChange={() => setTarget(option)}
                  />
                  {option}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-(length:--text-caption-size) text-muted-foreground" data-testid="format-target-note">
              {TARGET_COPY[target].note}
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-(length:--text-callout-size) font-medium">Typography</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="flex flex-col gap-1 text-(length:--text-body-size)">
                {FORMAT_LABELS.bodyFont}
                <NativeSelect
                  className="w-full"
                  value={draft.bodyFont}
                  onChange={(event) => change({ bodyFont: event.target.value as ManuscriptSettings["bodyFont"] })}
                >
                  {(
                    ["Times New Roman", "Garamond", "Georgia", "Palatino Linotype", "Book Antiqua", "Cambria", "Calibri", "Bookman Old Style", "Century", "Courier New", "Arial", "Helvetica"] as const
                  ).map((font) => (
                    <NativeSelectOption key={font} value={font}>
                      {font}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-(length:--text-body-size)">
                {FORMAT_LABELS.bodyFontSize}
                <NativeSelect
                  className="w-full"
                  value={draft.bodyFontSize}
                  onChange={(event) =>
                    change({ bodyFontSize: Number(event.target.value) as ManuscriptSettings["bodyFontSize"] })
                  }
                >
                  {[10, 11, 12, 13, 14].map((size) => (
                    <NativeSelectOption key={size} value={size}>
                      {size} pt
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-(length:--text-body-size)">
                {FORMAT_LABELS.firstLineIndent}
                <NativeSelect
                  className="w-full"
                  value={draft.firstLineIndent}
                  onChange={(event) =>
                    change({ firstLineIndent: Number(event.target.value) as ManuscriptSettings["firstLineIndent"] })
                  }
                >
                  {[0, 0.1, 0.2, 0.3, 0.5].map((indent) => (
                    <NativeSelectOption key={indent} value={indent}>
                      {indent === 0 ? "None" : `${indent} in`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-(length:--text-body-size)">
                {FORMAT_LABELS.lineSpacing}
                <NativeSelect
                  className="w-full"
                  value={draft.lineSpacing}
                  onChange={(event) => change({ lineSpacing: event.target.value as ManuscriptSettings["lineSpacing"] })}
                >
                  {(["Single", "1.15", "1.5", "Double"] as const).map((spacing) => (
                    <NativeSelectOption key={spacing} value={spacing}>
                      {spacing}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-4" role="radiogroup" aria-label={FORMAT_LABELS.chapterTitleAlignment}>
              {(["Left", "Center"] as const).map((alignment) => (
                <label key={alignment} className="flex items-center gap-1.5 text-(length:--text-body-size)">
                  <input
                    type="radio"
                    name="format-title-alignment"
                    value={alignment}
                    checked={draft.chapterTitleAlignment === alignment}
                    onChange={() => change({ chapterTitleAlignment: alignment })}
                  />
                  {alignment}
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-1.5 text-(length:--text-body-size)">
                <input
                  type="checkbox"
                  checked={draft.includeTableOfContents}
                  onChange={(event) => change({ includeTableOfContents: event.target.checked })}
                />
                {FORMAT_LABELS.includeTableOfContents}
              </label>
              <label className="flex items-center gap-1.5 text-(length:--text-body-size)">
                <input
                  type="checkbox"
                  checked={draft.preserveLineBreaks}
                  onChange={(event) => change({ preserveLineBreaks: event.target.checked })}
                />
                {FORMAT_LABELS.preserveLineBreaks}
              </label>
            </div>
          </fieldset>

          <section aria-label="Preview">
            <div className="rounded-[var(--corner-lg)] border border-border p-4" data-testid="format-disclosure">
              <p className="text-(length:--text-callout-size) font-medium">Approximate preview</p>
              <p className="mt-1 text-(length:--text-subheadline-size) text-muted-foreground">
                Final output may differ in your word processor, PDF reader or e-reader. Nothing here measures
                pages, breaks, counts or trim, and nothing claims Kindle or publisher acceptance.
              </p>
            </div>
            <article
              className="mt-3 rounded-[var(--corner-lg)] bg-[var(--manuscript-bg)] px-5 py-6"
              data-testid="format-preview"
              style={{
                fontFamily: `'${draft.bodyFont}', ${FONT_FALLBACK[draft.bodyFont] ?? "serif"}`,
                fontSize: `${draft.bodyFontSize}pt`,
                lineHeight: LINE_HEIGHT[draft.lineSpacing]
              }}
            >
              {draft.includeTableOfContents ? (
                <>
                  <h3 style={{ textAlign: draft.chapterTitleAlignment === "Center" ? "center" : "left" }}>
                    Contents
                  </h3>
                  <ul>
                    {chapters.map((chapter) => (
                      <li key={chapter.id}>{chapter.title}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {chapters.map((chapter) => (
                <section key={chapter.id}>
                  <h2 style={{ textAlign: draft.chapterTitleAlignment === "Center" ? "center" : "left" }}>
                    {chapter.title}
                  </h2>
                  {chapter.content.split("\n").map((line, index) => (
                    <p
                      // biome-ignore lint/suspicious/noArrayIndexKey: body lines have no stable identity; the chapter id scopes the index
                      key={`${chapter.id}-${index}`}
                      style={{
                        textIndent: draft.firstLineIndent === 0 ? undefined : `${draft.firstLineIndent}in`,
                        whiteSpace: draft.preserveLineBreaks ? "pre-wrap" : "normal"
                      }}
                    >
                      {line === "" ? "\u00a0" : line}
                    </p>
                  ))}
                </section>
              ))}
            </article>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
