import { useEffect, useState } from "react";
import type { Chapter, ManuscriptSettings } from "@ai-book-studio/core/schema";
import { Dialog, DialogContent } from "@ai-book-studio/ui/dialog";

/**
 * The Format journey (spec 035 T002). A local approximate preview bound to
 * `settings.manuscript` as the single canonical source: every control reads
 * and writes the saved settings, nothing duplicates them, and the preview
 * never calls a provider or writes chapters. PDF, EPUB and Markdown stay
 * visibly unavailable; DOCX exports from the existing Export button.
 */
export type FormatTarget = "DOCX" | "PDF" | "EPUB" | "Markdown";

const UNAVAILABLE_TARGETS: FormatTarget[] = ["PDF", "EPUB", "Markdown"];

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
  bookTitle: string;
  /** Last saved settings. The dialog reverts to these when a write fails. */
  settings: ManuscriptSettings;
  /** Saved chapter text. The dialog never edits or writes chapters. */
  chapters: Chapter[];
  /** Persists one manuscript patch; rejects when the write fails. */
  onSaveSettings: (next: ManuscriptSettings) => Promise<void>;
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

export function FormatDialog({ open, onClose, bookTitle, settings, chapters, onSaveSettings }: FormatDialogProps) {
  const [target, setTarget] = useState<FormatTarget>("DOCX");
  const [draft, setDraft] = useState<ManuscriptSettings>(settings);

  // The dialog content unmounts on close, so the target resets to DOCX on
  // every open; only the draft follows saved settings while open.
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const change = (patch: Partial<ManuscriptSettings>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void onSaveSettings(next).catch(() => setDraft(settings));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Format"
        description={`Typography and preview for ${bookTitle}. Exporting stays on the Export button.`}
        className="w-[720px]"
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-[var(--text-callout-size)] font-medium">Target</legend>
            <div className="mt-2 flex flex-wrap gap-4" role="radiogroup" aria-label="Output target">
              {(["DOCX", ...UNAVAILABLE_TARGETS] as FormatTarget[]).map((option) => {
                const unavailable = option !== "DOCX";
                return (
                  <label
                    key={option}
                    className={`flex items-center gap-1.5 text-[var(--text-body-size)] ${unavailable ? "text-muted-foreground" : ""}`}
                  >
                    <input
                      type="radio"
                      name="format-target"
                      value={option}
                      checked={target === option}
                      disabled={unavailable}
                      onChange={() => setTarget(option)}
                    />
                    {option}
                    {unavailable ? <span className="text-[var(--text-caption-size)]">Planned</span> : null}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-[var(--text-caption-size)] text-muted-foreground">
              Only DOCX can be exported today. Choosing a target changes the preview, not the Export button.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-[var(--text-callout-size)] font-medium">Typography</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="flex flex-col gap-1 text-[var(--text-body-size)]">
                {FORMAT_LABELS.bodyFont}
                <select
                  value={draft.bodyFont}
                  onChange={(event) => change({ bodyFont: event.target.value as ManuscriptSettings["bodyFont"] })}
                >
                  {(
                    ["Times New Roman", "Garamond", "Georgia", "Palatino Linotype", "Book Antiqua", "Cambria", "Calibri", "Bookman Old Style", "Century", "Courier New", "Arial", "Helvetica"] as const
                  ).map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[var(--text-body-size)]">
                {FORMAT_LABELS.bodyFontSize}
                <select
                  value={draft.bodyFontSize}
                  onChange={(event) =>
                    change({ bodyFontSize: Number(event.target.value) as ManuscriptSettings["bodyFontSize"] })
                  }
                >
                  {[10, 11, 12, 13, 14].map((size) => (
                    <option key={size} value={size}>
                      {size} pt
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[var(--text-body-size)]">
                {FORMAT_LABELS.firstLineIndent}
                <select
                  value={draft.firstLineIndent}
                  onChange={(event) =>
                    change({ firstLineIndent: Number(event.target.value) as ManuscriptSettings["firstLineIndent"] })
                  }
                >
                  {[0, 0.1, 0.2, 0.3, 0.5].map((indent) => (
                    <option key={indent} value={indent}>
                      {indent === 0 ? "None" : `${indent} in`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[var(--text-body-size)]">
                {FORMAT_LABELS.lineSpacing}
                <select
                  value={draft.lineSpacing}
                  onChange={(event) => change({ lineSpacing: event.target.value as ManuscriptSettings["lineSpacing"] })}
                >
                  {(["Single", "1.15", "1.5", "Double"] as const).map((spacing) => (
                    <option key={spacing} value={spacing}>
                      {spacing}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-4" role="radiogroup" aria-label={FORMAT_LABELS.chapterTitleAlignment}>
              {(["Left", "Center"] as const).map((alignment) => (
                <label key={alignment} className="flex items-center gap-1.5 text-[var(--text-body-size)]">
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
              <label className="flex items-center gap-1.5 text-[var(--text-body-size)]">
                <input
                  type="checkbox"
                  checked={draft.includeTableOfContents}
                  onChange={(event) => change({ includeTableOfContents: event.target.checked })}
                />
                {FORMAT_LABELS.includeTableOfContents}
              </label>
              <label className="flex items-center gap-1.5 text-[var(--text-body-size)]">
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
              <p className="text-[var(--text-callout-size)] font-medium">Approximate preview</p>
              <p className="mt-1 text-[var(--text-subheadline-size)] text-muted-foreground">
                Final output may differ in your word processor. Nothing here measures pages, breaks, counts or
                trim.
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
