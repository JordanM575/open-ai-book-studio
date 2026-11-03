import type { DraftInput } from "@ai-book-studio/core/ipc";
import type { SaveChapterResult } from "@ai-book-studio/core/schema";

/**
 * What a flush is allowed to claim.
 *
 * - `confirmed` — every held draft was committed by the storage adapter.
 * - `conflict` — the adapter left the chapter alone and preserved the author's text in a conflict
 *   copy; the text is on disk, but the chapter is not the saved one, so this is not `confirmed`.
 * - `unconfirmed` — at least one write did not finish, or a draft arrived during the flush. The
 *   held text was never confirmed saved.
 * - `empty` — there was nothing to flush.
 *
 * There is deliberately no `saved` member that can stand for a partial flush.
 */
export type DraftFlushStatus = "confirmed" | "conflict" | "unconfirmed" | "empty";

export interface DraftFlushFailure {
  bookId: string;
  chapterId: string;
  message: string;
}

export interface DraftFlushReport {
  /** When this report was produced, from the injected clock. */
  at: string;
  attempted: number;
  confirmed: number;
  conflicts: number;
  failed: number;
  /** Drafts still held after the flush: writes that failed, or text typed while it ran. */
  remaining: number;
  status: DraftFlushStatus;
  failures: DraftFlushFailure[];
}

/**
 * Writes one draft through the shared library service. It resolves to the service's
 * `SaveChapterResult`, so a flush can never invent a save status.
 */
export type SaveDraft = (draft: DraftInput) => Promise<SaveChapterResult>;

/** The browser surface uses `window`; tests pass a small stand-in. */
export interface PageHideTarget {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

const NOTHING_FLUSHED: DraftFlushStatus = "empty";

/**
 * The browser counterpart of the desktop draft buffer.
 *
 * The editor writes the newest text here after every keystroke; a confirmed save drops it. On
 * `pagehide` the buffer makes one best-effort flush and keeps an honest report, because a browser
 * may terminate the page without letting the write finish (FR-007, FR-009).
 */
export class BrowserDraftBuffer {
  private readonly drafts = new Map<string, DraftInput>();
  private report: DraftFlushReport | null = null;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  private key(bookId: string, chapterId: string): string {
    return `${bookId}:${chapterId}`;
  }

  set(input: DraftInput): void {
    this.drafts.set(this.key(input.bookId, input.chapterId), { ...input });
  }

  clear(bookId: string, chapterId: string): void {
    this.drafts.delete(this.key(bookId, chapterId));
  }

  /**
   * Drop the held draft after a confirmed save, but only when the stored text is the text that
   * was saved. Text typed while the save was in flight stays held.
   */
  confirm(bookId: string, chapterId: string, content: string): void {
    const key = this.key(bookId, chapterId);
    const held = this.drafts.get(key);
    if (!held) return;
    if (held.content === content) this.drafts.delete(key);
  }

  get(key: { bookId: string; chapterId: string }): DraftInput | null {
    return this.drafts.get(this.key(key.bookId, key.chapterId)) ?? null;
  }

  /** Chapter ids with unsent text, for the drift detector's `both-changed` check. */
  chapterIds(): string[] {
    return [...this.drafts.values()].map((draft) => draft.chapterId);
  }

  get size(): number {
    return this.drafts.size;
  }

  /** Null until a flush has run in this session. */
  get lastFlush(): DraftFlushReport | null {
    return this.report;
  }

  /** True when the last flush did not confirm every draft. Drives the "not confirmed saved" copy. */
  get needsAttention(): boolean {
    return this.report !== null && (this.report.status === "unconfirmed" || this.report.status === "conflict");
  }

  /**
   * Save every held draft once. Never reports `confirmed` unless the adapter confirmed each write
   * and nothing was left behind.
   */
  async flush(save: SaveDraft): Promise<DraftFlushReport> {
    let confirmed = 0;
    let conflicts = 0;
    let failed = 0;
    const failures: DraftFlushFailure[] = [];

    for (const [key, draft] of [...this.drafts]) {
      if (!this.drafts.has(key)) continue;
      try {
        const result = await save({ ...draft });
        if (result.status === "saved") {
          confirmed += 1;
          // Only the text that was written leaves the buffer; a newer draft stays held.
          this.confirm(draft.bookId, draft.chapterId, draft.content);
          continue;
        }
        // The service kept the chapter and wrote the author's text to a conflict copy. The text is
        // preserved, but this chapter was not saved.
        conflicts += 1;
        this.confirm(draft.bookId, draft.chapterId, draft.content);
      } catch (error) {
        failed += 1;
        failures.push({
          bookId: draft.bookId,
          chapterId: draft.chapterId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const attempted = confirmed + conflicts + failed;
    const remaining = this.drafts.size;
    this.report = {
      at: this.now(),
      attempted,
      confirmed,
      conflicts,
      failed,
      remaining,
      status: flushStatus({ attempted, conflicts, failed, remaining }),
      failures
    };
    return this.report;
  }
}

function flushStatus(counts: {
  attempted: number;
  conflicts: number;
  failed: number;
  remaining: number;
}): DraftFlushStatus {
  if (counts.attempted === 0 && counts.remaining === 0) return NOTHING_FLUSHED;
  if (counts.failed > 0) return "unconfirmed";
  if (counts.remaining > 0) return "unconfirmed";
  if (counts.conflicts > 0) return "conflict";
  return "confirmed";
}

/**
 * Flush once, when the page is going away. The browser is free to terminate before the write
 * lands, so callers must read `lastFlush` and say "not confirmed saved" rather than "saved".
 * Returns a function that removes the listener.
 */
export function flushDraftsOnHide(
  buffer: BrowserDraftBuffer,
  save: SaveDraft,
  target: PageHideTarget
): () => void {
  const listener = (): void => {
    void buffer.flush(save);
  };
  target.addEventListener("pagehide", listener);
  return () => target.removeEventListener("pagehide", listener);
}
