import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { BookMeta, BookSummary } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  book: BookSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (book: BookMeta) => void;
  onDeleted: (bookId: string) => void;
  onNotice: (error: unknown) => void;
}

export function BookActionsDialog({ book, onOpenChange, onSaved, onDeleted, onNotice }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!book) return;
    setTitle(book.title);
    setDescription(book.description ?? "");
    setBusy(false);
    setConfirming(false);
  }, [book]);

  const save = async (): Promise<void> => {
    if (!book || !title.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await must(window.studio.books.update(book.id, { title: title.trim(), description: description.trim() }));
      onSaved(updated);
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

  return (
    <Dialog open={book !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title="Book settings"
        description="Rename this book, or move the whole folder to the library trash."
        footer={
          <DialogFooter className="mt-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!title.trim() || busy} data-testid="save-book-settings">
              Save changes
            </Button>
          </DialogFooter>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[var(--text-subheadline-size)] font-medium">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
              className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-[var(--text-body-size)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              data-testid="book-title"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[var(--text-subheadline-size)] font-medium">
              What is it about? <span className="font-normal text-muted-foreground">Optional</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={20000}
              className="w-full resize-none rounded-[var(--corner-md)] bg-card px-3 py-2 text-[var(--text-body-size)] leading-[var(--text-body-leading)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              data-testid="book-description"
            />
          </label>

          <section className="rounded-[var(--corner-lg)] border border-border p-4">
            <h3 className="text-[var(--text-callout-size)] font-medium">Delete this book</h3>
            <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
              It moves to <span className="font-mono">.studio/trash/books</span> inside the library. Nothing is erased, and
              you can restore the folder from there.
            </p>
            {confirming ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => void remove()} disabled={busy} data-testid="confirm-delete-book">
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
