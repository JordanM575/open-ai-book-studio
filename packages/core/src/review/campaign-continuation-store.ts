import { bookSchema } from "../schema";
import { LibraryError, LibraryPortError } from "../library/errors";
import { bookFilePath, trashPath } from "../library/paths";
import { libraryPathToArchivePath, toLibraryFilePath, toLibraryPath, type LibraryPath } from "../library/path";
import type { CommitFileResult, FileExpectation, LibraryFileSnapshot, LibraryPort, LibraryRuntime } from "../library/port";
import { assertBookWritable, assertSchemaVersion } from "../library/schema-guard";
import { noteMovedPrefix } from "../sync/journal";
import { bookIdSchema } from "./contract";
import { decodeReviewRecord, recordIdSchema, recordTimestampSchema } from "./record-format";
import { ReviewRecordError } from "./record-error";
import { bytesEqual, decodeStrictJsonBytes, encodeCanonicalJson, REVIEW_RECORD_BYTES } from "./record-json";
import { ContinuationTokenError } from "./campaign-continuation-tokens";
import { CONTINUATION_SEGMENT_LIMITS } from "./campaign-continuation-segments";
import {
  CONTINUATION_WIRE_LIMITS, inspectContinuationWire, readContinuationManifest, readContinuationPublicationIntent
} from "./campaign-continuation-wire";
import {
  inspectCampaignContinuationCompatibility, replanCampaignContinuation, serveCampaignContinuation,
  type CampaignContinuationReplanResult, type CampaignContinuationServeResult
} from "./campaign-continuation-replan";
import {
  buildContinuationGroupIntentBytes, continuationInventoryDigest, extractContinuationReportReferences,
  readContinuationGroupIntent, sortContinuationInventory, validateContinuationInventory,
  CONTINUATION_GROUP_LIMITS,
  type ContinuationGroupAction, type ContinuationGroupComponent, type ContinuationInventoryEntry
} from "./campaign-continuation-group";
import type { CampaignPlan } from "./campaign-planner";
import type { InspectedContinuationHole } from "./campaign-continuation-tokens";

/**
 * Checked storage for retained campaign continuations (039 T014/T015, D-201 seam 3).
 *
 * This store is the only storage layer for the schema-2 continuation layout. It never
 * re-encodes a manifest, segment or intent: publication writes the exact candidate bytes
 * the pure codec builder produced, so supported unknown fields survive byte for byte.
 *
 * Publication is intent-first. The immutable intent is created first, then every immutable
 * segment in deterministic manifest order, then the checked manifest last. Segment and
 * intent files are created only through the host's genuine no-replace creation seam; a
 * host that cannot guarantee no-replace creation is refused before any file is written,
 * and this store never degrades segment creation to a check-then-rename commit. A segment
 * that already exists with identical bytes is the only tolerated pre-existence; different
 * bytes at a segment ID is a conflict and nothing at that ID is overwritten.
 *
 * `published` is reported only after the manifest commit and a fresh readback that
 * re-verifies every reference (exact length, raw SHA-256 and semantic segment ID, through
 * the codec wire reader). A readback that merely shows the candidate bytes after a failed
 * or uncertain commit is reported as an `already-published` observation or as `uncertain`,
 * never as this call's publication.
 *
 * Reads are owner-explicit: every path is derived from the caller's owner book and campaign
 * IDs, the owning book folder must name that book, and the retained manifest's recorded
 * owner and campaign must equal them. A retained continuation is loaded only through the
 * codec wire readers and the compatible-replan dispatch; hash agreement never registers a
 * deserialized plan.
 *
 * Group trash/restore (format section 7.3) moves exactly the manifest file and the whole
 * segment and publication-intent directories under one immutable group intent, in that
 * fixed order with the manifest last, after version dispatch and full wire verification
 * at the source; a move that cannot preserve every checked reference refuses before the
 * first move, and a failure after the first move is `uncertain` with both locations and
 * the intent retained. Cross-book report resolution (section 5) reads each checkpoint
 * report only from its recorded owner's ordinary report path: the recorded owner wins,
 * a verified foreign report is a bounded foreign reference, and a missing or changed
 * report stays an unavailable entry. Neither operation rewrites retained bytes, creates
 * reports, or grants execution authority.
 */

export const CONTINUATION_STORAGE_LIMITS = Object.freeze({
  manifestBytes: CONTINUATION_WIRE_LIMITS.manifestBytes,
  intentBytes: CONTINUATION_WIRE_LIMITS.intentBytes,
  segmentBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes,
  segments: CONTINUATION_SEGMENT_LIMITS.segments,
  segmentBytesTotal: CONTINUATION_SEGMENT_LIMITS.bytes,
  /** Format section 1 inventory entry ceiling, applied before any per-file reads. */
  inventoryEntries: 65_536,
  inventoryPage: 200
});

export type ContinuationStorageErrorCode =
  | "invalid" | "not-found" | "corrupt" | "unsupported" | "newer-schema" | "too-large"
  | "conflict" | "uncertain" | "unsupported-concurrent-writer" | "replan-required"
  | "external-unavailable" | "external-mismatch" | "io";

export class ContinuationStorageError extends Error {
  constructor(readonly code: ContinuationStorageErrorCode, message: string) {
    super(message);
    this.name = "ContinuationStorageError";
  }
}

export interface CampaignContinuationHost {
  storage: LibraryPort;
  runtime: LibraryRuntime;
  deviceId: string;
  /** The SAME queue used by chapter/book saves, including queued reads. */
  withBook<T>(bookId: string, work: () => Promise<T>): Promise<T>;
  /** The service's journal-aware checked commit; never an unchecked writer. */
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
  /**
   * Genuine no-replace creation for immutable files. Implementations must create the file
   * exclusively (for example an exclusive-create open) and return `changed` with the current
   * snapshot when the file already exists; they must not check for absence and then rename
   * over the destination. When this seam is absent, publication refuses.
   */
  createImmutableFile?: (path: LibraryPath, bytes: Uint8Array) => Promise<CommitFileResult>;
  /**
   * Journal-aware moves for a campaign group (format section 7.3). When a host seam is
   * absent the store falls back to the storage port's own move, which adapters must
   * still implement as a no-replace move; a store that can prove neither refuses a
   * group move before the first move instead of copying file by file.
   */
  moveFile?: (from: LibraryPath, to: LibraryPath) => Promise<void>;
  moveDirectory?: (from: LibraryPath, to: LibraryPath) => Promise<void>;
}

export const continuationManifestPath = (bookId: string, campaignId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, "reviews", "campaigns", `${campaignId}.json`]);
export const continuationSegmentsPath = (bookId: string, campaignId: string): LibraryPath =>
  toLibraryPath(["books", bookId, "reviews", "campaigns", `${campaignId}.segments`]);
export const continuationSegmentPath = (bookId: string, campaignId: string, segmentId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, "reviews", "campaigns", `${campaignId}.segments`, `${segmentId}.json`]);
export const continuationIntentsPath = (bookId: string, campaignId: string): LibraryPath =>
  toLibraryPath(["books", bookId, "reviews", "campaigns", `${campaignId}.intents`]);
export const continuationIntentPath = (bookId: string, campaignId: string, operationId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, "reviews", "campaigns", `${campaignId}.intents`, `${operationId}.json`]);
export const continuationCampaignsPath = (bookId: string): LibraryPath =>
  toLibraryPath(["books", bookId, "reviews", "campaigns"]);
export const continuationGroupMovesPath = (bookId: string): LibraryPath =>
  toLibraryPath(["books", bookId, "reviews", "campaign-moves"]);
export const continuationGroupMoveIntentPath = (bookId: string, operationId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, "reviews", "campaign-moves", `${operationId}.json`]);
/** Trash base for one archived campaign group: `.studio/trash/<owner>/reviews/campaign-<groupId>/`. */
export const continuationTrashBasePath = (bookId: string, groupId: string): LibraryPath =>
  toLibraryPath([...trashPath(bookId), "reviews", `campaign-${groupId}`]);
export const continuationTrashManifestPath = (bookId: string, campaignId: string, groupId: string): LibraryPath =>
  toLibraryFilePath([...continuationTrashBasePath(bookId, groupId), "campaigns", `${campaignId}.json`]);
