import { z } from "zod";
import { copyListInput, copyListSchema, copyReadInput, copySchema, inspectPlanningCopy, type PlanningCopy, type PlanningCopyList, type PlanningRecovery } from "./planning-recovery";
import type { Result } from "../ipc";
import { sameValue } from "./book-merge";
import { envelopeFields, sameSource, SidecarWriteError, type SidecarRead, type SidecarSave } from "../planning/checked-sidecar";
import { bookIdSchema, checkBytes, encoder, parseJson, planningSchema, sourceSchema, validateDocument, type Planning, type SidecarDocument } from "../planning/schema";
import { planningSaveSchema, type PlanningSaveRequest, type PlanningService } from "../planning/service";
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

export async function validateSidecarRead<T extends SidecarDocument>(schema: z.ZodType<T>, value: unknown, bookId: string): Promise<SidecarRead<T>> {
  const read = z.strictObject({ ...envelopeFields, data: schema.nullable() }).parse(value);
  if (read.bookId !== bookId) throw new Error("Foreign planning response.");
  if (read.source.kind === "absent") {
    if (read.data !== null || read.baselineJson !== null) throw new Error("Invalid absent response.");
  } else {
    if (read.baselineJson === null || read.data === null) throw new Error("Missing planning baseline.");
    const bytes = encoder.encode(read.baselineJson);
    const raw = validateDocument(schema, parseJson(bytes), bookId);
    checkBytes(encoder.encode(JSON.stringify(read.data)));
    if (await sha256(bytes) !== read.source.value || raw.revision !== read.source.revision || !sameValue(raw, read.data)) {
      throw new Error("The planning baseline could not be verified.");
    }
  }
  return read;
}

async function validateSave<T extends SidecarDocument>(schema: z.ZodType<T>, value: unknown, bookId: string, kind: "planning" | "goals"): Promise<SidecarSave<T>> {
  const result = z.discriminatedUnion("status", [
    z.strictObject({ status: z.enum(["saved", "unchanged"]), current: z.unknown() }),
    z.strictObject({ status: z.literal("conflict"), bookId: bookIdSchema, reason: z.enum(["external-edit", "missing-file"]), savedAs: z.string().max(600), observed: sourceSchema })
  ]).parse(value);
  if (result.status === "conflict") {
    if (result.bookId !== bookId || !result.savedAs.startsWith(`books/${bookId}/conflicts/${kind}.conflict-${result.reason}.`) ||
      !/^books\/[A-Za-z0-9_-]+\/conflicts\/[A-Za-z0-9_.-]+\.json$/.test(result.savedAs)) throw new Error("Foreign conflict response.");
    return result;
  }
  const current = await validateSidecarRead(schema, result.current, bookId);
  if (result.status === "saved" && current.source.kind !== "sha256") throw new Error("A saved result requires a persisted source.");
  return { status: result.status, current };
}

/** One validated handler shared by desktop IPC and browser hosts. Resolve the open Library once. */
export function planningHandler(getLibrary: () => { planning: PlanningService; goals: GoalService; planningRecovery: PlanningRecovery }) {
  return async (operation: PlanningOperation, payload: unknown): Promise<Result<unknown>> => {
    let bookId: string;
    let request: PlanningSaveRequest | GoalSaveRequest | undefined;
    try {
      if (operation === "save") request = planningSaveSchema.parse(payload);
      else if (operation === "saveGoal") request = goalSaveSchema.parse(payload);
      bookId = operation === "listCopies" ? copyListInput.parse(payload).bookId
        : operation === "readCopy" ? copyReadInput.parse(payload).bookId
        : scopeSchema.parse(request ? { bookId: request.bookId } : payload).bookId;
    } catch {
      return { ok: false, error: { code: "invalid", message: "The planning request is invalid. Nothing was submitted.", outcome: "refused" } };
    }
    try {
      const library = getLibrary();
      const data = operation === "read" ? await library.planning.read(bookId)
        : operation === "listCopies" ? await library.planningRecovery.list(payload)
        : operation === "readCopy" ? await library.planningRecovery.read(payload)
        : operation === "readGoal" ? await library.goals.read(bookId)
        : operation === "progress" ? await library.goals.progress(bookId)
        : operation === "save" ? await library.planning.save(request) : await library.goals.save(request);
      return { ok: true, data: await validateOutput(operation, data, bookId) };
    } catch (error) {
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
    scopeSchema.parse({ bookId });
    if (operation === "save") planningSaveSchema.parse(payload);
    if (operation === "saveGoal") goalSaveSchema.parse(payload);
    if (operation === "listCopies") copyListInput.parse(payload);
    if (operation === "readCopy") copyReadInput.parse(payload);
    const response = resultEnvelope.parse(await invoke(operation, payload));
    if (!response.ok) return { ok: false, error: { code: response.error.code, message: response.error.message,
      ...(response.error.outcome ? { outcome: response.error.outcome } : {}),
      ...(response.error.phase ? { phase: response.error.phase } : {}) } };
    const data = await validateOutput(operation, response.data, bookId);
    if (operation === "save" || operation === "saveGoal") {
      const request = operation === "save" ? planningSaveSchema.parse(payload) : goalSaveSchema.parse(payload);
      const result = data as SidecarSave<Planning | Goal>;
      if (result.status === "unchanged" && !sameSource(result.current.source, request.source)) throw new Error("Foreign unchanged baseline.");
      if (result.status === "saved" && result.current.source.revision !== request.source.revision + 1) throw new Error("Unexpected saved revision.");
      if (result.status !== "conflict") {
        if (request.draft.kind === "set-goal") {
          if ((result.current.data?.targetWords ?? null) !== request.draft.targetWords) throw new Error("Foreign goal result.");
        } else {
          const current = planningSchema.parse(result.current.data);
          const base = request.baselineJson === null ? null : planningSchema.parse(parseJson(encoder.encode(request.baselineJson)));
          const draft = request.draft;
          const records = draft.kind === "edit-worldbuilding" ? current.worldbuilding.filter((record) => record.id === draft.id)
            : current.worldbuilding.filter((record) => !base?.worldbuilding.some((previous) => previous.id === record.id));
          if (records.length !== 1 || !Object.entries(draft.fields).every(([key, value]) => records[0]?.[key] === value)) throw new Error("Foreign worldbuilding result.");
        }
      }
    }
    if (operation === "readCopy" && (data as PlanningCopy).name !== copyReadInput.parse(payload).name) throw new Error("Foreign copy reply.");
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

/** Preserve phase/outcome across Result transport rather than using the generic message-only must. */
export async function planningValue<T>(result: Promise<Result<T>>): Promise<T> {
  const value = await result;
  if (value.ok) return value.data;
  throw Object.assign(new Error(value.error.message), value.error);
}
