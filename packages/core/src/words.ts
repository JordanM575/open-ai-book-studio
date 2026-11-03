/**
 * The studio's word counter, used by the editor's live count and by every saved
 * count (chapter metadata, the manuscript review, import mapping). One
 * dependency-free implementation lives here so the editor, the library and the
 * review can never disagree; `markdown.ts` and the app's `lib/utils` re-export
 * it instead of carrying their own copy (spec 002 FR-016).
 */
export function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
