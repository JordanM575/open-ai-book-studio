import { bookIdSchema, hashSchema } from "./contract";
import { recordIdSchema, recordTimestampSchema } from "./record-format";
import { bytesEqual, canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson, visitCanonicalJsonBytes } from "./record-json";
import { CONTINUATION_SEGMENT_LIMITS, type ContinuationSegmentReference } from "./campaign-continuation-segments";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, inspectContinuationTokens } from "./campaign-continuation-tokens";

/** Pure wire inspection only; no result here grants publication or planner authority. */
export const CONTINUATION_WIRE_LIMITS = Object.freeze({ manifestBytes: 262_144, intentBytes: 1_048_576 });

type JsonObject = Record<string, unknown>;
type StreamName = "plan" | "checkpoint";
export interface ContinuationStreamDescriptor {
  stream: StreamName;
  tokenCount: number;
  segmentBytes: number;
  contentDigest: string;
  segments: ContinuationSegmentReference[];
}
export interface InspectedContinuationManifest extends JsonObject {
  owner: { bookId: string };
  id: string;
  publicationId: string;
  planDigest: string;
  base: JsonObject;
  plan: ContinuationStreamDescriptor;
  checkpoint: ContinuationStreamDescriptor | null;
}

function requireWire(condition: unknown, code: "corrupt" | "unsupported" | "too-large" | "external-unavailable"): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}
function object(value: unknown): JsonObject {
  requireWire(value !== null && typeof value === "object" && !Array.isArray(value), "corrupt");
  return value as JsonObject;
}
function closed(value: unknown, keys: readonly string[]): JsonObject {
  const result = object(value);
  const actual = Object.keys(result);
  requireWire(actual.length === keys.length && actual.every((key) => keys.includes(key)), "unsupported");
  return result;
}
function count(value: unknown, minimum = 0): asserts value is number {
  requireWire(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum, "corrupt");
}
function id(value: unknown): asserts value is string {
  requireWire(recordIdSchema.max(160).safeParse(value).success, "corrupt");
}
function hash(value: unknown): asserts value is string {
  requireWire(hashSchema.safeParse(value).success, "corrupt");
}
function timestamp(value: unknown): asserts value is string {
  requireWire(recordTimestampSchema.safeParse(value).success, "corrupt");
}
function owner(value: unknown, expected: string): void {
  const item = closed(value, ["bookId"]);
  requireWire(bookIdSchema.safeParse(item.bookId).success && item.bookId === expected, "corrupt");
}
function sum(a: number, b: number, limit: number): number {
  requireWire(b <= limit - a, "too-large");
  return a + b;
}
function parseBase(value: unknown, revision: number): JsonObject {
  const item = object(value);
  if (item.kind === "absent") {
    closed(item, ["kind", "revision"]);
    requireWire(revision === 1 && item.revision === 0, "corrupt");
  } else if (item.kind === "sha256") {
    closed(item, ["kind", "value", "revision"]);
    hash(item.value);
    requireWire(revision > 1 && item.revision === revision - 1, "corrupt");
  } else requireWire(false, "unsupported");
  return item;
}
function descriptor(value: unknown, stream: StreamName, ids: Set<string>): ContinuationStreamDescriptor {
  const item = closed(value, ["stream", "tokenCount", "segmentBytes", "contentDigest", "segments"]);
  requireWire(item.stream === stream, "corrupt");
  count(item.tokenCount, 1); count(item.segmentBytes, 1); hash(item.contentDigest);
  requireWire(Array.isArray(item.segments) && item.segments.length > 0 && item.segments.length <= CONTINUATION_SEGMENT_LIMITS.segments, "corrupt");
  let tokens = 0;
  let bytes = 0;
  const references: ContinuationSegmentReference[] = [];
  for (const [sequence, input] of item.segments.entries()) {
    const ref = closed(input, ["sequence", "firstToken", "tokenCount", "id", "revision", "bytes", "sha256"]);
    count(ref.tokenCount, 1); count(ref.bytes, 1); hash(ref.sha256);
    requireWire(typeof ref.id === "string" && /^s-[a-f0-9]{64}$/.test(ref.id) && !ids.has(ref.id), "corrupt");
    requireWire(ref.sequence === sequence && ref.firstToken === tokens && ref.revision === 1, "corrupt");
    requireWire(ref.bytes <= CONTINUATION_SEGMENT_LIMITS.documentBytes, "too-large");
    ids.add(ref.id);
    tokens = sum(tokens, ref.tokenCount, CONTINUATION_TOKEN_LIMITS.tokens);
    bytes = sum(bytes, ref.bytes, CONTINUATION_SEGMENT_LIMITS.bytes);
    references.push(ref as unknown as ContinuationSegmentReference);
  }
  requireWire(tokens === item.tokenCount && bytes === item.segmentBytes, "corrupt");
  return { stream, tokenCount: tokens, segmentBytes: bytes, contentDigest: item.contentDigest, segments: references };
}

