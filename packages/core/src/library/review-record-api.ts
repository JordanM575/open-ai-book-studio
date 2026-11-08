import { z } from "zod";
import { bookIdSchema, hashSchema, idSchema, timestampSchema } from "../review/contract";
import { validateReviewEnvelope } from "../review/envelope";
import { verifyReviewCitation, type ReaderRun } from "../review/findings";
import { ReviewRecordError } from "../review/record-error";
import {
  buildReviewReport, canonicalRecordText, decodeReviewRecord,
  recordIdSchema, reportFindingSchema, type ReviewDispositions, type ReviewReport
} from "../review/record-format";
import { canonicalJsonText, encodeCanonicalJson, REVIEW_RECORD_BYTES } from "../review/record-json";
import { validateReaderProfile } from "../review/profiles";
import type { ReportListing, ReviewRecordSnapshot, ReviewRecordStore } from "../review/record-store";
import { dispositionIntentSchema, prepareDispositionIntent } from "../review/record-intent";
import { reviewConfirmationSchema, reviewInspectionSchema, reviewTrashListSchema, reviewGroupHash, validateReviewGroup, type ReviewInspection, type ReviewConfirmation, type ReviewTrashList, type ReviewMoveReceipt } from "../review/record-recovery";

export const reviewRecordChannel = "reviewRecords:request";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const token = z.string().regex(/^[a-f0-9-]{36}$/);
const book = bookIdSchema.max(200);
const scopeSchema = z.strictObject({ bookId: book, viewId: token, libraryId: token });
export type ReviewRecordScope = z.infer<typeof scopeSchema>;
const identity = { scope: scopeSchema, id: recordIdSchema, hash: hashSchema };
const requestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("open"), bookId: book, viewId: token }),
  z.strictObject({ operation: z.literal("list"), scope: scopeSchema, offset: count, issueOffset: count }),
  z.strictObject({ operation: z.literal("read"), ...identity }),
  z.strictObject({ operation: z.literal("readDispositions"), ...identity }),
  z.strictObject({ operation: z.literal("save"), scope: scopeSchema, run: z.unknown() }),
  z.strictObject({ operation: z.literal("readReportConflict"), scope: scopeSchema, savedAs: z.string().max(600) }),
  z.strictObject({ operation: z.literal("saveDisposition"), ...identity, ...dispositionIntentSchema.shape }),
  z.strictObject({ operation: z.literal("inspectGroup"), ...identity }),
  z.strictObject({ operation: z.literal("listTrash"), scope: scopeSchema, offset: count }),
  z.strictObject({ operation: z.literal("inspectTrash"), scope: scopeSchema, groupId: recordIdSchema }),
  z.strictObject({ operation: z.literal("moveGroup"), scope: scopeSchema, confirmation: reviewConfirmationSchema })
]);
type Request = z.infer<typeof requestSchema>;
const errorSchema = z.strictObject({
  code: z.enum(["invalid", "exists", "conflict", "not-found", "corrupt", "newer-schema", "unsupported", "too-large", "uncertain", "not-kept", "io", "changed"]),
  message: z.string().max(4096),
  outcome: z.enum(["refused", "not-kept", "uncertain", "conflict"]),
  savedAs: z.string().max(600).optional(),
  copy: z.strictObject({ at: timestampSchema, hash: hashSchema, rawJson: z.string().max(REVIEW_RECORD_BYTES) }).optional()
});
export type ReviewRecordFailure = z.infer<typeof errorSchema>;
export type ReviewRecordResult<T> = { ok: true; data: T } | { ok: false; error: ReviewRecordFailure };
const resultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), data: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: errorSchema })
]);
const transportSchema = z.strictObject({ requestId: token, requestDigest: hashSchema, result: resultSchema });
const inputSchema = z.strictObject({ requestId: token, request: requestSchema });
const snapshotSchema = z.strictObject({ hash: hashSchema, rawJson: z.string().max(REVIEW_RECORD_BYTES) });
type WireSnapshot = z.infer<typeof snapshotSchema>;
export type SavedReview = WireSnapshot & { record: ReviewReport };
export type SavedDispositions = WireSnapshot & { record: ReviewDispositions };
export type SavedReviewList = ReportListing & { issueOffset: number; issueTotal: number };
export interface ReviewRecordApi {
  open(bookId: string, viewId: string): Promise<ReviewRecordResult<ReviewRecordScope>>;
  list(scope: ReviewRecordScope, offset?: number, issueOffset?: number): Promise<ReviewRecordResult<SavedReviewList>>;
  read(scope: ReviewRecordScope, id: string, hash: string): Promise<ReviewRecordResult<SavedReview>>;
  readDispositions(scope: ReviewRecordScope, id: string, hash: string): Promise<ReviewRecordResult<SavedDispositions | null>>;
  save(scope: ReviewRecordScope, run: ReaderRun): Promise<ReviewRecordResult<{ status: "created" | "unchanged"; report: SavedReview }>>;
  saveDisposition(input: Omit<Extract<Request, { operation: "saveDisposition" }>, "operation">): Promise<ReviewRecordResult<{ status: "saved" | "unchanged"; at: string; record: SavedDispositions }>>;
  inspectGroup(scope: ReviewRecordScope, id: string, hash: string): Promise<ReviewRecordResult<ReviewInspection>>;
  listTrash(scope: ReviewRecordScope, offset?: number): Promise<ReviewRecordResult<ReviewTrashList>>;
  inspectTrash(scope: ReviewRecordScope, groupId: string): Promise<ReviewRecordResult<ReviewInspection>>;
  moveGroup(scope: ReviewRecordScope, confirmation: ReviewConfirmation): Promise<ReviewRecordResult<ReviewMoveReceipt>>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const sha256Bytes = (bytes: Uint8Array) => sha256(decoder.decode(bytes));
const REQUEST_BYTES = 32_100_000; // Two maximum-size raw records, including worst-case JSON escaping.
function bounded(value: unknown, maxBytes: number): string {
  // Descriptor-first: no getters, toJSON, lossy numbers, cycles or unbounded nesting.
  const text = canonicalJsonText(value, { maxDepth: 70 });
  if (encoder.encode(text).byteLength > maxBytes) throw new Error("Review transport overflow.");
  return text;
}
function failure(code: ReviewRecordFailure["code"], message: string, outcome: ReviewRecordFailure["outcome"] = "refused"): ReviewRecordResult<never> {
  return { ok: false, error: { code, message, outcome } };
}
export function reviewRecordFailureText(error: ReviewRecordFailure): string {
  const label = error.outcome === "uncertain" ? "Save outcome uncertain" : error.outcome === "conflict" ? "Conflict copy kept"
    : error.outcome === "not-kept" ? "Not saved · No copy confirmed" : "Request refused";
  return `${label} · ${error.message}${error.savedAs ? ` Copy: ${error.savedAs}` : ""}`;
}

/** Re-establish captured evidence after IPC cloning; display flags never authorize a saved quote. */
async function validatedRun(value: unknown): Promise<ReaderRun> {
  encodeCanonicalJson(value, { maxBytes: 1_000_000 });
  const run = z.strictObject({ kind: z.literal("reader-review"), runId: recordIdSchema,
    startedAt: timestampSchema, completedAt: timestampSchema, envelope: z.unknown(),
    findings: z.array(reportFindingSchema).max(50) }).parse(value);
  const envelope = await validateReviewEnvelope(run.envelope);
  if (envelope.kind !== "reader-review" || run.runId !== envelope.requestId) throw new Error("Foreign run.");
  for (const finding of run.findings) {
    if (finding.evidence.length + finding.invalidEvidence.length > 8) throw new Error("Evidence overflow.");
    for (const evidence of finding.evidence) {
      const verified = verifyReviewCitation(envelope, evidence.citation);
      if (verified.status !== "verified-captured" || verified.evidence.label !== evidence.label) throw new Error("Unverified quotation.");
    }
  }
  return { ...run, envelope } as ReaderRun;
}
function wire(snapshot: ReviewRecordSnapshot<"review-report"> | ReviewRecordSnapshot<"review-dispositions">): WireSnapshot {
  return { hash: snapshot.hash, rawJson: decoder.decode(snapshot.bytes) };
}
async function snapshot<K extends "review-report" | "review-dispositions">(value: unknown, kind: K, bookId: string, id: string) {
  const raw = snapshotSchema.parse(value);
  const decoded = decodeReviewRecord(encoder.encode(raw.rawJson), { kind, bookId });
  if (decoded.record.id !== id || await sha256(raw.rawJson) !== raw.hash) throw new Error("Foreign or unverifiable review.");
  if (kind === "review-report") await validateReaderProfile((decoded.record as ReviewReport).profile);
  return { ...raw, record: decoded.record };
}
const summarySchema = z.strictObject({ id: recordIdSchema, profileId: idSchema, profileVersion: count.min(1),
  books: z.array(book).min(1).max(4), completedAt: timestampSchema, savedAt: timestampSchema,
  findings: count.max(50), quotations: count.max(400), size: count.max(REVIEW_RECORD_BYTES), hash: hashSchema });
const listSchema = z.strictObject({ bookId: book, offset: count, limit: z.literal(50), total: count,
  reports: z.array(summarySchema).max(50), issueOffset: count, issueTotal: count,
  issues: z.array(z.strictObject({ fileName: z.string().max(255), code: z.string().max(100), message: z.string().max(4096) })).max(50) });

async function validateOutput(request: Request, value: unknown): Promise<unknown> {
  if (request.operation === "open") {
    const scope = scopeSchema.parse(value);
    if (scope.bookId !== request.bookId || scope.viewId !== request.viewId) throw new Error("Foreign scope.");
    return scope;
  }
  if (request.operation === "list") {
    const list = listSchema.parse(value);
    if (list.bookId !== request.scope.bookId || list.offset !== request.offset || list.issueOffset !== request.issueOffset ||
      list.reports.length !== Math.min(50, Math.max(0, list.total - list.offset)) ||
      list.issues.length !== Math.min(50, Math.max(0, list.issueTotal - list.issueOffset)) ||
      new Set(list.reports.map((entry) => entry.id)).size !== list.reports.length ||
      list.reports.some((entry) => !entry.books.includes(list.bookId))) throw new Error("Foreign review list.");
    return list;
  }
  if (request.operation === "read") {
    const report = await snapshot(value, "review-report", request.scope.bookId, request.id);
    if (report.hash !== request.hash) throw new Error("Changed report.");
    return report;
  }
  if (request.operation === "readDispositions") {
    if (value === null) return null;
    const dispositions = await snapshot(value, "review-dispositions", request.scope.bookId, request.id);
    if (dispositions.record.report.hash !== request.hash) throw new Error("Foreign dispositions.");
    return dispositions;
  }
  if (request.operation === "save") {
    const saved = z.strictObject({ status: z.enum(["created", "unchanged"]), report: snapshotSchema }).parse(value);
    const run = await validatedRun(request.run);
    const report = await snapshot(saved.report, "review-report", request.scope.bookId, run.runId);
    const expected = await buildReviewReport({ ownerBookId: request.scope.bookId, run, savedAt: report.record.savedAt, sha256 });
    if (canonicalRecordText(expected) !== canonicalRecordText(report.record)) throw new Error("Foreign saved result.");
    return { status: saved.status, report };
  }
  if (request.operation === "readReportConflict") {
    const copy = snapshotSchema.parse(value);
    if (!request.savedAs.startsWith(`books/${request.scope.bookId}/conflicts/review-report.`) ||
      !/^books\/[A-Za-z0-9_-]+\/conflicts\/[A-Za-z0-9_.-]+\.json$/.test(request.savedAs) || request.savedAs.includes("..") ||
      await sha256(copy.rawJson) !== copy.hash) throw new Error("Foreign report conflict.");
    decodeReviewRecord(encoder.encode(copy.rawJson), { kind: "review-report", bookId: request.scope.bookId, allowConflictMetadata: true });
    return copy;
  }
  if (request.operation === "saveDisposition") {
    const saved = z.strictObject({ status: z.enum(["saved", "unchanged"]), at: timestampSchema, record: snapshotSchema }).parse(value);
    const record = await snapshot(saved.record, "review-dispositions", request.scope.bookId, request.id);
    const { scope: _scope, id: _id, hash: _hash, operation: _operation, ...intent } = request;
    if (request.hash !== request.report.hash) throw new Error("Foreign report intent.");
    const prepared = await prepareDispositionIntent(request.scope.bookId, request.id, intent, saved.at, sha256Bytes);
    if (canonicalRecordText(record.record) !== canonicalRecordText(prepared.value) || saved.status !== (prepared.changed ? "saved" : "unchanged")) throw new Error("Foreign disposition output.");
    return { ...saved, record };
  }
  if (request.operation === "listTrash") {
    const list = reviewTrashListSchema.parse(value);
    if (list.bookId !== request.scope.bookId || list.offset !== request.offset || list.groups.length !== Math.min(50, Math.max(0, list.total - list.offset)) || new Set(list.groups.map((g) => g.groupId)).size !== list.groups.length) throw new Error("Foreign trash list.");
    return list;
  }
  const receipt = request.operation === "moveGroup" ? z.strictObject({ status: z.enum(["trashed", "restored"]), inspection: reviewInspectionSchema, destinationGroupId: recordIdSchema.nullable() }).parse(value) : null;
  const inspected = reviewInspectionSchema.parse(receipt ? receipt.inspection : value);
  const { hash, token: _token, ...group } = inspected;
  await validateReviewGroup(group, sha256Bytes);
  if (inspected.bookId !== request.scope.bookId || await reviewGroupHash(group, sha256Bytes) !== hash) throw new Error("Foreign group contents.");
  if (request.operation === "inspectGroup" && (inspected.id !== request.id || inspected.groupId !== null || inspected.report?.hash !== request.hash)) throw new Error("Foreign active group.");
  if (request.operation === "inspectTrash" && inspected.groupId !== request.groupId) throw new Error("Foreign trash group.");
  if (request.operation === "moveGroup" && receipt) {
    const expected = request.confirmation;
    if (inspected.id !== expected.id || inspected.hash !== expected.hash || inspected.token !== expected.token || inspected.groupId !== expected.groupId ||
      receipt.status !== (expected.groupId === null ? "trashed" : "restored") || (expected.groupId === null ? receipt.destinationGroupId === null : receipt.destinationGroupId !== null)) throw new Error("Foreign move receipt.");
    return receipt;
  }
  return inspected;
}

async function validateFailure(error: ReviewRecordFailure, request: Request): Promise<ReviewRecordFailure> {
  const bookId = request.operation === "open" ? request.bookId : request.scope.bookId;
  if (error.outcome === "conflict") {
    if (error.code !== "conflict" || !error.savedAs ||
      !error.savedAs.startsWith(`books/${bookId}/conflicts/`) ||
      !/^books\/[A-Za-z0-9_-]+\/conflicts\/[A-Za-z0-9_.-]+\.json$/.test(error.savedAs) || error.savedAs.includes("..")) throw new Error("Foreign conflict.");
    if (request.operation === "saveDisposition") {
      if (request.hash !== request.report.hash) throw new Error("Foreign report intent.");
      if (!error.copy || !error.savedAs.startsWith(`books/${bookId}/conflicts/review-dispositions.`)) throw new Error("Missing disposition conflict contents.");
      const copy = decodeReviewRecord(encoder.encode(error.copy.rawJson), { kind: "review-dispositions", bookId, allowConflictMetadata: true });
      if (await sha256(error.copy.rawJson) !== error.copy.hash || copy.record.id !== request.id) throw new Error("Foreign conflict contents.");
      const { scope: _scope, id: _id, hash: _hash, operation: _operation, ...intent } = request;
      const expected = await prepareDispositionIntent(bookId, request.id, intent, error.copy.at, sha256Bytes);
      const { conflictMetadata, ...value } = copy.raw;
      const metadata = z.strictObject({ reason: z.enum(["missing-file", "external-edit"]), baseline: z.unknown(),
        observed: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("absent") }), z.strictObject({ kind: z.literal("sha256"), value: hashSchema })]) }).parse(conflictMetadata);
      if (canonicalRecordText(value) !== canonicalRecordText(expected.value) || canonicalRecordText(metadata.baseline) !== canonicalRecordText(expected.value.base) ||
        metadata.reason !== (metadata.observed.kind === "absent" ? "missing-file" : "external-edit")) throw new Error("Foreign conflict intent.");
    } else if (request.operation === "save") {
      if (!error.copy || !error.savedAs.startsWith(`books/${bookId}/conflicts/review-report.`)) throw new Error("Missing report conflict contents.");
      const run = await validatedRun(request.run);
      const copy = decodeReviewRecord(encoder.encode(error.copy.rawJson), { kind: "review-report", bookId, allowConflictMetadata: true });
      if (await sha256(error.copy.rawJson) !== error.copy.hash || copy.record.id !== run.runId || copy.record.savedAt !== error.copy.at) throw new Error("Foreign report conflict contents.");
      const expected = await buildReviewReport({ ownerBookId: bookId, run, savedAt: error.copy.at, sha256 });
      const { conflictMetadata, ...value } = copy.raw;
      const metadata = z.strictObject({ reason: z.enum(["missing-file", "external-edit"]), baseline: z.unknown(),
        observed: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("absent") }), z.strictObject({ kind: z.literal("sha256"), value: hashSchema })]) }).parse(conflictMetadata);
      if (canonicalRecordText(value) !== canonicalRecordText(expected) || canonicalRecordText(metadata.baseline) !== canonicalRecordText({ kind: "absent", revision: 0 }) ||
        metadata.reason !== (metadata.observed.kind === "absent" ? "missing-file" : "external-edit")) throw new Error("Foreign report conflict intent.");
    } else throw new Error("Unexpected conflict receipt.");
  } else if (error.savedAs !== undefined || error.copy !== undefined || error.code === "conflict") throw new Error("Invalid copy receipt.");
  if ((error.code === "uncertain") !== (error.outcome === "uncertain") ||
    (error.code === "not-kept") !== (error.outcome === "not-kept")) throw new Error("Invalid outcome.");
  return error;
}

