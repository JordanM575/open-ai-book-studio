import { useState } from "react";
import type { RecoveredDraft } from "@ai-book-studio/core/ipc";
import type { Chapter } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { formatWords } from "../lib/utils";

interface Props {
  entries: RecoveredDraft[];
  chapters: Chapter[];
  busy: boolean;
  onRestore: (entry: RecoveredDraft) => void;
  onDiscard: (entry: RecoveredDraft) => void;
}

const keptTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function chapterName(entry: RecoveredDraft, chapters: Chapter[]): string {
  const chapter = chapters.find((candidate) => candidate.id === entry.chapterId);
  if (!chapter) return "A chapter that is no longer in this book";
  return chapter.title.trim() || "Untitled chapter";
}

/**
 * The words a close or quit could not save to this book, offered when the book opens. Restoring goes
 * through the usual checked save, and discarding asks first: the kept copy is the only one.
 */
export function RecoveryPanel({ entries, chapters, busy, onRestore, onDiscard }: Props) {
  const [pending, setPending] = useState<RecoveredDraft | null>(null);
  if (entries.length === 0) return null;

  return (
    <div className="glass mb-4 rounded-[var(--corner-lg)] p-4" data-testid="recovery-offer">
      <p className="text-(length:--text-callout-size) font-semibold">Words the studio could not save</p>
      <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
        These words could not be saved to your library when you closed the studio or its window, or tried to, so the
        studio kept them on this computer. Restoring saves them the usual way: if the chapter was saved since, they are
        kept as a separate copy instead of replacing it.
      </p>
      <ul className="mt-3 grid gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2"
            data-testid="recovered-draft"
          >
            <div className="min-w-0">
              <p className="truncate text-(length:--text-subheadline-size) font-medium">{chapterName(entry, chapters)}</p>
              <p className="tabular text-(length:--text-caption-size) text-muted-foreground">
                {formatWords(entry.wordCount)} · kept {keptTime.format(Date.parse(entry.keptAt))}
              </p>
              <p className="mt-0.5 truncate text-(length:--text-caption-size) text-muted-foreground" title={entry.ending}>
                {entry.ending}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => onRestore(entry)} data-testid="recovery-restore">
                Restore words
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPending(entry)} data-testid="recovery-discard">
                Discard words
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
        <DialogContent
          title="Discard these words?"
          description="This is the only copy of these words the studio kept. Discarding cannot be undone."
        >
          <p className="rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-(length:--text-subheadline-size)">
            {pending ? chapterName(pending, chapters) : ""}
            <span className="tabular text-muted-foreground"> · {formatWords(pending?.wordCount ?? 0)}</span>
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep words
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              data-testid="recovery-discard-confirm"
              onClick={() => {
                if (pending) onDiscard(pending);
                setPending(null);
              }}
            >
              Discard words
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
