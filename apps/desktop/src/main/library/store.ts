import type {
  BookDetail,
  BookMeta,
  BookSummary,
  Chapter,
  ChapterConflict,
  ReorderChapterResult,
  ReorderDirection,
  SearchHit,
  SaveChapterResult
} from "@ai-book-studio/core/schema";
import { LibraryService, type BookPatch, type ChapterMetaPatch } from "@ai-book-studio/core/library/service";
import { ThreadStore } from "@ai-book-studio/core/agent/threads";
import type { LocationHealth } from "@ai-book-studio/core/sync/health";
import type { DriftReport } from "@ai-book-studio/core/sync/types";
import { ImageStore, type AddImageInput, type ImageList, type ImageRecord, type StoredImage } from "@ai-book-studio/core/images";
import { createFileSystemEnvironment } from "./fs-port";
import { resolveLibraryRoot } from "./paths";

export type { LibraryErrorCode } from "./errors";
export { LibraryError } from "./errors";

/**
 * The desktop face of the shared library service.
 *
 * Everything that defines the book format, checked saves, conflicts, trash and the catalog is
 * in `@ai-book-studio/core/library/service`. This class binds that service to Electron's
 * filesystem adapter and keeps the API the main process already uses.
 */
export class Library {
  private constructor(
    readonly root: string,
    private readonly service: LibraryService,
    readonly threads: ThreadStore,
    readonly images: ImageStore
  ) {}

  static async open(folder: string): Promise<Library> {
    const root = resolveLibraryRoot(folder);
    const environment = createFileSystemEnvironment(root);
    const service = await LibraryService.open(environment);
    return new Library(
      root,
      service,
      new ThreadStore(environment.storage, environment.runtime),
      new ImageStore(environment)
    );
  }

  get deviceId(): string {
    return this.service.deviceId;
  }

  get deviceName(): string {
    return this.service.deviceName;
  }

  watch(onChange: (path: string) => void): () => void {
    return this.service.watch(onChange);
  }

  locationHealth(): Promise<LocationHealth> {
    return this.service.locationHealth();
  }

  establishBaseline(): Promise<boolean> {
    return this.service.establishBaseline();
  }

  checkDrift(dirtyChapterIds?: Iterable<string>): Promise<DriftReport> {
    return this.service.checkDrift(dirtyChapterIds);
  }

  acceptDrift(paths: string[]): Promise<DriftReport> {
    return this.service.acceptDrift(paths);
  }

  listBooks(): Promise<BookSummary[]> {
    return this.service.listBooks();
  }

  createBook(input: {
    title: string;
    description?: string | undefined;
    outline?: string | undefined;
  }): Promise<BookMeta> {
    return this.service.createBook(input);
  }

  readBook(bookId: string): Promise<BookDetail> {
    return this.service.readBook(bookId);
  }

  importManuscript(input: {
    bookTitle: string;
    chapters: Array<{ title: string; content: string }>;
  }): Promise<BookDetail> {
    return this.service.importManuscript(input);
  }

  updateBook(bookId: string, patch: BookPatch): Promise<BookMeta> {
    return this.service.updateBook(bookId, patch);
  }

  readChapter(bookId: string, chapterId: string): Promise<Chapter> {
    return this.service.readChapter(bookId, chapterId);
  }

  createChapter(
    bookId: string,
    input: { title?: string | undefined; content?: string | undefined } = {}
  ): Promise<Chapter> {
    return this.service.createChapter(bookId, input);
  }

  saveChapter(
    bookId: string,
    chapterId: string,
    content: string,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    return this.service.saveChapter(bookId, chapterId, content, expected);
  }

  updateChapterMeta(
    bookId: string,
    chapterId: string,
    patch: ChapterMetaPatch,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    return this.service.updateChapterMeta(bookId, chapterId, patch, expected);
  }

  reorderChapter(bookId: string, chapterId: string, direction: ReorderDirection): Promise<ReorderChapterResult> {
    return this.service.reorderChapter(bookId, chapterId, direction);
  }

  moveChapterTo(bookId: string, chapterId: string, targetIndex: number): Promise<ReorderChapterResult> {
    return this.service.moveChapterTo(bookId, chapterId, targetIndex);
  }

  deleteChapter(bookId: string, chapterId: string): Promise<{ trashedAt: string }> {
    return this.service.deleteChapter(bookId, chapterId);
  }

  deleteBook(bookId: string): Promise<{ trashedAt: string }> {
    return this.service.deleteBook(bookId);
  }

  search(bookId: string, query: string, limit = 100): Promise<SearchHit[]> {
    return this.service.search(bookId, query, limit);
  }

  listConflicts(bookId: string): Promise<ChapterConflict[]> {
    return this.service.listConflicts(bookId);
  }

  rebuildCatalog(): Promise<void> {
    return this.service.rebuildCatalog();
  }

  listImages(bookId: string): Promise<ImageList> {
    return this.images.list(bookId);
  }

  readImage(bookId: string, imageId: string): Promise<StoredImage | null> {
    return this.images.read(bookId, imageId);
  }

  addImage(bookId: string, input: AddImageInput): Promise<ImageRecord> {
    return this.images.add(bookId, input);
  }

  attachImage(bookId: string, imageId: string, chapterId: string): Promise<ImageRecord> {
    return this.images.attach(bookId, imageId, chapterId);
  }

  attachCharacterImage(bookId: string, imageId: string, characterId: string): Promise<ImageRecord> {
    return this.images.attachCharacter(bookId, imageId, characterId);
  }

  removeImage(bookId: string, imageId: string): Promise<void> {
    return this.images.remove(bookId, imageId);
  }
}
