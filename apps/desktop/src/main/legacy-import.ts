import {
  DEFAULT_MANUSCRIPT_SETTINGS,
  manuscriptSettingsSchema,
  type Character,
  type Memory,
  type StoryArc
} from "@ai-book-studio/core/schema";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_CACHE_SETTINGS } from "@ai-book-studio/core/agent/settings";
import { parseLegacyExport, type LegacyImportReport } from "@ai-book-studio/core/legacy";
import type { Library } from "./library/store";
import { newId } from "./library/paths";

type LegacyRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function joined(value: unknown): string {
  return typeof value === "string" ? value : list(value).join("\n");
}

function section(value: unknown): { overview: string; keyMoments: string; openQuestions: string } {
  if (typeof value === "string") {
    return { overview: value, keyMoments: "", openQuestions: "" };
  }
  const record = (value ?? {}) as LegacyRecord;
  return {
    overview: text(record.overview),
    keyMoments: joined(record.keyMoments),
    openQuestions: joined(record.openQuestions)
  };
}

function storyArc(value: unknown): StoryArc {
  const record = (value ?? {}) as LegacyRecord;
  return {
    beginning: section(record.beginning),
    middle: section(record.middle),
    end: section(record.end)
  };
}

function arcValue(value: unknown): "beginning" | "middle" | "end" | undefined {
  return value === "beginning" || value === "middle" || value === "end" ? value : undefined;
}

function charactersOf(book: { characters?: unknown }): Character[] {
  const entries = Array.isArray(book.characters) ? (book.characters as LegacyRecord[]) : [];
  return entries
    .filter((entry) => text(entry.name).trim().length > 0)
    .map((entry) => ({
      id: newId("char"),
      name: text(entry.name).trim(),
      role: text(entry.role),
      description: text(entry.description),
      motivations: joined(entry.motivations),
      notes: text(entry.notes)
    }));
}

function memoriesOf(book: { memories?: unknown }): Memory[] {
  const entries = Array.isArray(book.memories) ? (book.memories as LegacyRecord[]) : [];
  const now = new Date().toISOString();
  return entries
    .filter((entry) => text(entry.text).trim().length > 0)
    .map((entry) => ({
      id: newId("mem"),
      text: text(entry.text).trim(),
      importance: entry.importance === "low" || entry.importance === "high" ? entry.importance : "medium",
      createdAt: now,
      updatedAt: now
    }));
}

export async function importLegacyBackup(library: Library, raw: unknown): Promise<LegacyImportReport> {
  const parsed = parseLegacyExport(raw);
  const books: LegacyImportReport["books"] = [];
  const warnings: string[] = [];

  for (const legacy of parsed.books) {
    try {
      const created = await library.createBook({
        title: legacy.title,
        description: legacy.description,
        outline: legacy.outline
      });
      const characters = charactersOf(legacy);
      const memories = memoriesOf(legacy);
      const settings = manuscriptSettingsSchema.safeParse(legacy.manuscriptSettings);

      await library.updateBook(created.id, {
        title: legacy.title,
        description: legacy.description,
        genres: legacy.genres,
        influences: legacy.influences,
        isErotica: legacy.isErotica,
        chapterRange: legacy.chapterRange,
        outline: legacy.outline,
        storyArc: storyArc(legacy.storyArc),
        characters,
        memories,
        stage: legacy.stage === "drafting" ? "drafting" : "onboarding",
        settings: {
          manuscript: settings.success ? settings.data : DEFAULT_MANUSCRIPT_SETTINGS,
          agent: DEFAULT_AGENT_SETTINGS,
          cache: DEFAULT_CACHE_SETTINGS
        },
        frontMatter: legacy.frontMatter
      });

      let chapterCount = 0;
      for (const [index, scene] of (legacy.scenes ?? []).entries()) {
        const chapter = await library.createChapter(created.id, {
          title: text(scene.title).trim() || `Chapter ${index + 1}`,
          content: text(scene.draftContent)
        });
        const meta: Record<string, unknown> = {};
        const arc = arcValue(scene.arc);
        if (arc) meta.arc = arc;
        if (text(scene.purpose)) meta.purpose = text(scene.purpose);
        if (text(scene.synopsis)) meta.synopsis = text(scene.synopsis);
        if (text(scene.notes)) meta.notes = text(scene.notes);
        if (scene.isPrologue) meta.isPrologue = true;
        if (typeof scene.color === "string") meta.color = scene.color;
        if (Object.keys(meta).length > 0) {
          await library.updateChapterMeta(created.id, chapter.id, meta, {
            baseVersion: chapter.version,
            baseHash: chapter.hash
          });
        }
        chapterCount += 1;
      }

      const manuscript = text(legacy.manuscript).trim();
      if (chapterCount === 0 && manuscript) {
        await library.createChapter(created.id, { title: "Manuscript", content: manuscript });
        chapterCount = 1;
      } else if (chapterCount > 0 && manuscript) {
        await library.createChapter(created.id, { title: "Earlier manuscript", content: manuscript });
        chapterCount += 1;
        warnings.push(`“${legacy.title}” kept an earlier whole-book manuscript as an extra chapter.`);
      }

      if (chapterCount === 0) {
        warnings.push(`“${legacy.title}” had no chapters or manuscript, so it was imported empty.`);
      }

      books.push({
        title: legacy.title,
        chapters: chapterCount,
        characters: characters.length,
        memories: memories.length
      });
    } catch (error) {
      warnings.push(
        `“${legacy.title}” could not be imported: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return { imported: books.length, books, warnings };
}
