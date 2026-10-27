import {
  bookSchema,
  chapterMetaSchema,
  SCHEMA_VERSION,
  type BookDetail,
  type BookMeta,
  type BookSummary,
  type Chapter,
  type ChapterConflict,
  type ChapterMeta,
  type ReorderChapterResult,
  type ReorderDirection,
  type SearchHit,
  type SaveChapterResult
} from "../schema";
import {
  chapterFileName,
  countWords,
  isConflictCopyName,
  normalizeBody,
  parseChapterFile,
  parseOrderFromFileName,
  serializeChapter
} from "../markdown";
import { LibraryError, LibraryPortError } from "./errors";
import { libraryPathToArchivePath, toLibraryFilePath } from "./path";
import type { LibraryPath } from "./path";
import {
  bookFilePath,
  bookPath,
  bookTrashPath,
  booksPath,
  chapterDisplayPath,
  chapterPath,
  chaptersPath,
  checkpointsPath,
  conflictDisplayPath,
  conflictPath,
  conflictsPath,
  libraryIndexPath,
  studioPath,
  threadsPath,
  trashPath
} from "./paths";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEnvironment,
  LibraryFileSnapshot
} from "./port";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * The product's library rules, independent of where the bytes live.
 *
 * A host supplies a `LibraryPort` (filesystem, folder handle, origin storage) and runtime
 * primitives. Everything promised about the format — checked saves, conflict copies, trash,
 * the derived catalog — is implemented here once.
 */
/**
 * A chapter field change where "leave it alone" and "clear it" are different things.
 *
 * `Partial<Pick<…>>` says a key may be missing; this says a key may also be present and
 * undefined, which is what a parsed request body actually produces.
 */
export type ChapterMetaPatch = {
  [K in "title" | "synopsis" | "purpose" | "notes" | "arc" | "order" | "isPrologue" | "color"]?:
    | ChapterMeta[K]
    | undefined;
};

/** A book field change where a key may be missing *or* present and undefined. */
export type BookPatch = { [K in keyof BookMeta]?: BookMeta[K] | undefined };

export class LibraryService {
  private readonly writes = new Map<string, Promise<unknown>>();

  private constructor(
    private readonly env: LibraryEnvironment,
    private readonly device: LibraryDeviceInfo
  ) {}

  static async open(env: LibraryEnvironment): Promise<LibraryService> {
    await ensureLayout(env.storage);
    const device = await env.storage.deviceInfo();
    const service = new LibraryService(env, device);
    await service.rebuildCatalog();
    return service;
  }

  get deviceId(): string {
    return this.device.id;
  }

  get deviceName(): string {
    return this.device.name;
  }

  /**
   * Watch author-owned paths for changes made outside this service. The adapter may not support
   * watching; then this returns a no-op and the studio keeps its save-time conflict checks.
   */
  watch(onChange: (path: string) => void): () => void {
    const storage = this.env.storage;
    if (!storage.watch) return () => {};
    const stops = [booksPath(), trashPath()].map((root) =>
      storage.watch!(root, (changed) => {
        try {
          onChange(libraryPathToArchivePath(changed));
        } catch {
          // A provider event on the root or an unsafe name is not a book file.
        }
      })
    );
    return () => {
      for (const stop of stops) stop();
    };
  }

  /* -------------------------------------------------------------------- books */

