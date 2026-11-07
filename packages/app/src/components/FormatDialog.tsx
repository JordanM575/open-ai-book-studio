import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Trash2 } from "lucide-react";
import type { Result } from "@ai-book-studio/core/ipc";
import {
  MATTER_KINDS,
  MATTER_LIMITS,
  MATTER_STYLE,
  NO_MATTER,
  convertLegacyMatter,
  isEmptyMatter,
  kindLabel,
  kindPosition,
  matterHash,
  matterPlan,
  matterTemplate,
  newMatterSection,
  orderSections,
  pendingLegacyMatter,
  readMatter,
  sectionName,
  type BookMatter,
  type LegacyEntry,
  type MatterKind,
  type MatterSection
} from "@ai-book-studio/core/matter";
import type { BookMeta, Chapter, ManuscriptSettings } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@ai-book-studio/ui/components/native-select";
import { Textarea } from "@ai-book-studio/ui/components/textarea";
import { exportBlockedMessage } from "../lib/export-save";
import { must } from "../lib/utils";
import type { SaveStatus } from "./ManuscriptEditor";

/**
 * The Format journey (spec 035). A local approximate preview bound to
 * `settings.manuscript` as the single canonical source: every control reads
 * and writes the saved settings, nothing duplicates them, and the preview
 * never calls a provider or writes chapters. Export saves the open chapter,
 * then writes the chosen target through the main process (D-108); the
 * workspace header keeps its own Word and Markdown buttons. The front and
 * back matter (D-169) is edited here and saves itself shortly after each
 * change, with the version and hash of the matter it started from.
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

const SIDES = { front: "Front matter", back: "Back matter" } as const;
// The studio's own field, as in the Story Bible: packages/ui has no shadcn Input yet.
const FIELD =
  "h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]";
const LABEL = "flex flex-col gap-1 text-(length:--text-body-size)";
const CHOICE = "flex items-center gap-1.5 text-(length:--text-body-size)";
const LEGEND = "text-(length:--text-callout-size) font-medium";
const SMALL = "text-(length:--text-subheadline-size)";
const ALERT = `${SMALL} text-[var(--destructive-text)]`;
const BOX = "space-y-2 rounded-[var(--corner-lg)] border border-border p-3";

const newId = (): string => `mat_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Where an entry of the older record goes when the author adds it. */
function destination({ target }: LegacyEntry): string {
  if (target === "author" || target === "subtitle") return `title page ${target}`;
  return target ? `${kindLabel(target)}, ${kindPosition(target)} matter` : "not placed; copy it in by hand";
}

