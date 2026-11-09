import {
  ADOPTION_RECEIPT_LIMITS, validateAdoptionReceipt, type AdoptionReceipt
} from "../authoring/adoption-receipt";
import { sameOwner, sameReference, type Owner, type Reference } from "../authoring/contracts";
import type { EffectPhase } from "../authoring/lifecycle";
import { AuthoringError, copyValue, type Immutable } from "../authoring/value";
import { canonicalWorkflowJson, parseWorkflowJsonBytes } from "../authoring/wire";
import { LibraryError, LibraryPortError } from "../library/errors";
import { libraryPathToArchivePath, type LibraryPath } from "../library/path";
import { bookFilePath } from "../library/paths";
import { WORKFLOW_CONFLICT_BYTES } from "../library/read-limits";
import type {
  CommitFileResult, LibraryFileSnapshot, LibraryPort, LibraryRuntime
} from "../library/port";
import { assertBookWritable, assertSchemaVersion } from "../library/schema-guard";
import { bookSchema } from "../schema";
import { WorkflowRecordError } from "./record-error";
import {
  adoptionReceiptPath, adoptionReceiptsPath, workflowConflictPath, workflowConflictsPath
} from "./paths";

/**
 * Checked storage for adoption receipts (037 FR-017 / ADR 0019, serving
 * 037 T032 adoption-based cadence), beside `WorkflowRecordStore`.
 *
 * Pattern chosen: the workflow record-store pattern — the same one the
 * checked question records use (`WorkflowRecordStore.readQuestion` /
 * `saveQuestion` over `questions/<questionId>.json`) — because adoption
 * receipts are book/run-owned workflow state with the same queue, journal
 * and foreign-owner requirements. The review record-store was not chosen:
 * it owns single-book review reports, not run-scoped workflow records.
 *
 * Reused from that pattern: the injected host (`storage`, `runtime`,
 * `deviceId`, the Library's per-book `withBook` queue and its journal-aware
 * `commitFile`), canonical compact sorted-key bytes, SHA-256 verification
 * through the injected runtime, exact readback verification, bounded
 * observed reads, owning-book/writable checks, `WorkflowRecordError`
 * vocabulary, and recoverable conflict copies under
 * `workflows/<runId>/conflicts/`.
 *
 * Added for receipts (the existing kinds cannot express them without
 * widening the schema-1 codec): a beside-store class with its own
 * `adoptions/<receiptId>.json` layout, strict absent-only creation scoped
 * to the candidate (an existing receipt for the same candidate artifact
 * refuses rather than overwrites — even a byte-identical replay refuses),
 * candidate/sequence uniqueness enforced by a bounded scan, and a bounded
 * sequence-ordered listing. The Library publisher records receipts through
 * `recordConfirmedAdoption` (see `LibraryService.recordConfirmedAdoptionReceipt`);
 * no scheduler, provider call or cadence wiring lives here.
 */

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const RECORD_BYTES = ADOPTION_RECEIPT_LIMITS.recordBytes;
const CONFLICT_COPY_BYTES = WORKFLOW_CONFLICT_BYTES;
const CONFLICT_NAME_LIMIT = 200;
const RUN_ID_PATTERN = /^run_[A-Za-z0-9][A-Za-z0-9_-]{0,123}$/;
const RECEIPT_ID_PATTERN = /^adoption_[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

export interface AdoptionReceiptHost {
  storage: LibraryPort;
  runtime: LibraryRuntime;
  deviceId: string;
  withBook<T>(bookId: string, work: () => Promise<T>): Promise<T>;
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: { kind: "absent" } | { kind: "sha256"; value: string } | { kind: "any" }): Promise<CommitFileResult>;
}

export interface AdoptionReceiptSnapshot {
  record: Immutable<AdoptionReceipt>;
  bytes: Uint8Array;
  hash: string;
}

export interface AdoptionReceiptListing {
  bookId: string;
  runId: string;
  offset: number;
  limit: number;
  total: number;
  receipts: AdoptionReceiptSnapshot[];
}

/**
 * One confirmed adoption, as the Library publisher hands it to this store.
 *
 * The fields are the ones the existing confirmation point carries: a checked
 * effect record saved with phase `confirmed` and a receipt of
 * `{ outcome: "confirmed", resultVersion, resultHash, at }` carries `owner`,
 * the exact `candidate`, the target `chapterId`, `resultVersion`/`resultHash`
 * and the adoption instant (`adoptedAt`, the effect receipt's `at`). It does
 * not carry a `grant` or a `direction` reference, so the caller — the future
 * coordinator holding the current host permission and direction — supplies
 * those two references explicitly. Nothing here fabricates them.
 */