  async listBooks(): Promise<BookSummary[]> {
    const summaries: BookSummary[] = [];
    for (const entry of await this.env.storage.listDirectory(booksPath())) {
      if (entry.kind !== "directory" || entry.name.startsWith(".")) continue;
      try {
        summaries.push(summarize(await this.readBook(entry.name)));
      } catch {
        // A half-synced or damaged book must not hide the rest of the library. It is reported
        // by opening it, and its folder is never deleted automatically.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createBook(input: {
    title: string;
    description?: string | undefined;
    outline?: string | undefined;
  }): Promise<BookMeta> {
    const now = this.env.runtime.now();
    const id = this.env.runtime.newId("book");
    const book = bookSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id,
      title: input.title.trim() || "Untitled book",
      description: input.description ?? "",
      outline: input.outline ?? "",
      createdAt: now,
      updatedAt: now
    });
    await this.ensureBookLayout(id);
    const result = await this.commitText(bookFilePath(id), `${JSON.stringify(book, null, 2)}\n`, { kind: "absent" });
    if (result.status !== "written") {
      throw new LibraryError("io", "A book with this identity already exists. Nothing was overwritten.");
    }
    await this.rebuildCatalog();
    return book;
  }

  async readBook(bookId: string): Promise<BookDetail> {
    const snapshot = await this.env.storage.readFile(bookFilePath(bookId));
    if (!snapshot) throw new LibraryError("not-found", `No book called ${bookId} in this library.`);
    const book = parseBookJson(textDecoder.decode(snapshot.bytes), libraryPathToArchivePath(bookFilePath(bookId)));
    const chapters = await this.readChapters(bookId);
    return { book, chapters };
  }

  async updateBook(bookId: string, patch: BookPatch): Promise<BookMeta> {
    return this.serializeWrite(bookId, async () => {
      const current = await this.readBook(bookId);
      const next = bookSchema.parse({
        ...current.book,
        ...patch,
        id: current.book.id,
        schemaVersion: current.book.schemaVersion,
        createdAt: current.book.createdAt,
        updatedAt: this.env.runtime.now()
      });
      await this.commitText(bookFilePath(bookId), `${JSON.stringify(next, null, 2)}\n`, { kind: "any" });
      await this.rebuildCatalog();
      return next;
    });
  }

  /* ----------------------------------------------------------------- chapters */

  async readChapter(bookId: string, chapterId: string): Promise<Chapter> {
    return (await this.locateChapter(bookId, chapterId)).chapter;
  }

  async createChapter(
    bookId: string,
    input: { title?: string | undefined; content?: string | undefined } = {}
  ): Promise<Chapter> {
    return this.serializeWrite(bookId, async () => {
      const existing = await this.readChapters(bookId);
      const order = existing.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1;
      const title = input.title?.trim() || `Chapter ${order}`;
      const now = this.env.runtime.now();
      const meta = chapterMetaSchema.parse({
        id: this.env.runtime.newId("ch"),
        title,
        order,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
      await this.ensureBookLayout(bookId);
      const content = normalizeBody(input.content ?? "");
      const text = serializeChapter(meta, content);

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const fileName = this.uniqueChapterFileName(order, title, attempt);
        const result = await this.commitText(chapterPath(bookId, fileName), text, { kind: "absent" });
        if (result.status === "written") {
          await this.rebuildCatalog();
          return chapterFrom(meta, content, fileName, result.snapshot.sha256);
        }
      }
      throw new LibraryError("io", "Could not find a free chapter file name. Nothing was written.");
    });
  }

  async saveChapter(
    bookId: string,
    chapterId: string,
    content: string,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    return this.serializeWrite(bookId, async () => {
      const { chapter: disk, fileName } = await this.locateChapter(bookId, chapterId);
      const normalized = normalizeBody(content);

      if (disk.content === normalized) {
        return { status: "saved", chapter: disk };
      }

      const conflict = (reason: ChapterConflict["reason"], localVersion: number): Promise<SaveChapterResult> =>
        this.preserveConflictingVersion(bookId, disk, fileName, normalized, reason, localVersion);

      if (disk.version > expected.baseVersion) {
        return conflict("newer-version", expected.baseVersion + 1);
      }
      if (disk.hash !== expected.baseHash) {
        return conflict("external-edit", expected.baseVersion + 1);
      }

      const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...stored } = disk;
      const meta: ChapterMeta = {
        ...stored,
        version: disk.version + 1,
        updatedAt: this.env.runtime.now()
      };
      const result = await this.commitText(chapterPath(bookId, fileName), serializeChapter(meta, normalized), {
        kind: "sha256",
        value: disk.hash
      });
      if (result.status === "changed") {
        const current = await this.chapterFromSnapshot(bookId, fileName, result.current);
        return this.preserveConflictingVersion(bookId, current, fileName, normalized, "external-edit", expected.baseVersion + 1);
      }
      await this.rebuildCatalog();
      return { status: "saved", chapter: chapterFrom(meta, normalized, fileName, result.snapshot.sha256) };
    });
  }

  async updateChapterMeta(
    bookId: string,
    chapterId: string,
    patch: ChapterMetaPatch,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    return this.serializeWrite(bookId, () => this.updateChapterMetaUnlocked(bookId, chapterId, patch, expected));
  }

  /**
   * Move one chapter past its neighbour by swapping their order metadata. File names stay as they
   * are: the order field is the source of truth, and renaming would invalidate every open editor.
   */
  async reorderChapter(bookId: string, chapterId: string, direction: ReorderDirection): Promise<ReorderChapterResult> {
    return this.serializeWrite(bookId, async () => {
      const chapters = await this.readChapters(bookId);
      const index = chapters.findIndex((chapter) => chapter.id === chapterId);
      if (index === -1) throw new LibraryError("not-found", "That chapter was not found.");

      const neighbourIndex = direction === "up" ? index - 1 : index + 1;
      if (neighbourIndex < 0 || neighbourIndex >= chapters.length) {
        return { status: "saved", chapters };
      }

      const moving = chapters[index]!;
      const neighbour = chapters[neighbourIndex]!;
      if (moving.order === neighbour.order) {
        throw new LibraryError(
          "invalid",
          "Two chapters share the same order. Fix their order in the chapter files before moving them."
        );
      }

      const first = await this.updateChapterMetaUnlocked(
        bookId,
        moving.id,
        { order: neighbour.order },
        { baseVersion: moving.version, baseHash: moving.hash }
      );
      if (first.status === "conflict") return first;

      const second = await this.updateChapterMetaUnlocked(
        bookId,
        neighbour.id,
        { order: moving.order },
        { baseVersion: neighbour.version, baseHash: neighbour.hash }
      );
      if (second.status === "conflict") {
        // The first write moved one chapter. Put it back when the second cannot commit, so a
        // failed move does not leave a half-swapped order. If the rollback also conflicts, the
        // original conflict is still reported and the author can reopen the book.
        await this.updateChapterMetaUnlocked(
          bookId,
          moving.id,
          { order: moving.order },
          { baseVersion: first.chapter.version, baseHash: first.chapter.hash }
        ).catch(() => {});
        return second;
      }

      return { status: "saved", chapters: await this.readChapters(bookId) };
    });
  }

  /**
   * Move one chapter to a position in the current order. This is the drag path; the rail's up/down
   * controls use the smaller two-write swap above. Only chapters whose order number changes are
   * rewritten, and a conflict rolls the earlier writes back.
   */
  async moveChapterTo(bookId: string, chapterId: string, targetIndex: number): Promise<ReorderChapterResult> {
    return this.serializeWrite(bookId, async () => {
      const chapters = await this.readChapters(bookId);
      const from = chapters.findIndex((chapter) => chapter.id === chapterId);
      if (from === -1) throw new LibraryError("not-found", "That chapter was not found.");

      const to = Number.isFinite(targetIndex)
        ? Math.max(0, Math.min(chapters.length - 1, Math.trunc(targetIndex)))
        : from;
      if (from === to) return { status: "saved", chapters };

      const ordered = [...chapters];
      const [moving] = ordered.splice(from, 1);
      if (!moving) throw new LibraryError("not-found", "That chapter was not found.");
      ordered.splice(to, 0, moving);

      const changed = ordered
        .map((chapter, index) => ({ chapter, order: index + 1 }))
        .filter(({ chapter, order }) => chapter.order !== order);
      const written: Array<{ chapter: Chapter; order: number }> = [];

      for (const item of changed) {
        const result = await this.updateChapterMetaUnlocked(
          bookId,
          item.chapter.id,
          { order: item.order },
          { baseVersion: item.chapter.version, baseHash: item.chapter.hash }
        );
        if (result.status === "conflict") {
          for (const previous of written.reverse()) {
            await this.updateChapterMetaUnlocked(
              bookId,
              previous.chapter.id,
              { order: previous.order },
              { baseVersion: previous.chapter.version, baseHash: previous.chapter.hash }
            ).catch(() => {});
          }
          return result;
        }
        written.push({ chapter: result.chapter, order: item.chapter.order });
      }

      return { status: "saved", chapters: await this.readChapters(bookId) };
    });
  }

  private async updateChapterMetaUnlocked(
    bookId: string,
    chapterId: string,
    patch: ChapterMetaPatch,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    const { chapter: disk, fileName } = await this.locateChapter(bookId, chapterId);
    const conflict = (reason: ChapterConflict["reason"], localVersion: number) =>
      this.preserveConflictingVersion(bookId, disk, fileName, disk.content, reason, localVersion);

    if (disk.version > expected.baseVersion) return conflict("newer-version", expected.baseVersion + 1);
    if (disk.hash !== expected.baseHash) return conflict("external-edit", expected.baseVersion + 1);

    const { content, path: _path, wordCount: _wordCount, hash: _hash, ...stored } = disk;
    const meta = chapterMetaSchema.parse({
      ...stored,
      ...patch,
      id: disk.id,
      version: disk.version + 1,
      updatedAt: this.env.runtime.now()
    });
    const result = await this.commitText(chapterPath(bookId, fileName), serializeChapter(meta, content), {
      kind: "sha256",
      value: disk.hash
    });
    if (result.status === "changed") {
      const current = await this.chapterFromSnapshot(bookId, fileName, result.current);
      return this.preserveConflictingVersion(bookId, current, fileName, disk.content, "external-edit", expected.baseVersion + 1);
    }
    await this.rebuildCatalog();
    return { status: "saved", chapter: chapterFrom(meta, content, fileName, result.snapshot.sha256) };
  }

  async deleteChapter(bookId: string, chapterId: string): Promise<{ trashedAt: string }> {
    return this.serializeWrite(bookId, async () => {
      const { fileName } = await this.locateChapter(bookId, chapterId);
      await this.ensureBookLayout(bookId);
      const stamp = this.stamp();

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const destination = toLibraryFilePath([
          ...trashPath(bookId),
          `${stamp}-${fileName.replace(/\.md$/, "")}${suffix}.md`
        ]);
        try {
          await this.env.storage.moveFile(chapterPath(bookId, fileName), destination);
          await this.rebuildCatalog();
          return { trashedAt: libraryPathToArchivePath(destination) };
        } catch (error) {
          if (error instanceof LibraryPortError && error.code === "already-exists") continue;
          throw error;
        }
      }
      throw new LibraryError("io", "Could not move the chapter to the trash folder. Nothing was deleted.");
    });
  }

  /** Move a whole book folder into the trash. The folder stays readable and restorable. */
  async deleteBook(bookId: string): Promise<{ trashedAt: string }> {
    return this.serializeWrite(bookId, async () => {
      const entries = await this.env.storage.listDirectory(bookPath(bookId));
      if (entries.length === 0) throw new LibraryError("not-found", "That book was not found.");
      const stamp = this.stamp();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const destination = bookTrashPath(`${stamp}${suffix}`, bookId);
        try {
          await this.env.storage.moveDirectory(bookPath(bookId), destination);
          await this.rebuildCatalog();
          return { trashedAt: libraryPathToArchivePath(destination) };
        } catch (error) {
          if (error instanceof LibraryPortError && error.code === "already-exists") continue;
          throw error;
        }
      }
      throw new LibraryError("io", "Could not move the book to the trash folder. Nothing was deleted.");
    });
  }

  async search(bookId: string, query: string, limit = 100): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const chapters = await this.readChapters(bookId);
    const hits: SearchHit[] = [];
    for (const chapter of chapters) {
      const lines = chapter.content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.toLowerCase().includes(needle)) continue;
        hits.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          order: chapter.order,
          line: index + 1,
          text: line.slice(0, 240)
        });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  /* ---------------------------------------------------------------- conflicts */

  async listConflicts(bookId: string): Promise<ChapterConflict[]> {
    const chapters = await this.readChapters(bookId);
    const byFile = new Map(chapters.map((chapter) => [chapter.path, chapter]));
    const conflicts: ChapterConflict[] = [];

    const directories: Array<{ path: LibraryPath; display: (name: string) => string }> = [
      { path: chaptersPath(bookId), display: (name) => chapterDisplayPath(bookId, name) },
      { path: conflictsPath(bookId), display: (name) => conflictDisplayPath(bookId, name) }
    ];

    for (const directory of directories) {
      for (const entry of await this.env.storage.listDirectory(directory.path)) {
        if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue;
        if (!isConflictCopyName(entry.name)) continue;
        const known = byFile.get(entry.name);
        conflicts.push({
          bookId,
          chapterId: known?.id ?? "",
          chapterTitle: known?.title ?? entry.name.replace(/\.md$/, ""),
          savedAs: directory.display(entry.name),
          reason: "provider-conflict-copy",
          diskVersion: known?.version ?? 0,
          localVersion: known?.version ?? 0
        });
      }
    }
    return conflicts;
  }

  /** `library.json` is a convenience catalog. It is derived and rebuilt, never read as truth. */
  async rebuildCatalog(): Promise<void> {
    try {
      const summaries = await this.listBooks();
      const catalog = {
        schemaVersion: SCHEMA_VERSION,
        app: "ai-book-studio",
        updatedAt: this.env.runtime.now(),
        books: summaries
      };
      await this.commitText(libraryIndexPath(), `${JSON.stringify(catalog, null, 2)}\n`, { kind: "any" });
    } catch (error) {
      console.warn("[library] Could not refresh library.json:", (error as Error).message);
    }
  }

  /* ------------------------------------------------------------------ private */

  private async ensureBookLayout(bookId: string): Promise<void> {
    for (const path of [
      bookPath(bookId),
      chaptersPath(bookId),
      conflictsPath(bookId),
      threadsPath(bookId),
      checkpointsPath(bookId)
    ]) {
      await this.env.storage.ensureDirectory(path);
    }
  }

  private async commitText(
    path: LibraryPath,
    text: string,
    expected: FileExpectation
  ): Promise<CommitFileResult> {
    return this.env.storage.commitFile(path, textEncoder.encode(text), expected);
  }

  private async locateChapter(bookId: string, chapterId: string): Promise<{ chapter: Chapter; fileName: string }> {
    for (const entry of await this.env.storage.listDirectory(chaptersPath(bookId))) {
      if (entry.kind !== "file" || !entry.name.endsWith(".md") || isConflictCopyName(entry.name)) continue;
      const chapter = await this.readChapterFile(bookId, entry.name);
      if (chapter.id === chapterId) return { chapter, fileName: entry.name };
    }
    throw new LibraryError("not-found", `No chapter ${chapterId} in this book.`);
  }

  private async readChapters(bookId: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    for (const entry of await this.env.storage.listDirectory(chaptersPath(bookId))) {
      if (entry.kind !== "file" || !entry.name.endsWith(".md") || isConflictCopyName(entry.name)) continue;
      try {
        chapters.push(await this.readChapterFile(bookId, entry.name));
      } catch (error) {
        console.warn(`[library] Skipping unreadable chapter ${entry.name}:`, (error as Error).message);
      }
    }
    return chapters.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }

  private async readChapterFile(bookId: string, fileName: string): Promise<Chapter> {
    const snapshot = await this.env.storage.readFile(chapterPath(bookId, fileName));
    if (!snapshot) throw new LibraryError("not-found", `The chapter file ${fileName} is missing.`);
    return this.chapterFromSnapshot(bookId, fileName, snapshot);
  }

  private async chapterFromSnapshot(
    bookId: string,
    fileName: string,
    snapshot: LibraryFileSnapshot | null
  ): Promise<Chapter> {
    if (!snapshot) throw new LibraryError("not-found", `The chapter file ${fileName} is missing.`);
    const raw = textDecoder.decode(snapshot.bytes);
    const displayPath = chapterDisplayPath(bookId, fileName);
    const fallback = await this.fallbackMeta(fileName, snapshot.createdAt, snapshot.modifiedAt);
    const parsed = parseChapterFile(raw, displayPath, fallback);
    return chapterFrom(parsed.meta, parsed.content, fileName, snapshot.sha256);
  }

  private async preserveConflictingVersion(
    bookId: string,
    disk: Chapter,
    fileName: string,
    localContent: string,
    reason: ChapterConflict["reason"],
    localVersion: number
  ): Promise<SaveChapterResult> {
    await this.ensureBookLayout(bookId);
    const stamp = this.env.runtime.now().replace(/[:.]/g, "-");
    const savedName = `${fileName.replace(/\.md$/, "")}.conflict-${reason}.${this.device.id}.${stamp}.md`;
    const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...stored } = disk;
    const text = serializeChapter({ ...stored, version: localVersion, updatedAt: this.env.runtime.now() }, localContent);
    await this.commitText(conflictPath(bookId, savedName), text, { kind: "absent" });

    return {
      status: "conflict",
      conflict: {
        bookId,
        chapterId: disk.id,
        chapterTitle: disk.title,
        savedAs: conflictDisplayPath(bookId, savedName),
        reason,
        diskVersion: disk.version,
        localVersion
      }
    };
  }

  /** Keeps one writer per book, so two calls cannot interleave a read and a write. */
  private serializeWrite<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(bookId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.writes.set(
      bookId,
      next.catch(() => {})
    );
    return next;
  }

  private uniqueChapterFileName(order: number, title: string, attempt: number): string {
    const base = chapterFileName(order, title).replace(/\.md$/, "");
    if (attempt === 0) return `${base}.md`;
    return `${base}-${attempt + 1}.md`;
  }

  private async fallbackMeta(fileName: string, created: string | null, modified: string | null): Promise<ChapterMeta> {
    const now = this.env.runtime.now();
    const order = parseOrderFromFileName(fileName) ?? 1;
    const slug = fileName.replace(/^\d+-/, "").replace(/\.md$/, "");
    const title = slug.replace(/-/g, " ").replace(/^\w/, (character) => character.toUpperCase()) || `Chapter ${order}`;
    const digest = (await this.env.runtime.sha256(textEncoder.encode(fileName))).slice(0, 16);
    return chapterMetaSchema.parse({
      id: `ch_${digest}`,
      title,
      order,
      version: 1,
      createdAt: validDate(created, now),
      updatedAt: validDate(modified, now)
    });
  }

  private stamp(): string {
    const millis = Date.parse(this.env.runtime.now());
    return Number.isFinite(millis) ? millis.toString(36) : this.env.runtime.now().replace(/\D/g, "").slice(-10);
  }
}