/** One handler instance per host. All async work keeps the Library resolved before its first await. */
export function reviewRecordHandler(getLibrary: () => object) {
  const libraries = new WeakMap<object, string>();
  const confirmations = new Map<string, string>();
  return async (payload: unknown): Promise<unknown> => {
    // Invalid envelopes are deliberately not echoed (they cannot be bound safely).
    let input: z.infer<typeof inputSchema>;
    try { input = inputSchema.parse(JSON.parse(bounded(payload, REQUEST_BYTES))); }
    catch { throw new ReviewRecordError("invalid", "The review request is invalid. Nothing was submitted."); }
    const { request, requestId } = input;
    let result: ReviewRecordResult<unknown>;
    let library: object | null;
    try { library = getLibrary(); }
    catch { library = null; }
    const requestDigest = await sha256(bounded(request, REQUEST_BYTES));
    if (!library) result = failure("not-found", "Open a library before inspecting saved reviews.");
    else {
      let libraryId = libraries.get(library);
      if (!libraryId) { libraryId = globalThis.crypto.randomUUID(); libraries.set(library, libraryId); }
      try {
        const store = (library as { reviewRecords?: ReviewRecordStore }).reviewRecords;
        if (!store) result = failure("unsupported", "Saved review storage is unavailable on this host. Your review remains in this view; nothing was submitted to storage.");
        else if (request.operation === "open") result = { ok: true, data: { bookId: request.bookId, viewId: request.viewId, libraryId } };
        else if (request.scope.libraryId !== libraryId) result = failure("changed", "The open library changed. Keep your draft, then return to the library and reopen this book.");
        else {
          let data: unknown;
          if (request.operation === "list") {
            const list = await store.listReports(request.scope.bookId, { offset: request.offset, limit: 50 });
            data = { ...list, issues: list.issues.slice(request.issueOffset, request.issueOffset + 50), issueOffset: request.issueOffset, issueTotal: list.issues.length };
          } else if (request.operation === "save") {
            let run: ReaderRun;
            try {
              run = await validatedRun(request.run);
              // Validate complete report semantics before calling the writer (without choosing its savedAt).
              await buildReviewReport({ ownerBookId: request.scope.bookId, run, savedAt: new Date(Math.max(Date.now(), Date.parse(run.completedAt))).toISOString(), sha256 });
            } catch {
              throw new ReviewRecordError("invalid", "The reader result or captured evidence could not be validated. Nothing was written; keep the volatile review.");
            }
            if (getLibrary() !== library) throw new ReviewRecordError("invalid", "The open library changed before saving. Nothing was written.");
            const saved = await store.createReport(request.scope.bookId, run);
            data = { status: saved.status, report: wire(saved.report) };
          } else if (request.operation === "readReportConflict") {
            data = await store.readReportConflictCopy(request.scope.bookId, request.savedAs);
          } else if (request.operation === "saveDisposition") {
            const { scope: _scope, id: _id, hash: _hash, operation: _operation, ...intent } = request;
            if (request.hash !== request.report.hash) throw new ReviewRecordError("invalid", "The disposition command names another report. Nothing was written.");
            const saved = await store.recordDispositionChecked(request.scope.bookId, request.id, intent);
            data = { status: saved.status, at: saved.at, record: wire(saved.record) };
          } else if (request.operation === "listTrash") data = await store.listTrashGroups(request.scope.bookId, request.offset);
          else if (request.operation === "inspectTrash") data = await store.inspectTrashGroup(request.scope.bookId, request.groupId);
          else if (request.operation === "inspectGroup") data = await store.inspectReportGroup(request.scope.bookId, request.id, request.hash);
          else if (request.operation === "moveGroup") {
            const owner = confirmations.get(request.confirmation.token);
            confirmations.delete(request.confirmation.token);
            if (owner !== canonicalRecordText(request.scope)) throw new ReviewRecordError("invalid", "This confirmation belongs to another view or has expired. Inspect the group again.");
            data = await store.moveInspectedGroup(request.scope.bookId, request.confirmation);
          }
          else {
            const report = await store.readReport(request.scope.bookId, request.id);
            if (!report) throw new ReviewRecordError("not-found", "This saved review is missing. Refresh the list; the inspected version is still here.");
            if (report.hash !== request.hash) throw new ReviewRecordError("invalid", "This saved review changed. Refresh the list; the inspected version is still here.");
            if (request.operation === "read") data = wire(report);
            else {
              const dispositions = await store.readDispositions(request.scope.bookId, request.id);
              if (dispositions && (dispositions.record.report.completedAt !== report.record.run.completedAt ||
                dispositions.record.dispositions.some((entry) => !report.record.findings.some((finding) => finding.findingId === entry.findingId)))) {
                throw new ReviewRecordError("corrupt", "These dispositions do not belong to the inspected findings. The files were left untouched.");
              }
              data = dispositions ? wire(dispositions) : null;
            }
          }
          // Validate wire data here as well as at the receiver; do not send duplicate raw/parsed bodies.
          try {
            bounded(data, REQUEST_BYTES);
            await validateOutput(request, data);
            if (request.operation === "inspectGroup" || request.operation === "inspectTrash") {
              const inspection = reviewInspectionSchema.parse(data);
              while (confirmations.size >= 64) {
                const oldest = confirmations.keys().next().value;
                if (oldest) confirmations.delete(oldest);
              }
              confirmations.set(inspection.token, canonicalRecordText(request.scope));
            }
          } catch {
            // A malformed receipt after a writer returned cannot establish nonpublication.
            throw new Error("The review storage reply could not be verified.");
          }
          result = { ok: true, data };
        }
      } catch (error) {
        if (error instanceof ReviewRecordError) {
          result = { ok: false, error: { code: error.code, message: error.message,
            outcome: error.code === "conflict" ? "conflict" : error.code === "not-kept" ? "not-kept" : error.code === "uncertain" ? "uncertain" : "refused",
            ...(error.savedAs ? { savedAs: error.savedAs } : {}), ...(error.copy ? { copy: error.copy } : {}) } };
        } else result = failure("uncertain", "The review operation could not be verified. Keep your draft and inspect the saved version before another save.", "uncertain");
      }
    }
    if (!result.ok) {
      try {
        await validateFailure(errorSchema.parse(result.error), request);
        if (request.operation === "save" && result.error.outcome === "conflict") {
          const store = (library as { reviewRecords?: ReviewRecordStore } | null)?.reviewRecords;
          if (!store || !result.error.savedAs || !result.error.copy) throw new Error("Missing report conflict.");
          const actual = await store.readReportConflictCopy(request.scope.bookId, result.error.savedAs);
          if (actual.hash !== result.error.copy.hash || actual.rawJson !== result.error.copy.rawJson) throw new Error("Changed report conflict.");
        }
      }
      catch { result = failure("uncertain", "The review failure receipt could not be verified. Keep your draft and inspect the saved version before another save.", "uncertain"); }
    }
    return { requestId, requestDigest, result };
  };
}

