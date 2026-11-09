import { z } from "zod";
import { copyListInput, copyListSchema, copyReadInput, copySchema, inspectPlanningCopy, type PlanningCopy, type PlanningCopyList, type PlanningRecovery } from "./planning-recovery";
import type { Result } from "../ipc";
import { envelopeFields, newSidecarAttempt, sameSource, sidecarAttemptIdSchema, sidecarAttemptSchema, sidecarIntentBytes, SidecarRefusalError, SidecarWriteError, type SidecarAttempt, type SidecarRead, type SidecarSave } from "../planning/checked-sidecar";
import { bookIdSchema, decoder, encoder, hashSchema, increment, parseJson, planningSchema, RECOVERY_BYTES, serializeDocument, sourceSchema, validateDocument, type Planning, type SidecarDocument } from "../planning/schema";
import { applyPlanningDraft, planningSaveSchema, type PlanningSaveRequest, type PlanningService } from "../planning/service";
import { goalSchema, goalSaveSchema, type Goal, type GoalProgress, type GoalSaveRequest, type GoalService } from "../organization/goals";

export interface PlanningApi {
  read(bookId: string): Promise<Result<SidecarRead<Planning>>>;
  save(input: PlanningSaveRequest): Promise<Result<SidecarSave<Planning>>>;
  readGoal(bookId: string): Promise<Result<SidecarRead<Goal>>>;
  saveGoal(input: GoalSaveRequest): Promise<Result<SidecarSave<Goal>>>;
  progress(bookId: string): Promise<Result<GoalProgress>>;
  listCopies(bookId: string, offset: number): Promise<Result<PlanningCopyList>>;
  readCopy(bookId: string, name: string): Promise<Result<PlanningCopy>>;
}
export type PlanningOperation = keyof PlanningApi;
export const planningChannels = {
  read: "planning:read", save: "planning:save", readGoal: "planning:readGoal",
  saveGoal: "planning:saveGoal", progress: "planning:progress", listCopies: "planning:listCopies", readCopy: "planning:readCopy"
} as const;
const scopeSchema = z.strictObject({ bookId: bookIdSchema.max(200) });
const planningWireSchema = planningSaveSchema.extend({ attemptId: sidecarAttemptIdSchema.optional() });
const goalWireSchema = goalSaveSchema.extend({ attemptId: sidecarAttemptIdSchema.optional() });
const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0);
const progressSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("complete"), bookId: bookIdSchema, targetWords: goalSchema.shape.targetWords, savedWords: count, remaining: count.nullable() }),
  z.strictObject({ status: z.literal("incomplete"), bookId: bookIdSchema, targetWords: goalSchema.shape.targetWords, unreadableChapters: count.refine((n) => n > 0) }),
  z.strictObject({ status: z.literal("unavailable"), bookId: bookIdSchema, reason: z.enum(["changed", "unreadable"]) })
]);
const errorSchema = z.strictObject({
  code: z.enum(["invalid", "io", "internal", "not-found", "format", "newer-schema"]),
  message: z.string().max(4096),
  outcome: z.enum(["uncertain", "not-kept", "refused"]).optional(),
  phase: z.enum(["active", "recovery"]).optional()
}).refine((error) => error.outcome === "not-kept" ? error.phase === "recovery"
  : error.outcome === "refused" ? error.phase === undefined : error.phase === undefined || error.outcome === "uncertain");
