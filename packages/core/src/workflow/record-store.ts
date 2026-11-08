import { AuthoringError, copyValue, sameValue, type Immutable } from "../authoring/value";
import {
  WORKFLOW_LIMITS,
  canonicalWorkflowJson,
  decodeWorkflowRecord,
  encodeWorkflowRecord,
  type WorkflowBase,
  type WorkflowRecord
} from "../authoring/wire";
import { LibraryError, LibraryPortError } from "../library/errors";
import { libraryPathToArchivePath, type LibraryPath } from "../library/path";
import { bookFilePath } from "../library/paths";
import { WORKFLOW_CONFLICT_BYTES } from "../library/read-limits";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryFileSnapshot,
  LibraryPort,
  LibraryRuntime
} from "../library/port";
import { assertBookWritable, assertSchemaVersion } from "../library/schema-guard";
import { bookSchema } from "../schema";
import { WorkflowRecordError } from "./record-error";
import {
  artifactBodyPath,
  artifactMetaPath,
  attemptPath,
  contextPath,
  effectPath,
  questionPath,
  runHeaderPath,
  taskPath,
  workflowConflictPath,
  workflowConflictsPath
} from "./paths";

/**
 * Checked storage for the T023 workflow record kinds (037 T023 / D-194–D-196 / ADR 0019).
 *
 * Checked records: `run`, `task`, `attempt`, `effect` and `question` carry a positive revision and
 * the exact previous raw hash. Immutable records: `artifact` (metadata plus a bounded body) and
 * `context` are absent-only at revision 1. Every read-modify-write joins the Library's per-book
 * queue and every commit uses the service's journal-aware checked writer. There is no second queue,
 * no direct adapter commit, no scheduler, no provider call, no publication and no deletion.
 *
 * Canonical bytes are produced by the T018 codec, parsed again by the same build's reader before
 * publication, committed against the observed hash and re-read before success is reported. A stale,
 * missing or racing base keeps the complete intended document beside the active record and reports
 * `uncertain` after an unverified publication; neither is ever replayed automatically.
 */

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** FORMAT: a workflow conflict copy is bounded to 5,000,000 bytes. */
const CONFLICT_COPY_BYTES = WORKFLOW_CONFLICT_BYTES;
/** Leave room under the typical 255-byte component limit for the atomic writer's temp suffix. */
const CONFLICT_NAME_LIMIT = 200;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type CheckedWorkflowKind = "run" | "task" | "attempt" | "effect" | "question";
export type ImmutableWorkflowKind = "artifact" | "context";
export type StoredWorkflowKind = CheckedWorkflowKind | ImmutableWorkflowKind;

export interface WorkflowRecordHost {
  storage: LibraryPort;
  runtime: LibraryRuntime;
  deviceId: string;
  /** The SAME queue used by chapter/book saves, including queued reads. */
  withBook<T>(bookId: string, work: () => Promise<T>): Promise<T>;
  /** The service's journal-aware checked commit; never an unchecked writer. */
  commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
}

export interface WorkflowRecordSnapshot {
  record: Immutable<WorkflowRecord>;
  bytes: Uint8Array;
  /** Raw SHA-256 of the exact file bytes. */
  hash: string;
}

export interface WorkflowArtifactSnapshot extends WorkflowRecordSnapshot {
  body: { bytes: Uint8Array; hash: string };
}

export interface WorkflowSaveResult {
  status: "saved" | "unchanged";
  record: WorkflowRecordSnapshot;
}

export interface WorkflowCreateResult {
  status: "created" | "unchanged";
  record: WorkflowRecordSnapshot;
}

export interface WorkflowArtifactResult {
  status: "created" | "unchanged";
  artifact: WorkflowArtifactSnapshot;
}

const PREFIX: Readonly<Record<StoredWorkflowKind, string>> = Object.freeze({
  run: "run_",
  task: "task_",
  attempt: "attempt_",
  effect: "effect_",
  question: "question_",
  artifact: "artifact_",
  context: "context_"
});

const RECORD_BOUND: Readonly<Record<StoredWorkflowKind, number>> = Object.freeze({
  run: WORKFLOW_LIMITS.runBytes,
  task: WORKFLOW_LIMITS.recordBytes,
  attempt: WORKFLOW_LIMITS.recordBytes,
  effect: WORKFLOW_LIMITS.recordBytes,
  question: WORKFLOW_LIMITS.recordBytes,
  artifact: WORKFLOW_LIMITS.recordBytes,
  context: WORKFLOW_LIMITS.recordBytes
});