/** The same receiver validation runs in preload and the browser. No retry, fallback or raw path API. */
export function createReviewRecordApi(invoke: (payload: unknown) => Promise<unknown>): ReviewRecordApi {
  async function call(requestInput: Request): Promise<ReviewRecordResult<unknown>> {
    let request: Request;
    try { request = requestSchema.parse(JSON.parse(bounded(requestInput, REQUEST_BYTES))); }
    catch { return failure("invalid", "The review request is invalid. Nothing was submitted."); }
    const requestId = globalThis.crypto.randomUUID();
    const requestDigest = await sha256(bounded(request, REQUEST_BYTES));
    try {
      const response = transportSchema.parse(JSON.parse(bounded(await invoke({ requestId, request }), REQUEST_BYTES + 100_000)));
      if (response.requestId !== requestId || response.requestDigest !== requestDigest) throw new Error("Foreign review response.");
      if (!response.result.ok) {
        const error = await validateFailure(response.result.error, request);
        if (request.operation === "save" && error.outcome === "conflict" && error.savedAs && error.copy) {
          const actual = await call({ operation: "readReportConflict", scope: request.scope, savedAs: error.savedAs });
          if (!actual.ok || canonicalRecordText(actual.data) !== canonicalRecordText({ hash: error.copy.hash, rawJson: error.copy.rawJson })) throw new Error("Report conflict readback failed.");
        }
        return { ok: false, error };
      }
      return { ok: true, data: await validateOutput(request, response.result.data) };
    } catch {
      return failure("uncertain", "The review reply could not be verified. Keep your draft and inspect the saved version before another save.", "uncertain");
    }
  }
  return {
    open: (bookId, viewId) => call({ operation: "open", bookId, viewId }) as ReturnType<ReviewRecordApi["open"]>,
    list: (scope, offset = 0, issueOffset = 0) => call({ operation: "list", scope, offset, issueOffset }) as ReturnType<ReviewRecordApi["list"]>,
    read: (scope, id, hash) => call({ operation: "read", scope, id, hash }) as ReturnType<ReviewRecordApi["read"]>,
    readDispositions: (scope, id, hash) => call({ operation: "readDispositions", scope, id, hash }) as ReturnType<ReviewRecordApi["readDispositions"]>,
    save: (scope, run) => call({ operation: "save", scope, run }) as ReturnType<ReviewRecordApi["save"]>,
    saveDisposition: (input) => {
      try {
        const detached = JSON.parse(bounded(input, REQUEST_BYTES)) as Omit<Extract<Request, { operation: "saveDisposition" }>, "operation">;
        return call({ ...detached, operation: "saveDisposition" }) as ReturnType<ReviewRecordApi["saveDisposition"]>;
      } catch {
        return Promise.resolve(failure("invalid", "The review request is invalid. Nothing was submitted."));
      }
    },
    inspectGroup: (scope, id, hash) => call({ operation: "inspectGroup", scope, id, hash }) as ReturnType<ReviewRecordApi["inspectGroup"]>,
    listTrash: (scope, offset = 0) => call({ operation: "listTrash", scope, offset }) as ReturnType<ReviewRecordApi["listTrash"]>,
    inspectTrash: (scope, groupId) => call({ operation: "inspectTrash", scope, groupId }) as ReturnType<ReviewRecordApi["inspectTrash"]>,
    moveGroup: (scope, confirmation) => call({ operation: "moveGroup", scope, confirmation }) as ReturnType<ReviewRecordApi["moveGroup"]>
  };
}