export const continuationTrashSegmentsPath = (bookId: string, campaignId: string, groupId: string): LibraryPath =>
  toLibraryPath([...continuationTrashBasePath(bookId, groupId), "campaigns", `${campaignId}.segments`]);
export const continuationTrashIntentsPath = (bookId: string, campaignId: string, groupId: string): LibraryPath =>
  toLibraryPath([...continuationTrashBasePath(bookId, groupId), "campaigns", `${campaignId}.intents`]);
/** Ordinary schema-1 report location for a recorded report owner (format section 5). */
export const continuationReportPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, "reviews", `${runId}.json`]);

export interface ContinuationCandidate {
  readonly manifestBytes: Uint8Array;
  readonly intentBytes: Uint8Array;
  readonly segments: readonly { readonly reference: { readonly id: string }; readonly bytes: Uint8Array }[];
}

export type ContinuationPublishResult =
  | { status: "published"; publicationId: string; revision: number; manifestHash: string }
  | { status: "already-published"; publicationId: string; revision: number; manifestHash: string };

export type ContinuationInspectResult =
  | {
      status: "structural-only"; compatibility: "serve-unchanged"; manifestHash: string;
      manifest: Awaited<ReturnType<typeof inspectContinuationWire>>["manifest"];
      streams: ReadonlyArray<{
        stream: "plan" | "checkpoint"; root: unknown;
        holes: Awaited<ReturnType<typeof inspectContinuationWire>>["streams"][number]["holes"];
        segments: ReadonlyArray<{ reference: unknown; hasUnknownFields: boolean }>;
      }>;
    }
  | { status: "replan-required"; compatibility: "replan-required"; recordedPlannerSemantics: string; manifestHash: string }
  | { status: "refused"; code: string };

export type ContinuationRecoveryStatus = "complete" | "recoverable" | "refused";
export interface ContinuationRecoveryClassification {
  operationId: string | null;
  status: ContinuationRecoveryStatus;
  code: string;
  candidateRetained: boolean;
  manifestState: "candidate" | "expected-base" | "other" | "absent";
  missingSegmentIds: string[];
  divergentSegmentIds: string[];
}
export interface ContinuationRecoveryInspection {
  ownerBookId: string;
  campaignId: string;
  manifest: { present: boolean; sha256: string | null; unreadable: boolean };
  classifications: ContinuationRecoveryClassification[];
}

export type ContinuationGroupMoveResult = {
  status: "trashed" | "restored"; operationId: string; groupId: string;
  campaignId: string; ownerBookId: string; manifestHash: string;
};

export type ContinuationGroupState = "active" | "archived" | "partial" | "absent";

export interface ContinuationGroupInspection {
  ownerBookId: string;
  campaignId: string;
  groupId: string | null;
  state: ContinuationGroupState;
  manifestHash: string | null;
  active: { manifest: boolean; segments: boolean; intents: boolean };
  archived: { manifest: boolean; segments: boolean; intents: boolean } | null;
}

export type ContinuationReportDisposition = "owned" | "foreign" | "unavailable";

export interface ContinuationReportResolutionEntry {
  stageId: string;
  reference: { ownerBookId: string; runId: string; sha256: string };
  disposition: ContinuationReportDisposition;
  code: string;
}

export type ContinuationReportResolutionResult =
  | {
      status: "resolved"; ownerBookId: string; campaignId: string;
      entries: ContinuationReportResolutionEntry[];
      owned: number; foreign: number; unavailable: number;
    }
  | { status: "refused"; code: string };

const decoder = new TextDecoder("utf-8", { fatal: true });
const SEGMENT_ID = /^s-[a-f0-9]{64}$/;

function refusal(code: ContinuationStorageErrorCode, message: string): never {
  throw new ContinuationStorageError(code, message);
}
function mapCode(error: unknown): ContinuationStorageErrorCode {
  if (error instanceof ContinuationStorageError) return error.code;
  if (error instanceof ContinuationTokenError) return error.code;
  if (error instanceof ReviewRecordError) {
    return ["corrupt", "unsupported", "too-large", "external-unavailable", "external-mismatch", "newer-schema"].includes(error.code)
      ? (error.code as ContinuationStorageErrorCode) : "corrupt";
  }
  if (error instanceof LibraryPortError) {
    if (error.code === "already-exists") return "conflict";
    if (error.code === "too-large") return "too-large";
    if (error.code === "unsupported") return "unsupported";
    if (error.code === "not-found") return "not-found";
    if (error.code === "invalid-path") return "invalid";
    return "uncertain";
  }
  if (error instanceof LibraryError) return error.code === "newer-schema" ? "newer-schema" : "corrupt";
  return "corrupt";
}
function asStorageError(error: unknown, message: string): ContinuationStorageError {
  if (error instanceof ContinuationStorageError) return error;
  return new ContinuationStorageError(mapCode(error), message);
}

export class CampaignContinuationStore {
  constructor(private readonly host: CampaignContinuationHost) {}

  /* ------------------------------------------------------------ publication */