export interface ConfirmedAdoption {
  phase: EffectPhase;
  owner: Owner;
  chapterId: string;
  candidate: Reference<"artifact">;
  resultVersion: number;
  resultHash: string;
  grant: Reference<"grant">;
  direction: Reference<"direction">;
  adoptedAt: string;
}

/**
 * What the caller learns when it asks this store to record a confirmed
 * adoption. `confirmed-unrecorded` is the honest failure shape: the adoption
 * itself is confirmed and is never rolled back by this store, but no receipt
 * is claimed; `code` is the `WorkflowRecordError` vocabulary of the failure.
 */
export type AdoptionRecordingResult =
  | { status: "recorded"; receipt: AdoptionReceiptSnapshot }
  | { status: "already-recorded"; receipt: AdoptionReceiptSnapshot }
  | { status: "not-confirmed"; phase: EffectPhase }
  | { status: "confirmed-unrecorded"; code: WorkflowRecordError["code"]; message: string };

const EFFECT_PHASES: ReadonlySet<string> = new Set([
  "prepared", "publish-intent", "confirmed", "conflict", "not-published", "uncertain"
]);

/**
 * The identity a retried confirmation is compared by: the adopting owner, the
 * chapter adopted into, the exact candidate reference, the published result
 * version/hash, and the grant and direction references. Receipt ID, sequence
 * and `adoptedAt` are recording metadata allocated at first recording, so a
 * retry that matches on this identity is the same adoption already recorded,
 * while a receipt for the same candidate that differs on any of these fields
 * is a conflicting receipt, never an overwrite.
 */
function sameAdoptionIdentity(record: Immutable<AdoptionReceipt>, adoption: ConfirmedAdoption): boolean {
  return sameOwner(record.owner, adoption.owner) &&
    record.chapterId === adoption.chapterId &&
    sameReference(record.candidate, adoption.candidate) &&
    record.resultVersion === adoption.resultVersion &&
    record.resultHash === adoption.resultHash &&
    sameReference(record.grant, adoption.grant) &&
    sameReference(record.direction, adoption.direction);
}

function unrecorded(error: WorkflowRecordError): AdoptionRecordingResult {
  return {
    status: "confirmed-unrecorded",
    code: error.code,
    message:
      `The adoption is confirmed, but its adoption receipt was not recorded (${error.code}: ` +
      `${error.message}) The adopted chapter was not rolled back and no adoption receipt is claimed.`
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new WorkflowRecordError("invalid", "That run ID is not a safe workflow run ID. Nothing was written.");
  }
}

function assertReceiptId(receiptId: string): void {
  if (typeof receiptId !== "string" || !RECEIPT_ID_PATTERN.test(receiptId)) {
    throw new WorkflowRecordError("invalid", "That adoption receipt ID is not a safe receipt ID. Nothing was written.");
  }
}

export class AdoptionReceiptStore {
  constructor(private readonly host: AdoptionReceiptHost) {}

  async createAdoptionReceipt(
    bookId: string,
    runId: string,
    value: unknown
  ): Promise<{ status: "created"; record: AdoptionReceiptSnapshot }> {
    assertRunId(runId);
    return this.inBook(bookId, async () => {
      await this.writable(bookId);
      const prepared = this.prepare(bookId, runId, value);
      const record = await this.commitPrepared(bookId, runId, prepared);
      return { status: "created" as const, record };
    });
  }

