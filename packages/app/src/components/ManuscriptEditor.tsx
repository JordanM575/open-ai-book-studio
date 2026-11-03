import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";
import type { ImageRecord } from "@ai-book-studio/core/images/schema";
import { pushHistory, redoHistory, undoHistory } from "../lib/editor-history";
import { countWords, formatCount, formatWords, pluralize, savedTime } from "../lib/utils";
import { insertTranscript as insertAtSelection } from "../lib/voice-text";
import { normalizePasteText } from "@ai-book-studio/core/paste";
import { VoiceButton } from "./VoiceButton";

export type SaveStatus =
  | { kind: "saved"; at: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "conflict"; conflict: ChapterConflict }
  | { kind: "error"; message: string };

export interface EditorHandle {
  /** Flush pending chapter text and report whether the saved source is confirmed. */
  flush: () => Promise<SaveStatus>;
  /** The live buffer status, without waiting for the mirrored React state to land. */
  getStatus: () => SaveStatus;
}

export interface EditorSelection {
  start: number;
  end: number;
  /** Changes every time a new span is requested, even for the same offsets. */
  nonce: number;
}

interface Props {
  bookId: string;
  chapter: Chapter;
  ordinal: number;
  onSaved: (chapter: Chapter) => void;
  onStatus: (status: SaveStatus) => void;
  /** The chapter illustration, served from the book folder. */
  illustration?: ImageRecord | null;
  illustrationData?: string | null;
  /** An evidence span to highlight, for example from a manuscript review finding. */
  selection?: EditorSelection | null;
}

interface Base {
  version: number;
  hash: string;
  content: string;
  title: string;
}

