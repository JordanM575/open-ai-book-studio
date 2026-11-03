import type { Result } from "@ai-book-studio/core/ipc";

export { cn } from "@ai-book-studio/ui/utils";

/** Turns the IPC envelope into a promise that rejects with the app's own error message. */
export async function must<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
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
