import type { Chapter, ChapterMeta, SaveChapterResult } from "../schema";
import { LibraryError, LibraryPortError, type LibraryErrorCode, type LibraryPortErrorCode } from "./errors";
import {
  HistoryError, historyRestoreSchema, historyUndoSchema, sameHistoryBase,
  type HistoryBase, type HistoryReadInput, type HistoryReference, type HistoryRestoreInput,
  type HistoryScope, type HistoryUndoInput, type StoredHistoryRecord, type HistoryErrorCode
} from "./history";
import type { ChapterHistoryStore } from "./history-store";
import type { LibraryRuntime } from "./port";

/** An internal prepared call to the existing checked chapter writer, never renderer input. */
export interface HistoryChapterWrite {
  base: Chapter;
  meta: ChapterMeta;
  content: string;
  text: string;
  result: HistoryBase;
}

export type HistoryMutationResult =
  | { status: "saved"; chapter: Chapter; intent: StoredHistoryRecord; safety: StoredHistoryRecord; finalized: boolean }
  | { status: "conflict"; conflict: Extract<SaveChapterResult, { status: "conflict" }>["conflict"]; intent?: StoredHistoryRecord; safety?: StoredHistoryRecord }
  | { status: "canceled"; intent?: StoredHistoryRecord; safety?: StoredHistoryRecord }
  | { status: "failed" | "uncertain"; stage: "preflight" | "safety" | "intent" | "chapter";
      code: HistoryErrorCode | LibraryErrorCode | LibraryPortErrorCode;
      message: string; intent?: StoredHistoryRecord; safety?: StoredHistoryRecord };

export interface HistoryRecovery {
  status: "base-matches" | "restore-matches" | "undo-matches" | "changed" | "uncertain" | "unavailable";
  undoAvailable: boolean;
  intent: StoredHistoryRecord;
  current?: Chapter;
}

const encoder = new TextEncoder();
class Canceled extends Error {}

export function historyReference(record: StoredHistoryRecord): HistoryReference {
  return { fileName: record.fileName, id: record.meta.id, hash: record.hash };
}

/** No queue of its own. All mutations run under LibraryService.serializeWrite. */
export class ChapterHistoryRestore {
  constructor(
    private readonly store: ChapterHistoryStore,
    private readonly runtime: LibraryRuntime,
    private readonly prepare: (scope: HistoryScope, chapter: Chapter, content: string) => Promise<HistoryChapterWrite>,
    private readonly write: (scope: HistoryScope, prepared: HistoryChapterWrite) => Promise<SaveChapterResult>,
    private readonly conflict: (scope: HistoryScope, current: Chapter, content: string, expected: HistoryBase) => Promise<SaveChapterResult>
  ) {}

