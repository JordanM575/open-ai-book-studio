/**
 * Pasted text, normalised for the manuscript. Long pastes arrive with the exporting
 * application's line endings, spacing and quotation marks; the studio unifies those without
 * touching meaning or layout:
 *
 * - CRLF and lone CR become LF, so every line break counts the same way everywhere.
 * - Non-breaking spaces become plain spaces.
 * - Curly double and single quotes become straight quotes, matching what the author types, so
 *   pasted prose and typed prose stay searchable as one corpus.
 * - Runs of three or more line breaks collapse to a single blank line; single breaks and stanza
 *   breaks pass through untouched, so verse survives.
 *
 * Deliberately untouched: trailing spaces (Markdown reads two as a hard line break, which verse
 * relies on), tabs, and dashes. The function is pure so the editor, the importer and tests share
 * it.
 */
export function normalizePasteText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}