const resultEnvelope = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), data: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: errorSchema })
]);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Exact JSON ownership matters even for own __proto__: inherited properties are not data. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  const array = Array.isArray(a);
  if (array !== Array.isArray(b)) return false;
  if (!array && [a, b].some((value) => Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  if (array && (a.length !== (b as unknown[]).length || keys.length !== a.length + 1)) return false;
  return keys.every((key) => {
    if (typeof key !== "string") return false;
    if (array && key === "length") return true;
    if (array && !/^(0|[1-9]\d*)$/.test(key)) return false;
    const left = Object.getOwnPropertyDescriptor(a, key);
    const right = Object.getOwnPropertyDescriptor(b, key);
    return !!left?.enumerable && !!right?.enumerable && "value" in left && "value" in right && sameValue(left.value, right.value);
  });
}

export async function validateSidecarRead<T extends SidecarDocument>(schema: z.ZodType<T>, value: unknown, bookId: string): Promise<SidecarRead<T>> {
  const envelope = z.strictObject({ ...envelopeFields, data: z.unknown() }).parse(value);
  // Validate without rebuilding loose objects: own __proto__ is supported JSON data too.
  const read: SidecarRead<T> = { ...envelope, data: envelope.data === null ? null : validateDocument(schema, envelope.data, bookId) };
  if (read.bookId !== bookId) throw new Error("Foreign planning response.");
  if (read.source.kind === "absent") {
    if (read.data !== null || read.baselineJson !== null) throw new Error("Invalid absent response.");
  } else {
    if (read.baselineJson === null || read.data === null) throw new Error("Missing planning baseline.");
    const bytes = encoder.encode(read.baselineJson);
    const raw = validateDocument(schema, parseJson(bytes), bookId);
    if (raw.revision !== read.source.revision || !sameValue(raw, read.data) || await sha256(bytes) !== read.source.value) {
      throw new Error("The planning baseline could not be verified.");
    }
    // Return the independently parsed raw data, detached before the first await.
    read.data = raw;
  }
  return read;
}

async function validateSave<T extends SidecarDocument>(schema: z.ZodType<T>, value: unknown, bookId: string, kind: "planning" | "goals"): Promise<SidecarSave<T>> {
  const result = z.discriminatedUnion("status", [
    z.strictObject({ status: z.enum(["saved", "unchanged"]), current: z.unknown(), attempt: sidecarAttemptSchema }),
    z.strictObject({ status: z.literal("conflict"), bookId: bookIdSchema, reason: z.enum(["external-edit", "missing-file"]), savedAs: z.string().max(600), observed: sourceSchema,
      preserved: z.strictObject({ hash: hashSchema, rawJson: z.string().refine((text) => encoder.encode(text).byteLength <= RECOVERY_BYTES) }), attempt: sidecarAttemptSchema })
  ]).parse(value);
  if (result.status === "conflict") {
    if (result.bookId !== bookId || !result.savedAs.startsWith(`books/${bookId}/conflicts/${kind}.conflict-${result.reason}.`) ||
      !/^books\/[A-Za-z0-9_-]+\/conflicts\/[A-Za-z0-9_.-]+\.json$/.test(result.savedAs)) throw new Error("Foreign conflict response.");
    if (await sha256(encoder.encode(result.preserved.rawJson)) !== result.preserved.hash) throw new Error("Unverified conflict bytes.");
    return result;
  }
  const current = await validateSidecarRead(schema, result.current, bookId);
  if (result.status === "saved" && current.source.kind !== "sha256") throw new Error("A saved result requires a persisted source.");
  return { status: result.status, current, attempt: result.attempt };
}

/** One validated handler shared by desktop IPC and browser hosts. Resolve the open Library once. */
export function planningHandler(getLibrary: () => { planning: PlanningService; goals: GoalService; planningRecovery: PlanningRecovery }) {
  return async (operation: PlanningOperation, payload: unknown): Promise<Result<unknown>> => {
    let bookId: string;
    let request: PlanningSaveRequest | GoalSaveRequest | undefined;
    let requestId: string | undefined;
    try {
      if (operation === "save" || operation === "saveGoal") {
        const { attemptId, ...parsed } = (operation === "save" ? planningWireSchema : goalWireSchema).parse(payload);
        request = parsed;
        requestId = attemptId;
      }
      bookId = operation === "listCopies" ? copyListInput.parse(payload).bookId
        : operation === "readCopy" ? copyReadInput.parse(payload).bookId
        : scopeSchema.parse(request ? { bookId: request.bookId } : payload).bookId;
    } catch {
      return { ok: false, error: { code: "invalid", message: "The planning request is invalid. Nothing was submitted.", outcome: "refused" } };
    }
    try {
      const library = getLibrary();
      // Keep validation state private across the service await, including a fresh host identity.
      const attempt = request ? newSidecarAttempt(requestId) : undefined;
      const submitted = request ? structuredClone(request) : undefined;
      const data = operation === "read" ? await library.planning.read(bookId)
        : operation === "listCopies" ? await library.planningRecovery.list(payload)
        : operation === "readCopy" ? await library.planningRecovery.read(payload)
        : operation === "readGoal" ? await library.goals.read(bookId)
        : operation === "progress" ? await library.goals.progress(bookId)
        : operation === "save" ? await library.planning.save(submitted, attempt ? { ...attempt } : undefined)
        : await library.goals.save(submitted, attempt ? { ...attempt } : undefined);
      const output = await validateOutput(operation, data, bookId);
      if (operation === "save" || operation === "saveGoal") {
        const result = output as SidecarSave<Planning | Goal>;
        if (!attempt) throw new Error("Missing planning attempt.");
        await validateIntentResult(request as PlanningSaveRequest | GoalSaveRequest, result, operation === "save" ? "planning" : "goals", attempt);
        if (result.status === "conflict") {
          const copy = await library.planningRecovery.read({ bookId, name: result.savedAs.split("/").at(-1) });
          const verified = await validateOutput("readCopy", copy, bookId) as PlanningCopy;
          if (`books/${bookId}/conflicts/${verified.name}` !== result.savedAs || verified.hash !== result.preserved.hash || verified.rawJson !== result.preserved.rawJson) {
            throw new Error("The named recovery copy no longer matches the submitted draft.");
          }
        }
      }
      return { ok: true, data: output };
    } catch (error) {
      if (error instanceof SidecarRefusalError) return { ok: false, error: { code: "invalid", message: error.message, outcome: "refused" } };
      // Unknown failures (including output validation) cannot prove nonpublication.
      return { ok: false, error: { code: "io", message: error instanceof SidecarWriteError ? error.message : "Planning storage could not be verified. Keep your draft and inspect the saved version before another save.",
        outcome: error instanceof SidecarWriteError ? error.outcome : "uncertain",
        ...(error instanceof SidecarWriteError ? { phase: error.phase } : {}) } };
    }
  };
}

async function validateOutput(operation: PlanningOperation, data: unknown, bookId: string) {
  if (operation === "listCopies") {
    const list = copyListSchema.parse(data);
    if (list.bookId !== bookId || new Set(list.names).size !== list.names.length) throw new Error("Foreign copy list.");
    return list;
  }
  if (operation === "readCopy") {
    const copy = copySchema.parse(data);
    if (copy.bookId !== bookId || await sha256(encoder.encode(copy.rawJson)) !== copy.hash) throw new Error("Unverified copy.");
    inspectPlanningCopy(copy);
    return copy;
  }
  if (operation === "read") return validateSidecarRead(planningSchema, data, bookId);
  if (operation === "readGoal") return validateSidecarRead(goalSchema, data, bookId);
  if (operation === "save") return validateSave(planningSchema, data, bookId, "planning");
  if (operation === "saveGoal") return validateSave(goalSchema, data, bookId, "goals");
  const progress = progressSchema.parse(data);
  if (progress.bookId !== bookId || (progress.status === "complete" && progress.remaining !== (progress.targetWords === null ? null : Math.max(0, progress.targetWords - progress.savedWords)))) {
    throw new Error("Invalid goal progress response.");
  }
  return progress;
}

/** Validate again after the transport. A rejected/malformed reply never triggers a retry. */
export function createPlanningApi(invoke: (operation: PlanningOperation, payload: unknown) => Promise<unknown>): PlanningApi {
  const call = async (operation: PlanningOperation, payload: unknown, bookId: string): Promise<Result<unknown>> => {
    payload = structuredClone(payload);
    scopeSchema.parse({ bookId });
    // Retain a schema-detached intent before invoke can yield or mutate its own payload object.
    const request = operation === "save" ? planningSaveSchema.parse(payload)
      : operation === "saveGoal" ? goalSaveSchema.parse(payload) : undefined;
    const attemptId = request ? globalThis.crypto.randomUUID() : undefined;
    if (request) payload = { ...structuredClone(request), attemptId };
    if (operation === "listCopies") copyListInput.parse(payload);
    const copyRequest = operation === "readCopy" ? copyReadInput.parse(payload) : undefined;
    const response = resultEnvelope.parse(await invoke(operation, payload));
    if (!response.ok) return { ok: false, error: { code: response.error.code, message: response.error.message,
      ...(response.error.outcome ? { outcome: response.error.outcome } : {}),
      ...(response.error.phase ? { phase: response.error.phase } : {}) } };
    const data = await validateOutput(operation, response.data, bookId);
    if (request) {
      const result = data as SidecarSave<Planning | Goal>;
      if (!attemptId) throw new Error("Missing planning attempt.");
      await validateIntentResult(request, result, operation === "save" ? "planning" : "goals", { requestId: attemptId });
    }
    if (copyRequest && (data as PlanningCopy).name !== copyRequest.name) throw new Error("Foreign copy reply.");
    return { ok: true, data };
  };
  return {
    read: (bookId) => call("read", { bookId }, bookId) as ReturnType<PlanningApi["read"]>,
    save: (input) => call("save", input, input.bookId) as ReturnType<PlanningApi["save"]>,
    readGoal: (bookId) => call("readGoal", { bookId }, bookId) as ReturnType<PlanningApi["readGoal"]>,
    saveGoal: (input) => call("saveGoal", input, input.bookId) as ReturnType<PlanningApi["saveGoal"]>,
    progress: (bookId) => call("progress", { bookId }, bookId) as ReturnType<PlanningApi["progress"]>,
    listCopies: (bookId, offset) => call("listCopies", { bookId, offset }, bookId) as ReturnType<PlanningApi["listCopies"]>,
    readCopy: (bookId, name) => call("readCopy", { bookId, name }, bookId) as ReturnType<PlanningApi["readCopy"]>
  };
}

async function validateIntentResult(request: PlanningSaveRequest | GoalSaveRequest, result: SidecarSave<Planning | Goal>, kind: "planning" | "goals",
  expectedAttempt: Pick<SidecarAttempt, "requestId"> & Partial<Pick<SidecarAttempt, "publicationId">>): Promise<void> {
  const attempt = sidecarAttemptSchema.parse(result.attempt);
  if (attempt.requestId !== expectedAttempt.requestId || (expectedAttempt.publicationId !== undefined && attempt.publicationId !== expectedAttempt.publicationId)) {
    throw new Error("The planning reply belongs to a different save attempt.");
  }
  const baseline = await validateSidecarRead<Planning | Goal>(kind === "planning" ? planningSchema : goalSchema, { bookId: request.bookId, source: request.source, baselineJson: request.baselineJson,
    data: request.baselineJson === null ? null : parseJson(encoder.encode(request.baselineJson))
  }, request.bookId);
  const base = baseline.data;
  const copy = result.status === "conflict" ? inspectPlanningCopy(copySchema.parse({ bookId: request.bookId,
    name: result.savedAs.split("/").at(-1), hash: result.preserved.hash, rawJson: result.preserved.rawJson })) : null;
  const current = copy ? copy.data : result.status !== "conflict" ? result.current.data : null;
  const proposed = request.draft.kind === "set-goal" ? {
    data: { ...(base ?? { schemaVersion: 1, bookId: request.bookId, revision: 1 }), targetWords: request.draft.targetWords },
    changed: (base?.targetWords ?? null) !== request.draft.targetWords
  } : applyPlanningDraft(base as Planning | null, request.bookId, request.draft, (prefix) => `${prefix}_${attempt.publicationId}`);
  const projected = proposed.changed ? { ...proposed.data, revision: increment(base?.revision ?? 0) } : proposed.data;
  if (result.status === "conflict") {
    const reason = result.observed.kind === "absent" && request.source.kind !== "absent" ? "missing-file" : "external-edit";
    const requestHash = await sha256(sidecarIntentBytes(request));
    if (!copy || copy.kind !== kind || result.reason !== reason || copy.metadata.reason !== reason ||
        copy.metadata.requestHash !== requestHash || !sameValue(copy.metadata.attempt, attempt) || !sameSource(copy.metadata.baseline, request.source) ||
        !sameSource(copy.metadata.observed, result.observed) || !sameValue(current, projected)) {
      throw new Error("The recovery copy does not match the exact intended operation.");
    }
    const raw = decoder.decode(serializeDocument({ ...projected, conflictMetadata: { reason, baseline: request.source, observed: result.observed, requestHash, attempt } }, RECOVERY_BYTES));
    if (raw !== result.preserved.rawJson) throw new Error("Unexpected recovery serialization.");
    return;
  }
  if (proposed.changed !== (result.status === "saved")) throw new Error("Unexpected planning save status.");
  const expected = proposed.changed ? projected : base;
  if (!sameValue(current, expected)) throw new Error("The planning reply does not match the exact intended operation.");
  if (proposed.changed && result.current.baselineJson !== decoder.decode(serializeDocument(projected))) throw new Error("Unexpected saved serialization.");
  if (!proposed.changed && (!sameSource(result.current.source, request.source) || result.current.baselineJson !== request.baselineJson)) {
    throw new Error("Foreign unchanged planning baseline.");
  }
}

/** Preserve phase/outcome across Result transport rather than using the generic message-only must. */
export async function planningValue<T>(result: Promise<Result<T>>): Promise<T> {
  const value = await result;
  if (value.ok) return value.data;
  throw Object.assign(new Error(value.error.message), value.error);
}