/** Codes that mean this build does not understand a current, otherwise readable record. */
const UNSUPPORTED_CODES = new Set([
  "foreign-kind", "foreign-owner", "foreign-reference", "unknown-record-kind",
  "unsupported-version", "unknown-mode", "unknown-task-status", "unknown-attempt-phase",
  "unknown-effect-phase", "unknown-question-state", "unknown-direction-origin", "unknown-action",
  "unknown-journal", "unknown-observation", "unknown-role", "unknown-completion", "unknown-receipt-outcome",
  "unknown-artifact-media-type", "unknown-target-kind", "unknown-accounting-kind", "unsupported-accounting"
]);

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

function assertRecordId(kind: StoredWorkflowKind, id: string): void {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || !id.startsWith(PREFIX[kind])) {
    throw new WorkflowRecordError(
      "invalid",
      `That ${kind} ID is not a safe workflow record ID for its kind. Nothing was written.`
    );
  }
}

function assertRunId(runId: string): void {
  assertRecordId("run", runId);
}

function baseOf(record: Record<string, unknown>): WorkflowBase | { readonly kind: "absent"; readonly revision: 0 } {
  const base = record.base;
  return isObject(base) ? (base as unknown as WorkflowBase) : { kind: "absent", revision: 0 };
}

function recordFilePath(
  kind: StoredWorkflowKind,
  bookId: string,
  runId: string,
  id: string
): LibraryPath {
  if (kind === "run") return runHeaderPath(bookId, runId);
  if (kind === "task") return taskPath(bookId, runId, id);
  if (kind === "attempt") return attemptPath(bookId, runId, id);
  if (kind === "effect") return effectPath(bookId, runId, id);
  if (kind === "question") return questionPath(bookId, runId, id);
  if (kind === "artifact") return artifactMetaPath(bookId, runId, id);
  return contextPath(bookId, runId, id);
}

export class WorkflowRecordStore {
  constructor(private readonly host: WorkflowRecordHost) {}

  /* ------------------------------------------------------------------ run */

  async readRun(bookId: string, runId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    return this.inBook(bookId, () => this.load("run", bookId, runId, runId));
  }

  saveRun(bookId: string, runId: string, value: unknown): Promise<WorkflowSaveResult> {
    return this.saveChecked("run", bookId, runId, value);
  }

  /* ------------------------------------------------------------------ tasks */

  async readTask(bookId: string, runId: string, taskId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    assertRecordId("task", taskId);
    return this.inBook(bookId, () => this.load("task", bookId, runId, taskId));
  }

  saveTask(bookId: string, runId: string, value: unknown): Promise<WorkflowSaveResult> {
    return this.saveChecked("task", bookId, runId, value);
  }

  /* --------------------------------------------------------------- attempts */

  async readAttempt(bookId: string, runId: string, attemptId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    assertRecordId("attempt", attemptId);
    return this.inBook(bookId, () => this.load("attempt", bookId, runId, attemptId));
  }

  saveAttempt(bookId: string, runId: string, value: unknown): Promise<WorkflowSaveResult> {
    return this.saveChecked("attempt", bookId, runId, value);
  }

  /* ---------------------------------------------------------------- effects */

  async readEffect(bookId: string, runId: string, effectId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    assertRecordId("effect", effectId);
    return this.inBook(bookId, () => this.load("effect", bookId, runId, effectId));
  }

  saveEffect(bookId: string, runId: string, value: unknown): Promise<WorkflowSaveResult> {
    return this.saveChecked("effect", bookId, runId, value);
  }

  /* -------------------------------------------------------------- questions */

  async readQuestion(bookId: string, runId: string, questionId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    assertRecordId("question", questionId);
    return this.inBook(bookId, () => this.load("question", bookId, runId, questionId));
  }

  saveQuestion(bookId: string, runId: string, value: unknown): Promise<WorkflowSaveResult> {
    return this.saveChecked("question", bookId, runId, value);
  }

  /* ---------------------------------------------------------------- contexts */

