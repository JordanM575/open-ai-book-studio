import type {
  BookChanges,
  BookDetail,
  BookEditResult,
  BookListing,
  BookMeta,
  BookSummary,
  Chapter,
  ChapterConflict,
  ReorderChapterResult,
  ReorderDirection,
  SearchHit,
  SaveChapterResult
} from "@ai-book-studio/core/schema";
import {
  LibraryService,
  type BookPatch,
  type ChapterMetaPatch,
  type KeepConflictCopyResult
} from "@ai-book-studio/core/library/service";
import type { BookMatter, SaveMatterResult } from "@ai-book-studio/core/matter";
import type {
  HistoryCaptureInput, HistoryComparison, HistoryListing, HistoryReadInput, HistoryScope, StoredHistoryRecord,
  HistoryRestoreInput, HistoryUndoInput
} from "@ai-book-studio/core/library/history";
import type { HistoryMutationResult, HistoryRecovery } from "@ai-book-studio/core/library/history-restore";
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
      new ThreadStore(environment.storage, environment.runtime, service.writeHost),
      new ImageStore(environment)
    );
  }

  get deviceId(): string {
    return this.service.deviceId;
  }

  get planning() { return this.service.planning; }
  get goals() { return this.service.goals; }
  get planningRecovery() { return this.service.planningRecovery; }

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

  /** Note files the studio wrote or removed beside the service, such as turn checkpoints, as this device's own. */
  noteOwnFiles(files: { written?: string[]; removed?: string[] }): Promise<void> {
    return this.service.noteOwnFiles(files);
  }

  listBooks(): Promise<BookSummary[]> {
    return this.service.listBooks();
  }

  listBooksWithIssues(): Promise<BookListing> {
    return this.service.listBooksWithIssues();
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

  /** Merge the fields an editor changed onto `book.json` as it is now; see `LibraryService.editBook`. */
  editBook(bookId: string, changes: BookChanges): Promise<BookEditResult> {
    return this.service.editBook(bookId, changes);
  }

  saveMatter(
    bookId: string,
    matter: BookMatter,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveMatterResult> {
    return this.service.saveMatter(bookId, matter, expected);
  }

  readChapter(bookId: string, chapterId: string): Promise<Chapter> {
    return this.service.readChapter(bookId, chapterId);
  }

  captureChapterHistory(input: HistoryCaptureInput): Promise<StoredHistoryRecord> {
    return this.service.captureChapterHistory(input);
  }

  listChapterHistory(scope: HistoryScope): Promise<HistoryListing> {
    return this.service.listChapterHistory(scope);
  }

  readChapterHistory(input: HistoryReadInput): Promise<StoredHistoryRecord> {
    return this.service.readChapterHistory(input);
  }

  compareChapterHistory(input: HistoryReadInput): Promise<HistoryComparison> {
    return this.service.compareChapterHistory(input);
  }

  restoreChapterHistory(input: HistoryRestoreInput, signal?: AbortSignal): Promise<HistoryMutationResult> {
    return this.service.restoreChapterHistory(input, signal);
  }

  undoChapterHistory(input: HistoryUndoInput, signal?: AbortSignal): Promise<HistoryMutationResult> {
    return this.service.undoChapterHistory(input, signal);
  }

  reconcileChapterHistory(input: HistoryReadInput): Promise<HistoryRecovery> {
    return this.service.reconcileChapterHistory(input);
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

  /** Move a deleted chapter's own file back from the trash, with its id and front matter. */
  restoreChapter(bookId: string, chapterId: string, trashedAt: string): Promise<Chapter> {
    return this.service.restoreChapter(bookId, chapterId, trashedAt);
  }

  /** Keep a chapter's file as it is now in `conflicts/`, before something replaces it. */
  keepConflictCopy(
    bookId: string,
    chapterId: string,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<KeepConflictCopyResult> {
    return this.service.keepConflictCopy(bookId, chapterId, expected);
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