  /**
   * Record the receipt for one confirmed adoption, under the same per-book
   * queue as publication. Only a `confirmed` phase records; every other
   * effect phase returns `not-confirmed` and writes nothing.
   *
   * Sequence allocation is race-safe because it happens here, inside the
   * queue: the next sequence is one past the maximum read from the store in
   * this same queue hold, never a cached value. A candidate that already has
   * a receipt is compared by `sameAdoptionIdentity`: a match is the same
   * adoption retried and returns `already-recorded` with the stored receipt,
   * while any identity difference is a conflicting receipt and returns
   * `confirmed-unrecorded` with code `conflict` — nothing is overwritten.
   *
   * Because creation is absent-only and refuses even a byte-identical
   * replay, an uncertain commit outcome is settled here by reading the
   * receipt back and comparing bytes exactly: byte equality with the
   * intended receipt reports `recorded`, anything else reports
   * `confirmed-unrecorded` with code `uncertain` and claims no receipt.
   */
  async recordConfirmedAdoption(
    bookId: string,
    runId: string,
    adoption: ConfirmedAdoption
  ): Promise<AdoptionRecordingResult> {
    assertRunId(runId);
    if (!adoption || typeof adoption.phase !== "string" || !EFFECT_PHASES.has(adoption.phase)) {
      throw new WorkflowRecordError("invalid", "That adoption phase is not a known effect phase. Nothing was written.");
    }
    if (adoption.phase !== "confirmed") return { status: "not-confirmed", phase: adoption.phase };
    return this.inBook(bookId, async () => {
      await this.writable(bookId);
      // Validate the binding before any identity comparison reads its fields.
      try {
        this.prepare(bookId, runId, {
          schemaVersion: 1,
          kind: "adoption-receipt",
          id: "adoption_00000001",
          owner: adoption.owner,
          chapterId: adoption.chapterId,
          candidate: adoption.candidate,
          resultVersion: adoption.resultVersion,
          resultHash: adoption.resultHash,
          grant: adoption.grant,
          direction: adoption.direction,
          sequence: 1,
          adoptedAt: adoption.adoptedAt
        });
      } catch (error) {
        if (error instanceof WorkflowRecordError) return unrecorded(error);
        throw error;
      }
      let existing: AdoptionReceiptSnapshot[];
      try {
        existing = await this.listAllUnlocked(bookId, runId);
      } catch (error) {
        if (error instanceof WorkflowRecordError) return unrecorded(error);
        throw error;
      }
      const candidateDuplicate = existing.find((entry) =>
        sameReference(entry.record.candidate, adoption.candidate));
      if (candidateDuplicate) {
        if (sameAdoptionIdentity(candidateDuplicate.record, adoption)) {
          return { status: "already-recorded" as const, receipt: candidateDuplicate };
        }
        return unrecorded(new WorkflowRecordError(
          "conflict",
          "An adoption receipt for this candidate already exists with different adoption details. Nothing was replaced."
        ));
      }
      const sequence = existing.reduce((max, entry) => Math.max(max, entry.record.sequence), 0) + 1;
      if (sequence > ADOPTION_RECEIPT_LIMITS.maxSequence) {
        return unrecorded(new WorkflowRecordError(
          "too-large",
          `This run already holds the maximum adoption sequence. Nothing was written.`
        ));
      }
      const receiptId = this.host.runtime.newId("adoption");
      let prepared: { bytes: Uint8Array; record: Immutable<AdoptionReceipt> };
      try {
        prepared = this.prepare(bookId, runId, {
          schemaVersion: 1,
          kind: "adoption-receipt",
          id: receiptId,
          owner: adoption.owner,
          chapterId: adoption.chapterId,
          candidate: adoption.candidate,
          resultVersion: adoption.resultVersion,
          resultHash: adoption.resultHash,
          grant: adoption.grant,
          direction: adoption.direction,
          sequence,
          adoptedAt: adoption.adoptedAt
        });
      } catch (error) {
        if (error instanceof WorkflowRecordError) return unrecorded(error);
        throw error;
      }
      try {
        const receipt = await this.commitPrepared(bookId, runId, prepared);
        return { status: "recorded" as const, receipt };
      } catch (error) {
        if (!(error instanceof WorkflowRecordError)) throw error;
        if (error.code === "uncertain") {
          // Creation refuses byte-identical replay, so settle the uncertain
          // write by reading back: only byte-exact stored bytes are ours.
          try {
            const stored = await this.load(bookId, runId, receiptId);
            if (stored && bytesEqual(stored.bytes, prepared.bytes)) {
              return { status: "recorded" as const, receipt: stored };
            }
          } catch {
            // A read-back failure confirms nothing; report it as uncertain.
          }
          return unrecorded(error);
        }
        if (error.code === "conflict") {
          try {
            const nowExisting = await this.listAllUnlocked(bookId, runId);
            const duplicate = nowExisting.find((entry) =>
              sameReference(entry.record.candidate, adoption.candidate));
            if (duplicate && sameAdoptionIdentity(duplicate.record, adoption)) {
              return { status: "already-recorded" as const, receipt: duplicate };
            }
          } catch {
            // The conflict below already states the receipt was not recorded.
          }
        }
        return unrecorded(error);
      }
    });
  }

