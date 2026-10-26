import type { AmbientChange, AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import { ambientStatus, type AmbientChapter } from "@ai-book-studio/core/agent/ambient";
import type { Library } from "../library/store";
import { CheckpointStore } from "./checkpoints";

/**
 * The ambient agent's view of a book.
 *
 * It is computed from the library, the undo checkpoints and the conversations, so it is available
 * whether the author has opened the chat panel or not. The agent knows the state of the book
 * without being asked.
 */
export class AmbientService {
  constructor(private readonly library: () => Library | null) {}

  /** The ambient status of a book. */
  async status(bookId: string, activeChapterId?: string | null): Promise<AmbientStatus> {
    const library = this.library();
    if (!library) throw new Error("No library is open.");
    const { book, chapters } = await library.readBook(bookId);

    const checkpoint = await new CheckpointStore(() => library.root).latest(bookId);
    const lastSaid = await this.lastThingTheAgentSaid(library, bookId);
    const lastChange = checkpoint ? describeChange(checkpoint) : null;

    return ambientStatus({
      book: { id: book.id, title: book.title || book.workingTitle || "Untitled book", stage: book.stage },
      chapters: chapters.map(
        (chapter): AmbientChapter => ({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          wordCount: chapter.wordCount
        })
      ),
      activeChapterId: activeChapterId ?? null,
      lastChange,
      lastSaid,
      canUndo: checkpoint !== null,
      canKeepGoing: Boolean(book.defaultConnectionId && book.defaultModelId)
    });
  }

  /**
   * The agent's own last words in this book.
   *
   * It is the newest conversation, because that is the one the author was last talking to.
   */
  private async lastThingTheAgentSaid(library: Library, bookId: string): Promise<string | null> {
    const threads = await library.threads.list(bookId);
    const newest = threads[0];
    if (!newest) return null;
    const thread = await library.threads.read(bookId, newest.id);
    if (!thread) return null;
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index]!;
      if (message.role !== "assistant") continue;
      const text = message.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
    return null;
  }
}

/**
 * What a checkpoint says happened, in a phrase a person can hear.
 *
 * It is a description of the change, not a claim about the agent's reasoning: the checkpoint
 * records which chapters changed, and nothing more.
 */
export function describeChange(checkpoint: {
  at: string;
  entries: Array<{ title: string; created?: boolean; deleted?: boolean }>;
}): AmbientChange {
  const entries = checkpoint.entries;
  if (entries.length === 0) {
    return { what: "I changed something", at: checkpoint.at };
  }
  if (entries.length === 1) {
    const entry = entries[0]!;
    if (entry.created) return { what: `I wrote ${entry.title}`, at: checkpoint.at };
    if (entry.deleted) return { what: `I removed ${entry.title}`, at: checkpoint.at };
    return { what: `I changed ${entry.title}`, at: checkpoint.at };
  }
  const first = entries[0]!;
  if (first.created) {
    return { what: `I wrote ${first.title} and ${entries.length - 1} more`, at: checkpoint.at };
  }
  return { what: `I changed ${first.title} and ${entries.length - 1} more`, at: checkpoint.at };
}
