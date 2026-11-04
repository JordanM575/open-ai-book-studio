import { z } from "zod";
import {
  agentSettingsSchema,
  cacheSettingsSchema,
} from "./agent/settings";

/**
 * The on-disk schema version. A newer app may write a newer number; an older app must refuse
 * to open the library rather than silently dropping fields it does not know (see FORMAT.md).
 */
export const SCHEMA_VERSION = 1;

export const ARC_VALUES = ["beginning", "middle", "end"] as const;
export const IMPORTANCE_VALUES = ["low", "medium", "high"] as const;
export const STAGE_VALUES = ["onboarding", "drafting"] as const;

export const idSchema = z.string().regex(/^(book|ch|char|mem|thread|cp)_[A-Za-z0-9-]{6,}$/, "invalid id");

const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

/* ------------------------------------------------------------------ chapters */

const storyArcNotesSchema = z.object({
  overview: z.string().default(""),
  keyMoments: z.string().default(""),
  openQuestions: z.string().default("")
});

export const storyArcSchema = z.object({
  beginning: storyArcNotesSchema.default({ overview: "", keyMoments: "", openQuestions: "" }),
  middle: storyArcNotesSchema.default({ overview: "", keyMoments: "", openQuestions: "" }),
  end: storyArcNotesSchema.default({ overview: "", keyMoments: "", openQuestions: "" })
});

export const characterSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  role: z.string().default(""),
  description: z.string().default(""),
  motivations: z.string().default(""),
  /** Free-form extra facts the author wants remembered about this person. */
  notes: z.string().default("")
});

export const memorySchema = z.object({
  id: idSchema,
  text: z.string().min(1),
  importance: z.enum(IMPORTANCE_VALUES).default("medium"),
  createdAt: isoDate,
  updatedAt: isoDate
});

export const manuscriptSettingsSchema = z
  .object({
    bodyFont: z
      .enum([
        "Times New Roman",
        "Garamond",
        "Georgia",
        "Palatino Linotype",
        "Book Antiqua",
        "Cambria",
        "Calibri",
        "Bookman Old Style",
        "Century",
        "Courier New",
        "Arial",
        "Helvetica"
      ])
      .default("Times New Roman"),
    bodyFontSize: z.union([z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14)]).default(12),
    firstLineIndent: z
      .union([z.literal(0), z.literal(0.1), z.literal(0.2), z.literal(0.3), z.literal(0.5)])
      .default(0.2),
    lineSpacing: z.enum(["Single", "1.15", "1.5", "Double"]).default("Double"),
    chapterTitleAlignment: z.enum(["Left", "Center"]).default("Center"),
    includeTableOfContents: z.boolean().default(false),
    preserveLineBreaks: z.boolean().default(true)
  })
  /** The default is on the input, so a book that predates a setting still opens. */
  .prefault({});

export const DEFAULT_MANUSCRIPT_SETTINGS: ManuscriptSettings = manuscriptSettingsSchema.parse({});

/* ---------------------------------------------------------------------- book */

export const bookSchema = z.looseObject({
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
  id: idSchema,
  title: z.string().default(""),
  workingTitle: z.string().default(""),
  description: z.string().default(""),
  genres: z.array(z.string()).default([]),
  influences: z.array(z.string()).default([]),
  isErotica: z.boolean().default(false),
  chapterRange: z
    .object({
      minimum: z.number().int().nonnegative().nullable().default(null),
      maximum: z.number().int().nonnegative().nullable().default(null)
    })
    .default({ minimum: null, maximum: null }),
  outline: z.string().default(""),
  storyArc: storyArcSchema.default({ beginning: { overview: "", keyMoments: "", openQuestions: "" }, middle: { overview: "", keyMoments: "", openQuestions: "" }, end: { overview: "", keyMoments: "", openQuestions: "" } }),
  characters: z.array(characterSchema).default([]),
  memories: z.array(memorySchema).default([]),
  stage: z.enum(STAGE_VALUES).default("onboarding"),
  /** Chosen connection and model for this book. Both are optional so older books keep opening. */
  defaultProvider: z.string().max(40).nullable().default(null),
  defaultConnectionId: z.string().max(200).nullable().default(null),
  defaultModelId: z.string().max(200).nullable().default(null),
  /**
   * Explicit consent to use a training-eligible model (for example Muse Spark Contributor) with this
   * book. Off by default; the agent refuses a contributor model until the author enables it.
   */
  allowContributorTraining: z.boolean().default(false),
  settings: z
    .object({
      manuscript: manuscriptSettingsSchema,
      /** Which built-in tools the author has withdrawn, and whether the skills file is used. */
      agent: agentSettingsSchema,
      /** How the agent's request is marked for the provider's cache. */
      cache: cacheSettingsSchema
    })
    /**
     * The defaults are on the input, so a book written before these settings existed still opens.
     * The sample library and every book an author already has must keep working.
     */
    .prefault({}),
  /** Front and back matter: title page, dedication, acknowledgements, author's note. */
  frontMatter: z.record(z.string(), z.string()).default({}),
  createdAt: isoDate,
  updatedAt: isoDate
});