  async readContext(bookId: string, runId: string, contextId: string): Promise<WorkflowRecordSnapshot | null> {
    assertRunId(runId);
    assertRecordId("context", contextId);
    return this.inBook(bookId, () => this.load("context", bookId, runId, contextId));
  }

  createContext(bookId: string, runId: string, value: unknown): Promise<WorkflowCreateResult> {
    assertRunId(runId);
    return this.inBook(bookId, async () => {
      await this.writable(bookId);
      return this.createOnly("context", bookId, runId, value);
    });
  }

  /* --------------------------------------------------------------- artifacts */

  async readArtifact(
    bookId: string,
    runId: string,
    artifactId: string
  ): Promise<WorkflowArtifactSnapshot | null> {
    assertRunId(runId);
    assertRecordId("artifact", artifactId);
    return this.inBook(bookId, () => this.readArtifactUnlocked(bookId, runId, artifactId));
  }

  /**
   * Write an immutable artifact metadata record and its bounded body. The pair is published body
   * first, then metadata. A later call refuses an orphan body rather than assuming its provenance;
   * a pair that does not agree on the exact byte count and SHA-256 is refused before publication.
   */
  async createArtifact(
    bookId: string,
    runId: string,
    metadata: unknown,
    body: Uint8Array
  ): Promise<WorkflowArtifactResult> {
    assertRunId(runId);
    if (!(body instanceof Uint8Array)) {
      throw new WorkflowRecordError("invalid", "An artifact body must be exact bytes. Nothing was written.");
    }
    if (body.byteLength > WORKFLOW_LIMITS.artifactBytes) {
      throw new WorkflowRecordError(
        "too-large",
        `An artifact body is at most ${WORKFLOW_LIMITS.artifactBytes.toLocaleString("en-US")} bytes. Nothing was written.`
      );
    }
    return this.inBook(bookId, async () => {
      await this.writable(bookId);
      const prepared = this.prepare("artifact", bookId, runId, metadata);
      const id = prepared.record.id;
      const mediaType = prepared.record.mediaType;
      if (mediaType !== "text/markdown" && mediaType !== "application/json") {
        throw new WorkflowRecordError("invalid", "An artifact media type must be text/markdown or application/json. Nothing was written.");
      }
      const extension = mediaType === "text/markdown" ? "md" : "json";
      const bodyPath = artifactBodyPath(bookId, runId, id, extension);
      const bodyHash = await this.host.runtime.sha256(body);
      if (prepared.record.bytes !== body.byteLength || prepared.record.hash !== bodyHash) {
        throw new WorkflowRecordError(
          "invalid",
          "The artifact metadata does not agree with its body's exact byte count and SHA-256. Nothing was written."
        );
      }
      const metaPath = artifactMetaPath(bookId, runId, id);
      const markdown = await this.readArtifactBody(artifactBodyPath(bookId, runId, id, "md"));
      const json = await this.readArtifactBody(artifactBodyPath(bookId, runId, id, "json"));
      const existingMeta = await this.readObserved(metaPath, RECORD_BOUND.artifact, "artifact metadata");

      if (existingMeta) {
        let currentMeta: WorkflowRecordSnapshot;
        try {
          currentMeta = await this.decodeSnapshot("artifact", bookId, runId, id, existingMeta);
        } catch {
          const savedAs = await this.preserveArtifact(bookId, runId, id, prepared.bytes, body, extension, existingMeta.sha256);
          throw new WorkflowRecordError(
            "conflict",
            "The saved artifact metadata could not be read, so it was not overwritten. This version was kept as a copy; nothing was replaced.",
            savedAs
          );
        }
        const existingMedia = currentMeta.record.mediaType;
        const existingBody = existingMedia === "text/markdown" ? markdown : existingMedia === "application/json" ? json : null;
        const existingOther = existingMedia === "text/markdown" ? json : existingMedia === "application/json" ? markdown : null;
        const complete = existingBody !== null && existingOther === null &&
          existingBody.sha256 === (await this.host.runtime.sha256(existingBody.bytes)) &&
          currentMeta.record.bytes === existingBody.bytes.byteLength &&
          currentMeta.record.hash === existingBody.sha256;
        if (!complete || !bytesEqual(existingMeta.bytes, prepared.bytes) || !existingBody || !bytesEqual(existingBody.bytes, body)) {
          const savedAs = await this.preserveArtifact(bookId, runId, id, prepared.bytes, body, extension, existingMeta.sha256);
          throw new WorkflowRecordError(
            "conflict",
            "An artifact with this identity is already present and does not match this complete metadata/body pair. This version was kept as a copy; nothing was replaced.",
            savedAs
          );
        }
        const artifact = await this.verifyArtifactPair(bookId, runId, id, prepared.bytes, body);
        return { status: "unchanged", artifact };
      }

      if (markdown || json) {
        const savedAs = await this.preserveArtifact(bookId, runId, id, prepared.bytes, body, extension, null);
        throw new WorkflowRecordError(
          "conflict",
          "An artifact body exists without its metadata. This version was kept as a copy; the partial pair was not rewritten.",
          savedAs
        );
      }

      let wrote = false;
      let result: CommitFileResult;
      try {
        result = await this.host.commitFile(bodyPath, body, { kind: "absent" });
      } catch (error) {
        throw this.writeFailure(error);
      }
      if (result.status === "changed") {
        if (result.publication === "uncertain") throw this.uncertainBody();
        if (!result.current || !bytesEqual(result.current.bytes, body)) {
          const savedAs = await this.preserveArtifact(bookId, runId, id, prepared.bytes, body, extension, result.current?.sha256 ?? null);
          throw new WorkflowRecordError(
            "conflict",
            "The artifact body changed while it was saved. This version was kept as a copy; nothing was overwritten.",
            savedAs
          );
        }
      } else {
        await this.verifyBytes(result.snapshot, body, this.uncertainBody());
        wrote = true;
      }

      try {
        result = await this.host.commitFile(metaPath, prepared.bytes, { kind: "absent" });
      } catch (error) {
        throw this.writeFailure(error);
      }
      if (result.status === "changed") {
        if (result.publication === "uncertain") throw this.uncertainMetadata();
        if (!result.current || !bytesEqual(result.current.bytes, prepared.bytes)) {
          const savedAs = await this.preserveArtifact(bookId, runId, id, prepared.bytes, body, extension, result.current?.sha256 ?? null);
          throw new WorkflowRecordError(
            "conflict",
            "The artifact metadata changed while it was saved. This version was kept as a copy; nothing was overwritten.",
            savedAs
          );
        }
      } else {
        await this.verifyBytes(result.snapshot, prepared.bytes, this.uncertainMetadata());
        wrote = true;
      }

      const artifact = await this.verifyArtifactPair(bookId, runId, id, prepared.bytes, body);
      return { status: wrote ? "created" : "unchanged", artifact };
    });
  }

