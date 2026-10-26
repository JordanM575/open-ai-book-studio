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
  const front = stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
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
    data = parseYaml(match[1] ?? "");
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

export function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

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

/**
 * A preserved copy, not a chapter. Matches this studio's `.conflict-<reason>` names and the
 * "(conflicted copy)" names storage providers add. A chapter that merely mentions conflict is
 * still a chapter.
 */
export function isConflictCopyName(name: string): boolean {
  return /conflicted copy|\.conflict[-.]/i.test(name);
}

export function parseOrderFromFileName(fileName: string): number | null {
  const match = /^(\d{1,4})-/.exec(fileName);
  if (!match) return null;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
