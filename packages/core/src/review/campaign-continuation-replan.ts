import { z } from "zod";
import { normalizeBody, parseChapterFile } from "../markdown";
import type { ChapterMeta } from "../schema";
import { historyMetaSchema, readHistoryEnvelope } from "../library/history";
import {
  assertReviewData, bookIdSchema, canonicalJson, freeze, idSchema, integerSchema, isReviewData, ReviewContractError,
  validSpan, versionSchema
} from "./contract";
import { planReviewCampaign, requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { compareContinuationWithLocalPlan } from "./campaign-continuation-match";
import {
  CONTINUATION_WIRE_LIMITS, inspectContinuationWire
} from "./campaign-continuation-wire";
import { ContinuationTokenError, type InspectedContinuationHole } from "./campaign-continuation-tokens";
import { decodeStrictJsonBytes, encodeCanonicalJson } from "./record-json";
import { ReviewRecordError } from "./record-error";
import { recordIdSchema } from "./record-format";
import { savedIdentitySchema, type SavedIdentity } from "./sources";

/**
 * Compatible-replan and source-validation seam for retained campaign continuations (039 T014/T017).
 *
 * This leaf is pure: it reads no files, writes nothing and grants no execution authority. It only
 * decides how a retained manifest may be related to this build's planner, validates explicitly
 * supplied raw source bytes against the retained source identities, and, when replanning is
 * permitted, runs the real planner and requires the codec's complete canonical match. A digest or
 * hash agreement never registers a deserialized plan; only the freshly returned planner result
 * satisfies `requireCampaignPlan` afterwards.
 */

/** The frozen planner behaviour this build serves unchanged. */
export const CAMPAIGN_PLANNER_SEMANTICS = "review-campaign-planner-v1" as const;
/**
 * Recorded semantics labels that differ from the current label but may be attempted by replan.
 * Listing a label only permits the attempt: the fresh plan must still match the retained
 * continuation's complete canonical content and digest, or the result is a refusal.
 */
export const COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS = Object.freeze(["review-campaign-planner-v0"] as const);
/** Format §1 read-operation caps for distinct raw files loaded for one replan. */
export const CONTINUATION_REPLAN_SOURCE_LIMITS: Readonly<{ fileBytes: number; totalBytes: number }> =
  Object.freeze({ fileBytes: 33_554_432, totalBytes: 134_217_728 });

export type CampaignContinuationCompatibility =
  | { readonly decision: "serve-unchanged"; readonly plannerSemantics: typeof CAMPAIGN_PLANNER_SEMANTICS }
  | { readonly decision: "replan-required"; readonly plannerSemantics: string }
  | { readonly decision: "refuse"; readonly code: string };

export interface ContinuationSourceExpectation {
  readonly sourceId: string;
  readonly identity: SavedIdentity;
  readonly bodyLength: number;
  readonly segments: readonly { readonly start: number; readonly end: number; readonly startLine: number }[];
}

export interface ValidatedContinuationSource {
  readonly sourceId: string;
  readonly identity: SavedIdentity;
  readonly kind: "current" | "historical";
  readonly body: string;
}

export type ContinuationSourceValidation =
  | { readonly status: "validated"; readonly sources: readonly ValidatedContinuationSource[] }
  | { readonly status: "refused"; readonly code: string };

export type CampaignContinuationServeResult =
  | {
      readonly status: "matched-local-plan-only"; readonly plan: CampaignPlan;
      readonly untrustedPlanContent: unknown;
      readonly checkpoint: Awaited<ReturnType<typeof compareContinuationWithLocalPlan>>["checkpoint"];
      readonly plannedUnionDigest: string;
      readonly recordedPlannerSemantics: string; readonly compatibility: "serve-unchanged";
    }
  | { readonly status: "refused"; readonly code: string };

export type CampaignContinuationReplanResult =
  | {
      readonly status: "matched-local-plan-only"; readonly plan: CampaignPlan;
      readonly untrustedPlanContent: unknown;
      readonly checkpoint: Awaited<ReturnType<typeof compareContinuationWithLocalPlan>>["checkpoint"];
      readonly plannedUnionDigest: string;
      readonly recordedPlannerSemantics: string; readonly compatibility: "serve-unchanged" | "replan-required";
    }
  | { readonly status: "refused"; readonly code: string };

type ObjectValue = Record<string, unknown>;
type SegmentReader = (id: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>;

const expectationSchema = z.strictObject({
  sourceId: idSchema, identity: savedIdentitySchema, bodyLength: integerSchema,
  segments: z.array(z.strictObject({ start: integerSchema, end: integerSchema, startLine: versionSchema })).min(1)
});

function check(condition: unknown, code: "corrupt" | "unsupported" | "too-large" | "external-unavailable" | "external-mismatch"): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}

function errorCode(error: unknown): string {
  if (error instanceof ContinuationTokenError) return error.code;
  if (error instanceof ReviewRecordError) {
    return ["corrupt", "unsupported", "too-large", "external-unavailable", "external-mismatch"].includes(error.code)
      ? error.code : "corrupt";
  }
  if (error instanceof ReviewContractError) return error.code;
  return "corrupt";
}

function refused(code: string): { status: "refused"; code: string } {
  return freeze({ status: "refused" as const, code });
}

function plainRecord(value: unknown, keys: readonly string[]): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "corrupt");
  const result = value as ObjectValue;
  const prototype = Object.getPrototypeOf(result);
  check(prototype === Object.prototype || prototype === null, "corrupt");
  const actual = Reflect.ownKeys(result);
  check(actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key)), "corrupt");
  for (const key of actual as string[]) {
    const property = Object.getOwnPropertyDescriptor(result, key);
    check(property && "value" in property && property.enumerable, "corrupt");
  }
  return result;
}