  async readAdoptionReceipt(
    bookId: string,
    runId: string,
    receiptId: string
  ): Promise<AdoptionReceiptSnapshot | null> {
    assertRunId(runId);
    assertReceiptId(receiptId);
    return this.inBook(bookId, () => this.load(bookId, runId, receiptId));
  }

  async listAdoptionReceipts(
    bookId: string,
    runId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<AdoptionReceiptListing> {
    assertRunId(runId);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? ADOPTION_RECEIPT_LIMITS.maxListPage;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new WorkflowRecordError("invalid", "The adoption receipt list offset is not valid.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > ADOPTION_RECEIPT_LIMITS.maxListPage) {
      throw new WorkflowRecordError(
        "invalid",
        `The adoption receipt list page is not valid; use 1 to ${ADOPTION_RECEIPT_LIMITS.maxListPage}.`
      );
    }
    return this.inBook(bookId, async () => {
      const all = await this.listAllUnlocked(bookId, runId);
      return {
        bookId, runId, offset, limit, total: all.length,
        receipts: all.slice(offset, offset + limit)
      };
    });
  }

  /** Absent-only candidate-scoped commit of one prepared receipt. Caller holds the book queue. */
  private async commitPrepared(
    bookId: string,
    runId: string,
    prepared: { bytes: Uint8Array; record: Immutable<AdoptionReceipt> }
  ): Promise<AdoptionReceiptSnapshot> {
    const receiptId = prepared.record.id;
    const path = adoptionReceiptPath(bookId, runId, receiptId);
    const observed = await this.readObserved(path, RECORD_BYTES, "adoption receipt");
    if (observed) {
      const savedAs = await this.preserve(bookId, runId, receiptId, prepared.bytes, observed.sha256);
      throw new WorkflowRecordError(
        "conflict",
        "An adoption receipt with this identity already exists. This version was kept as a copy; nothing was replaced.",
        savedAs
      );
    }
    const existing = await this.listAllUnlocked(bookId, runId);
    const candidateDuplicate = existing.find((entry) =>
      sameReference(entry.record.candidate, prepared.record.candidate));
    const sequenceDuplicate = existing.find((entry) => entry.record.sequence === prepared.record.sequence);
    const duplicate = candidateDuplicate ?? sequenceDuplicate;
    if (duplicate) {
      const savedAs = await this.preserve(bookId, runId, receiptId, prepared.bytes, duplicate.hash);
      throw new WorkflowRecordError(
        "conflict",
        candidateDuplicate
          ? "An adoption receipt for this candidate already exists. This version was kept as a copy; nothing was replaced."
          : "An adoption receipt with this sequence already exists. This version was kept as a copy; nothing was replaced.",
        savedAs
      );
    }
    let result: CommitFileResult;
    try {
      result = await this.host.commitFile(path, prepared.bytes, { kind: "absent" });
    } catch (error) {
      throw this.writeFailure(error);
    }
    if (result.status === "changed") {
      if (result.publication === "uncertain") throw this.uncertainRecord();
      if (result.current && bytesEqual(result.current.bytes, prepared.bytes)) {
        return this.decodeSnapshot(bookId, runId, receiptId, result.current);
      }
      const savedAs = await this.preserve(
        bookId, runId, receiptId, prepared.bytes, result.current?.sha256 ?? null);
      throw new WorkflowRecordError(
        "conflict",
        "An adoption receipt appeared while it was saved. This version was kept as a copy; nothing was overwritten.",
        savedAs
      );
    }
    const snapshot = await this.verifyBytes(result.snapshot, prepared.bytes, this.uncertainRecord());
    return this.decodeSnapshot(bookId, runId, receiptId, snapshot);
  }

  /* -------------------------------------------------------------- internals */

  private inBook<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwnerBook(bookId);
      return work();
    });
  }

  private prepare(
    bookId: string,
    runId: string,
    value: unknown
  ): { bytes: Uint8Array; record: Immutable<AdoptionReceipt> } {
    let validated: Immutable<AdoptionReceipt>;
    try {
      validated = validateAdoptionReceipt(value as AdoptionReceipt);
    } catch (error) {
      throw this.fromAuthoring(error, "write");
    }
    if (validated.owner.bookId !== bookId || validated.owner.runId !== runId) {
      throw new WorkflowRecordError(
        "invalid",
        "This adoption receipt belongs to another book or run. Nothing was written."
      );
    }
    if (Object.hasOwn(validated, "conflictMetadata")) {
      throw new WorkflowRecordError(
        "invalid",
        "A conflict copy cannot be saved as an active adoption receipt. Prepare a fresh reviewed edit. Nothing was written."
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = encoder.encode(canonicalWorkflowJson(validated));
    } catch (error) {
      throw this.fromAuthoring(error, "write");
    }
    if (bytes.byteLength > RECORD_BYTES) {
      throw new WorkflowRecordError(
        "too-large",
        `An adoption receipt is at most ${RECORD_BYTES.toLocaleString("en-US")} UTF-8 bytes. Nothing was written.`
      );
    }
    // Re-parse the exact intended bytes with this build's reader before publication.
    try {
      this.decodeBytes(bytes);
    } catch (error) {
      throw this.fromAuthoring(error, "write");
    }
    return { bytes, record: validated };
  }

  private decodeBytes(bytes: Uint8Array): Immutable<AdoptionReceipt> {
    if (!(bytes instanceof Uint8Array)) {
      throw new AuthoringError("invalid-bytes");
    }
    if (bytes.byteLength > RECORD_BYTES) throw new AuthoringError("record-overflow");
    const parsed = parseWorkflowJsonBytes(bytes);
    return validateAdoptionReceipt(parsed as AdoptionReceipt);
  }

  private async load(
    bookId: string,
    runId: string,
    receiptId: string
  ): Promise<AdoptionReceiptSnapshot | null> {
    const path = adoptionReceiptPath(bookId, runId, receiptId);
    const snapshot = await this.readObserved(path, RECORD_BYTES, "adoption receipt");
    if (!snapshot) return null;
    return this.decodeSnapshot(bookId, runId, receiptId, snapshot);
  }

  private async listAllUnlocked(bookId: string, runId: string): Promise<AdoptionReceiptSnapshot[]> {
    let entries: Array<{ name: string; kind: "file" | "directory" }>;
    try {
      entries = await this.host.storage.listDirectory(adoptionReceiptsPath(bookId, runId));
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      if (!entry.name.endsWith(".json")) {
        throw new WorkflowRecordError(
          "corrupt",
          "This adoption receipt file name is not a receipt ID. The file was left untouched."
        );
      }
      const id = entry.name.slice(0, -".json".length);
      if (!RECEIPT_ID_PATTERN.test(id)) {
        throw new WorkflowRecordError(
          "corrupt",
          "This adoption receipt file name is not a receipt ID. The file was left untouched."
        );
      }
      ids.push(id);
    }
    if (ids.length > ADOPTION_RECEIPT_LIMITS.maxReceiptsPerRun) {
      throw new WorkflowRecordError(
        "too-large",
        `This run holds more than ${ADOPTION_RECEIPT_LIMITS.maxReceiptsPerRun.toLocaleString("en-US")} adoption receipts. The files were left untouched.`
      );
    }
    const snapshots: AdoptionReceiptSnapshot[] = [];
    for (const id of ids.sort()) {
      const snapshot = await this.load(bookId, runId, id);
      if (!snapshot) {
        throw new WorkflowRecordError(
          "corrupt",
          "This adoption receipt disappeared while listing. It was left untouched."
        );
      }
      snapshots.push(snapshot);
    }
    snapshots.sort((left, right) =>
      left.record.sequence - right.record.sequence ||
      left.record.adoptedAt.localeCompare(right.record.adoptedAt) ||
      left.record.id.localeCompare(right.record.id));
    return snapshots;
  }

  private async decodeSnapshot(
    bookId: string,
    runId: string,
    receiptId: string,
    snapshot: LibraryFileSnapshot
  ): Promise<AdoptionReceiptSnapshot> {
    if (snapshot.bytes.byteLength > RECORD_BYTES) {
      throw new WorkflowRecordError(
        "too-large",
        `This adoption receipt is larger than the ${RECORD_BYTES.toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
      );
    }
    if (snapshot.sha256 !== (await this.host.runtime.sha256(snapshot.bytes))) {
      throw new WorkflowRecordError(
        "corrupt",
        "This adoption receipt's hash could not be verified. The file was left untouched."
      );
    }
    let record: Immutable<AdoptionReceipt>;
    try {
      record = this.decodeBytes(snapshot.bytes);
    } catch (error) {
      throw this.fromAuthoring(error, "read");
    }
    if (record.owner.bookId !== bookId || record.owner.runId !== runId) {
      throw new WorkflowRecordError(
        "unavailable",
        "This adoption receipt belongs to another book or run. It was left untouched."
      );
    }
    if (Object.hasOwn(record, "conflictMetadata")) {
      throw new WorkflowRecordError(
        "unavailable",
        "This file is a conflict copy, not an active adoption receipt. It was left untouched."
      );
    }
    if (record.id !== receiptId) {
      throw new WorkflowRecordError(
        "corrupt",
        "This adoption receipt's identity does not match its file name. The file was left untouched."
      );
    }
    return { record, bytes: snapshot.bytes, hash: snapshot.sha256 };
  }

  private async readObserved(
    path: LibraryPath,
    bound: number,
    label: string
  ): Promise<LibraryFileSnapshot | null> {
    const stat = await this.host.storage.stat(path);
    if (!stat) return null;
    if (stat.size > bound) {
      throw new WorkflowRecordError(
        "too-large",
        `This ${label} is larger than the ${bound.toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
      );
    }
    try {
      return await this.host.storage.readFile(path, { maxBytes: bound });
    } catch (error) {
      if (error instanceof LibraryPortError && error.code === "too-large") {
        throw new WorkflowRecordError(
          "too-large",
          `This ${label} is larger than the ${bound.toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
        );
      }
      throw error;
    }
  }

  private async preserve(
    bookId: string,
    runId: string,
    receiptId: string,
    intended: Uint8Array,
    observed: string | null
  ): Promise<string> {
    let copy: Record<string, unknown>;
    try {
      copy = copyValue(
        parseWorkflowJsonBytes(intended) as Record<string, unknown>,
        CONFLICT_COPY_BYTES
      );
      copy.conflictMetadata = {
        reason: observed === null ? "missing-file" : "external-edit",
        baseline: { kind: "absent", revision: 0 },
        observed: observed === null ? { kind: "absent" } : { kind: "sha256", value: observed }
      };
    } catch {
      throw new WorkflowRecordError(
        "not-kept",
        "The conflict copy could not be prepared. Keep your version and try again."
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = encoder.encode(canonicalWorkflowJson(copy));
    } catch {
      throw new WorkflowRecordError(
        "not-kept",
        "The conflict copy could not be prepared. Keep your version and try again."
      );
    }
    if (bytes.byteLength > CONFLICT_COPY_BYTES) {
      throw new WorkflowRecordError(
        "not-kept",
        `The conflict copy would be larger than ${CONFLICT_COPY_BYTES.toLocaleString("en-US")} bytes. Keep your version and try again.`
      );
    }
    return this.writeConflictCopy(bookId, runId, receiptId, bytes, observed);
  }

  private async writeConflictCopy(
    bookId: string,
    runId: string,
    receiptId: string,
    bytes: Uint8Array,
    observed: string | null
  ): Promise<string> {
    const device = this.host.deviceId;
    const stamp = this.host.runtime.now().replace(/[:.]/g, "-");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(device) || !/^[0-9TZ-]{1,100}$/.test(stamp)) {
      throw new WorkflowRecordError(
        "not-kept",
        "The conflict copy could not be named safely. Keep your version and try again."
      );
    }
    try {
      await this.host.storage.ensureDirectory(workflowConflictsPath(bookId, runId));
    } catch {
      throw new WorkflowRecordError(
        "not-kept",
        "The conflict copy folder could not be created. Keep your version and try again."
      );
    }
    const reason = observed === null ? "missing-file" : "external-edit";
    const idDigest = (await this.host.runtime.sha256(encoder.encode(receiptId))).slice(0, 12);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const readable = `adoption-receipt.${receiptId}.conflict-${reason}.${device}.${stamp}${suffix}.json`;
      const name = readable.length <= CONFLICT_NAME_LIMIT
        ? readable
        : `adoption-receipt.conflict-${reason}.${idDigest}${suffix}.json`;
      const path = workflowConflictPath(bookId, runId, name);
      let result: CommitFileResult;
      try {
        result = await this.host.commitFile(path, bytes, { kind: "absent" });
      } catch (error) {
        throw this.writeFailure(
          error,
          "The conflict copy could not be confirmed. Keep your version and check the conflicts folder."
        );
      }
      if (result.status === "changed") {
        if (result.publication === "uncertain") {
          throw new WorkflowRecordError(
            "uncertain",
            "The conflict copy was published but did not read back exactly. Keep your version and check the conflicts folder."
          );
        }
        continue;
      }
      await this.verifyBytes(
        result.snapshot,
        bytes,
        new WorkflowRecordError(
          "uncertain",
          "The conflict copy was written but did not read back exactly. Keep your version and check the conflicts folder."
        )
      );
      return libraryPathToArchivePath(path);
    }
    throw new WorkflowRecordError(
      "not-kept",
      "No free conflict copy name was found. Keep your version and try again."
    );
  }

  private async verifyBytes(
    snapshot: LibraryFileSnapshot,
    bytes: Uint8Array,
    failure: WorkflowRecordError
  ): Promise<LibraryFileSnapshot> {
    if (!bytesEqual(snapshot.bytes, bytes) || snapshot.sha256 !== (await this.host.runtime.sha256(bytes))) {
      throw failure;
    }
    return snapshot;
  }

  private async assertOwnerBook(bookId: string): Promise<void> {
    const snapshot = await this.host.storage.readFile(bookFilePath(bookId));
    if (!snapshot) {
      throw new WorkflowRecordError("not-found", "The owning book is unavailable. Nothing was written.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(snapshot.bytes)) as unknown;
    } catch {
      throw new WorkflowRecordError("corrupt", "The owning book is unreadable. Nothing was written.");
    }
    try {
      assertSchemaVersion(isObject(raw) ? raw.schemaVersion : undefined, "book.json");
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") {
        throw new WorkflowRecordError("newer-schema", error.message);
      }
      throw new WorkflowRecordError("invalid", "The owning book is not supported. Nothing was written.");
    }
    const parsed = bookSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== bookId) {
      throw new WorkflowRecordError("invalid", "The actual book ID does not match its folder. Nothing was written.");
    }
  }

  private async writable(bookId: string): Promise<void> {
    try {
      await assertBookWritable(this.host.storage, bookId);
    } catch (error) {
      if (error instanceof LibraryError && error.code === "newer-schema") {
        throw new WorkflowRecordError("newer-schema", error.message);
      }
      throw error;
    }
  }

  private fromAuthoring(error: unknown, mode: "read" | "write"): WorkflowRecordError {
    if (error instanceof WorkflowRecordError) return error;
    if (!(error instanceof AuthoringError)) {
      return mode === "read"
        ? new WorkflowRecordError("corrupt", "This adoption receipt could not be read. The file was left untouched.")
        : new WorkflowRecordError("invalid", "This adoption receipt could not be prepared. Nothing was written.");
    }
    if (error.code === "unsupported-version") {
      return mode === "read"
        ? new WorkflowRecordError(
            "newer-schema",
            "This adoption receipt was written by a newer version of Open Book Studio. Update the app before opening it."
          )
        : new WorkflowRecordError("invalid", "This adoption receipt could not be prepared. Nothing was written.");
    }
    if (["record-overflow", "text-overflow", "value-overflow"].includes(error.code)) {
      return new WorkflowRecordError(
        "too-large",
        mode === "read"
          ? "This adoption receipt is larger than this kind allows. The file was left untouched."
          : "This adoption receipt is larger than this kind allows. Nothing was written."
      );
    }
    return mode === "read"
      ? new WorkflowRecordError("corrupt", "This adoption receipt is not valid for its kind. The file was left untouched.")
      : new WorkflowRecordError("invalid", "This adoption receipt is not valid for its kind. Nothing was written.");
  }

  private writeFailure(error: unknown, message?: string): WorkflowRecordError {
    if (error instanceof WorkflowRecordError) return error;
    return new WorkflowRecordError(
      "uncertain",
      message ?? "The adoption receipt write could not be confirmed. Keep your draft and reread the saved file before another save."
    );
  }

  private uncertainRecord(): WorkflowRecordError {
    return new WorkflowRecordError(
      "uncertain",
      "The adoption receipt was written but did not read back exactly. Keep your version and check the saved file before retrying."
    );
  }
}

export type { Owner };
