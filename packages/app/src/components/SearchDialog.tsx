import { FormEvent, useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { SearchHit } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  open: boolean;
  bookId: string;
  onClose: () => void;
  onOpenChapter: (chapterId: string) => void;
}

export function SearchDialog({ open, bookId, onClose, onOpenChapter }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setRan(false);
    setError(null);
  }, [open]);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const needle = query.trim();
    if (!needle || searching) return;
    setSearching(true);
    setError(null);
    try {
      const found = await must(window.studio.books.search(bookId, needle));
      setHits(found);
      setRan(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The search could not run.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title="Search this book" description="Find a line and jump to its chapter." className="w-[640px]">
        <form onSubmit={(event) => void submit(event)} className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] px-3">
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A word or phrase"
              aria-label="Search this book"
              data-testid="search-input"
              className="h-9 w-full bg-transparent text-(length:--text-body-size) outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!query.trim() || searching} data-testid="search-submit">
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>

        <div className="thin-scroll mt-4 max-h-[48vh] overflow-y-auto">
          {error ? <p className="text-(length:--text-subheadline-size) text-[var(--destructive-text)]">{error}</p> : null}
          {!error && ran && hits.length === 0 ? (
            <p className="py-8 text-center text-(length:--text-subheadline-size) text-muted-foreground">
              No matches for “{query.trim()}”.
            </p>
          ) : null}
          {!error && !ran ? (
            <p className="py-8 text-center text-(length:--text-subheadline-size) text-muted-foreground">
              Search finds lines, not whole paragraphs.
            </p>
          ) : null}
          {hits.length > 0 ? (
            <>
              <p className="mb-2 text-(length:--text-caption-size) text-muted-foreground">
                {hits.length} {hits.length === 1 ? "match" : "matches"}
              </p>
              <ul className="space-y-1">
                {hits.map((hit) => (
                  <li key={`${hit.chapterId}-${hit.line}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChapter(hit.chapterId);
                        onClose();
                      }}
                      data-testid="search-result"
                      className="w-full rounded-[var(--corner-md)] px-3 py-2 text-left hover:bg-[var(--accent)]"
                    >
                      <span className="block text-(length:--text-caption-size) text-muted-foreground">
                        Chapter {hit.order} · {hit.chapterTitle} · line {hit.line}
                      </span>
                      <span className="mt-0.5 block truncate text-(length:--text-subheadline-size)">{hit.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