export const ManuscriptEditor = forwardRef<EditorHandle, Props>(function ManuscriptEditor(
  { bookId, chapter, ordinal, onSaved, onStatus, illustration, illustrationData, selection },
  ref
) {
  const [content, setContent] = useState(chapter.content);
  const [title, setTitle] = useState(chapter.title);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: Date.now() });
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const statusRef = useRef(status);

  const base = useRef<Base>({ version: chapter.version, hash: chapter.hash, content: chapter.content, title: chapter.title });
  const latest = useRef(content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  const updateStatus = useCallback((next: SaveStatus): SaveStatus => {
    statusRef.current = next;
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  const selectionNonce = selection?.nonce;
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionNonce is the change token; selection is a prop whose identity may change without new content, and following it would steal focus on every render
  useEffect(() => {
    if (!selection || selectionNonce === undefined) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(selection.start, selection.end);
    element.scrollIntoView({ block: "center" });
  }, [selectionNonce]);

  const save = useCallback(
    async (text: string): Promise<SaveStatus> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (text === base.current.content) return statusRef.current;

      updateStatus({ kind: "saving" });
      try {
        const result = await window.studio.chapters.save({
          bookId,
          chapterId: chapter.id,
          content: text,
          baseVersion: base.current.version,
          baseHash: base.current.hash
        });

        if (!result.ok) {
          return updateStatus({ kind: "error", message: result.error.message });
        }
        if (result.data.status === "conflict") {
          return updateStatus({ kind: "conflict", conflict: result.data.conflict });
        }

        const saved = result.data.chapter;
        base.current = { version: saved.version, hash: saved.hash, content: saved.content, title: saved.title };
        onSaved(saved);
        void window.studio.drafts.clear(bookId, chapter.id);
        return updateStatus({ kind: "saved", at: Date.now() });
      } catch (error) {
        return updateStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [bookId, chapter.id, onSaved, updateStatus]
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  useImperativeHandle(ref, () => ({ flush: () => saveRef.current(latest.current), getStatus: () => statusRef.current }), []);

  // Last line of defence: leaving the chapter must not drop the last keystrokes. The main process
  // also holds a draft copy and flushes it before the window closes.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // A draft write after unmount would hit a torn-down bridge in checks and serves no author:
      // dirty text is saved above and the main process holds its own draft copy.
      if (draftTimer.current) clearTimeout(draftTimer.current);
      if (latest.current !== base.current.content) void saveRef.current(latest.current);
    };
  }, []);

  const applyText = (next: string): void => {
    setContent(next);
    latest.current = next;
    updateStatus({ kind: "dirty" });

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

  /**
   * Insert a transcript where the author left the caret. Spacing is added only when the surrounding
   * text needs it; the insert then takes the normal applyText -> draft -> save path.
   */
  const insertTranscript = (text: string): void => {
    const element = textarea.current;
    const start = element?.selectionStart ?? latest.current.length;
    const end = element?.selectionEnd ?? start;
    const current = latest.current;
    const insertion = insertAtSelection(current, text, start, end);
    if (!insertion) return;
    setVoiceError(null);
    pushHistory(chapter.id, current, Date.now(), true);
    applyText(insertion.text);
    requestAnimationFrame(() => {
      const next = textarea.current;
      if (!next) return;
      next.focus();
      next.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  /**
   * Paste through the studio normaliser: line endings, spacing and quotation marks are unified
   * before the text lands, while single breaks, stanza breaks and hard breaks pass through so
   * verse survives. The insert takes the normal applyText -> draft -> save path, and the caret
   * lands after the inserted text.
   */
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = event.clipboardData?.getData("text");
    if (!pasted) return;
    event.preventDefault();
    const element = textarea.current;
    const start = element?.selectionStart ?? latest.current.length;
    const end = element?.selectionEnd ?? start;
    const current = latest.current;
    const inserted = normalizePasteText(pasted);
    pushHistory(chapter.id, current, Date.now(), true);
    applyText(`${current.slice(0, start)}${inserted}${current.slice(end)}`);
    requestAnimationFrame(() => {
      const next = textarea.current;
      if (!next) return;
      next.focus();
      const caret = start + inserted.length;
      next.setSelectionRange(caret, caret);
    });
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
        updateStatus({ kind: "error", message: result.error.message });
        return;
      }
      if (result.data.status === "conflict") {
        updateStatus({ kind: "conflict", conflict: result.data.conflict });
        return;
      }
      const saved = result.data.chapter;
      base.current = { version: saved.version, hash: saved.hash, content: saved.content, title: saved.title };
      onSaved(saved);
      updateStatus({ kind: "saved", at: Date.now() });
    } catch (error) {
      updateStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const words = countWords(content);
  const lines = content.split("\n").filter((line) => line.trim().length > 0).length;

  return (
    <div className="mx-auto w-full max-w-[760px]" data-testid="manuscript-editor">
      <div className="rounded-[var(--corner-xl)] bg-[var(--manuscript-bg)] px-5 pt-8 pb-16 shadow-[var(--elevation-2)] min-[700px]:px-10 min-[700px]:pt-12 min-[700px]:pb-24 lg:px-14">
        <div className="tabular mb-4 flex flex-wrap items-center gap-2 whitespace-nowrap text-[var(--text-caption-size)] text-muted-foreground">
          <span>{chapter.isPrologue ? "Prologue" : `Chapter ${ordinal}`}</span>
          <span className="opacity-50">·</span>
          <span>{formatWords(words)}</span>
          <span className="opacity-50">·</span>
          <span>
            {formatCount(lines)} {pluralize(lines, "line")}
          </span>
          <span className="ml-auto">
            <VoiceButton
              onText={insertTranscript}
              onError={(error) => setVoiceError(error.message)}
            />
          </span>
        </div>
        {voiceError ? (
          <p role="alert" className="mb-3 text-[var(--text-caption-size)] leading-[var(--text-caption-leading)] text-destructive">
            {voiceError}
          </p>
        ) : null}

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
          ref={textarea}
          value={content}
          data-testid="manuscript-text"
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
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

        {illustration && illustrationData ? (
          <figure className="mt-10 border-t border-[var(--border)] pt-6" data-testid="chapter-illustration">
            <img
              src={illustrationData}
              alt={illustration.prompt || `Illustration for ${chapter.title}`}
              className="w-full rounded-[var(--corner-lg)] bg-[var(--secondary)] object-contain"
            />
            <figcaption className="mt-2 text-[var(--text-caption-size)] text-muted-foreground">
              {illustration.prompt || "Chapter illustration"} · {illustration.model}
            </figcaption>
          </figure>
        ) : null}
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