  /* ---------------------------------------------------------------- internals */

  private inBook<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    return this.host.withBook(bookId, async () => {
      await this.assertOwnerBook(bookId);
      return work();
    });
  }

  private async saveChecked(
    kind: CheckedWorkflowKind,
    bookId: string,
    runId: string,
    value: unknown
  ): Promise<WorkflowSaveResult> {
    assertRunId(runId);
    return this.inBook(bookId, async () => {
      await this.writable(bookId);
      const prepared = this.prepare(kind, bookId, runId, value);
      const id = kind === "run" ? runId : prepared.record.id;
      if (kind === "run" && prepared.record.id !== runId) {
        throw new WorkflowRecordError(
          "invalid",
          "run.json must carry the run's own ID. Nothing was written."
        );
      }
      const path = recordFilePath(kind, bookId, runId, id);
      const observed = await this.readObserved(path, RECORD_BOUND[kind], `${kind} record`);
      let current: WorkflowRecordSnapshot | null = null;
      if (observed) {
        try {
          current = await this.decodeSnapshot(kind, bookId, runId, id, observed);
        } catch {
          const savedAs = await this.preserve(kind, bookId, runId, id, prepared.bytes, observed.sha256);
          throw new WorkflowRecordError(
            "conflict",
            "The saved workflow record could not be read, so it was not overwritten. This version was kept as a copy.",
            savedAs
          );
        }
      }

      const base = prepared.record.base;
      if (current) {
        if (sameValue(current.record, prepared.record)) return { status: "unchanged", record: current };
        if (
          base?.kind !== "sha256" ||
          base.value !== current.hash ||
          base.revision !== current.record.revision
        ) {
          const savedAs = await this.preserve(kind, bookId, runId, id, prepared.bytes, current.hash);
          throw new WorkflowRecordError(
            "conflict",
            "This workflow record changed since it was read. Your version was kept as a copy; nothing was overwritten.",
            savedAs
          );
        }
      } else if (base?.kind !== "absent") {
        const savedAs = await this.preserve(kind, bookId, runId, id, prepared.bytes, null);
        throw new WorkflowRecordError(
          "conflict",
          "The workflow record this save started from is missing. Your version was kept as a copy; the active location was not recreated.",
          savedAs
        );
      }

      let result: CommitFileResult;
      try {
        result = await this.host.commitFile(
          path,
          prepared.bytes,
          current ? { kind: "sha256", value: current.hash } : { kind: "absent" }
        );
      } catch (error) {
        throw this.writeFailure(error);
      }
      if (result.status === "changed") {
        if (result.publication === "uncertain") {
          throw new WorkflowRecordError(
            "uncertain",
            "The workflow record was published but did not read back exactly. Keep your version and check the saved file before retrying."
          );
        }
        if (result.current && bytesEqual(result.current.bytes, prepared.bytes)) {
          const snapshot = await this.decodeSnapshot(kind, bookId, runId, id, result.current);
          return { status: "unchanged", record: snapshot };
        }
        const savedAs = await this.preserve(
          kind,
          bookId,
          runId,
          id,
          prepared.bytes,
          result.current?.sha256 ?? null
        );
        throw new WorkflowRecordError(
          "conflict",
          "This workflow record changed while it was saved. Your version was kept as a copy; nothing was overwritten.",
          savedAs
        );
      }
      const snapshot = await this.verifyBytes(result.snapshot, prepared.bytes, this.uncertainRecord());
      const decoded = await this.decodeSnapshot(kind, bookId, runId, id, snapshot);
      return { status: "saved", record: decoded };
    });
  }

  private async createOnly(
    kind: ImmutableWorkflowKind,
    bookId: string,
    runId: string,
    value: unknown
  ): Promise<WorkflowCreateResult> {
    const prepared = this.prepare(kind, bookId, runId, value);
    const id = prepared.record.id;
    const path = recordFilePath(kind, bookId, runId, id);
    const observed = await this.readObserved(path, RECORD_BOUND[kind], `${kind} record`);
    if (observed) {
      if (bytesEqual(observed.bytes, prepared.bytes)) {
        const snapshot = await this.decodeSnapshot(kind, bookId, runId, id, observed);
        return { status: "unchanged", record: snapshot };
      }
      const savedAs = await this.preserve(kind, bookId, runId, id, prepared.bytes, observed.sha256);
      throw new WorkflowRecordError(
        "conflict",
        "A record with this identity already exists with different bytes. This version was kept as a copy; nothing was replaced.",
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
        const snapshot = await this.decodeSnapshot(kind, bookId, runId, id, result.current);
        return { status: "unchanged", record: snapshot };
      }
      const savedAs = await this.preserve(kind, bookId, runId, id, prepared.bytes, result.current?.sha256 ?? null);
      throw new WorkflowRecordError(
        "conflict",
        "A record with this identity appeared while it was saved. This version was kept as a copy; nothing was overwritten.",
        savedAs
      );
    }
    const snapshot = await this.verifyBytes(result.snapshot, prepared.bytes, this.uncertainRecord());
    const decoded = await this.decodeSnapshot(kind, bookId, runId, id, snapshot);
    return { status: "created", record: decoded };
  }

  /** Canonical bytes, validated, re-parsed and checked against the expected book/run before I/O. */
  private prepare(
    kind: StoredWorkflowKind,
    bookId: string,
    runId: string,
    value: unknown
  ): { bytes: Uint8Array; record: Immutable<WorkflowRecord> } {
    let bytes: Uint8Array;
    try {
      bytes = encodeWorkflowRecord(value as WorkflowRecord);
    } catch (error) {
      throw this.fromAuthoring(error, "write");
    }
    if (bytes.byteLength > RECORD_BOUND[kind]) {
      throw new WorkflowRecordError(
        "too-large",
        `A ${kind} record is at most ${RECORD_BOUND[kind].toLocaleString("en-US")} UTF-8 bytes. Nothing was written.`
      );
    }
    const owner = this.ownerFromBytes(bytes, "write");
    if (owner.bookId !== bookId || owner.runId !== runId) {
      throw new WorkflowRecordError(
        "invalid",
        "This workflow record belongs to another book or run. Nothing was written."
      );
    }
    let record: Immutable<WorkflowRecord>;
    try {
      record = decodeWorkflowRecord(bytes, { kind, owner });
    } catch (error) {
      throw this.fromAuthoring(error, "write");
    }
    if (Object.hasOwn(record, "conflictMetadata")) {
      throw new WorkflowRecordError(
        "invalid",
        "A conflict copy cannot be saved as an active workflow record. Prepare a fresh reviewed edit. Nothing was written."
      );
    }
    return { bytes, record };
  }

  private async load(
    kind: StoredWorkflowKind,
    bookId: string,
    runId: string,
    id: string
  ): Promise<WorkflowRecordSnapshot | null> {
    const path = recordFilePath(kind, bookId, runId, id);
    const snapshot = await this.readObserved(path, RECORD_BOUND[kind], `${kind} record`);
    if (!snapshot) return null;
    return this.decodeSnapshot(kind, bookId, runId, id, snapshot);
  }

  private async decodeSnapshot(
    kind: StoredWorkflowKind,
    bookId: string,
    runId: string,
    id: string,
    snapshot: LibraryFileSnapshot
  ): Promise<WorkflowRecordSnapshot> {
    if (snapshot.bytes.byteLength > RECORD_BOUND[kind]) {
      throw new WorkflowRecordError(
        "too-large",
        `This ${kind} record is larger than the ${RECORD_BOUND[kind].toLocaleString("en-US")} UTF-8 bytes this version can open. The file was left untouched.`
      );
    }
    if (snapshot.sha256 !== (await this.host.runtime.sha256(snapshot.bytes))) {
      throw new WorkflowRecordError(
        "corrupt",
        "This workflow record's hash could not be verified. The file was left untouched."
      );
    }
    const owner = this.ownerFromBytes(snapshot.bytes, "read");
    let record: Immutable<WorkflowRecord>;
    try {
      record = decodeWorkflowRecord(snapshot.bytes, { kind, owner });
    } catch (error) {
      throw this.fromAuthoring(error, "read");
    }
    if (record.owner.bookId !== bookId || record.owner.runId !== runId) {
      throw new WorkflowRecordError(
        "unavailable",
        "This workflow record belongs to another book or run. It was left untouched."
      );
    }
    if (Object.hasOwn(record, "conflictMetadata")) {
      throw new WorkflowRecordError(
        "unavailable",
        "This file is a conflict copy, not an active workflow record. It was left untouched."
      );
    }
    if (kind === "run" ? record.id !== runId : record.id !== id) {
      throw new WorkflowRecordError(
        "corrupt",
        "This workflow record's identity does not match its file name. The file was left untouched."
      );
    }
    return { record, bytes: snapshot.bytes, hash: snapshot.sha256 };
  }

  /** Read `owner` only to seed the codec; the strict reader still validates the whole document. */
  private ownerFromBytes(bytes: Uint8Array, mode: "read" | "write"): { libraryRegistration: string; bookId: string; runId: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      throw mode === "read"
        ? new WorkflowRecordError("corrupt", "This workflow record is not valid UTF-8 JSON. The file was left untouched.")
        : new WorkflowRecordError("invalid", "This workflow record is not valid UTF-8 JSON. Nothing was written.");
    }
    const owner = isObject(raw) ? raw.owner : null;
    if (!isObject(owner)) {
      throw mode === "read"
        ? new WorkflowRecordError("corrupt", "This workflow record has no usable owner. The file was left untouched.")
        : new WorkflowRecordError("invalid", "A workflow record needs an owner. Nothing was written.");
    }
    const { libraryRegistration, bookId, runId } = owner;
    if (typeof libraryRegistration !== "string" || typeof bookId !== "string" || typeof runId !== "string") {
      throw mode === "read"
        ? new WorkflowRecordError("corrupt", "This workflow record's owner is not valid. The file was left untouched.")
        : new WorkflowRecordError("invalid", "A workflow record needs a complete owner. Nothing was written.");
    }
    return { libraryRegistration, bookId, runId };
  }

  private async readArtifactUnlocked(
    bookId: string,
    runId: string,
    artifactId: string
  ): Promise<WorkflowArtifactSnapshot | null> {
    const metadata = await this.load("artifact", bookId, runId, artifactId);
    const markdown = await this.readArtifactBody(artifactBodyPath(bookId, runId, artifactId, "md"));
    const json = await this.readArtifactBody(artifactBodyPath(bookId, runId, artifactId, "json"));
    if (!metadata) {
      if (markdown || json) {
        throw new WorkflowRecordError(
          "unavailable",
          "An artifact body exists but its metadata is missing or unreadable. The files were left untouched."
        );
      }
      return null;
    }
    const mediaType = metadata.record.mediaType;
    if (mediaType !== "text/markdown" && mediaType !== "application/json") {
      throw new WorkflowRecordError(
        "unavailable",
        "This artifact's media type is not one this version knows. The files were left untouched."
      );
    }
    const extension = mediaType === "text/markdown" ? "md" : "json";
    const bodySnapshot = extension === "md" ? markdown : json;
    const otherSnapshot = extension === "md" ? json : markdown;
    if (otherSnapshot && bodySnapshot) {
      throw new WorkflowRecordError(
        "corrupt",
        "This artifact has two bodies under different media types. The files were left untouched."
      );
    }
    if (!bodySnapshot) {
      if (otherSnapshot) {
        throw new WorkflowRecordError(
          "corrupt",
          "This artifact's metadata names one media type but its body exists as another. The files were left untouched."
        );
      }
      throw new WorkflowRecordError(
        "unavailable",
        "This artifact's body is missing. The metadata was left untouched; the artifact cannot be used until its body returns."
      );
    }
    if (bodySnapshot.sha256 !== (await this.host.runtime.sha256(bodySnapshot.bytes))) {
      throw new WorkflowRecordError(
        "corrupt",
        "This artifact body's hash could not be verified. The files were left untouched."
      );
    }
    if (
      metadata.record.bytes !== bodySnapshot.bytes.byteLength ||
      metadata.record.hash !== bodySnapshot.sha256
    ) {
      throw new WorkflowRecordError(
        "corrupt",
        "This artifact's metadata and body disagree on the exact byte count or SHA-256. The files were left untouched."
      );
    }
    return {
      ...metadata,
      body: { bytes: bodySnapshot.bytes, hash: bodySnapshot.sha256 }
    };
  }

  /** A valid pair is not necessarily the pair this call intended to retain. */
  private async verifyArtifactPair(
    bookId: string,
    runId: string,
    artifactId: string,
    metadata: Uint8Array,
    body: Uint8Array
  ): Promise<WorkflowArtifactSnapshot> {
    const location = libraryPathToArchivePath(artifactMetaPath(bookId, runId, artifactId));
    const uncertain = new WorkflowRecordError(
      "uncertain",
      `The artifact's final metadata/body readback could not be confirmed as your exact pair. Keep your candidate and inspect ${location} and its body before another save.`
    );
    try {
      const artifact = await this.readArtifactUnlocked(bookId, runId, artifactId);
      if (!artifact || !bytesEqual(artifact.bytes, metadata) || !bytesEqual(artifact.body.bytes, body) ||
          artifact.hash !== await this.host.runtime.sha256(metadata) ||
          artifact.body.hash !== await this.host.runtime.sha256(body)) throw uncertain;
      return artifact;
    } catch {
      // Once publication/no-op verification began, missing/corrupt/I/O results cannot be read-only
      // refusals. No retry, conflict copy, rollback or orphan completion follows this observation.
      throw uncertain;
    }
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

  private async readArtifactBody(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    return this.readObserved(path, WORKFLOW_LIMITS.artifactBytes, "artifact body");
  }

  /** Keep the whole intended document beside the active file and report where it went. */
  private async preserve(
    kind: StoredWorkflowKind,
    bookId: string,
    runId: string,
    id: string,
    intended: Uint8Array,
    observed: string | null,
    bodyCopy?: string
  ): Promise<string> {
    let copy: Record<string, unknown>;
    try {
      copy = copyValue(
        JSON.parse(decoder.decode(intended)) as Record<string, unknown>,
        CONFLICT_COPY_BYTES
      );
      copy.conflictMetadata = {
        reason: observed === null ? "missing-file" : "external-edit",
        baseline: baseOf(copy),
        observed: observed === null ? { kind: "absent" } : { kind: "sha256", value: observed },
        ...(bodyCopy ? { bodyCopy } : {})
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
    return this.writeConflictCopy(kind, bookId, runId, id, bytes, observed, null);
  }

  private async preserveArtifact(
    bookId: string,
    runId: string,
    id: string,
    metadata: Uint8Array,
    body: Uint8Array,
    extension: "md" | "json",
    observed: string | null
  ): Promise<string> {
    const bodyCopy = await this.writeConflictCopy("artifact", bookId, runId, id, body, observed, extension);
    return this.preserve("artifact", bookId, runId, id, metadata, observed, bodyCopy);
  }

  private async writeConflictCopy(
    kind: StoredWorkflowKind,
    bookId: string,
    runId: string,
    id: string,
    bytes: Uint8Array,
    observed: string | null,
    bodyExtension: "md" | "json" | null
  ): Promise<string> {
    const device = this.host.deviceId;
    const stamp = this.stamp();
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
    const idDigest = (await this.host.runtime.sha256(encoder.encode(id))).slice(0, 12);
    const bodyPart = bodyExtension === null ? "" : ".body";
    const extensionSuffix = bodyExtension === null ? "json" : bodyExtension;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const readable = `${kind}.${id}${bodyPart}.conflict-${reason}.${device}.${stamp}${suffix}.${extensionSuffix}`;
      const name = readable.length <= CONFLICT_NAME_LIMIT
        ? readable
        : `${kind}${bodyPart}.conflict-${reason}.${idDigest}${suffix}.${extensionSuffix}`;
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
        // A publication that already happened but did not read back must not be retried under a
        // new name: report it as uncertain and leave the copy where it landed.
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
        ? new WorkflowRecordError("corrupt", "This workflow record could not be read. The file was left untouched.")
        : new WorkflowRecordError("invalid", "This workflow record could not be prepared. Nothing was written.");
    }
    if (error.code === "unsupported-schema") {
      return new WorkflowRecordError(
        "newer-schema",
        "This workflow record was written by a newer version of Open Book Studio. Update the app before opening it."
      );
    }
    if (mode === "read") {
      if (UNSUPPORTED_CODES.has(error.code)) {
        return new WorkflowRecordError(
          "unavailable",
          "This workflow record uses a value this version does not know. It was left untouched and is read-only."
        );
      }
      if (["record-overflow", "text-overflow", "value-overflow"].includes(error.code)) {
        return new WorkflowRecordError(
          "too-large",
          "This workflow record is larger than this kind allows. The file was left untouched."
        );
      }
      return new WorkflowRecordError(
        "corrupt",
        "This workflow record is not valid for its kind. The file was left untouched."
      );
    }
    if (["record-overflow", "text-overflow", "value-overflow"].includes(error.code)) {
      return new WorkflowRecordError(
        "too-large",
        "This workflow record is larger than this kind allows. Nothing was written."
      );
    }
    return new WorkflowRecordError(
      "invalid",
      "This workflow record is not valid for its kind. Nothing was written."
    );
  }

  private writeFailure(error: unknown, message?: string): WorkflowRecordError {
    if (error instanceof WorkflowRecordError) return error;
    return new WorkflowRecordError(
      "uncertain",
      message ?? "The workflow record write could not be confirmed. Keep your draft and reread the saved file before another save."
    );
  }

  private uncertainRecord(): WorkflowRecordError {
    return new WorkflowRecordError(
      "uncertain",
      "The workflow record was written but did not read back exactly. Keep your version and check the saved file before retrying."
    );
  }

  private uncertainMetadata(): WorkflowRecordError {
    return new WorkflowRecordError(
      "uncertain",
      "The artifact metadata was written but did not read back exactly. Check the artifacts folder before retrying."
    );
  }

  private uncertainBody(): WorkflowRecordError {
    return new WorkflowRecordError(
      "uncertain",
      "The artifact body was written but did not read back exactly. Check the artifacts folder before retrying."
    );
  }

  private stamp(): string {
    return this.host.runtime.now().replace(/[:.]/g, "-");
  }
}
