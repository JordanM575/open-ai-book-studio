import { z } from "zod";
import type { BookMeta } from "./schema";

/*
 * Front and back matter (spec 035, D-169): the pages before and after the chapters, kept as one
 * ordered list in `book.json`'s `matter` field. An absent field means the book has no matter and
 * exports exactly as it always has. The older free-form `frontMatter` record is never read as
 * matter; the author converts it explicitly (`convertLegacyMatter`) and the record stays as it is.
 */

export const MATTER_KINDS = [
  "copyright",
  "disclaimer",
  "dedication",
  "epigraph",
  "acknowledgements",
  "about-the-author",
  "other"
] as const;
export type MatterKind = (typeof MATTER_KINDS)[number];
export type MatterPosition = "front" | "back";

/** What a kind is called: its name in sentence case, and "Other page" for `other`. */
export const kindLabel = (kind: MatterKind): string =>
  kind === "other" ? "Other page" : `${kind.charAt(0).toUpperCase()}${kind.slice(1).replace(/-/g, " ")}`;

/** Where a new section of a kind goes: acknowledgements and about the author after the chapters. */
export const kindPosition = (kind: MatterKind): MatterPosition =>
  kind === "acknowledgements" || kind === "about-the-author" ? "back" : "front";

/** A book's matter before the author adds anything: exports exactly as no matter does. */
export const NO_MATTER: BookMatter = { version: 0, titlePage: true, author: "", subtitle: "", sections: [] };

/** How a kind is set: a dedication or epigraph centred, a copyright page or disclaimer without indents. */
export const MATTER_STYLE: Partial<Record<MatterKind, "centered" | "plain">> = {
  dedication: "centered",
  epigraph: "centered",
  copyright: "plain",
  disclaimer: "plain"
};

/** The IPC boundary also caps the whole value at `bytes`, so unknown fields cannot grow without bound. */
export const MATTER_LIMITS = { sections: 40, title: 200, name: 300, text: 50_000, bytes: 2_500_000 } as const;

export const matterSectionSchema = z.looseObject({
  id: z.string().regex(/^mat_[A-Za-z0-9-]{6,40}$/, "invalid section id"),
  kind: z.enum(MATTER_KINDS),
  position: z.enum(["front", "back"]),
  title: z.string().max(MATTER_LIMITS.title).default(""),
  /** Markdown, rendered like a chapter body: a paragraph is a line. */
  text: z.string().max(MATTER_LIMITS.text).default("")
});

export const matterSchema = z
  .looseObject({
    /** Incremented on every accepted save. Used to detect concurrent writers, as a chapter's is. */
    version: z.number().int().nonnegative().default(0),
    /** A generated title page (title, subtitle, author) before everything else. */
    titlePage: z.boolean().default(true),
    author: z.string().max(MATTER_LIMITS.name).default(""),
    subtitle: z.string().max(MATTER_LIMITS.name).default(""),
    sections: z.array(matterSectionSchema).max(MATTER_LIMITS.sections).default([])
  })
  .refine((matter) => new Set(matter.sections.map((section) => section.id)).size === matter.sections.length, {
    message: "two sections share an id",
    path: ["sections"]
  });

export type BookMatter = z.infer<typeof matterSchema>;
export type MatterSection = z.infer<typeof matterSectionSchema>;

/** A save of the matter, or the newer matter it would have overwritten and where the author's copy went. */
export type SaveMatterResult =
  | { status: "saved"; book: BookMeta }
  | { status: "conflict"; reason: "newer-version" | "external-edit"; savedAs: string; book: BookMeta };

/**
 * The book's matter, read tolerantly: a value the schema cannot read is reported, never thrown, so
 * a hand-edited `book.json` still opens. The value itself stays in the file untouched.
 */
export function readMatter(book: Pick<BookMeta, "matter">): { matter: BookMatter | null; issue: string | null } {
  if (book.matter == null) return { matter: null, issue: null };
  const parsed = matterSchema.safeParse(book.matter);
  if (parsed.success) return { matter: parsed.data, issue: null };
  const issue = parsed.error.issues[0];
  return { matter: null, issue: `${issue?.path.join(".") || "matter"}: ${issue?.message ?? "unreadable"}` };
}

export interface MatterPlan {
  /** False when there is matter and the author turned the title page off. */
  titlePage: boolean;
  /** The line under the title: the subtitle, or the book's description when there is no matter. */
  subtitle: string;
  author: string;
  front: MatterSection[];
  back: MatterSection[];
  /** Whether the book has matter at all. Without it every export is exactly what it always was. */
  present: boolean;
}

/**
 * Matter that changes nothing: the title page on, no author, no subtitle, no sections. It exports
 * exactly as no matter does, so turning the title page off and on again, or removing every section,
 * gives the author back the book's original title page.
 */