function object(value: unknown): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "corrupt");
  return value as ObjectValue;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface RecordedManifest {
  readonly plannerSemantics: string;
  readonly ownerBookId: string;
  readonly campaignId: string;
  readonly manifest: ObjectValue;
}

/** Bounded pre-read of only the dispatch fields; all other manifest validation stays with the wire reader. */
function readRecordedManifest(manifestBytes: unknown): RecordedManifest {
  check(manifestBytes instanceof Uint8Array, "corrupt");
  check(manifestBytes.byteLength <= CONTINUATION_WIRE_LIMITS.manifestBytes, "too-large");
  let parsed: unknown;
  try {
    parsed = decodeStrictJsonBytes(new Uint8Array(manifestBytes), { maxBytes: CONTINUATION_WIRE_LIMITS.manifestBytes });
  } catch (error) {
    throw new ContinuationTokenError(errorCode(error) === "too-large" ? "too-large" : "corrupt");
  }
  const manifest = object(parsed);
  check(manifest.schemaVersion === 2 && manifest.kind === "review-campaign", "unsupported");
  const owner = object(manifest.owner);
  check(bookIdSchema.safeParse(owner.bookId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(manifest.id).success, "corrupt");
  check(typeof manifest.plannerSemantics === "string" && manifest.plannerSemantics.length > 0, "corrupt");
  return { plannerSemantics: manifest.plannerSemantics, ownerBookId: owner.bookId as string,
    campaignId: manifest.id as string, manifest };
}

/**
 * Decide, from the recorded schema version and planner semantics alone, how a retained
 * continuation may be related to this build's planner. This inspects no segments and trusts no
 * digest: a `serve-unchanged` decision still requires the codec match against a locally
 * provenanced plan, and a `replan-required` decision still requires an exact fresh match.
 */
export function inspectCampaignContinuationCompatibility(manifestBytes: unknown): CampaignContinuationCompatibility {
  try {
    const recorded = readRecordedManifest(manifestBytes);
    if (recorded.plannerSemantics === CAMPAIGN_PLANNER_SEMANTICS) {
      return freeze({ decision: "serve-unchanged" as const, plannerSemantics: CAMPAIGN_PLANNER_SEMANTICS });
    }
    if ((COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS as readonly string[]).includes(recorded.plannerSemantics)) {
      return freeze({ decision: "replan-required" as const, plannerSemantics: recorded.plannerSemantics });
    }
    return freeze({ decision: "refuse" as const, code: "unsupported" });
  } catch (error) {
    return freeze({ decision: "refuse" as const, code: errorCode(error) });
  }
}

/**
 * Serve a current-semantics continuation through a caller-supplied, already provenanced local
 * plan. A compatibly differing label is refused here even if the plan's content would match:
 * differing semantics must go through replan, never through unchanged serving.
 */
export async function serveCampaignContinuation(manifestBytes: Uint8Array, plan: CampaignPlan,
  readSegment: SegmentReader,
  resolve: (hole: InspectedContinuationHole) => unknown | Promise<unknown>): Promise<CampaignContinuationServeResult> {
  const compatibility = inspectCampaignContinuationCompatibility(manifestBytes);
  if (compatibility.decision === "refuse") return refused(compatibility.code);
  if (compatibility.decision === "replan-required") return refused("replan-required");
  try {
    check(typeof readSegment === "function" && typeof resolve === "function", "corrupt");
    const matched = await compareContinuationWithLocalPlan(manifestBytes, plan, readSegment, resolve);
    return { status: "matched-local-plan-only", plan, untrustedPlanContent: matched.untrustedPlanContent,
      checkpoint: matched.checkpoint, plannedUnionDigest: matched.plannedUnionDigest,
      recordedPlannerSemantics: compatibility.plannerSemantics, compatibility: "serve-unchanged" };
  } catch (error) {
    return refused(errorCode(error));
  }
}

function chapterFallback(): ChapterMeta {
  // Impossible identity sentinels: a file omitting id or version must refuse, never inherit them.
  return {
    id: "", title: "", order: 1, arc: "middle", purpose: "", synopsis: "", notes: "",
    isPrologue: false, color: null, version: -1,
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z"
  };
}

function checkBody(body: string, expectation: z.infer<typeof expectationSchema>): void {
  check(body.length === expectation.bodyLength, "external-mismatch");
  check(normalizeBody(body) === body, "external-mismatch");
  for (const segment of expectation.segments) {
    check(validSpan(body, segment), "external-mismatch");
    check(body.slice(0, segment.start).split("\n").length === segment.startLine, "external-mismatch");
  }
}

async function validateCurrent(bytes: Uint8Array, text: string, expectation: z.infer<typeof expectationSchema>): Promise<string> {
  check(await sha256Hex(bytes) === expectation.identity.hash, "external-mismatch");
  let parsed: ReturnType<typeof parseChapterFile>;
  try {
    parsed = parseChapterFile(text, "chapter.md", chapterFallback());
  } catch {
    throw new ContinuationTokenError("corrupt");
  }
  check(parsed.meta.id === expectation.identity.chapterId && parsed.meta.version === expectation.identity.version,
    "external-mismatch");
  checkBody(parsed.content, expectation);
  return parsed.content;
}

async function validateHistorical(text: string, expectation: z.infer<typeof expectationSchema>): Promise<string> {
  let envelope: ReturnType<typeof readHistoryEnvelope>;
  try {
    envelope = readHistoryEnvelope(text);
  } catch {
    throw new ContinuationTokenError("corrupt");
  }
  const meta = historyMetaSchema.safeParse(envelope.metadata);
  check(meta.success, "corrupt");
  check(meta.data.bookId === expectation.identity.bookId && meta.data.chapterId === expectation.identity.chapterId,
    "external-mismatch");
  // The historical sourceHash is retained metadata binding this record to the planned identity;
  // it is not a fresh hash of unavailable old chapter-file bytes, and proves nothing on its own.
  check(meta.data.sourceVersion === expectation.identity.version && meta.data.sourceHash === expectation.identity.hash,
    "external-mismatch");
  check(await sha256Hex(new TextEncoder().encode(envelope.content)) === meta.data.bodyHash, "corrupt");
  checkBody(envelope.content, expectation);
  return envelope.content;
}

interface RawSourceInput { readonly kind: "current" | "historical"; readonly sourceId: string; readonly rawBytes: Uint8Array }

function parseRawSource(value: unknown): RawSourceInput {
  const entry = plainRecord(value, ["kind", "sourceId", "rawBytes"]);
  check(entry.kind === "current" || entry.kind === "historical",
    typeof entry.kind === "string" ? "unsupported" : "corrupt");
  check(idSchema.safeParse(entry.sourceId).success, "corrupt");
  check(entry.rawBytes instanceof Uint8Array, "corrupt");
  return entry as unknown as RawSourceInput;
}

/**
 * Validate explicitly chosen raw source files against retained source expectations, before any
 * planning. Current files must hash to the retained raw-file hash and parse to the retained
 * chapter/version with the exact full body; historical 032 records must bind their metadata
 * identity and body hash to the same body. Bounds are checked before any file is decoded or
 * hashed. A substituted, missing, extra or unverifiable source is a bounded refusal.
 */
export async function validateContinuationSources(expectationsInput: unknown, inputsInput: unknown): Promise<ContinuationSourceValidation> {
  try {
    check(Array.isArray(expectationsInput) && isReviewData(expectationsInput), "corrupt");
    const expectations = z.array(expectationSchema).parse(expectationsInput);
    check(new Set(expectations.map((entry) => entry.sourceId)).size === expectations.length, "corrupt");
    check(Array.isArray(inputsInput) && Object.getPrototypeOf(inputsInput) === Array.prototype, "corrupt");
    const inputs = inputsInput.map((value) => parseRawSource(value));
    // Bounds precede decoding, hashing and identity work, counted per supplied distinct file.
    let total = 0;
    for (const input of inputs) {
      check(input.rawBytes.byteLength <= CONTINUATION_REPLAN_SOURCE_LIMITS.fileBytes, "too-large");
      total += input.rawBytes.byteLength;
      check(total <= CONTINUATION_REPLAN_SOURCE_LIMITS.totalBytes, "too-large");
    }
    const byId = new Map<string, RawSourceInput>();
    for (const input of inputs) {
      check(!byId.has(input.sourceId), "corrupt");
      byId.set(input.sourceId, input);
    }
    for (const expectation of expectations) check(byId.has(expectation.sourceId), "external-unavailable");
    for (const input of inputs) check(expectations.some((entry) => entry.sourceId === input.sourceId), "corrupt");
    const sources: ValidatedContinuationSource[] = [];
    for (const expectation of expectations) {
      const input = byId.get(expectation.sourceId);
      check(input, "external-unavailable");
      // Snapshot the caller-owned bytes before the first await can let them change.
      const bytes = new Uint8Array(input.rawBytes);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ContinuationTokenError("corrupt");
      }
      const body = input.kind === "current"
        ? await validateCurrent(bytes, text, expectation)
        : await validateHistorical(text, expectation);
      sources.push({ sourceId: expectation.sourceId, identity: { ...expectation.identity }, kind: input.kind, body });
    }
    return freeze({ status: "validated" as const, sources });
  } catch (error) {
    return refused(errorCode(error));
  }
}

