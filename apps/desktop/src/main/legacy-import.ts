import {
  DEFAULT_MANUSCRIPT_SETTINGS,
  manuscriptSettingsSchema,
  type Character,
  type Memory,
  type StoryArc
} from "@ai-book-studio/core/schema";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_CACHE_SETTINGS } from "@ai-book-studio/core/agent/settings";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LegacyImportError,
  legacyImageSchema,
  parseLegacyExport,
  type LegacyBook,
  type LegacyImagePage,
  type LegacyImportReport
} from "@ai-book-studio/core/legacy";
import { inspectImage } from "@ai-book-studio/core/images";
import { migrationsPath } from "@ai-book-studio/core/library/paths";
import type { Library } from "./library/store";
import { writeFileAtomic } from "./library/atomic";
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

interface MigrationEntries {
  [fingerprint: string]: { bookId: string; title: string; importedAt: string };
}

function migrationFile(library: Library): string {
  return join(library.root, ...migrationsPath());
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pageVersions(page: LegacyImagePage): string[] {
  return page.versions ?? (page.currentVersion ? [page.currentVersion] : []);
}

function fingerprintBook(book: LegacyBook, imageMap: Record<string, unknown>): string {
  // The referenced picture bytes are part of the fingerprint: the same pages pointing at
  // different bytes are a different book, while an unrelated book's new picture changes nothing.
  const referenced = new Set<string>();
  for (const page of book.imagePages ?? []) {
    for (const version of pageVersions(page)) referenced.add(version);
  }
  const images: Record<string, unknown> = {};
  for (const version of [...referenced].sort()) {
    if (version in imageMap) images[version] = imageMap[version];
  }
  return createHash("sha256").update(canonicalize({ book, images })).digest("hex");
}

function pictureLabel(page: LegacyImagePage, version: string): string {
  const caption = (page.caption ?? "").trim();
  return caption === "" ? version : caption;
}

async function importLegacyImages(
  library: Library,
  bookId: string,
  legacy: LegacyBook,
  imageMap: Record<string, unknown>,
  warnings: string[]
): Promise<number> {
  let count = 0;
  for (const page of legacy.imagePages ?? []) {
    const versions = pageVersions(page);
    if (versions.length === 0) {
      warnings.push(
        `“${legacy.title}” kept a picture page with no picture in it, so nothing was imported for “${pictureLabel(page, "that page")}”.`
      );
      continue;
    }
    for (const version of versions) {
      const label = pictureLabel(page, version);
      const parsed = version in imageMap ? legacyImageSchema.safeParse(imageMap[version]) : null;
      if (!parsed?.success) {
        warnings.push(
          `“${legacy.title}” named the picture “${label}” but it was missing from the file, so it was not imported.`
        );
        continue;
      }
      const bytes = Buffer.from(typeof parsed.data.data === "string" ? parsed.data.data : "", "base64");
      const inspection = inspectImage(bytes);
      if (!inspection) {
        warnings.push(
          `“${legacy.title}” could not read the picture “${label}” as a picture, so it was not imported.`
        );
        continue;
      }
      if (parsed.data.mimeType && parsed.data.mimeType !== inspection.mimeType) {
        warnings.push(
          `“${legacy.title}” said the picture “${label}” was ${parsed.data.mimeType} but it decoded as ${inspection.mimeType}; the file's bytes were kept.`
        );
      }
      try {
        await library.addImage(bookId, {
          bytes,
          kind: page.cover ? "cover" : "other",
          prompt: parsed.data.prompt ?? page.caption ?? "",
          provider: "legacy-import",
          model: parsed.data.model ?? "legacy-export",
          costUsd: parsed.data.costUsd ?? null,
          source: "imported"
        });
        count += 1;
      } catch (error) {
        warnings.push(
          `“${legacy.title}” could not import the picture “${label}”: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  }
  return count;
}

async function readMigrationRecord(
  library: Library
): Promise<{ entries: MigrationEntries; unreadable: boolean }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(migrationFile(library), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return { entries: {}, unreadable: true };
    const books = (parsed as { books?: unknown }).books;
    if (typeof books !== "object" || books === null) return { entries: {}, unreadable: true };
    const entries: MigrationEntries = {};
    for (const [fingerprint, entry] of Object.entries(books as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { bookId, title, importedAt } = entry as Record<string, unknown>;
      if (typeof bookId === "string" && typeof title === "string" && typeof importedAt === "string") {
        entries[fingerprint] = { bookId, title, importedAt };
      }
    }
    return { entries, unreadable: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { entries: {}, unreadable: false };
    return { entries: {}, unreadable: true };
  }
}

async function writeMigrationRecord(library: Library, entries: MigrationEntries): Promise<void> {
  const path = migrationFile(library);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify({ version: 1, books: entries }, null, 2)}\n`);
}

/**
 * The export as the old app wrote it. The import dialog hands over the file's text; a caller that
 * already holds the parsed export passes it as it is. Text that does not parse is refused in plain
 * words, never with the parser's own message.
 */
function exportFrom(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new LegacyImportError(
      "This file could not be read as a backup, so nothing was imported. It may be damaged or incomplete; export it again from Mom's AI Book Studio, then choose the new file."
    );
  }
}

export async function importLegacyBackup(library: Library, raw: unknown): Promise<LegacyImportReport> {
  const parsed = parseLegacyExport(exportFrom(raw));
  const books: LegacyImportReport["books"] = [];
  const recognised: LegacyImportReport["recognised"] = [];
  const warnings: string[] = [];

  const record = await readMigrationRecord(library);
  if (record.unreadable) {
    warnings.push("The previous import record could not be read, so every book was imported again.");
  }
  const existingIds = new Set((await library.listBooks()).map((book) => book.id));
  let changed = false;

  for (const legacy of parsed.books) {
    try {
      const fingerprint = fingerprintBook(legacy, parsed.imageMap ?? {});
      const prior = record.entries[fingerprint];
      if (prior && existingIds.has(prior.bookId)) {
        recognised.push({ title: legacy.title, bookId: prior.bookId });
        continue;
      }
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

      const imageCount = await importLegacyImages(
        library,
        created.id,
        legacy,
        parsed.imageMap ?? {},
        warnings
      );

      books.push({
        title: legacy.title,
        chapters: chapterCount,
        characters: characters.length,
        memories: memories.length,
        images: imageCount
      });
      record.entries[fingerprint] = {
        bookId: created.id,
        title: legacy.title,
        importedAt: new Date().toISOString()
      };
      existingIds.add(created.id);
      changed = true;
    } catch (error) {
      warnings.push(
        `“${legacy.title}” could not be imported: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  if (changed) {
    await writeMigrationRecord(library, record.entries);
  }
  return { imported: books.length, books, recognised, warnings };
}
