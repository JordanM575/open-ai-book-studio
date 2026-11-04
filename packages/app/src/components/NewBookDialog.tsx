import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bookId: string) => void | Promise<void>;
  onNotice: (error: unknown) => void;
}

export function NewBookDialog({ open, onOpenChange, onCreated, onNotice }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setBusy(false);
    }
  }, [open]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const book = await must(window.studio.books.create({ title: title.trim(), description: description.trim() }));
      await onCreated(book.id);
    } catch (error) {
      onNotice(error);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New book"
        description="A title and one line are enough to begin. The rest can come as you write."
      >
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-(length:--text-subheadline-size) font-medium">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="The Lighthouse Keeper's Daughter"
              maxLength={300}
              className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none placeholder:text-muted-foreground focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-(length:--text-subheadline-size) font-medium">
              What is it about? <span className="font-normal text-muted-foreground">Optional</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A keeper's daughter inherits a lighthouse, and the letters her mother never sent."
              rows={3}
              maxLength={20000}
              className="w-full resize-none rounded-[var(--corner-md)] bg-card px-3 py-2 text-(length:--text-body-size) leading-[var(--text-body-leading)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none placeholder:text-muted-foreground focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
            />
          </label>

          <p className="text-(length:--text-caption-size) leading-[var(--text-caption-leading)] text-muted-foreground">
            This creates a new folder inside your library. Nothing leaves this computer.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || busy}>
              {busy ? "Creating…" : "Create book"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