  async publishContinuation(ownerBookId: string, campaignId: string, candidateInput: ContinuationCandidate): Promise<ContinuationPublishResult> {
    this.assertIds(ownerBookId, campaignId);
    // Snapshot caller-owned bytes synchronously, before the first await can let them change.
    if (!candidateInput || typeof candidateInput !== "object" || !(candidateInput.manifestBytes instanceof Uint8Array) ||
      !(candidateInput.intentBytes instanceof Uint8Array) || !Array.isArray(candidateInput.segments)) {
      refusal("invalid", "The continuation candidate is not exact bytes. Nothing was written.");
    }
    const manifestBytes = new Uint8Array(candidateInput.manifestBytes);
    const intentBytes = new Uint8Array(candidateInput.intentBytes);
    const segmentInputs = candidateInput.segments.map((entry) => {
      if (!entry || typeof entry !== "object" || !(entry.bytes instanceof Uint8Array) ||
        !entry.reference || typeof entry.reference.id !== "string") {
        refusal("invalid", "The continuation candidate has a malformed segment. Nothing was written.");
      }
      return { id: entry.reference.id, bytes: new Uint8Array(entry.bytes) };
    });
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      await this.writable(ownerBookId);
      if (typeof this.host.createImmutableFile !== "function") {
        refusal("unsupported-concurrent-writer",
          "This storage cannot create immutable continuation segments without replacing an existing file, so nothing was written. Keep your draft and use a storage adapter with proven no-replace creation.");
      }
      let manifest: ReturnType<typeof readContinuationManifest>;
      try {
        manifest = readContinuationManifest(manifestBytes, { ownerBookId, campaignId });
      } catch (error) {
        throw asStorageError(error, "The continuation candidate manifest could not be read. Nothing was written.");
      }
      const operationId = manifest.publicationId;
      let intent: Awaited<ReturnType<typeof readContinuationPublicationIntent>>;
      try {
        intent = await readContinuationPublicationIntent(intentBytes, { ownerBookId, campaignId, operationId });
      } catch (error) {
        throw asStorageError(error, "The continuation publication intent could not be read. Nothing was written.");
      }
      if (!bytesEqual(intent.candidateBytes, manifestBytes)) {
        refusal("corrupt", "The publication intent does not carry this exact candidate manifest. Nothing was written.");
      }
      const references = [...manifest.plan.segments, ...(manifest.checkpoint?.segments ?? [])];
      const byId = new Map<string, Uint8Array>();
      for (const segment of segmentInputs) {
        if (!SEGMENT_ID.test(segment.id) || byId.has(segment.id)) refusal("corrupt", "The continuation candidate has duplicate or invalid segment identities. Nothing was written.");
        byId.set(segment.id, segment.bytes);
      }
      if (byId.size !== references.length || references.some((reference) => !byId.has(reference.id))) {
        refusal("corrupt", "The continuation candidate does not carry exactly the segments its manifest references. Nothing was written.");
      }
      try {
        await inspectContinuationWire(manifestBytes, { ownerBookId, campaignId }, (id) => byId.get(id));
      } catch (error) {
        throw asStorageError(error, "The continuation candidate does not verify against its own segments. Nothing was written.");
      }

      const manifestPath = continuationManifestPath(ownerBookId, campaignId);
      const prior = await this.readBounded(manifestPath, CONTINUATION_STORAGE_LIMITS.manifestBytes);
      const priorHash = prior ? await this.host.runtime.sha256(prior.bytes) : null;
      if (prior && bytesEqual(prior.bytes, manifestBytes)) {
        try {
          await this.verifyStoredReferences(ownerBookId, campaignId, manifestBytes);
        } catch {
          throw new ContinuationStorageError("uncertain",
            "The active continuation names this candidate but its segments do not verify. Nothing was replaced; inspect the retained files before another save.");
        }
        return { status: "already-published", publicationId: operationId, revision: manifest.revision as number, manifestHash: priorHash ?? prior.sha256 };
      }
      const base = manifest.base as { kind?: unknown; value?: unknown; revision?: unknown };
      // Revision continuity (format section 3.1): the base must name the immediate
      // predecessor, so a candidate that skips a revision refuses even when its base
      // hash happens to match an older active manifest.
      let priorRevision: number | null = null;
      if (prior) {
        try {
          priorRevision = readContinuationManifest(prior.bytes, { ownerBookId, campaignId }).revision as number;
        } catch {
          refusal("conflict",
            "The saved continuation could not be read as a continuation manifest, so its revision chain cannot be checked. Nothing was overwritten; inspect the retained files before another save.");
        }
      }
      const revisionContinues = prior === null
        ? manifest.revision === 1 && base.kind === "absent"
        : manifest.revision === (priorRevision as number) + 1 && base.kind === "sha256" && base.revision === priorRevision;
      const baseMatches = revisionContinues && (prior === null || priorHash === base.value);
      if (!baseMatches) {
        refusal("conflict",
          "The saved continuation changed since this candidate was prepared. Its intent and segments were kept for inspection; the active file was not overwritten.");
      }

      await this.host.storage.ensureDirectory(continuationSegmentsPath(ownerBookId, campaignId));
      await this.host.storage.ensureDirectory(continuationIntentsPath(ownerBookId, campaignId));
      await this.host.storage.ensureDirectory(continuationCampaignsPath(ownerBookId));

      // Intent first: it carries the exact candidate manifest, never segment bytes.
      await this.createImmutable(continuationIntentPath(ownerBookId, campaignId, operationId), intentBytes, "publication intent");
      // Immutable segments in deterministic manifest order.
      for (const reference of references) {
        const bytes = byId.get(reference.id);
        if (!bytes) refusal("corrupt", "A referenced continuation segment is missing from the candidate. The manifest was not published.");
        await this.createImmutable(continuationSegmentPath(ownerBookId, campaignId, reference.id), bytes, "continuation segment");
      }
      // Re-read every intended reference before the manifest can point at it.
      try {
        await this.verifyStoredReferences(ownerBookId, campaignId, manifestBytes);
      } catch (error) {
        throw asStorageError(error, "A continuation segment did not read back exactly, so the manifest was not published. The intent and any written segments were kept for inspection.");
      }
      const beforeManifest = await this.readBounded(manifestPath, CONTINUATION_STORAGE_LIMITS.manifestBytes);
      const beforeHash = beforeManifest ? await this.host.runtime.sha256(beforeManifest.bytes) : null;
      if (beforeHash !== priorHash) {
        refusal("conflict", "The saved continuation changed while its segments were published. The manifest was not replaced; the intent and segments were kept for inspection.");
      }
      let result: CommitFileResult;
      try {
        result = await this.host.commitFile(manifestPath, manifestBytes, prior ? { kind: "sha256", value: priorHash as string } : { kind: "absent" });
      } catch {
        throw new ContinuationStorageError("uncertain", "The continuation manifest write could not be confirmed. Keep your draft and inspect the saved continuation before another save.");
      }
      if (result.status === "changed") {
        if (result.publication === "uncertain") {
          throw new ContinuationStorageError("uncertain", "The continuation manifest was published but did not read back exactly. Keep your draft and inspect the saved continuation before another save.");
        }
        if (result.current && bytesEqual(result.current.bytes, manifestBytes)) {
          // Another publisher, or an interrupted attempt, already left these exact bytes.
          // This is an observation about the file, not attribution of this call's write.
          try { await this.verifyStoredReferences(ownerBookId, campaignId, manifestBytes); } catch {
            throw new ContinuationStorageError("uncertain", "The active continuation names this candidate but its segments do not verify. Inspect the retained files before another save.");
          }
          return { status: "already-published", publicationId: operationId, revision: manifest.revision as number, manifestHash: await this.host.runtime.sha256(manifestBytes) };
        }
        refusal("conflict", "The saved continuation changed while it was published. The intent and segments were kept for inspection; the active file was not overwritten.");
      }
      if (!bytesEqual(result.snapshot.bytes, manifestBytes) || result.snapshot.sha256 !== (await this.host.runtime.sha256(manifestBytes))) {
        throw new ContinuationStorageError("uncertain", "The continuation manifest did not read back from its commit exactly. Keep your draft and inspect the saved continuation before another save.");
      }
      // Final fresh readback: manifest bytes, then every reference again.
      const readback = await this.readBounded(manifestPath, CONTINUATION_STORAGE_LIMITS.manifestBytes);
      if (!readback || !bytesEqual(readback.bytes, manifestBytes)) {
        throw new ContinuationStorageError("uncertain", "The continuation manifest did not read back exactly after publication. Inspect the saved continuation before another save; it is not reported as published by this call.");
      }
      try {
        await this.verifyStoredReferences(ownerBookId, campaignId, manifestBytes);
      } catch {
        throw new ContinuationStorageError("uncertain", "The continuation manifest was written but a segment did not verify on readback. Inspect the saved continuation before another save; it is not reported as published by this call.");
      }
      return { status: "published", publicationId: operationId, revision: manifest.revision as number, manifestHash: readback.sha256 };
    });
  }

  /* ------------------------------------------------------------------ reads */

  async inspectContinuation(ownerBookId: string, campaignId: string): Promise<ContinuationInspectResult> {
    this.assertIds(ownerBookId, campaignId);
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const snapshot = await this.readBounded(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes);
      if (!snapshot) return { status: "refused", code: "not-found" };
      if (!this.recordedIdentityMatches(snapshot.bytes, ownerBookId, campaignId)) return { status: "refused", code: "corrupt" };
      const dispatch = inspectCampaignContinuationCompatibility(snapshot.bytes);
      if (dispatch.decision === "refuse") return { status: "refused", code: dispatch.code };
      if (dispatch.decision === "replan-required") {
        return { status: "replan-required", compatibility: "replan-required", recordedPlannerSemantics: dispatch.plannerSemantics, manifestHash: snapshot.sha256 };
      }
      try {
        const wire = await inspectContinuationWire(snapshot.bytes, { ownerBookId, campaignId }, this.segmentReader(ownerBookId, campaignId));
        return {
          status: "structural-only", compatibility: "serve-unchanged", manifestHash: snapshot.sha256, manifest: wire.manifest,
          streams: wire.streams.map((stream) => ({
            stream: stream.stream, root: stream.root, holes: stream.holes,
            segments: stream.segments.map((segment) => ({ reference: segment.reference, hasUnknownFields: segment.hasUnknownFields }))
          }))
        };
      } catch (error) {
        return { status: "refused", code: mapCode(error) };
      }
    });
  }

  async loadContinuation(ownerBookId: string, campaignId: string, plan: CampaignPlan,
    resolve: (hole: InspectedContinuationHole) => unknown | Promise<unknown>): Promise<CampaignContinuationServeResult> {
    this.assertIds(ownerBookId, campaignId);
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const snapshot = await this.readBounded(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes);
      if (!snapshot) return { status: "refused", code: "not-found" };
      if (!plan || plan.ownerBookId !== ownerBookId || plan.campaignId !== campaignId) return { status: "refused", code: "corrupt" };
      if (!this.recordedIdentityMatches(snapshot.bytes, ownerBookId, campaignId)) return { status: "refused", code: "corrupt" };
      return serveCampaignContinuation(snapshot.bytes, plan, this.segmentReader(ownerBookId, campaignId), resolve);
    });
  }

  async replanContinuation(ownerBookId: string, campaignId: string, request: unknown): Promise<CampaignContinuationReplanResult> {
    this.assertIds(ownerBookId, campaignId);
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const snapshot = await this.readBounded(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes);
      if (!snapshot) return { status: "refused", code: "not-found" };
      if (!this.recordedIdentityMatches(snapshot.bytes, ownerBookId, campaignId)) return { status: "refused", code: "corrupt" };
      return replanCampaignContinuation(snapshot.bytes, this.segmentReader(ownerBookId, campaignId), request);
    });
  }

  async readContinuationIntent(ownerBookId: string, campaignId: string, operationId: string) {
    this.assertIds(ownerBookId, campaignId);
    if (!recordIdSchema.max(160).safeParse(operationId).success) refusal("invalid", "That publication operation ID is not valid. Nothing was read as an intent.");
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const snapshot = await this.readBounded(continuationIntentPath(ownerBookId, campaignId, operationId), CONTINUATION_STORAGE_LIMITS.intentBytes);
      if (!snapshot) return null;
      try {
        const read = await readContinuationPublicationIntent(snapshot.bytes, { ownerBookId, campaignId, operationId });
        return { status: read.status, intent: read.intent, manifest: read.manifest, candidateBytes: read.candidateBytes, hash: snapshot.sha256 };
      } catch (error) {
        throw asStorageError(error, "The retained publication intent could not be read. It was left untouched.");
      }
    });
  }

  /* ------------------------------------------------------------- inventories */

  async listContinuationIntents(ownerBookId: string, campaignId: string, options: { offset?: number; limit?: number } = {}) {
    this.assertIds(ownerBookId, campaignId);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > CONTINUATION_STORAGE_LIMITS.inventoryPage) {
      refusal("invalid", "The continuation intent page is not valid; use an offset of 0 or more and a page of 1 to 200.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const entries = await this.inventoryEntries(continuationIntentsPath(ownerBookId, campaignId));
      const issues: Array<{ fileName: string; code: string }> = [];
      const intents: Array<{ operationId: string }> = [];
      for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) { issues.push({ fileName: entry.name, code: "unsupported" }); continue; }
        const operationId = entry.name.slice(0, -".json".length);
        if (!recordIdSchema.max(160).safeParse(operationId).success) { issues.push({ fileName: entry.name, code: "invalid" }); continue; }
        intents.push({ operationId });
      }
      intents.sort((a, b) => a.operationId.localeCompare(b.operationId));
      issues.sort((a, b) => a.fileName.localeCompare(b.fileName));
      return { ownerBookId, campaignId, offset, limit, total: intents.length, intents: intents.slice(offset, offset + limit), issues };
    });
  }

  async listContinuationSegments(ownerBookId: string, campaignId: string, options: { offset?: number; limit?: number } = {}) {
    this.assertIds(ownerBookId, campaignId);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > CONTINUATION_STORAGE_LIMITS.inventoryPage) {
      refusal("invalid", "The continuation segment page is not valid; use an offset of 0 or more and a page of 1 to 200.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const entries = await this.inventoryEntries(continuationSegmentsPath(ownerBookId, campaignId));
      const issues: Array<{ fileName: string; code: string }> = [];
      const segments: Array<{ segmentId: string }> = [];
      for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) { issues.push({ fileName: entry.name, code: "unsupported" }); continue; }
        const segmentId = entry.name.slice(0, -".json".length);
        if (!SEGMENT_ID.test(segmentId)) { issues.push({ fileName: entry.name, code: "invalid" }); continue; }
        segments.push({ segmentId });
      }
      segments.sort((a, b) => a.segmentId.localeCompare(b.segmentId));
      issues.sort((a, b) => a.fileName.localeCompare(b.fileName));
      return { ownerBookId, campaignId, offset, limit, total: segments.length, segments: segments.slice(offset, offset + limit), issues };
    });
  }

  /* ---------------------------------------------------------------- recovery */

  async inspectContinuationRecovery(ownerBookId: string, campaignId: string, operationId?: string): Promise<ContinuationRecoveryInspection> {
    this.assertIds(ownerBookId, campaignId);
    if (operationId !== undefined && !recordIdSchema.max(160).safeParse(operationId).success) {
      refusal("invalid", "That publication operation ID is not valid.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      // A present-but-unreadable manifest (for example over the byte bound) is not
      // absence: it occupies the publication pointer, so recovery refuses as
      // uncertain instead of reporting an intact expected base.
      let manifestSnapshot: LibraryFileSnapshot | null = null;
      let manifestUnreadable = false;
      try {
        manifestSnapshot = await this.readBounded(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes);
      } catch {
        manifestUnreadable = true;
      }
      const manifestInfo = { present: manifestSnapshot !== null || manifestUnreadable, sha256: manifestSnapshot?.sha256 ?? null, unreadable: manifestUnreadable };
      if (operationId !== undefined) {
        const classification = await this.classifyOperation(ownerBookId, campaignId, operationId, manifestSnapshot, manifestUnreadable);
        return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [classification] };
      }
      let entries: Awaited<ReturnType<CampaignContinuationStore["inventoryEntries"]>>;
      try {
        entries = await this.inventoryEntries(continuationIntentsPath(ownerBookId, campaignId));
      } catch (error) {
        return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [{
          operationId: null, status: "refused" as const, code: mapCode(error), candidateRetained: false,
          manifestState: manifestSnapshot || manifestUnreadable ? "other" as const : "absent" as const, missingSegmentIds: [], divergentSegmentIds: []
        }] };
      }
      const operationIds = entries.flatMap((entry) => {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) return [];
        const id = entry.name.slice(0, -".json".length);
        return recordIdSchema.max(160).safeParse(id).success ? [id] : [];
      }).sort();
      if (operationIds.length === 0) {
        if (!manifestSnapshot) {
          if (manifestUnreadable) {
            return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [{
              operationId: null, status: "refused" as const, code: "uncertain", candidateRetained: false,
              manifestState: "other" as const, missingSegmentIds: [], divergentSegmentIds: []
            }] };
          }
          return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [{
            operationId: null, status: "refused" as const, code: "not-found", candidateRetained: false,
            manifestState: "absent" as const, missingSegmentIds: [], divergentSegmentIds: []
          }] };
        }
        try {
          await this.verifyStoredReferences(ownerBookId, campaignId, manifestSnapshot.bytes);
          return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [{
            operationId: null, status: "complete" as const, code: "already-published", candidateRetained: false,
            manifestState: "candidate" as const, missingSegmentIds: [], divergentSegmentIds: []
          }] };
        } catch {
          return { ownerBookId, campaignId, manifest: manifestInfo, classifications: [{
            operationId: null, status: "refused" as const, code: "uncertain", candidateRetained: false,
            manifestState: "other" as const, missingSegmentIds: [], divergentSegmentIds: []
          }] };
        }
      }
      const classifications: ContinuationRecoveryClassification[] = [];
      for (const id of operationIds) classifications.push(await this.classifyOperation(ownerBookId, campaignId, id, manifestSnapshot, manifestUnreadable));
      return { ownerBookId, campaignId, manifest: manifestInfo, classifications };
    });
  }

  /* ------------------------------------------------------------ group moves */

  async trashContinuationGroup(ownerBookId: string, campaignId: string,
    options: { operationId: string; groupId: string; createdAt: string }): Promise<ContinuationGroupMoveResult> {
    return this.moveContinuationGroup(ownerBookId, campaignId, "trash", options);
  }

  async restoreContinuationGroup(ownerBookId: string, campaignId: string,
    options: { operationId: string; groupId: string; createdAt: string }): Promise<ContinuationGroupMoveResult> {
    return this.moveContinuationGroup(ownerBookId, campaignId, "restore", options);
  }

  private async moveContinuationGroup(ownerBookId: string, campaignId: string, action: ContinuationGroupAction,
    options: { operationId: string; groupId: string; createdAt: string }): Promise<ContinuationGroupMoveResult> {
    this.assertIds(ownerBookId, campaignId);
    const operationId = options?.operationId;
    const groupId = options?.groupId;
    const createdAt = options?.createdAt;
    if (!recordIdSchema.max(160).safeParse(operationId).success ||
      !recordIdSchema.max(160).safeParse(groupId).success) {
      refusal("invalid", "That group operation or group ID is not valid. Nothing was moved.");
    }
    if (!recordTimestampSchema.safeParse(createdAt).success) {
      refusal("invalid", "That group operation time is not valid. Nothing was moved.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      await this.writable(ownerBookId);
      if (typeof this.host.createImmutableFile !== "function") {
        refusal("unsupported-concurrent-writer",
          "This storage cannot create the immutable group intent without replacing an existing file, so nothing was moved. Keep the continuation where it is and use a storage adapter with proven no-replace creation.");
      }
      const moveFile = this.host.moveFile ?? this.host.storage.moveFile.bind(this.host.storage);
      const moveDirectory = this.host.moveDirectory ?? this.host.storage.moveDirectory.bind(this.host.storage);
      if (typeof moveFile !== "function" || typeof moveDirectory !== "function") {
        refusal("unsupported-concurrent-writer",
          "This storage cannot move a continuation group without replacing a destination, so nothing was moved.");
      }
      const trashing = action === "trash";
      const sourceManifest = trashing ? continuationManifestPath(ownerBookId, campaignId)
        : continuationTrashManifestPath(ownerBookId, campaignId, groupId);
      const sourceSegments = trashing ? continuationSegmentsPath(ownerBookId, campaignId)
        : continuationTrashSegmentsPath(ownerBookId, campaignId, groupId);
      const sourceIntents = trashing ? continuationIntentsPath(ownerBookId, campaignId)
        : continuationTrashIntentsPath(ownerBookId, campaignId, groupId);
      const destManifest = trashing ? continuationTrashManifestPath(ownerBookId, campaignId, groupId)
        : continuationManifestPath(ownerBookId, campaignId);
      const destSegments = trashing ? continuationTrashSegmentsPath(ownerBookId, campaignId, groupId)
        : continuationSegmentsPath(ownerBookId, campaignId);
      const destIntents = trashing ? continuationTrashIntentsPath(ownerBookId, campaignId, groupId)
        : continuationIntentsPath(ownerBookId, campaignId);
      const intentPath = continuationGroupMoveIntentPath(ownerBookId, operationId);
      if (await this.host.storage.readFile(intentPath)) {
        refusal("conflict", "That group operation already has a retained intent. Nothing was moved; inspect it before another move.");
      }
      const source = await this.readBounded(sourceManifest, CONTINUATION_STORAGE_LIMITS.manifestBytes);
      if (!source) refusal("not-found", "That continuation is not at the expected location. Nothing was moved.");
      const manifestBytes = new Uint8Array(source.bytes);
      if (!this.recordedIdentityMatches(manifestBytes, ownerBookId, campaignId)) {
        refusal("corrupt", "The continuation at that location names another owner or campaign. Nothing was moved.");
      }
      const dispatch = inspectCampaignContinuationCompatibility(manifestBytes);
      if (dispatch.decision === "refuse") {
        throw new ContinuationStorageError(
          (["corrupt", "unsupported", "too-large", "newer-schema"].includes(dispatch.code)
            ? dispatch.code : "unsupported") as ContinuationStorageErrorCode,
          "That continuation version cannot be moved by this build. Nothing was moved.");
      }
      const verifyBytes = dispatch.decision === "replan-required"
        ? this.normalizedSemanticsBytes(manifestBytes) : manifestBytes;
      try {
        await inspectContinuationWire(verifyBytes, { ownerBookId, campaignId },
          this.segmentReaderFor(sourceSegments));
      } catch (error) {
        throw asStorageError(error, "The continuation does not verify at its source location, so nothing was moved. Its files were left exactly as they were.");
      }
      const sourceSegInventory = await this.inventoryDirectory(sourceSegments);
      const sourceIntInventory = await this.inventoryDirectory(sourceIntents);
      const sourceSegCheck = this.checkInventory(sourceSegInventory);
      const sourceIntCheck = this.checkInventory(sourceIntInventory);
      const destSegInventory = await this.inventoryDirectory(destSegments);
      const destIntInventory = await this.inventoryDirectory(destIntents);
      this.checkInventory(destSegInventory);
      this.checkInventory(destIntInventory);
      const totalEntries = sourceSegCheck.entries + sourceIntCheck.entries + 1 +
        destSegInventory.length + destIntInventory.length;
      const totalBytes = sourceSegCheck.bytes + sourceIntCheck.bytes + manifestBytes.byteLength;
      if (totalEntries > CONTINUATION_GROUP_LIMITS.entries || totalBytes > CONTINUATION_GROUP_LIMITS.fileBytes ||
        sourceSegCheck.inventoryBytes + sourceIntCheck.inventoryBytes > CONTINUATION_GROUP_LIMITS.inventoryBytes) {
        refusal("too-large", "This continuation group is larger than this version can move. Nothing was moved or listed partially.");
      }
      if (await this.host.storage.stat(destManifest)) {
        refusal("conflict", "A continuation already occupies the move destination. Nothing was moved; both locations were kept.");
      }
      if (destSegInventory.length > 1 || destIntInventory.length > 1) {
        refusal("conflict", "A continuation already occupies the move destination. Nothing was moved; both locations were kept.");
      }
      const components: ContinuationGroupComponent[] = [
        { name: "segments", type: "directory",
          sourceLocation: trashing ? "active" : "trash", destinationLocation: trashing ? "trash" : "active",
          entries: sourceSegCheck.entries, bytes: sourceSegCheck.bytes,
          inventoryDigest: await continuationInventoryDigest(sourceSegInventory) },
        { name: "publication-intents", type: "directory",
          sourceLocation: trashing ? "active" : "trash", destinationLocation: trashing ? "trash" : "active",
          entries: sourceIntCheck.entries, bytes: sourceIntCheck.bytes,
          inventoryDigest: await continuationInventoryDigest(sourceIntInventory) },
        { name: "manifest", type: "file",
          sourceLocation: trashing ? "active" : "trash", destinationLocation: trashing ? "trash" : "active",
          entries: 1, bytes: manifestBytes.byteLength,
          inventoryDigest: await this.host.runtime.sha256(manifestBytes) }
      ];
      let intentBytes: Uint8Array;
      try {
        intentBytes = buildContinuationGroupIntentBytes({
          ownerBookId, campaignId, operationId, groupId, action, createdAt, components
        });
      } catch (error) {
        throw asStorageError(error, "The group move intent could not be prepared. Nothing was moved.");
      }
      await this.host.storage.ensureDirectory(continuationGroupMovesPath(ownerBookId));
      await this.createImmutable(intentPath, intentBytes, "group move intent");
      const retained = await this.readBounded(intentPath, CONTINUATION_GROUP_LIMITS.intentBytes);
      if (!retained || !bytesEqual(retained.bytes, intentBytes)) {
        throw new ContinuationStorageError("uncertain",
          "The group move intent did not read back exactly, so nothing was moved. The intent was kept for inspection.");
      }
      const manifestHash = await this.host.runtime.sha256(manifestBytes);
      let movedAny = false;
      try {
        await moveDirectory(sourceSegments, destSegments);
        movedAny = true;
        await this.noteGroupMove(sourceSegments, destSegments);
        await this.verifyDirectoryAt(destSegments, sourceSegInventory);
        await moveDirectory(sourceIntents, destIntents);
        await this.noteGroupMove(sourceIntents, destIntents);
        await this.verifyDirectoryAt(destIntents, sourceIntInventory);
        await moveFile(sourceManifest, destManifest);
        await this.noteGroupMove(sourceManifest, destManifest);
        const landed = await this.readBounded(destManifest, CONTINUATION_STORAGE_LIMITS.manifestBytes);
        if (!landed || !bytesEqual(landed.bytes, manifestBytes)) throw new Error("Manifest readback changed.");
        if (await this.host.storage.readFile(sourceManifest)) throw new Error("Source manifest reappeared.");
        await inspectContinuationWire(verifyBytes, { ownerBookId, campaignId },
          this.segmentReaderFor(destSegments));
      } catch (error) {
        if (error instanceof ContinuationStorageError && !movedAny) throw error;
        throw new ContinuationStorageError("uncertain",
          "The continuation group move could not be confirmed and may be partial. Both locations and the group intent were kept; inspect them before another move. Nothing was rolled back or overwritten.");
      }
      return {
        status: trashing ? "trashed" as const : "restored" as const,
        operationId, groupId, campaignId, ownerBookId, manifestHash
      };
    });
  }

  async inspectContinuationGroup(ownerBookId: string, campaignId: string,
    options: { groupId?: string } = {}): Promise<ContinuationGroupInspection> {
    this.assertIds(ownerBookId, campaignId);
    const groupId = options.groupId ?? null;
    if (groupId !== null && !recordIdSchema.max(160).safeParse(groupId).success) {
      refusal("invalid", "That group ID is not valid. Nothing was inspected as a group.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const present = async (path: LibraryPath, bounded: number): Promise<boolean> => {
        try {
          return (await this.readBounded(path, bounded)) !== null;
        } catch {
          return true;
        }
      };
      const dirPresent = async (path: LibraryPath): Promise<boolean> =>
        (await this.inventoryDirectory(path)).some((entry) => entry.type === "file");
      const active = {
        manifest: await present(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes),
        segments: await dirPresent(continuationSegmentsPath(ownerBookId, campaignId)),
        intents: await dirPresent(continuationIntentsPath(ownerBookId, campaignId))
      };
      let archived: ContinuationGroupInspection["archived"] = null;
      if (groupId !== null) {
        archived = {
          manifest: await present(continuationTrashManifestPath(ownerBookId, campaignId, groupId), CONTINUATION_STORAGE_LIMITS.manifestBytes),
          segments: await dirPresent(continuationTrashSegmentsPath(ownerBookId, campaignId, groupId)),
          intents: await dirPresent(continuationTrashIntentsPath(ownerBookId, campaignId, groupId))
        };
      }
      const activeAny = active.manifest || active.segments || active.intents;
      const activeAll = active.manifest && active.segments && active.intents;
      const archivedAny = archived ? archived.manifest || archived.segments || archived.intents : false;
      const archivedAll = archived ? archived.manifest && archived.segments && archived.intents : false;
      let state: ContinuationGroupState;
      if (activeAll && !archivedAny) state = "active";
      else if (archivedAll && !activeAny) state = "archived";
      else if (!activeAny && !archivedAny) state = "absent";
      else state = "partial";
      let manifestHash: string | null = null;
      const activeSnapshot = await this.readBounded(
        continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes).catch(() => null);
      if (activeSnapshot) manifestHash = activeSnapshot.sha256;
      else if (groupId !== null) {
        const archivedSnapshot = await this.readBounded(
          continuationTrashManifestPath(ownerBookId, campaignId, groupId), CONTINUATION_STORAGE_LIMITS.manifestBytes).catch(() => null);
        if (archivedSnapshot) manifestHash = archivedSnapshot.sha256;
      }
      return { ownerBookId, campaignId, groupId, state, manifestHash, active, archived };
    });
  }

  async listContinuationGroupMoves(ownerBookId: string, options: { offset?: number; limit?: number } = {}) {
    if (!bookIdSchema.safeParse(ownerBookId).success) refusal("invalid", "That owning book ID is not valid.");
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 ||
      limit > CONTINUATION_STORAGE_LIMITS.inventoryPage) {
      refusal("invalid", "The group move page is not valid; use an offset of 0 or more and a page of 1 to 200.");
    }
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const entries = await this.inventoryEntries(continuationGroupMovesPath(ownerBookId));
      const issues: Array<{ fileName: string; code: string }> = [];
      const moves: Array<{ operationId: string }> = [];
      for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) { issues.push({ fileName: entry.name, code: "unsupported" }); continue; }
        const operationId = entry.name.slice(0, -".json".length);
        if (!recordIdSchema.max(160).safeParse(operationId).success) { issues.push({ fileName: entry.name, code: "invalid" }); continue; }
        moves.push({ operationId });
      }
      moves.sort((a, b) => a.operationId.localeCompare(b.operationId));
      issues.sort((a, b) => a.fileName.localeCompare(b.fileName));
      return { ownerBookId, offset, limit, total: moves.length, moves: moves.slice(offset, offset + limit), issues };
    });
  }

  async readContinuationGroupIntent(ownerBookId: string, operationId: string) {
    if (!bookIdSchema.safeParse(ownerBookId).success) refusal("invalid", "That owning book ID is not valid.");
    if (!recordIdSchema.max(160).safeParse(operationId).success) refusal("invalid", "That group operation ID is not valid.");
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      const snapshot = await this.readBounded(continuationGroupMoveIntentPath(ownerBookId, operationId), CONTINUATION_GROUP_LIMITS.intentBytes);
      if (!snapshot) return null;
      try {
        const raw = decodeStrictJsonBytes(new Uint8Array(snapshot.bytes), { maxBytes: CONTINUATION_GROUP_LIMITS.intentBytes }) as Record<string, unknown>;
        const campaignId = typeof raw.campaignId === "string" ? raw.campaignId : "";
        const read = readContinuationGroupIntent(snapshot.bytes, { ownerBookId, campaignId, operationId });
        return { status: "structural-only" as const, intent: read.intent, hash: snapshot.sha256 };
      } catch (error) {
        throw asStorageError(error, "The retained group move intent could not be read. It was left untouched.");
      }
    });
  }

  /**
   * Resolve checkpoint report references across their recorded owners (format
   * section 5). The recorded owner always wins: a report is read only from its
   * recorded owner's ordinary report path and verified by raw hash, identity
   * and disclosure scope. A verified report owned by another participating
   * book is a bounded foreign reference, never adopted, merged or dropped; a
   * missing, changed or unsupported report stays an unavailable entry in
   * stage order. Nothing is written and no checkpoint byte is rewritten.
   */
  async resolveContinuationReports(ownerBookId: string, campaignId: string): Promise<ContinuationReportResolutionResult> {
    this.assertIds(ownerBookId, campaignId);
    return this.host.withBook(ownerBookId, async () => {
      await this.assertOwner(ownerBookId);
      let snapshot: LibraryFileSnapshot | null;
      try {
        snapshot = await this.readBounded(continuationManifestPath(ownerBookId, campaignId), CONTINUATION_STORAGE_LIMITS.manifestBytes);
      } catch (error) {
        return { status: "refused" as const, code: mapCode(error) };
      }
      if (!snapshot) return { status: "refused" as const, code: "not-found" };
      if (!this.recordedIdentityMatches(snapshot.bytes, ownerBookId, campaignId)) {
        return { status: "refused" as const, code: "corrupt" };
      }
      const dispatch = inspectCampaignContinuationCompatibility(snapshot.bytes);
      if (dispatch.decision === "refuse") return { status: "refused" as const, code: dispatch.code };
      const verifyBytes = dispatch.decision === "replan-required"
        ? this.normalizedSemanticsBytes(snapshot.bytes) : snapshot.bytes;
      let wire: Awaited<ReturnType<typeof inspectContinuationWire>>;
      try {
        wire = await inspectContinuationWire(verifyBytes, { ownerBookId, campaignId },
          this.segmentReader(ownerBookId, campaignId));
      } catch (error) {
        return { status: "refused" as const, code: mapCode(error) };
      }
      const planStream = wire.streams.find((stream) => stream.stream === "plan");
      const checkpointStream = wire.streams.find((stream) => stream.stream === "checkpoint");
      if (!planStream || !checkpointStream) {
        return { status: "resolved" as const, ownerBookId, campaignId, entries: [], owned: 0, foreign: 0, unavailable: 0 };
      }
      let extracted: ReturnType<typeof extractContinuationReportReferences>;
      try {
        extracted = extractContinuationReportReferences(planStream.root, checkpointStream.root);
      } catch (error) {
        return { status: "refused" as const, code: mapCode(error) };
      }
      if (!extracted) {
        return { status: "resolved" as const, ownerBookId, campaignId, entries: [], owned: 0, foreign: 0, unavailable: 0 };
      }
      const entries: ContinuationReportResolutionEntry[] = [];
      for (const item of extracted.references) {
        const reference = item.reference;
        let disposition: ContinuationReportDisposition = "unavailable";
        let code = "external-unavailable";
        try {
          await this.assertOwner(reference.ownerBookId);
          const reportSnapshot = await this.readBounded(continuationReportPath(reference.ownerBookId, reference.runId), REVIEW_RECORD_BYTES);
          if (!reportSnapshot) {
            code = "external-unavailable";
          } else if (reportSnapshot.sha256 !== reference.sha256) {
            code = "external-mismatch";
          } else {
            const decoded = decodeReviewRecord(reportSnapshot.bytes, { kind: "review-report", bookId: reference.ownerBookId });
            const record = decoded.record as unknown as Record<string, unknown>;
            const disclosure = record.disclosure as Record<string, unknown> | undefined;
            if (record.id !== reference.runId || disclosure?.scopeDigest !== item.actualScopeDigest) {
              code = "external-mismatch";
            } else {
              disposition = reference.ownerBookId === ownerBookId ? "owned" : "foreign";
              code = "resolved";
            }
          }
        } catch (error) {
          disposition = "unavailable";
          code = error instanceof ContinuationStorageError ? error.code : mapCode(error);
        }
        entries.push({ stageId: item.stageId, reference: { ...reference }, disposition, code });
      }
      return {
        status: "resolved" as const, ownerBookId, campaignId, entries,
        owned: entries.filter((entry) => entry.disposition === "owned").length,
        foreign: entries.filter((entry) => entry.disposition === "foreign").length,
        unavailable: entries.filter((entry) => entry.disposition === "unavailable").length
      };
    });
  }

  private async classifyOperation(ownerBookId: string, campaignId: string, operationId: string,
    manifestSnapshot: LibraryFileSnapshot | null, manifestUnreadable = false): Promise<ContinuationRecoveryClassification> {
    const manifestStateOf = (candidateBytes: Uint8Array | null): ContinuationRecoveryClassification["manifestState"] => {
      // An unreadable manifest occupies the pointer; its state is never "absent"
      // and never a proven expected base.
      if (manifestUnreadable) return "other";
      if (!manifestSnapshot) return "absent";
      if (candidateBytes && bytesEqual(manifestSnapshot.bytes, candidateBytes)) return "candidate";
      return "other";
    };
    let intentSnapshot: LibraryFileSnapshot | null;
    try {
      intentSnapshot = await this.readBounded(continuationIntentPath(ownerBookId, campaignId, operationId), CONTINUATION_STORAGE_LIMITS.intentBytes);
    } catch (error) {
      return { operationId, status: "refused", code: mapCode(error), candidateRetained: false,
        manifestState: manifestStateOf(null), missingSegmentIds: [], divergentSegmentIds: [] };
    }
    if (!intentSnapshot) {
      if (manifestUnreadable) {
        return { operationId, status: "refused", code: "uncertain", candidateRetained: false,
          manifestState: "other", missingSegmentIds: [], divergentSegmentIds: [] };
      }
      // Interrupted before the intent landed: no candidate is retained in storage. The draft
      // may be republished only as a fresh, fully revalidated candidate; nothing is published.
      return { operationId, status: "recoverable", code: "incomplete-draft", candidateRetained: false,
        manifestState: manifestStateOf(null), missingSegmentIds: [], divergentSegmentIds: [] };
    }
    let intent: Awaited<ReturnType<typeof readContinuationPublicationIntent>>;
    try {
      intent = await readContinuationPublicationIntent(intentSnapshot.bytes, { ownerBookId, campaignId, operationId });
    } catch (error) {
      return { operationId, status: "refused", code: mapCode(error), candidateRetained: false,
        manifestState: manifestStateOf(null), missingSegmentIds: [], divergentSegmentIds: [] };
    }
    const candidateBytes = intent.candidateBytes;
    const candidate = intent.manifest;
    const references = [...candidate.plan.segments, ...(candidate.checkpoint?.segments ?? [])];
    const missingSegmentIds: string[] = [];
    const divergentSegmentIds: string[] = [];
    for (const reference of references) {
      const segment = await this.readBounded(continuationSegmentPath(ownerBookId, campaignId, reference.id), CONTINUATION_STORAGE_LIMITS.segmentBytes)
        .catch(() => null);
      if (!segment) { missingSegmentIds.push(reference.id); continue; }
      if (segment.bytes.byteLength !== reference.bytes || (await this.host.runtime.sha256(segment.bytes)) !== reference.sha256) {
        divergentSegmentIds.push(reference.id);
      }
    }
    if (manifestSnapshot && bytesEqual(manifestSnapshot.bytes, candidateBytes)) {
      if (missingSegmentIds.length === 0 && divergentSegmentIds.length === 0) {
        try {
          await this.verifyStoredReferences(ownerBookId, campaignId, candidateBytes);
          return { operationId, status: "complete", code: "already-published", candidateRetained: true,
            manifestState: "candidate", missingSegmentIds, divergentSegmentIds };
        } catch {
          return { operationId, status: "refused", code: "uncertain", candidateRetained: true,
            manifestState: "candidate", missingSegmentIds, divergentSegmentIds };
        }
      }
      return { operationId, status: "refused", code: "uncertain", candidateRetained: true,
        manifestState: "candidate", missingSegmentIds, divergentSegmentIds };
    }
    if (manifestUnreadable) {
      return { operationId, status: "refused", code: "uncertain", candidateRetained: true,
        manifestState: "other", missingSegmentIds, divergentSegmentIds };
    }
    const base = candidate.base as { kind?: unknown; value?: unknown; revision?: unknown };
    const activeHash = manifestSnapshot ? await this.host.runtime.sha256(manifestSnapshot.bytes) : null;
    // Same revision-continuity gate as publication: a candidate whose base skips a
    // revision does not have its expected base intact, whatever the hash says.
    let activeRevision: number | null = null;
    if (manifestSnapshot) {
      try {
        activeRevision = readContinuationManifest(manifestSnapshot.bytes, { ownerBookId, campaignId }).revision as number;
      } catch {
        activeRevision = null;
      }
    }
    const revisionContinues = !manifestSnapshot
      ? candidate.revision === 1 && base.kind === "absent"
      : activeRevision !== null && candidate.revision === activeRevision + 1 && base.kind === "sha256" && base.revision === activeRevision;
    const baseMatches = revisionContinues && (base.kind === "absent" ? manifestSnapshot === null : activeHash !== null && activeHash === base.value);
    if (!baseMatches) {
      return { operationId, status: "refused", code: "conflict", candidateRetained: true,
        manifestState: manifestStateOf(candidateBytes), missingSegmentIds, divergentSegmentIds };
    }
    if (divergentSegmentIds.length > 0) {
      return { operationId, status: "refused", code: "conflict", candidateRetained: true,
        manifestState: "expected-base", missingSegmentIds, divergentSegmentIds };
    }
    if (missingSegmentIds.length > 0) {
      return { operationId, status: "recoverable", code: "incomplete-draft", candidateRetained: true,
        manifestState: "expected-base", missingSegmentIds, divergentSegmentIds };
    }
    try {
      await this.verifyStoredReferences(ownerBookId, campaignId, candidateBytes);
    } catch (error) {
      return { operationId, status: "refused", code: mapCode(error), candidateRetained: true,
        manifestState: "expected-base", missingSegmentIds, divergentSegmentIds };
    }
    return { operationId, status: "recoverable", code: "prepared", candidateRetained: true,
      manifestState: "expected-base", missingSegmentIds, divergentSegmentIds };
  }

  /* ---------------------------------------------------------------- internals */

  private assertIds(ownerBookId: string, campaignId: string): void {
    if (!bookIdSchema.safeParse(ownerBookId).success) refusal("invalid", "That owning book ID is not valid. Nothing was written or read as a continuation.");
    if (!recordIdSchema.max(160).safeParse(campaignId).success) refusal("invalid", "That campaign ID is not a portable continuation ID. Nothing was written or read as a continuation.");
  }

  private recordedIdentityMatches(bytes: Uint8Array, ownerBookId: string, campaignId: string): boolean {
    try {
      const value = decodeStrictJsonBytes(new Uint8Array(bytes), { maxBytes: CONTINUATION_STORAGE_LIMITS.manifestBytes });
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const owner = record.owner as Record<string, unknown> | null;
      return owner !== null && typeof owner === "object" && owner.bookId === ownerBookId && record.id === campaignId;
    } catch {
      return false;
    }
  }

  private segmentReader(ownerBookId: string, campaignId: string) {
    return async (id: string): Promise<Uint8Array | undefined> => {
      if (!SEGMENT_ID.test(id)) return undefined;
      const snapshot = await this.readBounded(continuationSegmentPath(ownerBookId, campaignId, id), CONTINUATION_STORAGE_LIMITS.segmentBytes);
      return snapshot ? new Uint8Array(snapshot.bytes) : undefined;
    };
  }

  private segmentReaderFor(segmentsDir: LibraryPath) {
    return async (id: string): Promise<Uint8Array | undefined> => {
      if (!SEGMENT_ID.test(id)) return undefined;
      const snapshot = await this.readBounded(
        toLibraryFilePath([...segmentsDir, `${id}.json`]), CONTINUATION_STORAGE_LIMITS.segmentBytes);
      return snapshot ? new Uint8Array(snapshot.bytes) : undefined;
    };
  }

  /** Local comparison copy for a compatibly differing label; stored bytes are never altered. */
  private normalizedSemanticsBytes(manifestBytes: Uint8Array): Uint8Array {
    const manifest = decodeStrictJsonBytes(new Uint8Array(manifestBytes),
      { maxBytes: CONTINUATION_STORAGE_LIMITS.manifestBytes }) as Record<string, unknown>;
    return encodeCanonicalJson({ ...manifest, plannerSemantics: "review-campaign-planner-v1" },
      { maxBytes: CONTINUATION_STORAGE_LIMITS.manifestBytes });
  }

  private checkInventory(inventory: ContinuationInventoryEntry[]) {
    try {
      return validateContinuationInventory(inventory);
    } catch (error) {
      throw asStorageError(error, "This continuation group inventory cannot be verified. Nothing was moved.");
    }
  }

  /**
   * Recursive inventory of one group directory (format section 7.3). Unsupported
   * entries refuse without following them; every file is read bounded and hashed
   * before the inventory grows past its scan budgets.
   */
  private async inventoryDirectory(root: LibraryPath): Promise<ContinuationInventoryEntry[]> {
    const entries: ContinuationInventoryEntry[] = [{ path: [], type: "directory" }];
    let fileBytes = 0;
    const walk = async (dir: LibraryPath, prefix: string[]): Promise<void> => {
      const listed = this.host.storage.inspectDirectory
        ? await this.host.storage.inspectDirectory(dir)
        : await this.host.storage.listDirectory(dir);
      const ordered = [...listed].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of ordered) {
        if ((entry as { kind: string }).kind === "unsupported") {
          refusal("unsupported", "This continuation group contains a file this version cannot move safely. Nothing was moved.");
        }
        const name = entry.name;
        if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
          refusal("unsupported", "This continuation group contains a file this version cannot move safely. Nothing was moved.");
        }
        if (entries.length + 1 > CONTINUATION_GROUP_LIMITS.entries) {
          refusal("too-large", "This continuation group has more files than this version can move. Nothing was moved or listed partially.");
        }
        const path = [...prefix, name];
        if (entry.kind === "directory") {
          entries.push({ path, type: "directory" });
          await walk(toLibraryPath([...dir, name]), path);
        } else {
          const child = toLibraryFilePath([...dir, name]);
          const snapshot = await this.readBounded(child, CONTINUATION_GROUP_LIMITS.fileBytesEach);
          if (!snapshot) refusal("corrupt", "A continuation group file disappeared while it was inventoried. Nothing was moved.");
          if (snapshot.bytes.byteLength > CONTINUATION_GROUP_LIMITS.fileBytes - fileBytes) {
            refusal("too-large", "This continuation group is larger than this version can move. Nothing was moved.");
          }
          fileBytes += snapshot.bytes.byteLength;
          entries.push({ path, type: "file", bytes: snapshot.bytes.byteLength, sha256: snapshot.sha256 });
        }
      }
    };
    await walk(root, []);
    return sortContinuationInventory(entries);
  }

  private async verifyDirectoryAt(dir: LibraryPath, expected: ContinuationInventoryEntry[]): Promise<void> {
    const landed = await this.inventoryDirectory(dir);
    if (JSON.stringify(landed) !== JSON.stringify(expected)) throw new Error("Directory readback changed.");
  }

  private async noteGroupMove(from: LibraryPath, to: LibraryPath): Promise<void> {
    try {
      await noteMovedPrefix({
        storage: this.host.storage, deviceId: this.host.deviceId,
        from: libraryPathToArchivePath(from), to: libraryPathToArchivePath(to),
        now: this.host.runtime.now()
      });
    } catch {
      // Detection degrades to a reviewable report; the move itself already verified.
    }
  }

  private async verifyStoredReferences(ownerBookId: string, campaignId: string, manifestBytes: Uint8Array) {
    return inspectContinuationWire(manifestBytes, { ownerBookId, campaignId }, this.segmentReader(ownerBookId, campaignId));
  }

  private async createImmutable(path: LibraryPath, bytes: Uint8Array, label: string): Promise<"created" | "existing-identical"> {
    const create = this.host.createImmutableFile;
    if (!create) refusal("unsupported-concurrent-writer", "This storage cannot create immutable continuation files without replacing an existing file, so nothing was written.");
    let result: CommitFileResult;
    try {
      result = await create(path, bytes);
    } catch (error) {
      if (error instanceof LibraryPortError && error.code === "already-exists") {
        const current = await this.readBounded(path, Math.max(bytes.byteLength, 1));
        if (current && bytesEqual(current.bytes, bytes)) return "existing-identical";
        refusal("conflict", `A ${label} already exists with different bytes. It was not overwritten; the manifest was not published.`);
      }
      throw new ContinuationStorageError("uncertain", `The ${label} write could not be confirmed. Any files already written were kept for inspection; the manifest was not reported as published.`);
    }
    if (result.status === "written") {
      if (!bytesEqual(result.snapshot.bytes, bytes) || result.snapshot.sha256 !== (await this.host.runtime.sha256(bytes))) {
        throw new ContinuationStorageError("uncertain", `The ${label} did not read back from its creation exactly. It was kept for inspection; the manifest was not reported as published.`);
      }
      return "created";
    }
    if (result.publication === "uncertain") {
      throw new ContinuationStorageError("uncertain", `The ${label} was created but did not read back exactly. It was kept for inspection; the manifest was not reported as published.`);
    }
    if (result.current && bytesEqual(result.current.bytes, bytes)) return "existing-identical";
    return refusal("conflict", `A ${label} already exists with different bytes. It was not overwritten; the manifest was not published.`);
  }

  private async readBounded(path: LibraryPath, maxBytes: number): Promise<LibraryFileSnapshot | null> {
    try {
      return await this.host.storage.readFile(path, { maxBytes });
    } catch (error) {
      throw asStorageError(error, "A retained continuation file could not be read within its bounds. It was left untouched.");
    }
  }

  private async inventoryEntries(path: LibraryPath) {
    const entries = this.host.storage.inspectDirectory
      ? await this.host.storage.inspectDirectory(path)
      : await this.host.storage.listDirectory(path);
    if (entries.length > CONTINUATION_STORAGE_LIMITS.inventoryEntries) {
      refusal("too-large", "This continuation inventory has more entries than this version can inspect. Nothing was listed partially or written.");
    }
    return entries;
  }

  private async assertOwner(bookId: string): Promise<void> {
    const snapshot = await this.host.storage.readFile(bookFilePath(bookId));
    if (!snapshot) throw new ContinuationStorageError("not-found", "The owning book is unavailable.");
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(snapshot.bytes)) as unknown;
    } catch {
      throw new ContinuationStorageError("corrupt", "The owning book is unreadable.");
    }
    try {
      assertSchemaVersion((raw as { schemaVersion?: unknown } | null)?.schemaVersion, "book.json");
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") throw new ContinuationStorageError("newer-schema", error.message);
      throw new ContinuationStorageError("invalid", "The owning book is not supported.");
    }
    const parsed = bookSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== bookId) {
      throw new ContinuationStorageError("invalid", "The actual book ID does not match its folder.");
    }
  }

  private async writable(bookId: string): Promise<void> {
    try {
      await assertBookWritable(this.host.storage, bookId);
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") throw new ContinuationStorageError("newer-schema", error.message);
      throw error;
    }
  }
}