/** Validates the manifest's wire shape and reference accounting, not its referenced contents. */
export function readContinuationManifest(bytes: Uint8Array, expected: { ownerBookId: string; campaignId: string }): InspectedContinuationManifest {
  requireWire(bytes instanceof Uint8Array && bytes.byteLength <= CONTINUATION_WIRE_LIMITS.manifestBytes, "too-large");
  requireWire(bookIdSchema.safeParse(expected.ownerBookId).success, "corrupt");
  id(expected.campaignId);
  const item = object(decodeStrictJsonBytes(bytes, { maxBytes: CONTINUATION_WIRE_LIMITS.manifestBytes }));
  requireWire(item.schemaVersion === 2 && item.kind === "review-campaign", "unsupported");
  owner(item.owner, expected.ownerBookId);
  id(item.id); id(item.publicationId);
  requireWire(item.id === expected.campaignId, "corrupt");
  count(item.revision, 1); parseBase(item.base, item.revision);
  timestamp(item.createdAt); timestamp(item.updatedAt);
  requireWire(item.createdAt <= item.updatedAt, "corrupt");
  requireWire(item.plannerSemantics === "review-campaign-planner-v1", "unsupported");
  hash(item.planDigest); hash(item.plannedUnionDigest);
  const counts = object(item.counts);
  for (const field of ["sources", "selectedSpans", "stages", "rangeStages", "synthesisStages", "dependencyEdges", "selectedUtf16", "selectedUtf8", "resolvedPlanBytes", "holes"]) count(counts[field]);
  requireWire((counts.resolvedPlanBytes as number) <= CONTINUATION_TOKEN_LIMITS.expandedBytes, "too-large");
  const ids = new Set<string>();
  const plan = descriptor(item.plan, "plan", ids);
  const checkpoint = item.checkpoint === null ? null : descriptor(item.checkpoint, "checkpoint", ids);
  requireWire(plan.contentDigest === item.planDigest, "corrupt");
  const segmentCount = sum(plan.segments.length, checkpoint?.segments.length ?? 0, CONTINUATION_SEGMENT_LIMITS.segments);
  const segmentBytes = sum(plan.segmentBytes, checkpoint?.segmentBytes ?? 0, CONTINUATION_SEGMENT_LIMITS.bytes);
  const tokenCount = sum(plan.tokenCount, checkpoint?.tokenCount ?? 0, CONTINUATION_TOKEN_LIMITS.tokens);
  requireWire(item.segmentCount === segmentCount && item.segmentBytes === segmentBytes && item.tokenCount === tokenCount, "corrupt");
  // Preserve loose fields, including own __proto__; closed descriptor fields were already checked.
  return item as InspectedContinuationManifest;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function canonicalDigest(value: unknown, limit: number): Promise<string> {
  const length = visitCanonicalJsonBytes(value, limit);
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(value, limit, (chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  return sha256(bytes);
}

/**
 * Read only the referenced bounded bytes. Callback IDs are validated portable segment IDs, not paths.
 * The returned trees are structural inspection, not validated plan/checkpoint semantics or provenance.
 */
export async function inspectContinuationWire(manifestBytes: Uint8Array, expected: { ownerBookId: string; campaignId: string },
  readSegment: (id: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>) {
  const identity = { ownerBookId: expected.ownerBookId, campaignId: expected.campaignId };
  const manifest = readContinuationManifest(manifestBytes, identity);
  const streams: { stream: StreamName; tokens: unknown[]; root: unknown; holes: ReturnType<typeof inspectContinuationTokens>["holes"];
    segments: { reference: ContinuationSegmentReference; bytes: Uint8Array; hasUnknownFields: boolean }[] }[] = [];
  for (const desc of [manifest.plan, manifest.checkpoint]) {
    if (!desc) continue;
    const tokens: unknown[] = [];
    const segments: { reference: ContinuationSegmentReference; bytes: Uint8Array; hasUnknownFields: boolean }[] = [];
    for (const ref of desc.segments) {
      const input = await readSegment(ref.id);
      requireWire(input !== undefined, "external-unavailable");
      requireWire(input instanceof Uint8Array && input.byteLength === ref.bytes, "corrupt");
      const raw = new Uint8Array(input);
      requireWire(await sha256(raw) === ref.sha256, "corrupt");
      const segment = object(decodeStrictJsonBytes(raw, { maxBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes }));
      requireWire(segment.schemaVersion === 1 && segment.kind === "review-campaign-segment", "unsupported");
      owner(segment.owner, identity.ownerBookId);
      requireWire(segment.id === ref.id && segment.campaignId === manifest.id && segment.planDigest === manifest.planDigest &&
        segment.stream === desc.stream && segment.revision === 1 && segment.sequence === ref.sequence &&
        segment.firstToken === ref.firstToken && Array.isArray(segment.tokens) && segment.tokens.length === ref.tokenCount, "corrupt");
      const { id: _id, ...body } = segment;
      requireWire(`s-${await canonicalDigest(body, CONTINUATION_SEGMENT_LIMITS.documentBytes)}` === ref.id, "corrupt");
      for (const token of segment.tokens as unknown[]) tokens.push(token);
      const known = ["schemaVersion", "kind", "owner", "campaignId", "planDigest", "stream", "revision", "sequence", "firstToken", "tokens", "id"];
      segments.push({ reference: ref, bytes: raw, hasUnknownFields: Object.keys(segment).some((key) => !known.includes(key)) });
    }
    requireWire(tokens.length === desc.tokenCount, "corrupt");
    const parsed = inspectContinuationTokens(tokens, desc.stream);
    if (desc.stream === "checkpoint") {
      requireWire(await canonicalDigest(parsed.root, CONTINUATION_TOKEN_LIMITS.expandedBytes) === desc.contentDigest, "corrupt");
    }
    streams.push({ stream: desc.stream, tokens, root: parsed.root, holes: parsed.holes, segments });
  }
  return { status: "structural-only" as const, manifest, streams };
}

/** Strictly validates an immutable publication intent and its canonical candidate manifest bytes. */
export async function readContinuationPublicationIntent(bytes: Uint8Array,
  expected: { ownerBookId: string; campaignId: string; operationId: string }) {
  const identity = { ownerBookId: expected.ownerBookId, campaignId: expected.campaignId, operationId: expected.operationId };
  requireWire(bytes instanceof Uint8Array && bytes.byteLength <= CONTINUATION_WIRE_LIMITS.intentBytes, "too-large");
  id(identity.operationId);
  const intent = object(decodeStrictJsonBytes(bytes, { maxBytes: CONTINUATION_WIRE_LIMITS.intentBytes }));
  requireWire(intent.schemaVersion === 1 && intent.kind === "review-campaign-publication-intent", "unsupported");
  owner(intent.owner, identity.ownerBookId);
  requireWire(intent.id === identity.operationId && intent.campaignId === identity.campaignId && intent.revision === 1, "corrupt");
  timestamp(intent.createdAt);
  const candidate = closed(intent.candidate, ["encoding", "bytes", "sha256", "data"]);
  requireWire(candidate.encoding === "base64", "unsupported");
  count(candidate.bytes, 1); hash(candidate.sha256);
  requireWire(candidate.bytes <= CONTINUATION_WIRE_LIMITS.manifestBytes, "too-large");
  requireWire(typeof candidate.data === "string" && candidate.data.length <= 349_528 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate.data), "corrupt");
  let binary: string;
  try { binary = atob(candidate.data); } catch { throw new ContinuationTokenError("corrupt"); }
  requireWire(btoa(binary) === candidate.data && binary.length === candidate.bytes, "corrupt");
  const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  requireWire(await sha256(raw) === candidate.sha256, "corrupt");
  const manifest = readContinuationManifest(raw, identity);
  requireWire(manifest.publicationId === identity.operationId && canonicalJsonText(intent.expectedBase) === canonicalJsonText(manifest.base), "corrupt");
  // Candidate bytes, unlike general readable manifest bytes, must be exactly canonical.
  requireWire(bytesEqual(raw, encodeCanonicalJson(manifest, { maxBytes: CONTINUATION_WIRE_LIMITS.manifestBytes })), "corrupt");
  return { status: "structural-only" as const, intent, manifest, candidateBytes: raw };
}