interface FormatDialogProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  /** The saved book, for its matter, its older front matter record and its description. */
  book: BookMeta;
  /** The book after a matter save, with the matter that is now on disk. */
  onBookSaved: (book: BookMeta) => void;
  /** Says why a save made after the dialog closed did not land. */
  onNotice: (error: unknown) => void;
  /** Last saved settings. The dialog reverts to these when a write fails. */
  settings: ManuscriptSettings;
  /** Saved chapter text. The dialog never edits or writes chapters. */
  chapters: Chapter[];
  /** Persists one manuscript patch; rejects when the write fails. */
  onSaveSettings: (patch: Partial<ManuscriptSettings>) => Promise<void>;
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
  book,
  onBookSaved,
  onNotice,
  settings,
  chapters,
  onSaveSettings,
  onFlush
}: FormatDialogProps) {
  const [target, setTarget] = useState<FormatTarget>("DOCX");
  const [draft, setDraft] = useState<ManuscriptSettings>(settings);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<ExportNote | null>(null);
  const [matter, setMatter] = useState<BookMatter | null>(() => readMatter(book).matter);
  const [kind, setKind] = useState<MatterKind>("copyright");
  const [removing, setRemoving] = useState<string | null>(null);
  const [matterError, setMatterError] = useState<string | null>(null);
  // The matter as saved (the base of the next save), the latest edit (ahead of the render that
  // shows it, so two quick changes both land), the change waiting to be saved, and the save chain.
  const savedMatter = useRef<BookMatter | null>(matter);
  const latest = useRef<BookMatter | null>(matter);
  // Whether a save has gone out, so emptying the matter again is saved too.
  const sent = useRef(false);
  // Where the author's version went after the last conflict.
  const copy = useRef<string | null>(null);
  const pending = useRef<BookMatter | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const focusAfter = useRef<string | null>(null);
  const isOpen = useRef(open);
  isOpen.current = open;
  // Exports write files through the main process, which the browser build does not have.
  const canExport = window.studio.platform !== "web";
  const unreadable = readMatter(book).issue;
  const current = matter ?? NO_MATTER;
  const plan = matterPlan(book, matter);
  const legacy = unreadable ? [] : pendingLegacyMatter(book.frontMatter, matter);

  // Only the draft follows saved settings while open.
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // The target and the last export's note are this visit's alone: every open starts at DOCX. The
  // matter is read from the saved book on open, and a change still waiting is saved on close.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger; following the book while open would drop the author's unsaved typing
  useEffect(() => {
    if (!open) {
      setTarget("DOCX");
      setNote(null);
      void persist();
      return;
    }
    setRemoving(null);
    // After any save still running from the last visit, the newer of the book's matter and the
    // matter that save wrote; an unsaved change, or one typed meanwhile, stays as it is.
    void saving.current.then(() => {
      if (pending.current) return;
      const fromBook = readMatter(book).matter;
      if ((fromBook?.version ?? 0) >= (savedMatter.current?.version ?? 0)) savedMatter.current = fromBook;
      show(savedMatter.current);
    });
  }, [open]);

  // Leaving the book saves a change that is still waiting, and the workspace says if that fails.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on unmount
  useEffect(
    () => () => {
      isOpen.current = false;
      void persist();
    },
    []
  );

  // A keyboard move keeps focus on the moved section's button, or its other one at an end; asking
  // to remove a section moves focus to Keep section, and keeping it returns focus to Remove.
  useEffect(() => {
    const wanted = focusAfter.current;
    focusAfter.current = null;
    if (!wanted) return;
    const button = (selector: string) => document.querySelector<HTMLElement>(`[data-move${selector}]:not([disabled])`);
    (button(`="${wanted}"`) ?? button(`^="${wanted.split(":")[0]}:"`))?.focus();
  });

  const change = (patch: Partial<ManuscriptSettings>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Only the fields this change touched are sent, so a save waiting its turn cannot carry a stale
    // value for a field the author did not change.
    void onSaveSettings(patch).catch(() => setDraft(settings));
  };

  /** Shows why the matter did not save; after the dialog has closed, the workspace says it too. */
  const fail = (message: string, savedAs: string | null = null): void => {
    copy.current = savedAs;
    setMatterError(message);
    if (!isOpen.current) onNotice(new Error(message));
  };

  /** Saves the waiting change, after any save already running. True when nothing is left unsaved. */
  const persist = (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    saving.current = saving.current.then(async () => {
      const next = pending.current;
      if (!next) return true;
      pending.current = null;
      sent.current = true;
      const base = savedMatter.current;
      try {
        const result = await must(
          window.studio.books.saveMatter({ bookId: book.id, matter: next, baseVersion: base?.version ?? 0, baseHash: await matterHash(base) })
        );
        savedMatter.current = readMatter(result.book).matter;
        onBookSaved(result.book);
        if (result.status === "saved") {
          setMatterError(null);
          return true;
        }
        pending.current = null;
        show(savedMatter.current);
        fail(`The front and back matter changed elsewhere. Your version is kept in ${result.savedAs}.`, result.savedAs);
      } catch (error) {
        pending.current ??= next;
        fail(error instanceof Error ? error.message : String(error));
      }
      return false;
    });
    return saving.current;
  };

  const show = (next: BookMatter | null): void => {
    latest.current = next;
    setMatter(next);
  };

  /** Applies a change to the latest matter and saves it shortly after the author stops. */
  const edit = (change: (from: BookMatter) => BookMatter): void => {
    const next = change(latest.current ?? NO_MATTER);
    show(next);
    setRemoving(null);
    if (timer.current) clearTimeout(timer.current);
    // A book without matter gets none until something in it would change an export.
    pending.current = !savedMatter.current && !sent.current && isEmptyMatter(next) ? null : next;
    if (pending.current) timer.current = setTimeout(() => void persist(), 500);
  };

  const update = (id: string, patch: Partial<MatterSection>): void =>
    edit((from) => ({ ...from, sections: from.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)) }));

  /**
   * Swaps a section with its neighbour on the same side. At the edge of a side it crosses the
   * chapters instead: the last front section moves down to the top of the back matter.
   */
  const move = (id: string, step: -1 | 1): void => {
    focusAfter.current = `${id}:${step < 0 ? "up" : "down"}`;
    edit((matter) => {
      const sections = orderSections(matter.sections);
      const from = sections.findIndex((section) => section.id === id);
      const [a, b] = [sections[from], sections[from + step]];
      if (a && b?.position === a.position) [sections[from], sections[from + step]] = [b, a];
      else if (a) sections[from] = { ...a, position: step < 0 ? "front" : "back" };
      return { ...matter, sections };
    });
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
        setNote({ kind: "error", message: exportBlockedMessage(saved) });
        return;
      }
      if (!(await persist())) {
        setNote({ kind: "error", message: "The front and back matter could not be saved, so nothing was exported." });
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

  const field = (label: string, value: string, max: number, onChange: (value: string) => void) => (
    <label className={`${LABEL} min-w-40 flex-1`}>
      {label}
      <input className={FIELD} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false, moves?: string) => (
    <Button variant="ghost" size="icon-sm" aria-label={label} data-move={moves} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  );
  const align = draft.chapterTitleAlignment === "Center" ? "center" : "left";
  /** A chapter or a section as the exports set it: its heading, then a paragraph per line. */
  const page = (id: string, title: string, text: string, style?: "centered" | "plain") => (
    <section key={id}>
      {title.trim() ? <h2 style={{ textAlign: style === "centered" ? "center" : align }}>{title}</h2> : null}
      {text.split("\n").map((line, index) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: body lines have no stable identity; the chapter or section id scopes the index
          key={`${id}-${index}`}
          style={{
            textIndent: style || draft.firstLineIndent === 0 ? undefined : `${draft.firstLineIndent}in`,
            whiteSpace: draft.preserveLineBreaks ? "pre-wrap" : "normal",
            textAlign: style === "centered" ? "center" : undefined
          }}
        >
          {line === "" ? "\u00a0" : line}
        </p>
      ))}
    </section>
  );
  const section = (item: MatterSection) => page(item.id, item.title, item.text, MATTER_STYLE[item.kind]);

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
            <legend className={LEGEND}>Target</legend>
            <div className="mt-2 flex flex-wrap gap-4" role="radiogroup" aria-label="Output target">
              {TARGETS.map((option) => (
                <label key={option} className={CHOICE}>
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
            <legend className={LEGEND}>Typography</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
              <label className={LABEL}>
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
              <label className={LABEL}>
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
              <label className={LABEL}>
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
              <label className={LABEL}>
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
                <label key={alignment} className={CHOICE}>
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
              <label className={CHOICE}>
                <input
                  type="checkbox"
                  checked={draft.includeTableOfContents}
                  onChange={(event) => change({ includeTableOfContents: event.target.checked })}
                />
                {FORMAT_LABELS.includeTableOfContents}
              </label>
              <label className={CHOICE}>
                <input
                  type="checkbox"
                  checked={draft.preserveLineBreaks}
                  onChange={(event) => change({ preserveLineBreaks: event.target.checked })}
                />
                {FORMAT_LABELS.preserveLineBreaks}
              </label>
            </div>
          </fieldset>

          <fieldset data-testid="format-matter">
            <legend className={LEGEND}>Front and back matter</legend>
            {unreadable ? null : (
              <div className="mt-2 space-y-4">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <label className={`h-9 ${CHOICE}`}>
                    <input
                      type="checkbox"
                      checked={current.titlePage}
                      onChange={(event) => edit((from) => ({ ...from, titlePage: event.target.checked }))}
                    />
                    Title page
                  </label>
                  {field("Author", current.author, MATTER_LIMITS.name, (author) => edit((from) => ({ ...from, author })))}
                  {field("Subtitle", current.subtitle, MATTER_LIMITS.name, (subtitle) => edit((from) => ({ ...from, subtitle })))}
                </div>
                {(["front", "back"] as const).map((side) => {
                  const list = current.sections.filter((section) => section.position === side);
                  return list.length > 0 ? (
                    <section key={side} aria-label={SIDES[side]}>
                      <h3 className={`${SMALL} font-medium`}>{SIDES[side]}</h3>
                      <ol className="mt-2 space-y-3">
                        {list.map((section, index) => {
                          const name = sectionName(section);
                          return (
                            <li key={section.id} className={BOX} data-testid="matter-section">
                              <div className="flex items-center gap-1">
                                <span className="flex-1 font-medium">{kindLabel(section.kind)}</span>
                                {iconButton(`Move ${name} up`, <ChevronUp size={13} />, () => move(section.id, -1), side === "front" && index === 0, `${section.id}:up`)}
                                {iconButton(
                                  `Move ${name} down`,
                                  <ChevronDown size={13} />,
                                  () => move(section.id, 1),
                                  side === "back" && index === list.length - 1,
                                  `${section.id}:down`
                                )}
                                {iconButton(
                                  `Remove ${name}`,
                                  <Trash2 size={13} />,
                                  () => {
                                    focusAfter.current = `${section.id}:keep`;
                                    setRemoving(section.id);
                                  },
                                  false,
                                  `${section.id}:remove`
                                )}
                              </div>
                              {removing === section.id ? (
                                <p className={`flex flex-wrap items-center gap-2 ${SMALL}`}>
                                  Remove {name} and its text from the book?
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => edit((from) => ({ ...from, sections: from.sections.filter((item) => item.id !== section.id) }))}
                                  >
                                    Remove section
                                  </Button>
                                  <Button
                                    size="sm"
                                    data-move={`${section.id}:keep`}
                                    onClick={() => {
                                      focusAfter.current = `${section.id}:remove`;
                                      setRemoving(null);
                                    }}
                                  >
                                    Keep section
                                  </Button>
                                </p>
                              ) : null}
                              {field("Heading", section.title, MATTER_LIMITS.title, (title) => update(section.id, { title }))}
                              <label className={LABEL} htmlFor={`${section.id}-text`}>
                                Text
                              </label>
                              <Textarea
                                id={`${section.id}-text`}
                                value={section.text}
                                rows={3}
                                maxLength={MATTER_LIMITS.text}
                                onChange={(event) => update(section.id, { text: event.target.value })}
                              />
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  ) : null;
                })}
                <div className="flex items-end gap-2">
                  <label className={LABEL}>
                    New section
                    <NativeSelect value={kind} onChange={(event) => setKind(event.target.value as MatterKind)}>
                      {MATTER_KINDS.map((option) => (
                        <NativeSelectOption key={option} value={option}>
                          {kindLabel(option)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    disabled={current.sections.length >= MATTER_LIMITS.sections}
                    onClick={() =>
                      edit((from) => ({
                        ...from,
                        sections: [...from.sections, newMatterSection(kind, newId(), matterTemplate(kind, from.author, new Date().getFullYear()))]
                      }))
                    }
                  >
                    Add section
                  </Button>
                </div>
                {legacy.length > 0 ? (
                  <div className={`${BOX} ${SMALL}`} data-testid="matter-legacy">
                    <p>Older front matter, not exported yet. The old record stays as it is.</p>
                    <ul className="list-disc pl-5">
                      {legacy.map((entry) => (
                        <li key={entry.key}>
                          {entry.key}: {destination(entry)}
                        </li>
                      ))}
                    </ul>
                    {legacy.some((entry) => entry.target) ? (
                      <Button size="sm" onClick={() => edit((from) => convertLegacyMatter(book.frontMatter, from, newId))}>
                        Add to front and back matter
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
            {matterError || unreadable ? (
              <p role="alert" data-testid="matter-error" className={`mt-2 ${ALERT}`}>
                {matterError ?? `This book's front and back matter could not be read, so exports stop until the file is corrected. ${unreadable}`}
                {matterError && copy.current ? (
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => void must(window.studio.conflicts.reveal(book.id, copy.current ?? "")).catch(onNotice)}
                  >
                    Show the saved copy
                  </Button>
                ) : null}
              </p>
            ) : null}
          </fieldset>

          <section aria-label="Preview">
            <div className="rounded-[var(--corner-lg)] border border-border p-4" data-testid="format-disclosure">
              <p className={LEGEND}>Approximate preview</p>
              <p className={`mt-1 ${SMALL} text-muted-foreground`}>
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
              {plan.titlePage ? (
                <section className="mb-6 text-center" data-testid="format-preview-title-page">
                  <h1 className="font-bold">{bookTitle.trim() || "Untitled book"}</h1>
                  {plan.subtitle ? <p className="italic">{plan.subtitle}</p> : null}
                  {plan.author ? <p className="mt-4">{plan.author}</p> : null}
                </section>
              ) : null}
              {plan.front.map(section)}
              {draft.includeTableOfContents ? (
                <>
                  <h3 style={{ textAlign: align }}>Contents</h3>
                  <ul>
                    {chapters.map((chapter) => (
                      <li key={chapter.id}>{chapter.title}</li>
                    ))}
                    {plan.back.map((section) => (
                      <li key={section.id}>{sectionName(section)}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {chapters.map((chapter) => page(chapter.id, chapter.title, chapter.content))}
              {plan.back.map(section)}
            </article>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