export function isEmptyMatter(matter: BookMatter): boolean {
  return matter.titlePage && !matter.author.trim() && !matter.subtitle.trim() && matter.sections.length === 0;
}

/** What every export puts around the chapters, in order: title page, front sections, back sections. */
export function matterPlan(book: BookMeta, matter: BookMatter | null): MatterPlan {
  if (!matter || isEmptyMatter(matter)) {
    return { titlePage: true, subtitle: book.description.trim(), author: "", front: [], back: [], present: false };
  }
  return {
    titlePage: matter.titlePage,
    subtitle: matter.subtitle.trim(),
    author: matter.author.trim(),
    front: matter.sections.filter((section) => section.position === "front"),
    back: matter.sections.filter((section) => section.position === "back"),
    present: true
  };
}

/** A section's name where one is needed (contents, Markdown, the dialog): its heading, or its kind. */
export function sectionName(section: MatterSection): string {
  return section.title.trim() || kindLabel(section.kind);
}

/** The starting text for a new section. It is the author's to change; nothing here is legal advice. */
export function matterTemplate(kind: MatterKind, author: string, year: number): string {
  if (kind === "copyright") return `Copyright © ${year}${author.trim() ? ` ${author.trim()}` : ""}\nAll rights reserved.`;
  if (kind === "disclaimer") {
    return "This is a work of fiction. Any resemblance to real people or events is coincidental.";
  }
  return "";
}

/** A new section in its kind's usual place. Back matter starts with its name as its heading. */
export function newMatterSection(kind: MatterKind, id: string, text = ""): MatterSection {
  const position = kindPosition(kind);
  return { id, kind, position, title: position === "back" ? kindLabel(kind) : "", text };
}

/** Front sections first, then back, each in the author's order: how the matter is written to disk. */
export function orderSections(sections: MatterSection[]): MatterSection[] {
  return [...sections.filter((section) => section.position === "front"), ...sections.filter((section) => section.position === "back")];
}

/** Other spellings of a legacy `frontMatter` key, by its letters alone (`aboutAuthor`, `about the author`). */
const LEGACY_ALIASES: Record<string, MatterKind | "author"> = {
  authorname: "author",
  acknowledgments: "acknowledgements",
  aboutauthor: "about-the-author",
  authorbio: "about-the-author"
};

function legacyTarget(key: string): LegacyEntry["target"] {
  const letters = key.toLowerCase().replace(/[^a-z]/g, "");
  if (letters === "subtitle" || letters === "author") return letters;
  return LEGACY_ALIASES[letters] ?? MATTER_KINDS.find((kind) => kind !== "other" && kind.replace(/-/g, "") === letters) ?? null;
}

export interface LegacyEntry {
  key: string;
  /**
   * The title page, a section kind, or null when the studio does not place it: an unknown key, or
   * an author or subtitle the title page already has.
   */
  target: MatterKind | "author" | "subtitle" | null;
}

/**
 * The legacy record's entries that no export includes yet: every non-empty value the matter does not
 * already hold, in record order. An empty result means nothing in the record is left out.
 */
export function pendingLegacyMatter(record: Record<string, string>, matter: BookMatter | null): LegacyEntry[] {
  const pending: LegacyEntry[] = [];
  for (const [key, raw] of Object.entries(record)) {
    const value = raw.trim();
    const target = legacyTarget(key);
    if (!value) continue;
    if (target === "author" || target === "subtitle") {
      // The title page keeps an author or subtitle it already has.
      const current = matter?.[target].trim() ?? "";
      if (current !== value) pending.push({ key, target: current ? null : target });
    } else if (!matter?.sections.some((section) => section.text.trim() === value)) {
      pending.push({ key, target });
    }
  }
  return pending;
}

/**
 * Adds the placeable legacy entries to the matter: author and subtitle fill the title page when it
 * has none, and each other known key becomes a section of its kind in its usual place. Nothing is
 * taken out of the record, and an entry the matter already holds is not added twice.
 */
export function convertLegacyMatter(record: Record<string, string>, matter: BookMatter | null, newId: () => string): BookMatter {
  const next: BookMatter = { ...(matter ?? NO_MATTER), sections: [...(matter?.sections ?? [])] };
  for (const { key, target } of pendingLegacyMatter(record, next)) {
    const value = (record[key] ?? "").trim();
    if (target === "author" || target === "subtitle") {
      if (!next[target].trim()) next[target] = value;
    } else if (target && !next.sections.some((section) => section.text.trim() === value)) {
      next.sections.push(newMatterSection(target, newId(), value));
    }
  }
  return { ...next, sections: orderSections(next.sections) };
}

/**
 * SHA-256 of the matter, the `baseHash` a save carries; no matter hashes as `null`. Both sides hash
 * what `readMatter` parsed from the same JSON, so the keys come out in the same order.
 */
export async function matterHash(matter: BookMatter | null): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(matter)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