/* -------------------------------------------------------------------- helpers */

function summarize(detail: BookDetail): BookSummary {
  return {
    id: detail.book.id,
    title: detail.book.title,
    description: detail.book.description,
    stage: detail.book.stage,
    chapterCount: detail.chapters.length,
    wordCount: detail.chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    updatedAt: detail.book.updatedAt
  };
}

function chapterFrom(meta: ChapterMeta, content: string, fileName: string, hash: string): Chapter {
  return {
    ...meta,
    content,
    path: fileName,
    wordCount: countWords(content),
    hash
  };
}

function parseBookJson(raw: string, path: string): BookMeta {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new LibraryError("format", `book.json is not valid JSON: ${(error as Error).message}`);
  }
  assertSchemaVersion((data as { schemaVersion?: unknown } | null)?.schemaVersion, path);
  const parsed = bookSchema.safeParse(data);
  if (!parsed.success) {
    throw new LibraryError(
      "format",
      `book.json does not match the book schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`
    );
  }
  return parsed.data;
}

function assertSchemaVersion(version: unknown, path: string): void {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new LibraryError("invalid", `${path} has no schemaVersion. It may not be an AI Book Studio file.`);
  }
  if (version > SCHEMA_VERSION) {
    throw new LibraryError(
      "newer-schema",
      `${path} was written by a newer version of AI Book Studio (schema ${version}). Update the app before opening this library, so no fields are dropped.`
    );
  }
}

function validDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

/** Layout is created through the port, so every target creates the same ordinary folders. */
async function ensureLayout(storage: LibraryEnvironment["storage"]): Promise<void> {
  for (const path of [studioPath(), booksPath(), trashPath()]) {
    await storage.ensureDirectory(path);
  }
}
