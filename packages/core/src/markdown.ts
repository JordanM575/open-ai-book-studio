import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { chapterMetaSchema, type ChapterMeta } from "./schema";

export class FormatError extends Error {
  constructor(
    message: string,
    readonly path?: string
  ) {
    super(path ? `${message} (${path})` : message);
    this.name = "FormatError";
  }
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface ParsedChapterFile {
  meta: ChapterMeta;
  content: string;
  hadFrontMatter: boolean;
}

/** Normalizes line endings and the trailing newline of a manuscript without touching interior text. */
export function normalizeBody(content: string): string {
  const unified = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = unified.replace(/^\n+/, "").replace(/\n+$/, "");
  return trimmed.length === 0 ? "" : `${trimmed}\n`;
}

export function serializeChapter(meta: ChapterMeta, content: string): string {
  // The separator supplies the final line break; other trailing whitespace may belong to a scalar.
  const front = stringifyYaml(meta, { lineWidth: 0 }).replace(/\n$/, "");
  return `---\n${front}\n---\n\n${normalizeBody(content)}`;
}

/**
 * Reads a chapter file. A file without front matter is still readable (the author may have pasted
 * prose into the folder); the caller supplies fallback metadata so nothing is lost.
 */
export function parseChapterFile(raw: string, path: string, fallback: ChapterMeta): ParsedChapterFile {
  const match = FRONT_MATTER.exec(raw);
  if (!match) {
    return { meta: fallback, content: normalizeBody(raw), hadFrontMatter: false };
  }

  let data: unknown;
  try {
    // The delimiter's preceding newline also terminates the YAML document (including block scalars).
    data = parseYaml(`${match[1] ?? ""}\n`);
  } catch (error) {
    throw new FormatError(`Front matter is not valid YAML: ${(error as Error).message}`, path);
  }

  const merged = {
    ...fallback,
    ...(data && typeof data === "object" ? (data as Record<string, unknown>) : {})
  };
  const result = chapterMetaSchema.safeParse(merged);
  if (!result.success) {
    throw new FormatError(`Front matter does not match the chapter schema: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, path);
  }

  return { meta: result.data, content: normalizeBody(raw.slice(match[0].length)), hadFrontMatter: true };
}

export { countWords } from "./words";

/** A filename-safe slug. Never used for identity; only for a readable file name. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "chapter";
}

export function chapterFileName(order: number, title: string): string {
  const prefix = String(order).padStart(4, "0");
  return `${prefix}-${slugify(title)}.md`;
}

/** A name `chapterFileName` writes: `NNNN-slug.md`, or `NNNN-slug-2.md` when that one is taken. */
const STUDIO_CHAPTER_NAME = /^\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/**
 * A preserved copy, not a chapter (docs/FORMAT.md, "Copies of a chapter"). Matches this studio's
 * `.conflict-<reason>` names; Dropbox's and Nextcloud's "(… conflicted copy …)", and Dropbox's
 * "(Case Conflict)" and "(Selective Sync Conflict)"; Syncthing's `.sync-conflict-<date>-<time>-<device>`;
 * and iCloud Drive's ` 2` or Google Drive's ` (1)` after a studio chapter name. A chapter that merely
 * mentions conflict is still a chapter, and so are hand-named `Chapter 2.md` and `Part Two (The Conflict).md`.
 */
export function isConflictCopyName(name: string): boolean {
  if (/conflicted copy|\((?:case|selective sync) conflict\)|\.conflict[-.]|\.sync-conflict-/i.test(name)) return true;
  const unsuffixed = name.replace(/ (?:\d+|\(\d+\))(\.md)$/, "$1");
  return unsuffixed !== name && STUDIO_CHAPTER_NAME.test(unsuffixed);
}

/**
 * Ranks the files that carry one chapter id: the first readable one is the chapter, the rest are
 * copies (docs/FORMAT.md, "Copies of a chapter"). A studio chapter name comes first, then the
 * shorter name, then character order. Only names decide, so every device picks the same file, and
 * a save never moves the chapter to a copy, as file dates would: an atomic save makes a new file.
 */
export function compareChapterFileNames(left: string, right: string): number {
  const studio = Number(STUDIO_CHAPTER_NAME.test(right)) - Number(STUDIO_CHAPTER_NAME.test(left));
  if (studio !== 0) return studio;
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseOrderFromFileName(fileName: string): number | null {
  const match = /^(\d{1,4})-/.exec(fileName);
  if (!match) return null;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
