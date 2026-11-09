import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { recordIdSchema, recordTimestampSchema } from "./record-format";
import { bytesEqual, canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson, visitCanonicalJsonBytes } from "./record-json";
import { inspectCheckpointForCampaign } from "./campaign-continuation-checkpoint";
import { measureProvenancedCampaign } from "./campaign-continuation-metrics";
import { CONTINUATION_SEGMENT_LIMITS, packContinuationTokenStreams, preflightContinuationPacking, type PackedContinuationStream } from "./campaign-continuation-segments";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, tokenizeCampaignPlan, tokenizeCheckpointValue } from "./campaign-continuation-tokens";
import { CONTINUATION_WIRE_LIMITS, inspectContinuationWire, readContinuationPublicationIntent, type ContinuationStreamDescriptor } from "./campaign-continuation-wire";

type ObjectValue = Record<string, unknown>;
type SegmentReader = (id: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>;

export interface ContinuationBuildOptions {
  operationId: string;
  createdAt: string;
  updatedAt: string;
  checkpoint: unknown | null;
  /** A revision requires the prior local plan and all referenced prior bytes. */
  previous?: { manifestBytes: Uint8Array; plan: CampaignPlan; readSegment: SegmentReader };
  /** Additional loose fields; known members and closed controls cannot be supplied here. */
  manifestUnknown?: unknown;
  countsUnknown?: unknown;
  intentUnknown?: unknown;
}

const MANIFEST_KEYS = ["schemaVersion", "kind", "owner", "id", "revision", "base", "createdAt", "updatedAt", "publicationId",
  "plannerSemantics", "planDigest", "plan", "checkpoint", "counts", "plannedUnionDigest", "segmentCount", "segmentBytes", "tokenCount"];
const COUNT_KEYS = ["sources", "selectedSpans", "stages", "rangeStages", "synthesisStages", "dependencyEdges", "selectedUtf16", "selectedUtf8", "resolvedPlanBytes", "holes"];
const INTENT_KEYS = ["schemaVersion", "kind", "owner", "id", "revision", "campaignId", "createdAt", "expectedBase", "candidate"];
const CHECKPOINT_KEYS = ["checkpointVersion", "owner", "campaignId", "planDigest", "capturedAt", "stages"];
const STAGE_KEYS = ["stageId", "receipt"];
const RECEIPT_KEYS = ["status", "completedCategories", "at", "actualScopeDigest", "report"];

function check(condition: unknown, code: "corrupt" | "unsupported" | "too-large" = "corrupt"): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}
function object(value: unknown): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as ObjectValue;
}
function loose(value: ObjectValue, known: readonly string[]): ObjectValue {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)));
}
function hasUnknown(value: ObjectValue, known: readonly string[]): boolean {
  return Object.keys(value).some((key) => !known.includes(key));
}
// Inputs here have already passed the strict JSON visitor, so direct own-value comparison is safe.
// Compare without constructing a second canonical copy of potentially large loose values.
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]));
  }
  const a = left as ObjectValue;
  const b = right as ObjectValue;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function mergeUnknown(previous: ObjectValue, next: ObjectValue, known: readonly string[]): ObjectValue {
  const oldFields = loose(previous, known);
  const newFields = loose(next, known);
  for (const key of Object.keys(newFields)) {
    if (Object.hasOwn(oldFields, key)) check(sameJson(oldFields[key], newFields[key]), "unsupported");
  }
  return { ...oldFields, ...newFields };
}
function extra(value: unknown, known: readonly string[], limit: number): ObjectValue {
  if (value === undefined) return {};
  visitCanonicalJsonBytes(value, limit);
  const detached = object(decodeStrictJsonBytes(encodeCanonicalJson(value, { maxBytes: limit }), { maxBytes: limit }));
  check(!Object.keys(detached).some((key) => known.includes(key)), "unsupported");
  return detached;
}
function optionObject(value: unknown, required: readonly string[], optional: readonly string[]): ObjectValue {
  const result = object(value);
  check(Object.getPrototypeOf(result) === Object.prototype || Object.getPrototypeOf(result) === null);
  for (const key of Reflect.ownKeys(result)) {
    check(typeof key === "string" && [...required, ...optional].includes(key), "unsupported");
    const property = Object.getOwnPropertyDescriptor(result, key);
    check(property && "value" in property && property.enumerable);
  }
  check(required.every((key) => Object.hasOwn(result, key)));
  return result;
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sameTokens(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((token, index) => canonicalJsonText(token) === canonicalJsonText(right[index]));
}
function boundedDocument(value: unknown, limit: number): Uint8Array {
  visitCanonicalJsonBytes(value, limit);
  return encodeCanonicalJson(value, { maxBytes: limit });
}
function descriptor(stream: PackedContinuationStream, contentDigest: string): ContinuationStreamDescriptor {
  return { stream: stream.stream, tokenCount: stream.tokenCount, segmentBytes: stream.segmentBytes, contentDigest,
    segments: stream.segments.map(({ reference }) => reference) };
}
function checkReusableSegments(segments: readonly { bytes: Uint8Array }[]): void {
  for (const [index, segment] of segments.entries()) {
    const document = object(decodeStrictJsonBytes(segment.bytes, { maxBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes }));
    check(bytesEqual(segment.bytes, boundedDocument(document, CONTINUATION_SEGMENT_LIMITS.documentBytes)));
    const next = segments[index + 1];
    if (!next) continue;
    const nextDocument = object(decodeStrictJsonBytes(next.bytes, { maxBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes }));
    check(Array.isArray(nextDocument.tokens) && nextDocument.tokens.length > 0);
    const nextBytes = visitCanonicalJsonBytes(nextDocument.tokens[0], CONTINUATION_TOKEN_LIMITS.tokenBytes);
    check(segment.bytes.length + 1 + nextBytes > CONTINUATION_SEGMENT_LIMITS.documentBytes);
  }
}
function checkpointHasUnknown(root: ObjectValue): boolean {
  if (hasUnknown(root, CHECKPOINT_KEYS)) return true;
  return (root.stages as unknown[]).some((value) => {
    const entry = object(value);
    return hasUnknown(entry, STAGE_KEYS) || (entry.receipt !== null && hasUnknown(object(entry.receipt), RECEIPT_KEYS));
  });
}
function carryCheckpoint(previous: ObjectValue, next: ObjectValue): ObjectValue {
  const oldStages = previous.stages as ObjectValue[];
  const newStages = next.stages as ObjectValue[];
  check(oldStages.length === newStages.length);
  const stages = newStages.map((entry, index) => {
    const old = oldStages[index];
    check(old && old.stageId === entry.stageId);
    let receipt = entry.receipt;
    if (old.receipt !== null) {
      const oldReceipt = object(old.receipt);
      if (receipt === null) check(!hasUnknown(oldReceipt, RECEIPT_KEYS), "unsupported");
      else receipt = { ...mergeUnknown(oldReceipt, object(receipt), RECEIPT_KEYS), ...object(receipt) };
    }
    return { ...mergeUnknown(old, entry, STAGE_KEYS), ...entry, receipt };
  });
  return { ...mergeUnknown(previous, next, CHECKPOINT_KEYS), ...next, stages };
}

/**
 * Build bounded, canonical in-memory candidate bytes. A revision is accepted only when its prior
 * wire matches the caller's independently local plan. Unknown data that cannot be mapped is refused.
 * This does not save, authorize, verify report files, validate source files or grant execution.
 */
export async function buildCampaignContinuation(plan: CampaignPlan, options: ContinuationBuildOptions) {
  requireCampaignPlan(plan);
  const input = optionObject(options, ["operationId", "createdAt", "updatedAt", "checkpoint"],
    ["previous", "manifestUnknown", "countsUnknown", "intentUnknown"]);
  check(recordIdSchema.max(160).safeParse(input.operationId).success);
  check(recordTimestampSchema.safeParse(input.createdAt).success && recordTimestampSchema.safeParse(input.updatedAt).success);
  const operationId = input.operationId as string;
  const createdAt = input.createdAt as string;
  const updatedAt = input.updatedAt as string;
  const manifestUnknown = extra(input.manifestUnknown, MANIFEST_KEYS, CONTINUATION_WIRE_LIMITS.manifestBytes);
  const countsUnknown = extra(input.countsUnknown, COUNT_KEYS, CONTINUATION_WIRE_LIMITS.manifestBytes);
  const intentUnknown = extra(input.intentUnknown, INTENT_KEYS, CONTINUATION_WIRE_LIMITS.intentBytes);
  // A checkpoint is caller-owned: preflight combined tokens and complete-document segment packing
  // before making its detached snapshot, and before the first await can allow the caller to change it.
  let projected = preflightContinuationPacking(plan, input.checkpoint);
  let checkpoint = input.checkpoint === null ? null : inspectCheckpointForCampaign(input.checkpoint, plan).checkpoint;
  let previous: { manifestBytes: Uint8Array; plan: CampaignPlan; readSegment: SegmentReader } | undefined;
  if (input.previous !== undefined) {
    const source = optionObject(input.previous, ["manifestBytes", "plan", "readSegment"], []);
    check(source.manifestBytes instanceof Uint8Array && source.manifestBytes.byteLength <= CONTINUATION_WIRE_LIMITS.manifestBytes, "too-large");
    check(typeof source.readSegment === "function");
    const oldPlan = source.plan as CampaignPlan;
    requireCampaignPlan(oldPlan);
    check(oldPlan.ownerBookId === plan.ownerBookId && oldPlan.campaignId === plan.campaignId);
    previous = { manifestBytes: new Uint8Array(source.manifestBytes), plan: oldPlan, readSegment: source.readSegment as SegmentReader };
  }

  const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
  const prior = previous ? await inspectContinuationWire(previous.manifestBytes, identity, previous.readSegment) : null;
  let revision = 1;
  let base: ObjectValue = { kind: "absent", revision: 0 };
  let inheritedManifest: ObjectValue = {};
  let inheritedCounts: ObjectValue = {};
  let oldCheckpointRoot: ObjectValue | null = null;
  if (prior && previous) {
    const old = prior.manifest;
    check(old.planDigest === previous.plan.digest && old.publicationId !== operationId && old.createdAt === createdAt);
    check(typeof old.revision === "number" && Number.isSafeInteger(old.revision) && old.revision < Number.MAX_SAFE_INTEGER);
    revision = old.revision + 1;
    base = { kind: "sha256", revision: old.revision, value: await hash(previous.manifestBytes) };
    inheritedManifest = mergeUnknown(old, manifestUnknown, MANIFEST_KEYS);
    inheritedCounts = mergeUnknown(object(old.counts), countsUnknown, COUNT_KEYS);
    const oldStream = prior.streams.find((stream) => stream.stream === "plan");
    check(oldStream);
    const oldTokens = await tokenizeCampaignPlan(previous.plan);
    const oldMetrics = await measureProvenancedCampaign(previous.plan);
    check(sameTokens(oldStream.tokens, oldTokens.tokens) && old.plannedUnionDigest === oldMetrics.plannedUnionDigest);
    for (const [key, value] of Object.entries(oldMetrics.counts)) check(object(old.counts)[key] === value);
    const oldCheckpoint = prior.streams.find((stream) => stream.stream === "checkpoint");
    if (oldCheckpoint) {
      oldCheckpointRoot = inspectCheckpointForCampaign(oldCheckpoint.root, previous.plan).checkpoint;
      if (previous.plan.digest !== plan.digest || checkpoint === null) check(!checkpointHasUnknown(oldCheckpointRoot), "unsupported");
      else {
        const carried = carryCheckpoint(oldCheckpointRoot, checkpoint);
        projected = preflightContinuationPacking(plan, carried);
        checkpoint = inspectCheckpointForCampaign(carried, plan).checkpoint;
      }
    }
  }

  // Before allocating new token streams or segments, substitute the exact sizes of any streams we
  // will reuse. Digest equality alone is insufficient: compare the complete local plan/checkpoint.
  const oldPlanStream = prior?.streams.find((stream) => stream.stream === "plan");
  const oldCheckpointStream = prior?.streams.find((stream) => stream.stream === "checkpoint");
  const reusePlan = !!(oldPlanStream && previous && sameJson(previous.plan, plan));
  const reuseCheckpoint = !!(oldCheckpointStream && oldCheckpointRoot && checkpoint && previous &&
    sameJson(previous.plan, plan) && sameJson(oldCheckpointRoot, checkpoint));
  for (const [old, reuse] of [[oldPlanStream, reusePlan], [oldCheckpointStream, reuseCheckpoint]] as const) {
    if (!old) continue;
    if (reuse) checkReusableSegments(old.segments);
    else check(!old.segments.some((segment) => segment.hasUnknownFields), "unsupported");
  }
  const reusedBytes = (stream: typeof oldPlanStream) => stream?.segments.reduce((sum, segment) => sum + segment.bytes.length, 0) ?? 0;
  const selectedCount = (reusePlan ? oldPlanStream?.segments.length ?? 0 : projected.planSegmentCount) +
    (reuseCheckpoint ? oldCheckpointStream?.segments.length ?? 0 : projected.checkpointSegmentCount);
  const selectedBytes = (reusePlan ? reusedBytes(oldPlanStream) : projected.planSegmentBytes) +
    (reuseCheckpoint ? reusedBytes(oldCheckpointStream) : projected.checkpointSegmentBytes);
  check(selectedCount <= CONTINUATION_SEGMENT_LIMITS.segments && selectedBytes <= CONTINUATION_SEGMENT_LIMITS.bytes &&
    projected.planTokens + projected.checkpointTokens <= CONTINUATION_TOKEN_LIMITS.tokens, "too-large");

  const planTokens = await tokenizeCampaignPlan(plan);
  check(planTokens.tokens.length === projected.planTokens);
  const checkpointTokens = checkpoint === null ? null : await tokenizeCheckpointValue(checkpoint, projected.planTokens);
  check((checkpointTokens?.tokens.length ?? 0) === projected.checkpointTokens);
  const metrics = await measureProvenancedCampaign(plan);
  check(metrics.counts.holes === planTokens.holes && metrics.counts.resolvedPlanBytes === planTokens.contentBytes);
  const packed = await packContinuationTokenStreams({ ...identity, planDigest: plan.digest, streams: [
    { stream: "plan", tokens: planTokens.tokens },
    ...(checkpointTokens ? [{ stream: "checkpoint" as const, tokens: checkpointTokens.tokens }] : [])
  ] });
  check(packed.reduce((sum, stream) => sum + stream.segments.length, 0) === projected.segmentCount &&
    packed.reduce((sum, stream) => sum + stream.segmentBytes, 0) === projected.segmentBytes);

  // Reuse only the streams already preflighted against their exact retained bytes.
  const selected = packed.map((stream): PackedContinuationStream => {
    const old = prior?.streams.find((entry) => entry.stream === stream.stream);
    const newTokens = stream.stream === "plan" ? planTokens.tokens : checkpointTokens?.tokens;
    const reuse = stream.stream === "plan" ? reusePlan : reuseCheckpoint;
    if (reuse && old && newTokens) {
      check(sameTokens(old.tokens, newTokens));
      return { stream: stream.stream, tokenCount: old.tokens.length,
        segmentBytes: old.segments.reduce((sum, segment) => sum + segment.bytes.length, 0), segments: old.segments };
    }
    return stream;
  });
  const planStream = selected.find((stream) => stream.stream === "plan");
  const checkpointStream = selected.find((stream) => stream.stream === "checkpoint");
  check(planStream);
  const segmentCount = selected.reduce((sum, stream) => sum + stream.segments.length, 0);
  const segmentBytes = selected.reduce((sum, stream) => sum + stream.segmentBytes, 0);
  const tokenCount = selected.reduce((sum, stream) => sum + stream.tokenCount, 0);
  check(segmentCount === selectedCount && segmentBytes === selectedBytes &&
    segmentCount <= CONTINUATION_SEGMENT_LIMITS.segments && segmentBytes <= CONTINUATION_SEGMENT_LIMITS.bytes &&
    tokenCount <= CONTINUATION_TOKEN_LIMITS.tokens, "too-large");
  const manifest = { ...inheritedManifest, ...manifestUnknown, schemaVersion: 2, kind: "review-campaign", owner: { bookId: plan.ownerBookId },
    id: plan.campaignId, revision, base, createdAt, updatedAt, publicationId: operationId, plannerSemantics: "review-campaign-planner-v1",
    planDigest: plan.digest, plan: descriptor(planStream, plan.digest),
    checkpoint: checkpointStream && checkpointTokens ? descriptor(checkpointStream, checkpointTokens.contentDigest) : null,
    counts: { ...inheritedCounts, ...countsUnknown, ...metrics.counts }, plannedUnionDigest: metrics.plannedUnionDigest,
    segmentCount, segmentBytes, tokenCount };
  const manifestBytes = boundedDocument(manifest, CONTINUATION_WIRE_LIMITS.manifestBytes);
  const candidateHash = await hash(manifestBytes);
  let binary = "";
  for (const byte of manifestBytes) binary += String.fromCharCode(byte);
  const intent = { ...intentUnknown, schemaVersion: 1, kind: "review-campaign-publication-intent", owner: { bookId: plan.ownerBookId },
    id: operationId, revision: 1, campaignId: plan.campaignId, createdAt: updatedAt, expectedBase: base,
    candidate: { encoding: "base64", bytes: manifestBytes.length, sha256: candidateHash, data: btoa(binary) } };
  const intentBytes = boundedDocument(intent, CONTINUATION_WIRE_LIMITS.intentBytes);
  const segments = selected.flatMap((stream) => stream.segments);
  const byId = new Map(segments.map((segment) => [segment.reference.id, segment.bytes]));
  const verified = await inspectContinuationWire(manifestBytes, identity, (id) => byId.get(id));
  const verifiedPlan = verified.streams.find((stream) => stream.stream === "plan");
  check(verifiedPlan && sameTokens(verifiedPlan.tokens, planTokens.tokens));
  await readContinuationPublicationIntent(intentBytes, { ...identity, operationId });
  check(bytesEqual(manifestBytes, boundedDocument(verified.manifest, CONTINUATION_WIRE_LIMITS.manifestBytes)));
  return { status: "candidate-only" as const, manifestBytes, intentBytes, segments,
    unresolvedReportCount: checkpoint === null ? 0 : inspectCheckpointForCampaign(checkpoint, plan).unresolvedReportCount };
}
