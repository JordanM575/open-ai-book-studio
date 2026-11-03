import type { SaveChapterResult } from "@ai-book-studio/core/schema";
import type { DriftReport } from "@ai-book-studio/core/sync/types";
import type { DraftBuffer } from "./drafts";
import type { Library } from "./library/store";
import { DEFAULT_SYNC_CHECK_INTERVAL_MINUTES, type SettingsStore } from "./settings";

/**
 * The desktop drift runner. It scans on library open and when the window regains focus after the
 * configured interval, records when it last ran, and resolves what the author reviews. Scans are
 * read-only; the journal baseline only advances through `accept`, after review, and own writes
 * note themselves at save time so they never report as someone else's edit.
 */
export class SyncService {
  constructor(
    private readonly studio: { library: Library | null; drafts: DraftBuffer },
    private readonly settings: SettingsStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Run a full scan now and remember when it ran. Null when no library is open. The first scan
   * on a fresh library records the current state as the baseline, so later opens can tell what
   * changed; without that first baseline every scan would report nothing forever.
   */
  async check(): Promise<DriftReport | null> {
    const library = this.studio.library;
    if (!library) return null;
    await library.establishBaseline();
    const report = await library.checkDrift(this.studio.drafts.dirtyChapterIds());
    await this.settings.update({ lastSyncScanAt: report.scannedAt });
    return report;
  }

  /**
   * Run a scan when the window regains focus, at most as often as configured. Returns the report,
   * or null when no library is open or the last scan is still fresh.
   */
  async maybeCheckOnFocus(): Promise<DriftReport | null> {
    if (!this.studio.library) return null;
    const interval = this.settings.get().syncCheckIntervalMinutes ?? DEFAULT_SYNC_CHECK_INTERVAL_MINUTES;
    const last = this.settings.get().lastSyncScanAt;
    const lastTime = typeof last === "string" ? Date.parse(last) : Number.NaN;
    if (Number.isFinite(lastTime) && this.nowMillis() - lastTime < interval * 60_000) return null;
    return this.check();
  }

  /** Fold reviewed paths into the baseline and return the fresh report. */
  async accept(paths: string[]): Promise<DriftReport | null> {
    const library = this.studio.library;
    if (!library) return null;
    const report = await library.acceptDrift(paths);
    await this.settings.update({ lastSyncScanAt: report.scannedAt });
    return report;
  }

  /**
   * Save one chapter's draft through the normal checked path ("keep mine"). Returns the save
   * outcome: a conflict preserves the text as a conflict copy and never overwrites the disk.
   * Null when no draft or no library is open.
   */
  async keepMine(bookId: string, chapterId: string): Promise<SaveChapterResult | null> {
    const library = this.studio.library;
    if (!library) return null;
    return this.studio.drafts.flushOne(library, bookId, chapterId);
  }

  /** Drop one chapter's unsent draft ("keep the disk version" for unsaved text). */
  discardDraft(bookId: string, chapterId: string): void {
    this.studio.drafts.clear(bookId, chapterId);
  }

  private nowMillis(): number {
    const parsed = Date.parse(this.now());
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
}
