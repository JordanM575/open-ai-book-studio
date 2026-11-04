import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import type { Chapter, ReorderDirection } from "@ai-book-studio/core/schema";
import { cn, formatCount } from "../lib/utils";
import { Button } from "@ai-book-studio/ui/button";

interface Props {
  chapters: Chapter[];
  selectedId: string | null;
  busy?: boolean;
  onSelect: (chapterId: string) => void | Promise<void>;
  onAdd: () => void | Promise<void>;
  onMove: (chapter: Chapter, direction: ReorderDirection) => void | Promise<void>;
  onMoveTo: (chapter: Chapter, targetIndex: number) => void | Promise<void>;
  onDelete: (chapter: Chapter) => void;
  className?: string;
  onClose?: () => void;
}

export function ChapterRail({
  chapters,
  selectedId,
  busy = false,
  onSelect,
  onAdd,
  onMove,
  onMoveTo,
  onDelete,
  className,
  onClose
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  return (
    <aside className={cn("glass flex w-[248px] shrink-0 flex-col rounded-[var(--corner-xl)]", className)} data-testid="chapter-rail">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-(length:--text-caption-size) font-medium tracking-[0.2px] text-muted-foreground">Chapters</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => void onAdd()} aria-label="Add chapter" title="Add chapter">
            <Plus size={15} />
          </Button>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close chapters" title="Close chapters">
              <X size={15} />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-3">
        {chapters.length === 0 ? (
          <p className="px-2 py-3 text-(length:--text-caption-size) leading-[var(--text-caption-leading)] text-muted-foreground">
            No chapters yet. Add the first one to begin.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chapters.map((chapter, index) => {
              const selected = chapter.id === selectedId;
              return (
                <li
                  key={chapter.id}
                  draggable={!busy && chapters.length > 1}
                  data-testid="chapter-item"
                  onDragStart={(event) => {
                    setDraggingId(chapter.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", chapter.id);
                  }}
                  onDragOver={(event) => {
                    if (draggingId === chapter.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropIndex(index);
                  }}
                  onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("text/plain") || draggingId;
                    setDraggingId(null);
                    setDropIndex(null);
                    if (!id || id === chapter.id) return;
                    const source = chapters.find((item) => item.id === id);
                    if (source) void onMoveTo(source, index);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropIndex(null);
                  }}
                  className={cn(
                    "chapter-rail-item group relative",
                    draggingId === chapter.id && "opacity-50",
                    dropIndex === index && "ring-2 ring-[var(--accent)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void onSelect(chapter.id)}
                    aria-current={selected ? "page" : undefined}
                    data-testid="chapter-row"
                    data-chapter-id={chapter.id}
                    className={cn(
                      "chapter-rail-row flex w-full items-start gap-2.5 rounded-[var(--corner-md)] px-2 py-2 text-left transition-colors duration-[var(--duration-fast)]",
                      selected ? "bg-[var(--rail-item-selected)]" : "hover:bg-[var(--accent)]"
                    )}
                  >
                    <span className="tabular mt-[3px] w-4 shrink-0 text-(length:--text-caption-size) text-muted-foreground">
                      {chapter.isPrologue ? "P" : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-(length:--text-callout-size) leading-[var(--text-callout-leading)] font-medium">
                        {chapter.title || "Untitled chapter"}
                      </span>
                      <span className="tabular mt-0.5 block text-(length:--text-caption-size) text-muted-foreground">
                        {formatCount(chapter.wordCount)} {chapter.wordCount === 1 ? "word" : "words"}
                      </span>
                    </span>
                  </button>
                  <div className="chapter-actions absolute top-1.5 right-1 flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${chapter.title || "chapter"} up`}
                      aria-keyshortcuts="Meta+Alt+ArrowUp Control+Alt+ArrowUp"
                      title="Move up"
                      data-testid="move-chapter-up"
                      disabled={busy || index === 0}
                      onClick={() => void onMove(chapter, "up")}
                    >
                      <ChevronUp size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${chapter.title || "chapter"} down`}
                      aria-keyshortcuts="Meta+Alt+ArrowDown Control+Alt+ArrowDown"
                      title="Move down"
                      data-testid="move-chapter-down"
                      disabled={busy || index === chapters.length - 1}
                      onClick={() => void onMove(chapter, "down")}
                    >
                      <ChevronDown size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${chapter.title || "chapter"}`}
                      title="Delete chapter"
                      data-testid="delete-chapter"
                      onClick={() => onDelete(chapter)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
