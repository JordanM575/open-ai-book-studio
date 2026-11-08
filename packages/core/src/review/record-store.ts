import { bookSchema } from "../schema";
import { LibraryError, LibraryPortError } from "../library/errors";
import { libraryPathFromArchivePath, libraryPathToArchivePath, toLibraryFilePath, toLibraryPath } from "../library/path";
import type { LibraryPath } from "../library/path";
import { bookFilePath, conflictPath, conflictsPath, trashPath } from "../library/paths";
import type { CommitFileResult, FileExpectation, LibraryFileSnapshot, LibraryPort, LibraryRuntime } from "../library/port";
import { assertBookWritable, assertSchemaVersion } from "../library/schema-guard";
import { noteMovedPrefix } from "../sync/journal";
import type { ReaderRun } from "./findings";
import type { ReaderProfile } from "./profiles";
import { builtinReaderProfile, validateReaderProfile } from "./profiles";
import { ReviewRecordError } from "./record-error";
import { bytesEqual, jsonBytes, REVIEW_RECORD_BYTES } from "./record-json";
import {
  applyDispositionEvent, buildCampaignRecord, buildProfileRecord, buildReviewReport, decodeReviewRecord,
  dispositionStateSchema, encodeReviewRecord, newDispositionsRecord, recordIdSchema, reportRecordBytes,
  type CampaignDraft, type DecodedReviewRecord, type DispositionState,
  type ReviewRecordBase, type ReviewRecordKind
} from "./record-format";

/**
 * Checked storage for explicit saved review records (039 T014/T015 / D-199 / ADR 0020).
 *
 * Reports are immutable and absent-only; dispositions, author lenses and campaigns are checked
 * revisions carrying the exact previous raw hash. Every read-modify-write joins the Library's
 * per-book queue and every commit uses the service's journal-aware checked writer. There is no
 * second queue, no direct adapter commit, no automatic pruning and no permanent delete.
 */

const REVIEWS = "reviews";
const decoder = new TextDecoder("utf-8", { fatal: true });

export const reviewsPath = (bookId: string): LibraryPath => toLibraryPath(["books", bookId, REVIEWS]);
export const reportPath = (bookId: string, id: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, REVIEWS, `${id}.json`]);
export const dispositionsPath = (bookId: string): LibraryPath => toLibraryPath(["books", bookId, REVIEWS, "dispositions"]);
export const dispositionPath = (bookId: string, id: string): LibraryPath =>
  toLibraryFilePath([...dispositionsPath(bookId), `${id}.json`]);
export const profilesPath = (bookId: string): LibraryPath => toLibraryPath(["books", bookId, REVIEWS, "profiles"]);
export const profilePath = (bookId: string, id: string): LibraryPath =>
  toLibraryFilePath([...profilesPath(bookId), `${id}.json`]);
export const campaignsPath = (bookId: string): LibraryPath => toLibraryPath(["books", bookId, REVIEWS, "campaigns"]);
export const campaignPath = (bookId: string, id: string): LibraryPath =>
  toLibraryFilePath([...campaignsPath(bookId), `${id}.json`]);
/** Deleted review records keep their group so a report and its dispositions restore together. */
export const reviewTrashPath = (bookId: string): LibraryPath => toLibraryPath([...trashPath(bookId), REVIEWS]);
export const reviewTrashGroupPath = (bookId: string, stamp: string): LibraryPath =>
  toLibraryPath([...reviewTrashPath(bookId), stamp]);

export interface ReviewRecordHost {
  storage: LibraryPort;
  runtime: LibraryRuntime;
  deviceId: string;
  /** The SAME queue used by chapter/book saves, including queued reads. */
  withBook<T>(bookId: string, work: () => Promise<T>): Promise<T>;
  /** The service's journal-aware checked commit; never an unchecked writer. */
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
  moveFile(from: LibraryPath, to: LibraryPath): Promise<void>;
}

export type ReviewBaseRequest = { kind: "absent" } | { kind: "sha256"; value: string; revision: number };
export type ReviewRecordSnapshot<K extends ReviewRecordKind> = DecodedReviewRecord<K> & { hash: string };

export interface ReportSummary {
  id: string;
  profileId: string;
  profileVersion: number;
  books: string[];
  completedAt: string;
  savedAt: string;
  findings: number;
  quotations: number;
  size: number;
  hash: string;
}

export interface ReportListing {
  bookId: string;
  offset: number;
  limit: number;
  total: number;
  reports: ReportSummary[];
  issues: Array<{ fileName: string; code: string; message: string }>;
}

export type TrashResult = { status: "trashed"; trashedAt: string; files: string[] } | { status: "missing" };

function pathFor(kind: ReviewRecordKind, bookId: string, id: string): LibraryPath {
  if (kind === "review-report") return reportPath(bookId, id);
  if (kind === "review-dispositions") return dispositionPath(bookId, id);
  if (kind === "reader-profile-record") return profilePath(bookId, id);
  return campaignPath(bookId, id);
}