  async restore(input: HistoryRestoreInput, signal?: AbortSignal): Promise<HistoryMutationResult> {
    const parsed = historyRestoreSchema.safeParse(input);
    if (!parsed.success) throw new HistoryError("invalid", "Restore needs a selected snapshot and confirmed saved version and hash.");
    const { bookId, chapterId, source, selected: reference } = parsed.data;
    const scope = { bookId, chapterId };
    let safety: StoredHistoryRecord | undefined;
    let intent: StoredHistoryRecord | undefined;
    let stage: "preflight" | "safety" | "intent" | "chapter" = "preflight";
    try {
      this.checkCanceled(signal);
      const selected = await this.referenced(scope, reference);
      if (selected.meta.kind === "intent") throw new HistoryError("invalid", "Select a snapshot with a saved body.");
      const current = await this.store.savedChapter(scope);
      this.checkCanceled(signal);
      if (!sameHistoryBase(current, source)) return await this.stale(scope, current, selected.content, source);
      const prepared = await this.prepare(scope, current, selected.content);
      this.checkCanceled(signal);
      stage = "safety";
      safety = await this.store.create({ content: current.content, meta: {
        schemaVersion: 1, kind: "safety", id: this.runtime.newId("hist"), ...scope,
        label: "Before restoration", capturedAt: this.runtime.now(),
        sourceVersion: current.version, sourceHash: current.hash,
        bodyHash: await this.hash(current.content)
      } }, async () => {
        this.checkCanceled(signal);
        await this.exactSource(scope, source);
        this.checkCanceled(signal);
      });
      // Once safety is published, finish the prepared intent even if cancellation arrives.
      stage = "intent";
      intent = await this.store.create({ content: "", meta: {
        schemaVersion: 1, kind: "intent", id: this.runtime.newId("hist"), ...scope,
        label: "Restore snapshot", capturedAt: this.runtime.now(),
        sourceVersion: current.version, sourceHash: current.hash, bodyHash: await this.hash(""),
        selected: historyReference(selected), safety: historyReference(safety),
        intendedBodyHash: selected.meta.bodyHash, state: "prepared", plannedResult: prepared.result
      } }, async () => {});
      if (signal?.aborted) return { status: "canceled", safety, intent };
      // Revalidate dependencies immediately before the checked chapter write.
      await this.referenced(scope, historyReference(selected));
      await this.referenced(scope, historyReference(safety));
      await this.referenced(scope, historyReference(intent));
      if (signal?.aborted) return { status: "canceled", safety, intent };
      stage = "chapter";
      const result = await this.write(scope, prepared);
      if (result.status === "conflict") return { ...result, safety, intent };
      return this.finalize(result.chapter, safety, intent, "applied");
    } catch (error) {
      const records = { ...(safety ? { safety } : {}), ...(intent ? { intent } : {}) };
      if (error instanceof Canceled) return { status: "canceled", ...records };
      return { status: stage === "chapter" ? "uncertain" : "failed", stage, code: failureCode(error),
        message: stage === "chapter" ? "The chapter write could not be confirmed. Review recovery before any further action."
          : error instanceof HistoryError ? error.message
          : "Restoration stopped before the chapter write. Keep all history files and review them before retrying.", ...records };
    }
  }

  /** Read-only: a matching full-file identity is evidence of bytes, not proof of authorship. */
  async reconcile(input: HistoryReadInput): Promise<HistoryRecovery> {
    const intent = await this.store.read(input);
    if (intent.meta.kind !== "intent") throw new HistoryError("invalid", "Select a restore intent for recovery.");
    try {
      await this.dependencies(input, intent);
      const current = await this.store.savedChapter(input);
      const meta = intent.meta;
      const undo = meta.undoResult ?? meta.plannedUndoResult;
      const restored = meta.result ?? meta.plannedResult;
      if (undo && sameHistoryBase(current, undo)) return { status: "undo-matches", undoAvailable: false, intent, current };
      if (restored && sameHistoryBase(current, restored)) {
        return { status: "restore-matches", undoAvailable: meta.state !== "undone" && !meta.plannedUndoResult, intent, current };
      }
      if (sameHistoryBase(current, { version: meta.sourceVersion, hash: meta.sourceHash })) {
        return { status: "base-matches", undoAvailable: false, intent, current };
      }
      return { status: restored ? "changed" : "uncertain", undoAvailable: false, intent, current };
    } catch {
      return { status: "unavailable", undoAvailable: false, intent };
    }
  }

