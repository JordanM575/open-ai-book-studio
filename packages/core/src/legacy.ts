import { z } from "zod";

/**
 * Reading an old backup is deliberately separate from the studio's own schema.
 *
 * The old app wrote one JSON file for the whole library. We accept the shapes it
 * actually produced, keep the fields we can carry across, and report the rest.
 * Nothing here writes to a library; the importer in the desktop app does that.
 */

export const LEGACY_APP_ID = "moms-ai-book-studio";
export const LEGACY_SCHEMA_VERSION = 1;

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyImportError";
  }
}

const sceneSchema = z.looseObject({
  title: z.string().optional(),
  arc: z.string().optional(),
  purpose: z.string().optional(),
  synopsis: z.string().optional(),
  draftContent: z.string().optional(),
  notes: z.string().optional(),
  isPrologue: z.boolean().optional(),
  color: z.string().nullable().optional()
});

const characterSchema = z.looseObject({
  name: z.string().min(1),
  role: z.string().optional(),
  description: z.string().optional(),
  motivations: z.array(z.string()).optional(),
  notes: z.string().optional()
});

const memorySchema = z.looseObject({
  text: z.string().min(1),
  importance: z.enum(["low", "medium", "high"]).optional()
});

const manuscriptSettingsSchema = z.looseObject({
  bodyFont: z.string().optional(),
  bodyFontSize: z.number().optional(),
  firstLineIndent: z.number().optional(),
  lineSpacing: z.string().optional(),
  chapterTitleAlignment: z.string().optional(),
  includeTableOfContents: z.boolean().optional(),
  preserveLineBreaks: z.boolean().optional()
});

export const legacyImageSchema = z.looseObject({
  mimeType: z.string().optional(),
  data: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  costUsd: z.number().optional()
});

export const legacyImagePageSchema = z.looseObject({
  id: z.string().optional(),
  anchor: z.string().optional(),
  caption: z.string().optional(),
  altText: z.string().optional(),
  currentVersion: z.string().optional(),
  versions: z.array(z.string()).optional(),
  cover: z.boolean().optional()
});

const bookSchema = z.looseObject({
  title: z.string().min(1),
  description: z.string().optional(),
  imagePages: z.array(legacyImagePageSchema).optional(),
  genres: z.array(z.string()).optional(),
  influences: z.array(z.string()).optional(),
  isErotica: z.boolean().optional(),
  chapterRange: z.object({ minimum: z.number(), maximum: z.number() }).optional(),
  outline: z.string().optional(),
  storyArc: z.unknown().optional(),
  scenes: z.array(sceneSchema).optional(),
  characters: z.array(characterSchema).optional(),
  memories: z.array(memorySchema).optional(),
  stage: z.string().optional(),
  manuscript: z.string().optional(),
  manuscriptSettings: manuscriptSettingsSchema.optional(),
  frontMatter: z.record(z.string(), z.string()).optional()
});

export type LegacyScene = z.infer<typeof sceneSchema>;
export type LegacyCharacter = z.infer<typeof characterSchema>;
export type LegacyMemory = z.infer<typeof memorySchema>;
export type LegacyBook = z.infer<typeof bookSchema>;
export type LegacyImage = z.infer<typeof legacyImageSchema>;
export type LegacyImagePage = z.infer<typeof legacyImagePageSchema>;
export type LegacyManuscriptSettings = z.infer<typeof manuscriptSettingsSchema>;

export interface LegacyExport {
  books: LegacyBook[];
  imageMap?: Record<string, unknown>;
  exportedAt?: string;
}

function looksLikeBook(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === "string" && (Array.isArray(candidate.scenes) || typeof candidate.manuscript === "string");
}

/**
 * Accept the shapes the old app exported: a wrapped library, a bare library
 * state, or a single book object.
 */
export function parseLegacyExport(raw: unknown): LegacyExport {
  if (typeof raw !== "object" || raw === null) {
    throw new LegacyImportError("This file is not a Mom's AI Book Studio backup.");
  }
  const payload = raw as Record<string, unknown>;
  if (typeof payload.app === "string" && payload.app !== LEGACY_APP_ID) {
    throw new LegacyImportError("This backup was written by another app.");
  }
  if (typeof payload.version === "number" && payload.version > LEGACY_SCHEMA_VERSION) {
    throw new LegacyImportError("This backup comes from a newer version of the old app. Update the importer first.");
  }

  const candidates = Array.isArray(payload.books) ? payload.books : looksLikeBook(payload) ? [payload] : null;
  if (!candidates) {
    throw new LegacyImportError("This file does not contain any books this importer recognises.");
  }

  const books: LegacyBook[] = [];
  candidates.forEach((candidate, index) => {
    const parsed = bookSchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues[0];
      throw new LegacyImportError(
        `Book ${index + 1} is damaged: ${detail?.path.join(".") || "unknown field"} ${detail?.message ?? "is invalid"}.`
      );
    }
    books.push(parsed.data);
  });

  if (books.length === 0) throw new LegacyImportError("This backup does not contain any books.");

  const imageMap = payload.imageMap;
  return {
    books,
    ...(typeof payload.exportedAt === "string" ? { exportedAt: payload.exportedAt } : {}),
    ...(typeof imageMap === "object" && imageMap !== null && !Array.isArray(imageMap)
      ? { imageMap: imageMap as Record<string, unknown> }
      : {})
  };
}

export interface LegacyImportReport {
  imported: number;
  books: Array<{ title: string; chapters: number; characters: number; memories: number; images: number }>;
  recognised: Array<{ title: string; bookId: string }>;
  warnings: string[];
}
