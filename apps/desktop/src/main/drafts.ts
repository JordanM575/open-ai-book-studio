import type { DraftInput } from "@ai-book-studio/core/ipc";
import type { Library } from "./library/store";
import { normalizeBody } from "@ai-book-studio/core/markdown";

/**
 * Keeps the newest text of an open chapter in memory so closing the window, quitting, or a crash
 * in the renderer cannot lose the last few seconds of typing. The renderer still saves on its own;
 * this is the safety net, and it is flushed before the app exits.
 */
export class DraftBuffer {
  private readonly drafts = new Map<string, DraftInput>();

  private key(bookId: string, chapterId: string): string {
    return `${bookId}:${chapterId}`;
  }

  set(input: DraftInput): void {
    this.drafts.set(this.key(input.bookId, input.chapterId), { ...input });
  }

  clear(bookId: string, chapterId: string): void {
    this.drafts.delete(this.key(bookId, chapterId));
  }

  get size(): number {
    return this.drafts.size;
  }

  /** Best effort: a conflict here preserves the draft next to the chapter instead of overwriting it. */
  async flush(library: Library): Promise<void> {
    for (const [key, draft] of [...this.drafts]) {
      try {
        const disk = await library.readChapter(draft.bookId, draft.chapterId);
        if (disk.content === normalizeBody(draft.content)) {
          this.drafts.delete(key);
          continue;
        }
        await library.saveChapter(draft.bookId, draft.chapterId, draft.content, {
          baseVersion: draft.baseVersion,
          baseHash: draft.baseHash
        });
        this.drafts.delete(key);
      } catch (error) {
        console.warn(`[drafts] Could not flush ${key}:`, (error as Error).message);
      }
    }
  }
}