  async undo(input: HistoryUndoInput, signal?: AbortSignal): Promise<HistoryMutationResult> {
    const parsed = historyUndoSchema.safeParse(input);
    if (!parsed.success) throw new HistoryError("invalid", "Undo needs a restore intent and confirmed saved version and hash.");
    const { bookId, chapterId, source, intent: reference } = parsed.data;
    const scope = { bookId, chapterId };
    let intent: StoredHistoryRecord | undefined;
    let safety: StoredHistoryRecord | undefined;
    let stage: "preflight" | "intent" | "chapter" = "preflight";
    try {
      this.checkCanceled(signal);
      intent = await this.referenced(scope, reference);
      if (intent.meta.kind !== "intent") throw new HistoryError("invalid", "Select a restore intent to undo.");
      safety = (await this.dependencies(scope, intent)).safety;
      const meta = intent.meta;
      const expected = meta.result ?? meta.plannedResult;
      if (!expected || meta.state === "undone" || meta.plannedUndoResult) {
        throw new HistoryError("invalid", "This intent needs recovery review rather than another undo write.");
      }
      const current = await this.store.savedChapter(scope);
      this.checkCanceled(signal);
      if (!sameHistoryBase(current, source) || !sameHistoryBase(current, expected)) {
        const result = await this.stale(scope, current, safety.content, expected);
        return { ...result, intent, safety };
      }
      const prepared = await this.prepare(scope, current, safety.content);
      this.checkCanceled(signal);
      stage = "intent";
      // Also finalizes an interrupted restore, based on the exact precomputed identity.
      intent = await this.store.update(intent, { ...intent, meta: {
        ...meta, state: "applied", result: { ...meta.plannedResult, ...meta.result, ...expected },
        plannedUndoResult: prepared.result
      } });
      if (signal?.aborted) return { status: "canceled", intent, safety };
      await this.dependencies(scope, intent);
      await this.referenced(scope, historyReference(intent));
      if (signal?.aborted) return { status: "canceled", intent, safety };
      stage = "chapter";
      const result = await this.write(scope, prepared);
      if (result.status === "conflict") return { ...result, intent, safety };
      return this.finalize(result.chapter, safety, intent, "undone");
    } catch (error) {
      const records = { ...(intent ? { intent } : {}), ...(safety ? { safety } : {}) };
      if (error instanceof Canceled) return { status: "canceled", ...records };
      return { status: stage === "chapter" ? "uncertain" : "failed", stage, code: failureCode(error),
        message: stage === "chapter" ? "The undo write could not be confirmed. Review recovery before any further action."
          : error instanceof HistoryError ? error.message
          : "Undo stopped before the chapter write. Keep all history files and review recovery.", ...records };
    }
  }

  private async finalize(chapter: Chapter, safety: StoredHistoryRecord, intent: StoredHistoryRecord,
    state: "applied" | "undone"): Promise<HistoryMutationResult> {
    if (intent.meta.kind !== "intent") throw new Error("Expected an intent");
    const key = state === "applied" ? "result" : "undoResult";
    try {
      const updated = await this.store.update(intent, { ...intent, meta: { ...intent.meta, state,
        [key]: { ...intent.meta[key], version: chapter.version, hash: chapter.hash }
      } });
      return { status: "saved", chapter, safety, intent: updated, finalized: true };
    } catch {
      // The chapter outcome is known even if finalization/readback is not. Never call it canceled.
      return { status: "saved", chapter, safety, intent, finalized: false };
    }
  }

  private async dependencies(scope: HistoryScope, intent: StoredHistoryRecord) {
    if (intent.meta.kind !== "intent") throw new HistoryError("invalid", "Expected a restore intent.");
    const selected = await this.referenced(scope, intent.meta.selected);
    const safety = await this.referenced(scope, intent.meta.safety);
    if (selected.meta.kind === "intent" || safety.meta.kind !== "safety" ||
        selected.meta.bodyHash !== intent.meta.intendedBodyHash ||
        safety.meta.sourceVersion !== intent.meta.sourceVersion || safety.meta.sourceHash !== intent.meta.sourceHash) {
      throw new HistoryError("corrupt", "Restore dependencies do not match. Keep every record for recovery.");
    }
    return { selected, safety };
  }

  private async referenced(scope: HistoryScope, reference: HistoryReference) {
    const record = await this.store.read({ bookId: scope.bookId, chapterId: scope.chapterId, fileName: reference.fileName });
    if (record.meta.id !== reference.id || record.hash !== reference.hash) {
      throw new HistoryError("stale-source", "A history record changed. Review its current saved contents before trying again.");
    }
    return record;
  }

  private async exactSource(scope: HistoryScope, expected: HistoryBase) {
    if (!sameHistoryBase(await this.store.savedChapter(scope), expected)) {
      throw new HistoryError("stale-source", "The chapter changed before its safety copy was published.");
    }
  }

  private async stale(scope: HistoryScope, current: Chapter, content: string, expected: HistoryBase): Promise<HistoryMutationResult> {
    const result = await this.conflict(scope, current, content, expected);
    if (result.status !== "conflict") throw new Error("Expected a conflict");
    return result;
  }

  private checkCanceled(signal?: AbortSignal) { if (signal?.aborted) throw new Canceled(); }
  private hash(content: string) { return this.runtime.sha256(encoder.encode(content)); }
}

function failureCode(error: unknown): HistoryErrorCode | LibraryErrorCode | LibraryPortErrorCode {
  return error instanceof HistoryError || error instanceof LibraryError || error instanceof LibraryPortError ? error.code : "io";
}