function expectationsFromRoot(rootValue: unknown): { expectations: ContinuationSourceExpectation[]; root: ObjectValue } {
  const root = object(rootValue);
  check(Array.isArray(root.sources) && root.sources.length > 0, "corrupt");
  const expectations = root.sources.map((value) => {
    const source = object(value);
    check(Array.isArray(source.segments), "corrupt");
    const segments = source.segments.map((segmentValue) => {
      const segment = object(segmentValue);
      return { start: segment.start, end: segment.end, startLine: segment.startLine };
    });
    const parsed = expectationSchema.parse({ sourceId: source.sourceId, identity: source.identity,
      bodyLength: source.bodyLength, segments });
    return parsed;
  });
  return { expectations, root };
}

function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new ContinuationTokenError("corrupt");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}

/** Derive one planner candidate input from retained content and validated full bodies. */
function replanInput(root: ObjectValue, sources: readonly ValidatedContinuationSource[],
  prompt: string, priorFeedback: unknown): unknown {
  check(root.operation === "full-book-review-plan", "corrupt");
  check(Array.isArray(root.stages) && root.stages.length > 0, "corrupt");
  const retainedSources = root.sources as ObjectValue[];
  let plannedAt: unknown;
  const plannerSources = retainedSources.map((retained, index) => {
    const validated = sources[index];
    check(validated && retained.sourceId === validated.sourceId, "corrupt");
    check(canonicalJson(retained.identity) === canonicalJson(validated.identity), "external-mismatch");
    if (plannedAt === undefined) plannedAt = retained.capturedAt;
    check(retained.capturedAt === plannedAt, "corrupt");
    const segments = retained.segments as ObjectValue[];
    return { sourceId: validated.sourceId, saved: { ...validated.identity, body: validated.body },
      bookTitle: retained.bookTitle, title: retained.title, position: retained.position,
      ranges: segments.map((segment) => ({ start: segment.start, end: segment.end })) };
  });
  let destination: unknown;
  let environment: unknown;
  const books: ObjectValue[] = [];
  const bookById = new Map<string, string>();
  for (const stageValue of root.stages as ObjectValue[]) {
    const envelope = object(stageValue.envelope);
    check(envelope.contractVersion === 1 && envelope.kind === "reader-review", "corrupt");
    check(envelope.capturedAt === plannedAt, "corrupt");
    check(canonicalJson(envelope.profile) === canonicalJson(root.profile), "corrupt");
    if (destination === undefined) { destination = envelope.destination; environment = envelope.environment; }
    check(canonicalJson(envelope.destination) === canonicalJson(destination) &&
      canonicalJson(envelope.environment) === canonicalJson(environment), "corrupt");
    check(Array.isArray(envelope.books), "corrupt");
    for (const bookValue of envelope.books as ObjectValue[]) {
      const book = object(bookValue);
      check(typeof book.bookId === "string", "corrupt");
      const seen = bookById.get(book.bookId);
      if (seen === undefined) { bookById.set(book.bookId, canonicalJson(book)); books.push(book); }
      else check(seen === canonicalJson(book), "corrupt");
    }
  }
  return { operation: "plan-full-book-review", campaignId: root.campaignId, ownerBookId: root.ownerBookId,
    plannedAt, taxonomyVersion: root.taxonomyVersion, categories: root.categories, profile: root.profile,
    request: { destination, environment, books, prompt, priorFeedback }, sources: plannerSources, policy: root.policy };
}

