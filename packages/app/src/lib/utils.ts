import type { Result } from "@ai-book-studio/core/ipc";
import type { BookEditResult, BookMeta } from "@ai-book-studio/core/schema";
import { bookChanges } from "@ai-book-studio/core/library/book-merge";

export { cn } from "@ai-book-studio/ui/utils";

/** Turns the IPC envelope into a promise that rejects with the app's own error message. */
export async function must<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * Save the book fields that differ in `next`, each with the value it had in `book`, the copy the
 * editor started from. The main process merges them onto `book.json` as it is now.
 */
export function editBook(book: { id: string }, next: Partial<BookMeta>): Promise<BookEditResult> {
  return must(window.studio.books.edit(book.id, bookChanges(book as BookMeta, next)));
}

/** Another writer had changed the same fields: theirs stayed in the book and the author's is a copy. */
export function keptCopyText(subject = "This"): string {
  return `${subject} changed on disk while you were editing, so your version was kept as a separate copy instead of overwriting the change.`;
}

const wordFormatter = new Intl.NumberFormat("en-US");

export function formatWords(count: number): string {
  return `${wordFormatter.format(count)} ${count === 1 ? "word" : "words"}`;
}

export function formatCount(count: number): string {
  return wordFormatter.format(count);
}

export function savedTime(at: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
}

export { countWords } from "@ai-book-studio/core/words";

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