/* ------------------------------------------------------------------- chapter */

/**
 * Chapter front matter. The prose lives in the Markdown body; everything here is metadata that
 * the rail, the agent and the export formats need without reading the prose.
 */
export const chapterMetaSchema = z.looseObject({
  id: idSchema,
  title: z.string().default("Untitled chapter"),
  order: z.number().int().positive(),
  arc: z.enum(ARC_VALUES).default("middle"),
  purpose: z.string().default(""),
  synopsis: z.string().default(""),
  notes: z.string().default(""),
  isPrologue: z.boolean().default(false),
  color: z.string().nullable().default(null),
  /** Incremented on every accepted save. Used to detect concurrent writers. */
  version: z.number().int().nonnegative().default(1),
  createdAt: isoDate,
  updatedAt: isoDate
});

export type BookMeta = z.infer<typeof bookSchema>;
export type ChapterMeta = z.infer<typeof chapterMetaSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type ManuscriptSettings = z.infer<typeof manuscriptSettingsSchema>;
export type StoryArc = z.infer<typeof storyArcSchema>;
export type ArcValue = (typeof ARC_VALUES)[number];

/** A chapter as the renderer sees it: metadata plus prose. */
export interface Chapter extends ChapterMeta {
  content: string;
  /** File name inside the book's chapters folder. A hint for humans; identity is `id`. */
  path: string;
  wordCount: number;
  /** SHA-256 of the exact bytes on disk. The renderer sends it back to prove what it edited. */
  hash: string;
}

export interface BookSummary {
  id: string;
  title: string;
  description: string;
  stage: BookMeta["stage"];
  chapterCount: number;
  wordCount: number;
  updatedAt: string;
}

export interface BookDetail {
  book: BookMeta;
  chapters: Chapter[];
  /** Chapter files omitted from `chapters` because the current saved read could not verify them. */
  chapterReadIssues: ChapterReadIssue[];
}

export type ChapterReadIssueReason = "file-missing" | "permission-needed" | "invalid-format" | "unreadable";

export interface ChapterReadIssue {
  /** File name relative to the library's chapters folder; never a host path. */
  fileName: string;
  /** Recovered from the file name when available; otherwise null. */
  order: number | null;
  /** Stable safe category; never includes raw adapter or parser error text. */
  reason: ChapterReadIssueReason;
}

export type BookReadIssueReason = "newer-schema" | "syncing" | "unreadable";

/** A folder under `books/` that holds a book the studio cannot open, so the grid can say why. */
export interface BookReadIssue {
  /** The folder's name under `books/`; never a host path. */
  folder: string;
  /** The title in `book.json` when it could be read; otherwise null. */
  title: string | null;
  /** Stable safe category; never includes raw adapter or parser error text. */
  reason: BookReadIssueReason;
}

/** The library grid: every book that opens, and every book folder that does not. */
export interface BookListing {
  books: BookSummary[];
  bookReadIssues: BookReadIssue[];
}

/** A copy of a chapter that could not be saved over the version on disk. */
export interface ChapterConflict {
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  /** Where the losing version was preserved, library-relative. */
  savedAs: string;
  reason: "newer-version" | "external-edit" | "provider-conflict-copy" | "missing-file" | "placeholder";
  diskVersion: number;
  localVersion: number;
}

/** One matching line in a book, with the chapter and line it came from. */
export interface SearchHit {
  chapterId: string;
  chapterTitle: string;
  order: number;
  line: number;
  text: string;
}

export type SaveChapterResult =
  | { status: "saved"; chapter: Chapter }
  | { status: "conflict"; conflict: ChapterConflict };

export type ReorderDirection = "up" | "down";

/** A move affects two chapter files; the whole book is returned so the rail can re-render once. */
export type ReorderChapterResult =
  | { status: "saved"; chapters: Chapter[] }
  | { status: "conflict"; conflict: ChapterConflict };
