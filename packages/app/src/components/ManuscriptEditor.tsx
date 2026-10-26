import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";
import { pushHistory, redoHistory, undoHistory } from "../lib/editor-history";
import { countWords, formatCount, savedTime } from "../lib/utils";

export type SaveStatus =
  | { kind: "saved"; at: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "conflict"; conflict: ChapterConflict }
  | { kind: "error"; message: string };

export interface EditorHandle {
  flush: () => Promise<void>;
}

interface Props {
  bookId: string;
  chapter: Chapter;
  ordinal: number;
  onSaved: (chapter: Chapter) => void;
  onStatus: (status: SaveStatus) => void;
}

interface Base {
  version: number;
  hash: string;
  content: string;
  title: string;
}

export const ManuscriptEditor = forwardRef<EditorHandle, Props>(function ManuscriptEditor(
  { bookId, chapter, ordinal, onSaved, onStatus },
  ref
) {
  const [content, setContent] = useState(chapter.content);
  const [title, setTitle] = useState(chapter.title);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: Date.now() });

  const base = useRef<Base>({ version: chapter.version, hash: chapter.hash, content: chapter.content, title: chapter.title });
  const latest = useRef(content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  const save = useCallback(
    async (text: string): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (text === base.current.content) return;

      setStatus({ kind: "saving" });
      try {
        const result = await window.studio.chapters.save({
          bookId,
          chapterId: chapter.id,
          content: text,
          baseVersion: base.current.version,
          baseHash: base.current.hash
        });

        if (!result.ok) {
          setStatus({ kind: "error", message: result.error.message });
          return;
        }
        if (result.data.status === "conflict") {
          setStatus({ kind: "conflict", conflict: result.data.conflict });
          return;
        }

        const saved = result.data.chapter;
        base.current = { version: saved.version, hash: saved.hash, content: saved.content, title: saved.title };
        onSaved(saved);
        void window.studio.drafts.clear(bookId, chapter.id);
        setStatus({ kind: "saved", at: Date.now() });
      } catch (error) {
        setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [bookId, chapter.id, onSaved]
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  useImperativeHandle(ref, () => ({ flush: () => saveRef.current(latest.current) }), []);

  // Last line of defence: leaving the chapter must not drop the last keystrokes. The main process
  // also holds a draft copy and flushes it before the window closes.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (latest.current !== base.current.content) void saveRef.current(latest.current);
    };
  }, []);

  const applyText = (next: string): void => {
    setContent(next);
    latest.current = next;
    setStatus({ kind: "dirty" });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveRef.current(latest.current);
    }, 700);

    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void window.studio.drafts.set({
        bookId,
        chapterId: chapter.id,
        content: latest.current,
        baseVersion: base.current.version,
        baseHash: base.current.hash
      });
    }, 300);
  };

  const onChange = (next: string): void => {
    pushHistory(chapter.id, content, Date.now(), Math.abs(next.length - content.length) > 1);
    applyText(next);
  };

  const commitTitle = async (): Promise<void> => {
    const next = title.trim();
    if (!next || next === base.current.title) {
      setTitle(base.current.title);
      return;
    }
    try {
      const result = await window.studio.chapters.updateMeta(
        bookId,
        chapter.id,
        { title: next },
        { baseVersion: base.current.version, baseHash: base.current.hash }
      );
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error.message });
        return;
      }
      if (result.data.status === "conflict") {
        setStatus({ kind: "conflict", conflict: result.data.conflict });
        return;
      }
      const saved = result.data.chapter;
      base.current = { version: saved.version, hash: saved.hash, content: saved.content, title: saved.title };
      onSaved(saved);
      setStatus({ kind: "saved", at: Date.now() });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const words = countWords(content);
  const lines = content.split("\n").filter((line) => line.trim().length > 0).length;

  return (
    <div className="mx-auto w-full max-w-[760px]" data-testid="manuscript-editor">
      <div className="rounded-[var(--corner-xl)] bg-[var(--manuscript-bg)] px-5 pt-8 pb-16 shadow-[var(--elevation-2)] min-[700px]:px-10 min-[700px]:pt-12 min-[700px]:pb-24 lg:px-14">
        <div className="tabular mb-4 flex items-center gap-2 text-[var(--text-caption-size)] text-muted-foreground">
          <span>{chapter.isPrologue ? "Prologue" : `Chapter ${ordinal}`}</span>
          <span className="opacity-50">·</span>
          <span>{formatCount(words)} words</span>
          <span className="opacity-50">·</span>
          <span>{formatCount(lines)} lines</span>
        </div>

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          maxLength={400}
          spellCheck={false}
          aria-label="Chapter title"
          placeholder="Untitled chapter"
          className="chapter-title w-full bg-transparent tracking-[-0.2px] outline-none placeholder:text-muted-foreground/60"
        />

        <textarea
          value={content}
          data-testid="manuscript-text"
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => void saveRef.current(latest.current)}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase();
            if ((event.metaKey || event.ctrlKey) && key === "s") {
              event.preventDefault();
              void saveRef.current(latest.current);
              return;
            }
            if ((event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey) {
              const previous = undoHistory(chapter.id, latest.current);
              if (previous !== null) {
                event.preventDefault();
                applyText(previous);
              }
              return;
            }
            if (
              ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey) ||
              (event.ctrlKey && key === "y")
            ) {
              const next = redoHistory(chapter.id, latest.current);
              if (next !== null) {
                event.preventDefault();
                applyText(next);
              }
            }
          }}
          spellCheck
          aria-label="Chapter text"
          placeholder="Begin wherever you like. Nothing here is read by anyone else."
          className="manuscript thin-scroll mt-8 block min-h-[52vh] w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground/60"
        />
      </div>
    </div>
  );
});

export function statusLabel(status: SaveStatus): string {
  switch (status.kind) {
    case "saved":
      return `Saved ${savedTime(status.at)}`;
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "conflict":
      return "Not saved";
    case "error":
      return "Not saved";
  }
}