function relativeFor(kind: ReviewRecordKind, id: string): string[] {
  if (kind === "review-report") return [`${id}.json`];
  if (kind === "review-dispositions") return ["dispositions", `${id}.json`];
  if (kind === "reader-profile-record") return ["profiles", `${id}.json`];
  return ["campaigns", `${id}.json`];
}

function baseOf(record: Record<string, unknown>): ReviewRecordBase {
  const base = record.base;
  return base && typeof base === "object" ? (base as ReviewRecordBase) : { kind: "absent", revision: 0 };
}

export class ReviewRecordStore {
  constructor(private readonly host: ReviewRecordHost) {}

  /* --------------------------------------------------------------- reports */

  async createReport(
    bookId: string,
    run: ReaderRun
  ): Promise<{ status: "created" | "unchanged"; report: ReviewRecordSnapshot<"review-report"> }> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      // Saving the same run again must stay idempotent after the clock advances: only a report
      // whose bytes match exactly (including savedAt) is unchanged. An existing-but-different report
      // keeps its own time in the conflict copy and this save uses the current time.
      let savedAt = this.now();
      const existing = await this.loadReport(bookId, run.runId).catch(() => null);
      if (existing) {
        const reused = await buildReviewReport({
          ownerBookId: bookId,
          run,
          savedAt: existing.record.savedAt,
          sha256: (text) => this.sha256Text(text)
        });
        if (bytesEqual(reportRecordBytes(reused), existing.bytes)) savedAt = existing.record.savedAt;
      }
      const report = await buildReviewReport({
        ownerBookId: bookId,
        run,
        savedAt,
        sha256: (text) => this.sha256Text(text)
      });
      const bytes = reportRecordBytes(report);
      return this.createOnly("review-report", bookId, report.id, bytes);
    });
  }

  async readReport(bookId: string, id: string): Promise<ReviewRecordSnapshot<"review-report"> | null> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      return this.loadReport(bookId, id);
    });
  }

  async listReports(
    bookId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<ReportListing> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new ReviewRecordError("invalid", "The review list offset is not valid.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new ReviewRecordError("invalid", "The review list page is not valid; use 1 to 200.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      const issues: ReportListing["issues"] = [];
      const reports: ReportSummary[] = [];
      const entries = await this.listDirectory(reviewsPath(bookId));
      for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
        const id = entry.name.slice(0, -".json".length);
        if (!recordIdSchema.safeParse(id).success) {
          issues.push({ fileName: entry.name, code: "invalid", message: "This file name is not a review run ID. It was left untouched." });
          continue;
        }
        try {
          const snapshot = await this.loadReport(bookId, id);
          if (!snapshot) {
            issues.push({ fileName: entry.name, code: "not-found", message: "This review disappeared while listing. It was left untouched." });
            continue;
          }
          const stat = await this.host.storage.stat(reportPath(bookId, id));
          reports.push({
            id,
            profileId: snapshot.record.profile.id,
            profileVersion: snapshot.record.profile.version,
            books: snapshot.record.books.map((book) => book.bookId),
            completedAt: snapshot.record.run.completedAt,
            savedAt: snapshot.record.savedAt,
            findings: snapshot.record.findings.length,
            quotations: snapshot.record.findings.reduce((total, finding) => total + finding.evidence.length, 0),
            size: stat?.size ?? snapshot.bytes.byteLength,
            hash: snapshot.hash
          });
        } catch (error) {
          issues.push({
            fileName: entry.name,
            code: error instanceof ReviewRecordError ? error.code : "io",
            message: error instanceof ReviewRecordError
              ? error.message
              : "This review could not be read. It was left untouched; check access to the library folder."
          });
        }
      }
      reports.sort((left, right) =>
        right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id)
      );
      issues.sort((left, right) => left.fileName.localeCompare(right.fileName));
      return { bookId, offset, limit, total: reports.length, reports: reports.slice(offset, offset + limit), issues };
    });
  }

  /* ---------------------------------------------------------- dispositions */

  async readDispositions(bookId: string, id: string): Promise<ReviewRecordSnapshot<"review-dispositions"> | null> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      return this.readRecord("review-dispositions", bookId, id);
    });
  }

  /**
   * Append one author disposition event. The referenced report must still be the file whose hash
   * the disposition document names, and the finding must exist in that report.
   */
  async recordDisposition(
    bookId: string,
    runId: string,
    change: { findingId: string; state: DispositionState; note?: string }
  ): Promise<{ status: "saved" | "unchanged"; record: ReviewRecordSnapshot<"review-dispositions"> }> {
    dispositionStateSchema.parse(change.state);
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      const report = await this.loadReport(bookId, runId);
      if (!report) throw new ReviewRecordError("not-found", "The saved review for this run is missing. Nothing was written.");
      if (!report.record.findings.some((finding) => finding.findingId === change.findingId)) {
        throw new ReviewRecordError("not-found", "That finding is not in the saved report. Nothing was written.");
      }
      const current = await this.readRecord("review-dispositions", bookId, runId);
      if (current && current.record.report.hash !== report.hash) {
        throw new ReviewRecordError("invalid", "The saved review changed since these dispositions were recorded. Nothing was written.");
      }
      const at = this.now();
      const base = current?.record ?? newDispositionsRecord({
        bookId,
        runId,
        reportHash: report.hash,
        completedAt: report.record.run.completedAt,
        at
      });
      const applied = applyDispositionEvent(base, {
        findingId: change.findingId,
        state: change.state,
        at,
        ...(change.note === undefined ? {} : { note: change.note })
      });
      if (!applied.changed) {
        if (!current) throw new ReviewRecordError("io", "The disposition document could not be prepared. Nothing was written.");
        return { status: "unchanged" as const, record: current };
      }
      const next = current
        ? {
            ...applied.record,
            revision: current.record.revision + 1,
            base: { kind: "sha256" as const, value: current.hash, revision: current.record.revision },
            updatedAt: at
          }
        : applied.record;
      return this.commitValue("review-dispositions", bookId, next, current);
    });
  }

  /* --------------------------------------------------------------- lenses */

  async readProfile(bookId: string, id: string): Promise<ReviewRecordSnapshot<"reader-profile-record"> | null> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      const snapshot = await this.readRecord("reader-profile-record", bookId, id);
      return snapshot ? this.verifyProfileRecord(snapshot) : null;
    });
  }

  /** Save an author lens. Built-in lenses need no file; an edit advances the lens version by one. */
  async saveProfile(
    bookId: string,
    profileInput: unknown,
    base: ReviewBaseRequest
  ): Promise<{ status: "saved" | "unchanged"; record: ReviewRecordSnapshot<"reader-profile-record"> }> {
    let profile: ReaderProfile;
    try {
      profile = await validateReaderProfile(profileInput);
    } catch (error) {
      if (error instanceof ReviewRecordError) throw error;
      throw new ReviewRecordError("invalid", "The reader lens is invalid or its digest does not match. Nothing was written.");
    }
    if (profile.origin !== "author") {
      throw new ReviewRecordError("invalid", "Built-in reader lenses need no saved file. Nothing was written.");
    }
    if (!recordIdSchema.safeParse(profile.id).success) {
      throw new ReviewRecordError("invalid", "This reader lens ID is not a portable file name. Nothing was written.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      const current = await this.readRecord("reader-profile-record", bookId, profile.id);
      if (current) {
        const verified = await this.verifyProfileRecord(current);
        if (canonicalProfile(verified.record.profile) === canonicalProfile(profile)) {
          return { status: "unchanged" as const, record: verified };
        }
        // Only judge the next version when this save is actually based on the record it read. A
        // stale base must reach commitValue, which keeps the author's edit as a conflict copy
        // instead of rejecting it before anything can be preserved.
        const basedOnCurrent = base.kind === "sha256" &&
          base.value === current.hash && base.revision === current.record.revision;
        if (basedOnCurrent && profile.version !== verified.record.profile.version + 1) {
          throw new ReviewRecordError("invalid", "A lens edit advances its version by exactly one. Nothing was written.");
        }
      }
      const revision = base.kind === "absent" ? 1 : base.revision + 1;
      const value = buildProfileRecord({
        bookId,
        profile,
        revision,
        base: base.kind === "absent" ? { kind: "absent", revision: 0 } : { kind: "sha256", value: base.value, revision: base.revision },
        createdAt: current?.record.createdAt ?? this.now(),
        updatedAt: this.now(),
        ...(current ? { previous: current.raw } : {})
      });
      return this.commitValue("reader-profile-record", bookId, value, current);
    });
  }

  /* ------------------------------------------------------------- campaigns */

  async readCampaign(bookId: string, id: string): Promise<ReviewRecordSnapshot<"review-campaign"> | null> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      return this.readRecord("review-campaign", bookId, id);
    });
  }

  /**
   * Save a campaign manifest. Stage report references must resolve to this book's immutable reports
   * with the exact recorded hash; the record grants no execution authority.
   */
  async saveCampaign(
    bookId: string,
    id: string,
    draft: CampaignDraft,
    base: ReviewBaseRequest
  ): Promise<{ status: "saved" | "unchanged"; record: ReviewRecordSnapshot<"review-campaign"> }> {
    if (!recordIdSchema.safeParse(id).success) {
      throw new ReviewRecordError("invalid", "This campaign ID is not a portable file name. Nothing was written.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      const current = await this.readRecord("review-campaign", bookId, id);
      await this.assertCampaignReferences(bookId, draft);
      const revision = base.kind === "absent" ? 1 : base.revision + 1;
      const value = buildCampaignRecord({
        bookId,
        id,
        revision,
        base: base.kind === "absent" ? { kind: "absent", revision: 0 } : { kind: "sha256", value: base.value, revision: base.revision },
        draft,
        createdAt: current?.record.createdAt ?? this.now(),
        updatedAt: this.now(),
        ...(current ? { previous: current.raw } : {})
      });
      return this.commitValue("review-campaign", bookId, value, current);
    });
  }

  /* ----------------------------------------------------------- trash/restore */

  /** Move the report and its dispositions into one recoverable trash group. Nothing is permanently deleted. */
  async trashReport(bookId: string, runId: string): Promise<TrashResult> {
    if (!recordIdSchema.safeParse(runId).success) {
      throw new ReviewRecordError("invalid", "That run ID is not valid. Nothing was moved.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      return this.trashEntries(bookId, [
        { kind: "review-dispositions", id: runId, path: dispositionPath(bookId, runId) },
        { kind: "review-report", id: runId, path: reportPath(bookId, runId) }
      ]);
    });
  }

  /** Restore the very files `trashReport` moved. Both destinations must be absent. */
  async restoreReport(
    bookId: string,
    runId: string,
    trashedAt: string
  ): Promise<{ report: { hash: string } | null; dispositions: { hash: string } | null; files: string[] }> {
    if (!recordIdSchema.safeParse(runId).success) {
      throw new ReviewRecordError("invalid", "That run ID is not valid. Nothing was moved.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      const group = this.trashGroup(bookId, trashedAt);
      const sources = [
        { kind: "review-dispositions" as const, path: toLibraryFilePath([...group, ...relativeFor("review-dispositions", runId)]) },
        { kind: "review-report" as const, path: toLibraryFilePath([...group, ...relativeFor("review-report", runId)]) }
      ];
      const present: Array<(typeof sources)[number] & { hash: string }> = [];
      for (const source of sources) {
        const snapshot = await this.host.storage.readFile(source.path);
        if (snapshot) present.push({ ...source, hash: snapshot.sha256 });
      }
      if (present.length === 0) {
        throw new ReviewRecordError("not-found", "That review is no longer in the trash. Nothing was moved.");
      }
      const destinations = present.map((source) => ({
        ...source,
        destination: pathFor(source.kind, bookId, runId)
      }));
      for (const entry of destinations) {
        if (await this.host.storage.readFile(entry.destination)) {
          throw new ReviewRecordError("exists", "A review already occupies that location. Nothing was moved; the trash copy was kept.");
        }
      }
      let reportHash: string | null = null;
      let dispositionsHash: string | null = null;
      const reportEntry = destinations.find((entry) => entry.kind === "review-report");
      if (reportEntry) {
        const snapshot = await this.requireVerified(reportEntry.path);
        const decoded = decodeReviewRecord(snapshot.bytes, { kind: "review-report", bookId });
        if (decoded.record.id !== runId) throw new ReviewRecordError("corrupt", "The trashed review has another identity. Nothing was moved.");
        reportHash = snapshot.sha256;
      }
      const dispositionsEntry = destinations.find((entry) => entry.kind === "review-dispositions");
      if (dispositionsEntry) {
        const snapshot = await this.requireVerified(dispositionsEntry.path);
        const decoded = decodeReviewRecord(snapshot.bytes, { kind: "review-dispositions", bookId });
        if (decoded.record.id !== runId) throw new ReviewRecordError("corrupt", "The trashed dispositions have another identity. Nothing was moved.");
        const reportBytes = reportEntry
          ? await this.requireVerified(reportEntry.path)
          : await this.host.storage.readFile(reportPath(bookId, runId));
        if (!reportBytes) {
          throw new ReviewRecordError("not-found", "The dispositions' saved review is missing, so they cannot be restored alone. Nothing was moved.");
        }
        if (decoded.record.report.hash !== reportBytes.sha256) {
          throw new ReviewRecordError("invalid", "The dispositions name another version of the saved review. Nothing was moved.");
        }
        dispositionsHash = snapshot.sha256;
      }
      const moved: string[] = [];
      const ordered = [...destinations].sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "review-report" ? -1 : 1));
      try {
        for (const entry of ordered) {
          await this.host.storage.ensureDirectory(parentOf(entry.destination));
          await this.host.moveFile(entry.path, entry.destination);
          let after: LibraryFileSnapshot;
          try {
            after = await this.requireVerified(entry.destination);
          } catch {
            throw new ReviewRecordError(
              "uncertain",
              "A trashed review did not return exactly as it was kept. Check both locations before retrying."
            );
          }
          if (after.sha256 !== entry.hash || (await this.host.storage.readFile(entry.path))) {
            throw new ReviewRecordError(
              "uncertain",
              "A trashed review did not return exactly as it was kept. Check both locations before retrying."
            );
          }
          await this.noteMove(entry.path, entry.destination);
          moved.push(libraryPathToArchivePath(entry.destination));
        }
      } catch (error) {
        if (error instanceof LibraryPortError && error.code === "already-exists") {
          throw new ReviewRecordError("exists", "A review appeared at that location while restoring. Nothing else was moved; the trash copy was kept.");
        }
        throw error;
      }
      return { report: reportHash === null ? null : { hash: reportHash }, dispositions: dispositionsHash === null ? null : { hash: dispositionsHash }, files: moved };
    });
  }

  async trashProfile(bookId: string, profileId: string): Promise<TrashResult> {
    return this.trashSingle("reader-profile-record", bookId, profileId);
  }

  async restoreProfile(bookId: string, profileId: string, trashedAt: string): Promise<{ hash: string; files: string[] }> {
    return this.restoreSingle("reader-profile-record", bookId, profileId, trashedAt);
  }

  async trashCampaign(bookId: string, campaignId: string): Promise<TrashResult> {
    return this.trashSingle("review-campaign", bookId, campaignId);
  }

  async restoreCampaign(bookId: string, campaignId: string, trashedAt: string): Promise<{ hash: string; files: string[] }> {
    return this.restoreSingle("review-campaign", bookId, campaignId, trashedAt);
  }

  /* ---------------------------------------------------------------- internals */

  private async createOnly<K extends ReviewRecordKind>(
    kind: K,
    bookId: string,
    id: string,
    bytes: Uint8Array
  ): Promise<{ status: "created"; report: ReviewRecordSnapshot<K> } | { status: "unchanged"; report: ReviewRecordSnapshot<K> }> {
    const path = pathFor(kind, bookId, id);
    const existing = await this.host.storage.readFile(path);
    const conflict = async (observed: LibraryFileSnapshot | null): Promise<never> => {
      const savedAs = await this.preserve(kind, bookId, id, bytes, observed?.sha256 ?? null);
      throw new ReviewRecordError(
        "conflict",
        "A record with this identity already exists with different bytes. This version was kept as a copy; nothing was replaced.",
        savedAs
      );
    };
    if (existing) {
      if (bytesEqual(existing.bytes, bytes)) {
        const current = await this.readRecord(kind, bookId, id);
        if (!current) throw new ReviewRecordError("io", "The saved record disappeared while it was read. Nothing was replaced.");
        return { status: "unchanged", report: current as ReviewRecordSnapshot<K> };
      }
      return conflict(existing);
    }
    let result: CommitFileResult;
    try {
      result = await this.host.commitFile(path, bytes, { kind: "absent" });
    } catch (error) {
      throw this.writeFailure(error);
    }
    if (result.status === "changed") {
      if (result.current && bytesEqual(result.current.bytes, bytes)) {
        const current = await this.readRecord(kind, bookId, id);
        if (current) return { status: "unchanged", report: current as ReviewRecordSnapshot<K> };
      }
      return conflict(result.current);
    }
    const snapshot = await this.verifyBytes(result.snapshot, bytes);
    const decoded = decodeReviewRecord(snapshot.bytes, { kind, bookId });
    return { status: "created", report: { ...decoded, hash: snapshot.sha256 } as ReviewRecordSnapshot<K> };
  }

  private async commitValue<K extends "review-dispositions" | "reader-profile-record" | "review-campaign">(
    kind: K,
    bookId: string,
    value: unknown,
    current: ReviewRecordSnapshot<K> | null
  ): Promise<{ status: "saved" | "unchanged"; record: ReviewRecordSnapshot<K> }> {
    const bytes = encodeReviewRecord(kind, value);
    const intended = decodeReviewRecord(bytes, { kind, bookId });
    const id = intended.record.id;
    const path = pathFor(kind, bookId, id);
    if (current) {
      if (bytesEqual(current.bytes, bytes)) return { status: "unchanged", record: current };
      const base = baseOf(intended.raw);
      const stale =
        base.kind !== "sha256" ||
        base.value !== current.hash ||
        base.revision !== (current.record as { revision: number }).revision;
      if (stale) {
        const savedAs = await this.preserve(kind, bookId, id, bytes, current.hash);
        throw new ReviewRecordError(
          "conflict",
          "This review record changed since it was read. Your version was kept as a copy; nothing was overwritten.",
          savedAs
        );
      }
    } else if (baseOf(intended.raw).kind !== "absent") {
      const savedAs = await this.preserve(kind, bookId, id, bytes, null);
      throw new ReviewRecordError(
        "conflict",
        "The review record this save started from is missing. Your version was kept as a copy; the active location was not recreated.",
        savedAs
      );
    }
    let result: CommitFileResult;
    try {
      result = await this.host.commitFile(
        path,
        bytes,
        current ? { kind: "sha256", value: current.hash } : { kind: "absent" }
      );
    } catch (error) {
      throw this.writeFailure(error);
    }
    if (result.status === "changed") {
      const savedAs = await this.preserve(kind, bookId, id, bytes, result.current?.sha256 ?? null);
      throw new ReviewRecordError(
        "conflict",
        "This review record changed while it was saved. Your version was kept as a copy; nothing was overwritten.",
        savedAs
      );
    }
    const snapshot = await this.verifyBytes(result.snapshot, bytes);
    const decoded = decodeReviewRecord(snapshot.bytes, { kind, bookId });
    return { status: "saved", record: { ...decoded, hash: snapshot.sha256 } };
  }

  private async readRecord<K extends ReviewRecordKind>(
    kind: K,
    bookId: string,
    id: string
  ): Promise<ReviewRecordSnapshot<K> | null> {
    if (!recordIdSchema.safeParse(id).success) {
      throw new ReviewRecordError("invalid", "That review record ID is not a safe file name.");
    }
    const path = pathFor(kind, bookId, id);
    const stat = await this.host.storage.stat(path);
    if (!stat) return null;
    if (stat.size > REVIEW_RECORD_BYTES) {
      throw new ReviewRecordError(
        "too-large",
        `This review record is larger than the ${REVIEW_RECORD_BYTES.toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
      );
    }
    const snapshot = await this.requireVerified(path);
    const decoded = decodeReviewRecord(snapshot.bytes, { kind, bookId });
    if (decoded.record.id !== id) {
      throw new ReviewRecordError("corrupt", "This review record has another identity than its file. The file was left untouched.");
    }
    return { ...decoded, hash: snapshot.sha256 };
  }

  private async loadReport(bookId: string, id: string): Promise<ReviewRecordSnapshot<"review-report"> | null> {
    const snapshot = await this.readRecord("review-report", bookId, id);
    if (!snapshot) return null;
    try {
      await validateReaderProfile(snapshot.record.profile);
    } catch {
      throw new ReviewRecordError("corrupt", "The saved review's reader lens snapshot does not verify. The file was left untouched.");
    }
    return snapshot;
  }

  private async verifyProfileRecord(
    snapshot: ReviewRecordSnapshot<"reader-profile-record">
  ): Promise<ReviewRecordSnapshot<"reader-profile-record">> {
    try {
      await validateReaderProfile(snapshot.record.profile);
    } catch {
      throw new ReviewRecordError("corrupt", "This reader lens does not verify. The file was left untouched.");
    }
    return snapshot;
  }

  private async assertCampaignReferences(bookId: string, draft: CampaignDraft): Promise<void> {
    for (const sourceBook of new Set(draft.sources.map((source) => source.bookId))) {
      await this.assertOwner(sourceBook);
    }
    const refs = [
      ...draft.stages.flatMap((stage) => (stage.report ? [stage.report] : [])),
      ...draft.synthesis.map((entry) => entry.report)
    ];
    for (const ref of refs) {
      const report = await this.loadReport(bookId, ref.runId);
      if (!report) {
        throw new ReviewRecordError("not-found", "A campaign stage names a saved review that is missing. Nothing was written.");
      }
      if (report.hash !== ref.hash) {
        throw new ReviewRecordError("invalid", "A campaign stage names another version of a saved review. Nothing was written.");
      }
    }
    const profile = draft.profile;
    if (profile.id === "reader-alpha" || profile.id === "reader-beta") {
      const builtin = await builtinReaderProfile(profile.id === "reader-alpha" ? "alpha" : "beta");
      if (builtin.version !== profile.version || builtin.digest !== profile.digest) {
        throw new ReviewRecordError("invalid", "The campaign names a different built-in lens version. Nothing was written.");
      }
      return;
    }
    const record = await this.readRecord("reader-profile-record", bookId, profile.id);
    if (!record) {
      throw new ReviewRecordError("not-found", "The campaign names an author lens that has no saved record. Nothing was written.");
    }
    if (record.record.profile.version !== profile.version || record.record.profile.digest !== profile.digest) {
      throw new ReviewRecordError("invalid", "The campaign names another version of its reader lens. Nothing was written.");
    }
  }

  private async trashSingle(
    kind: "reader-profile-record" | "review-campaign",
    bookId: string,
    id: string
  ): Promise<TrashResult> {
    if (!recordIdSchema.safeParse(id).success) {
      throw new ReviewRecordError("invalid", "That review record ID is not valid. Nothing was moved.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      return this.trashEntries(bookId, [{ kind, id, path: pathFor(kind, bookId, id) }]);
    });
  }

  private async restoreSingle(
    kind: "reader-profile-record" | "review-campaign",
    bookId: string,
    id: string,
    trashedAt: string
  ): Promise<{ hash: string; files: string[] }> {
    if (!recordIdSchema.safeParse(id).success) {
      throw new ReviewRecordError("invalid", "That review record ID is not valid. Nothing was moved.");
    }
    return this.host.withBook(bookId, async () => {
      await this.assertOwner(bookId);
      await this.writable(bookId);
      const group = this.trashGroup(bookId, trashedAt);
      const source = toLibraryFilePath([...group, ...relativeFor(kind, id)]);
      const destination = pathFor(kind, bookId, id);
      if (await this.host.storage.readFile(destination)) {
        throw new ReviewRecordError("exists", "A record already occupies that location. Nothing was moved; the trash copy was kept.");
      }
      const snapshot = await this.host.storage.readFile(source);
      if (!snapshot) throw new ReviewRecordError("not-found", "That record is no longer in the trash. Nothing was moved.");
      const verified = await this.requireVerified(source);
      const decoded = decodeReviewRecord(verified.bytes, { kind, bookId });
      if (decoded.record.id !== id) {
        throw new ReviewRecordError("corrupt", "The trashed record has another identity. Nothing was moved.");
      }
      try {
        await this.host.storage.ensureDirectory(parentOf(destination));
        await this.host.moveFile(source, destination);
      } catch (error) {
        if (error instanceof LibraryPortError && error.code === "already-exists") {
          throw new ReviewRecordError("exists", "A record appeared at that location while restoring. Nothing was moved; the trash copy was kept.");
        }
        throw error;
      }
      let after: LibraryFileSnapshot;
      try {
        after = await this.requireVerified(destination);
      } catch {
        throw new ReviewRecordError(
          "uncertain",
          "The trashed record did not return exactly as it was kept. Check both locations before retrying."
        );
      }
      if (after.sha256 !== verified.sha256 || (await this.host.storage.readFile(source))) {
        throw new ReviewRecordError(
          "uncertain",
          "The trashed record did not return exactly as it was kept. Check both locations before retrying."
        );
      }
      await this.noteMove(source, destination);
      return { hash: verified.sha256, files: [libraryPathToArchivePath(destination)] };
    });
  }

  private async trashEntries(
    bookId: string,
    entries: Array<{ kind: ReviewRecordKind; id: string; path: LibraryPath }>
  ): Promise<TrashResult> {
    const present: Array<(typeof entries)[number] & { hash: string }> = [];
    for (const entry of entries) {
      const snapshot = await this.host.storage.readFile(entry.path);
      if (snapshot) present.push({ ...entry, hash: snapshot.sha256 });
    }
    if (present.length === 0) return { status: "missing" };
    const stamp = this.stamp();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const group = reviewTrashGroupPath(bookId, `${stamp}${attempt === 0 ? "" : `-${attempt + 1}`}`);
      const destinations = present.map((entry) => ({
        entry,
        destination: toLibraryFilePath([...group, ...relativeFor(entry.kind, entry.id)])
      }));
      let free = true;
      for (const item of destinations) {
        if (await this.host.storage.readFile(item.destination)) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      try {
        await this.host.storage.ensureDirectory(group);
      } catch {
        continue;
      }
      const existing = await this.host.storage.listDirectory(group);
      if (existing.length > 0) continue;
      const moved: string[] = [];
      try {
        for (const item of destinations) {
          await this.host.storage.ensureDirectory(parentOf(item.destination));
          await this.host.moveFile(item.entry.path, item.destination);
          let after: LibraryFileSnapshot;
          try {
            after = await this.requireVerified(item.destination);
          } catch {
            throw new ReviewRecordError(
              "uncertain",
              "A review file did not arrive in the trash exactly as it left. Check the review trash before retrying."
            );
          }
          if (after.sha256 !== item.entry.hash || (await this.host.storage.readFile(item.entry.path))) {
            throw new ReviewRecordError(
              "uncertain",
              "A review file did not arrive in the trash exactly as it left. Check the review trash before retrying."
            );
          }
          await this.noteMove(item.entry.path, item.destination);
          moved.push(libraryPathToArchivePath(item.destination));
        }
      } catch (error) {
        if (error instanceof LibraryPortError && error.code === "already-exists") {
          if (moved.length === 0) continue;
          throw new ReviewRecordError(
            "uncertain",
            "A trash destination appeared while deleting. The files already moved are in the review trash; check it before retrying."
          );
        }
        throw error;
      }
      return { status: "trashed", trashedAt: libraryPathToArchivePath(group), files: moved };
    }
    throw new ReviewRecordError("io", "Could not find a free place in the review trash. Nothing was deleted.");
  }

  private trashGroup(bookId: string, trashedAt: string): LibraryPath {
    let path: LibraryPath;
    try {
      path = libraryPathFromArchivePath(trashedAt);
    } catch {
      throw new ReviewRecordError("invalid", "That is not a review trash location. Nothing was moved.");
    }
    const root = reviewTrashPath(bookId);
    const matches = path.length === root.length + 1 && root.every((segment, index) => path[index] === segment);
    if (!matches) throw new ReviewRecordError("invalid", "That is not a review trash location for this book. Nothing was moved.");
    return path;
  }

  /** Keep the whole intended document beside the active file and report where it went. */
  private async preserve(
    kind: ReviewRecordKind,
    bookId: string,
    id: string,
    intended: Uint8Array,
    observed: string | null
  ): Promise<string> {
    const decoded = decodeReviewRecord(intended, { kind, bookId });
    const copy = {
      ...decoded.raw,
      conflictMetadata: {
        reason: observed === null ? "missing-file" : "external-edit",
        baseline: baseOf(decoded.raw),
        observed: observed === null ? { kind: "absent" } : { kind: "sha256", value: observed }
      }
    };
    let bytes: Uint8Array;
    try {
      bytes = encodeReviewRecord(kind, copy, { copy: true });
    } catch {
      throw new ReviewRecordError("not-kept", "The conflict copy could not be prepared. Keep your version and try again.");
    }
    const device = this.host.deviceId;
    const stamp = this.stamp();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(device) || !/^[0-9TZ-]{1,100}$/.test(stamp)) {
      throw new ReviewRecordError("not-kept", "The conflict copy could not be named safely. Keep your version and try again.");
    }
    try {
      await this.host.storage.ensureDirectory(conflictsPath(bookId));
    } catch {
      throw new ReviewRecordError("not-kept", "The conflict copy could not be created. Keep your version and try again.");
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const name = `${kind}.${id}.conflict-${observed === null ? "missing-file" : "external-edit"}.${device}.${stamp}${attempt === 0 ? "" : `-${attempt + 1}`}.json`;
      const path = conflictPath(bookId, name);
      let result: CommitFileResult;
      try {
        result = await this.host.commitFile(path, bytes, { kind: "absent" });
      } catch (error) {
        throw this.writeFailure(error, "The conflict copy could not be confirmed. Keep your version and check the conflicts folder.");
      }
      if (result.status === "changed") continue;
      try {
        await this.verifyBytes(result.snapshot, bytes);
      } catch {
        throw new ReviewRecordError("uncertain", "The conflict copy was written but did not read back exactly. Keep your version and check the conflicts folder.");
      }
      return libraryPathToArchivePath(path);
    }
    throw new ReviewRecordError("not-kept", "No free conflict copy name was found. Keep your version and try again.");
  }

  private async verifyBytes(snapshot: LibraryFileSnapshot, bytes: Uint8Array): Promise<LibraryFileSnapshot> {
    if (!bytesEqual(snapshot.bytes, bytes) || snapshot.sha256 !== (await this.host.runtime.sha256(bytes))) {
      throw new ReviewRecordError(
        "uncertain",
        "The review record was written but did not read back exactly. Keep your version and check the saved file before retrying."
      );
    }
    return snapshot;
  }

  private async requireVerified(path: LibraryPath): Promise<LibraryFileSnapshot> {
    const snapshot = await this.host.storage.readFile(path);
    if (!snapshot) throw new ReviewRecordError("not-found", "This review record is missing. Check that the library folder has finished syncing.");
    if (snapshot.sha256 !== (await this.host.runtime.sha256(snapshot.bytes))) {
      throw new ReviewRecordError("corrupt", "This review record's hash could not be verified. The file was left untouched.");
    }
    return snapshot;
  }

  private writeFailure(error: unknown, message?: string): ReviewRecordError {
    if (error instanceof ReviewRecordError) return error;
    return new ReviewRecordError(
      "uncertain",
      message ?? "The review record write could not be confirmed. Keep your draft and reread the saved file before another save."
    );
  }

  private async assertOwner(bookId: string): Promise<void> {
    const snapshot = await this.host.storage.readFile(bookFilePath(bookId));
    if (!snapshot) throw new ReviewRecordError("not-found", "The owning book is unavailable.");
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(snapshot.bytes)) as unknown;
    } catch {
      throw new ReviewRecordError("corrupt", "The owning book is unreadable.");
    }
    try {
      assertSchemaVersion((raw as { schemaVersion?: unknown } | null)?.schemaVersion, "book.json");
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") {
        throw new ReviewRecordError("newer-schema", error.message);
      }
      throw new ReviewRecordError("invalid", "The owning book is not supported.");
    }
    const parsed = bookSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== bookId) {
      throw new ReviewRecordError("invalid", "The actual book ID does not match its folder.");
    }
  }

  private async writable(bookId: string): Promise<void> {
    try {
      await assertBookWritable(this.host.storage, bookId);
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") {
        throw new ReviewRecordError("newer-schema", error.message);
      }
      throw error;
    }
  }

  private async listDirectory(path: LibraryPath): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
    const entries = this.host.storage.inspectDirectory
      ? await this.host.storage.inspectDirectory(path)
      : await this.host.storage.listDirectory(path);
    return entries.flatMap((entry) => {
      if (entry.kind === "unsupported") {
        return [{ name: entry.name, kind: "file" as const }];
      }
      return [{ name: entry.name, kind: entry.kind }];
    });
  }

  private async noteMove(from: LibraryPath, to: LibraryPath): Promise<void> {
    try {
      await noteMovedPrefix({
        storage: this.host.storage,
        deviceId: this.host.deviceId,
        from: libraryPathToArchivePath(from),
        to: libraryPathToArchivePath(to),
        now: this.now()
      });
    } catch {
      // Detection degrades to a reviewable report.
    }
  }

  private sha256Text(text: string): Promise<string> {
    return this.host.runtime.sha256(jsonBytes(text));
  }

  private now(): string {
    return this.host.runtime.now();
  }

  private stamp(): string {
    return this.now().replace(/[:.]/g, "-");
  }
}

function parentOf(path: LibraryPath): LibraryPath {
  const parent = path.slice(0, -1);
  return parent.length === 0 ? toLibraryPath([]) : toLibraryPath(parent);
}

function canonicalProfile(profile: ReaderProfile): string {
  return JSON.stringify({
    name: profile.name,
    purpose: profile.purpose,
    focus: profile.focus,
    guidance: profile.guidance,
    id: profile.id,
    origin: profile.origin,
    version: profile.version,
    digest: profile.digest
  });
}