/**
 * Replan a retained continuation whose recorded semantics are current or compatibly differing.
 * The supplied base prompt and prior feedback are explicit planner inputs, never recovered by
 * guessing; the supplied raw sources are validated before the planner runs. The fresh planner
 * result must then pass the codec's complete canonical comparison against the retained wire, or
 * the result refuses. Only that fresh result is returned for later planner APIs.
 */
export async function replanCampaignContinuation(manifestBytes: Uint8Array, readSegment: SegmentReader,
  requestInput: unknown): Promise<CampaignContinuationReplanResult> {
  const compatibility = inspectCampaignContinuationCompatibility(manifestBytes);
  if (compatibility.decision === "refuse") return refused(compatibility.code);
  try {
    check(typeof readSegment === "function", "corrupt");
    const request = plainRecord(requestInput, ["sources", "prompt", "priorFeedback"]);
    check(typeof request.prompt === "string", "corrupt");
    assertReviewData(request.priorFeedback);
    const recorded = readRecordedManifest(manifestBytes);
    // The wire reader remains closed to the current label; a compatibly differing label is
    // dispatched here by normalizing only that one field for local comparison. No content,
    // segment or digest field is altered, and the fresh plan must still match completely.
    const comparisonBytes = compatibility.decision === "replan-required"
      ? encodeCanonicalJson({ ...recorded.manifest, plannerSemantics: CAMPAIGN_PLANNER_SEMANTICS },
          { maxBytes: CONTINUATION_WIRE_LIMITS.manifestBytes })
      : manifestBytes;
    const wire = await inspectContinuationWire(comparisonBytes,
      { ownerBookId: recorded.ownerBookId, campaignId: recorded.campaignId }, readSegment);
    const planStream = wire.streams.find((stream) => stream.stream === "plan");
    check(planStream, "corrupt");
    const { expectations, root } = expectationsFromRoot(planStream.root);
    check(root.campaignId === recorded.campaignId && root.ownerBookId === recorded.ownerBookId, "corrupt");
    const validated = await validateContinuationSources(expectations, request.sources);
    if (validated.status === "refused") return validated;
    const input = replanInput(root, validated.sources, request.prompt, request.priorFeedback);
    const planned = await planReviewCampaign(input);
    if (planned.status === "refused") return refused(planned.code);
    const fresh = planned.plan;
    requireCampaignPlan(fresh);
    const { digest: _digest, ...content } = fresh;
    const matched = await compareContinuationWithLocalPlan(comparisonBytes, fresh, readSegment,
      ({ path }) => valueAt(content, path));
    return { status: "matched-local-plan-only", plan: fresh, untrustedPlanContent: matched.untrustedPlanContent,
      checkpoint: matched.checkpoint, plannedUnionDigest: matched.plannedUnionDigest,
      recordedPlannerSemantics: recorded.plannerSemantics,
      compatibility: compatibility.decision === "replan-required" ? "replan-required" : "serve-unchanged" };
  } catch (error) {
    return refused(errorCode(error));
  }
}
