import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The book's own instructions for the agent.
 *
 * `SKILLS.md` sits in the book folder, so it travels with the book and the author can see it in
 * the file browser. It is the author's own file in their own library, so it is treated as
 * instructions rather than as data (FR-006).
 */
export const SKILLS_FILE = "SKILLS.md";

/** A skills file, bounded so a large one cannot crowd out the book. */
export interface BookSkills {
  /** The text the agent receives. */
  text: string;
  /** How many characters were dropped because the file was too long. */
  truncatedCharacters: number;
}

/** The largest skills file the agent will read. */
export const MAX_SKILLS_CHARACTERS = 8_000;

/**
 * Read a book's skills file.
 *
 * A missing file is not an error: most books have none, and the agent simply has no extra
 * instructions. A file that cannot be read is also not an error, because the turn must still work.
 */
export async function readBookSkills(
  libraryRoot: string,
  bookId: string,
  enabled: boolean
): Promise<BookSkills | null> {
  if (!enabled) return null;
  let raw: string;
  try {
    raw = await readFile(join(libraryRoot, "books", bookId, SKILLS_FILE), "utf8");
  } catch {
    return null;
  }
  const text = raw.trim();
  if (!text) return null;
  if (text.length <= MAX_SKILLS_CHARACTERS) {
    return { text, truncatedCharacters: 0 };
  }
  return {
    text: text.slice(0, MAX_SKILLS_CHARACTERS),
    truncatedCharacters: text.length - MAX_SKILLS_CHARACTERS
  };
}
