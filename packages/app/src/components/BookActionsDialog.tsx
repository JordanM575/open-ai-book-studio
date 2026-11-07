import { useEffect, useRef, useState } from "react";
import { Images, Trash2 } from "lucide-react";
import type { ImageExportNote, ImageExportResult } from "@ai-book-studio/core/ipc";
import type { BookMeta, BookSummary } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { conflictFieldsText, editBook, formatCount, keptCopyText, must } from "../lib/utils";

interface Props {
  book: BookSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (book: BookMeta) => void;
  onDeleted: (bookId: string) => void;
  onNotice: (error: unknown) => void;
}

interface ExportNote {
  message: string;
  skipped: ImageExportNote[];
}

/** What the author reads after an image export. A cancelled picker says nothing. */
function describeImageExport(result: ImageExportResult): ExportNote | null {
  switch (result.status) {
    case "cancelled":
      return null;
    case "empty":
      return { message: "This book has no images yet. Nothing was exported.", skipped: [] };
    case "unconverted":
      return { message: "None of the images could be converted to JPEG. Nothing was written.", skipped: result.skipped };
    case "saved": {
      const count = result.files.length;
      const folder = result.folder.split(/[\\/]/).pop() ?? result.folder;
      const skipped = result.skipped.length > 0 ? ` · ${formatCount(result.skipped.length)} skipped` : "";
      return {
        message: `Saved ${formatCount(count)} ${count === 1 ? "image" : "images"} to ${folder}${skipped}`,
        skipped: result.skipped
      };
    }
  }
}

export function BookActionsDialog({ book, onOpenChange, onSaved, onDeleted, onNotice }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<ExportNote | null>(null);
  // The book as the last save left it, which the next save is measured against. The library's copy of
  // the book does not change while the dialog stays open, so after a save that applied one field and
  // kept the other as a copy, changing the first back would otherwise look like no change at all.
  const [saved, setSaved] = useState<{ id: string; title: string; description?: string | undefined } | null>(null);
  // Where the author's version went after a clash with an outside edit, for the book it belongs to.
  const [copy, setCopy] = useState<{ bookId: string; savedAs: string; fields: string[] } | null>(null);
  // The book on screen, so an export that finishes after the dialog closed or moved on leaves its note out.
  const shown = useRef<string | null>(null);
  // Image export writes files through the main process, which the browser build does not have.
  const canExportImages = window.studio.platform !== "web";

  useEffect(() => {
    shown.current = book?.id ?? null;
    setSaved(book);
    if (!book) {
      setCopy(null);
      return;
    }
    setTitle(book.title);
    setDescription(book.description ?? "");
    setBusy(false);
    setConfirming(false);
    setExporting(false);
    setExportNote(null);
  }, [book]);

  const save = async (): Promise<void> => {
    if (!book || !title.trim() || busy) return;
    setBusy(true);
    try {
      const base = saved && saved.id === book.id ? saved : book;
      const result = await editBook(base, { title: title.trim(), description: description.trim() });
      setSaved(result.book);
      // A field the author left as it was follows the book the save returned, so the next save does not
      // read the old text as a deliberate change back over what another writer put there.
      if (title === base.title) setTitle(result.book.title);
      if (description === (base.description ?? "")) setDescription(result.book.description ?? "");
      onSaved(result.book);
      if (result.status === "conflict") {
        // The book now shows the other writer's values; the note says where the author's went.
        setCopy({ bookId: book.id, savedAs: result.savedAs, fields: result.fields });
        setBusy(false);
        return;
      }
      onOpenChange(false);
    } catch (error) {
      onNotice(error);
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!book || busy) return;
    setBusy(true);
    try {
      await must(window.studio.books.delete(book.id));
      onDeleted(book.id);
      onOpenChange(false);
    } catch (error) {
      onNotice(error);
      setBusy(false);
    }
  };

  const exportImages = async (): Promise<void> => {
    if (!book || busy || exporting) return;
    const bookId = book.id;
    setExporting(true);
    setExportNote(null);
    try {
      const result = await must(window.studio.books.exportImages(bookId));
      if (shown.current === bookId) setExportNote(describeImageExport(result));
    } catch (error) {
      // The studio's notice outlives the dialog, and a refusal names the folder, so it always reports.
      onNotice(error);
    } finally {
      if (shown.current === bookId) setExporting(false);
    }
  };

  return (
    <Dialog open={book !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title="Book settings"
        description={
          canExportImages
            ? "Rename this book, export its images, or move the whole folder to the library trash."
            : "Rename this book, or move the whole folder to the library trash."
        }
        footer={
          <>
            {book && copy && copy.bookId === book.id ? (
              <div role="status" data-testid="book-settings-conflict" className="mb-3 flex items-start gap-3">
                <p className="min-w-0 flex-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)]">
                  {keptCopyText(conflictFieldsText(copy.fields))}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void must(window.studio.conflicts.reveal(book.id, copy.savedAs)).catch(onNotice)}
                >
                  Show the copy
                </Button>
              </div>
            ) : null}
            <DialogFooter className="mt-0">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {copy ? "Close" : "Cancel"}
              </Button>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={!title.trim() || busy || exporting}
                data-testid="save-book-settings"
              >
                Save changes
              </Button>
            </DialogFooter>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-(length:--text-subheadline-size) font-medium">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
              className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              data-testid="book-title"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-(length:--text-subheadline-size) font-medium">
              What is it about? <span className="font-normal text-muted-foreground">Optional</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={20000}
              className="w-full resize-none rounded-[var(--corner-md)] bg-card px-3 py-2 text-(length:--text-body-size) leading-[var(--text-body-leading)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              data-testid="book-description"
            />
          </label>

          {canExportImages ? (
            <section className="rounded-[var(--corner-lg)] border border-border p-4">
              <h3 className="text-(length:--text-callout-size) font-medium">Images</h3>
              <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
                Save every picture in this book as a JPEG, in a new folder you choose. The manuscript is not
                included.
              </p>
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => void exportImages()}
                disabled={busy || exporting}
                data-testid="export-images"
              >
                <Images size={15} />
                {exporting ? "Exporting…" : "Export images"}
              </Button>
              <div
                role="status"
                data-testid="export-images-note"
                className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)]"
              >
                {exportNote ? (
                  <>
                    <p className="mt-2">{exportNote.message}</p>
                    {exportNote.skipped.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {exportNote.skipped.map((note) => (
                          <li key={note.name}>
                            <span className="font-mono text-[12px]">{note.name}</span> · {note.reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-[var(--corner-lg)] border border-border p-4">
            <h3 className="text-(length:--text-callout-size) font-medium">Delete this book</h3>
            <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              It moves to <span className="font-mono">.studio/trash/books</span> inside the library. Nothing is erased, and
              you can restore the folder from there.
            </p>
            {confirming ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => void remove()} disabled={busy || exporting} data-testid="confirm-delete-book">
                  {busy ? "Moving…" : "Delete book"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="mt-2 text-[var(--destructive-text)]"
                onClick={() => setConfirming(true)}
                disabled={exporting}
                data-testid="delete-book"
              >
                <Trash2 size={15} />
                Delete book…
              </Button>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
