import { bookIdSchema, hashSchema } from "./contract";
import { recordIdSchema } from "./record-format";
import { decodeStrictJsonBytes, encodeCanonicalJson, visitCanonicalJsonBytes } from "./record-json";
import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import {
  ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, inspectContinuationTokens, preflightCampaignPlanTokenCount,
  preflightCheckpointTokenCount, type ContinuationToken
} from "./campaign-continuation-tokens";

export const CONTINUATION_SEGMENT_LIMITS = Object.freeze({ segments: 64, bytes: 33_554_432, documentBytes: 2_000_000 });

export interface ContinuationSegmentReference {
  readonly sequence: number;
  readonly firstToken: number;
  readonly tokenCount: number;
  readonly id: string;
  readonly revision: 1;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PackedContinuationStream {
  readonly stream: "plan" | "checkpoint";
  readonly tokenCount: number;
  readonly segmentBytes: number;
  readonly segments: readonly { readonly reference: ContinuationSegmentReference; readonly bytes: Uint8Array }[];
}

interface PendingSegment {
  stream: "plan" | "checkpoint";
  sequence: number;
  firstToken: number;
  expectedBytes: number;
  inputTokens: readonly unknown[];
  tokenCount: number;
  tokens: ContinuationToken[];
}

function requireSegment(condition: unknown, code: "corrupt" | "unsupported" | "too-large"): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}

function plainControl(value: unknown, names: readonly string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === names.length && keys.every((key) => {
    if (typeof key !== "string" || !names.includes(key)) return false;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return !!property && "value" in property && !!property.enumerable;
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Measure maximal complete-document packing before allocating either token stream or a checkpoint
 * snapshot. Hole digests have fixed width, so placeholder hashes have the exact serialized size.
 * This measures a new canonical candidate; callers selecting retained segments must substitute their
 * exact bytes and counts before allocating a new candidate.
 */
export function preflightContinuationPacking(plan: CampaignPlan, checkpoint: unknown | null) {
  requireCampaignPlan(plan);
  const common = { schemaVersion: 1 as const, kind: "review-campaign-segment" as const,
    owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId, planDigest: plan.digest, revision: 1 as const };
  let segmentCount = 0;
  let segmentBytes = 0;
  const writer = (stream: "plan" | "checkpoint") => {
    let sequence = 0;
    let currentBytes = 0;
    let currentTokens = 0;
    return (token: ContinuationToken, ordinal: number): void => {
      const tokenBytes = visitCanonicalJsonBytes(token, CONTINUATION_TOKEN_LIMITS.tokenBytes);
      if (currentTokens && currentBytes + 1 + tokenBytes > CONTINUATION_SEGMENT_LIMITS.documentBytes) {
        currentBytes = 0;
        currentTokens = 0;
      }
      if (!currentTokens) {
        requireSegment(segmentCount < CONTINUATION_SEGMENT_LIMITS.segments, "too-large");
        const header = { ...common, stream, sequence: sequence++, firstToken: ordinal,
          tokens: [], id: `s-${"0".repeat(64)}` };
        currentBytes = visitCanonicalJsonBytes(header, CONTINUATION_SEGMENT_LIMITS.documentBytes);
        requireSegment(currentBytes + tokenBytes <= CONTINUATION_SEGMENT_LIMITS.documentBytes, "too-large");
        requireSegment(currentBytes <= CONTINUATION_SEGMENT_LIMITS.bytes - segmentBytes, "too-large");
        segmentBytes += currentBytes;
        segmentCount++;
      }
      const addition = tokenBytes + (currentTokens ? 1 : 0);
      requireSegment(addition <= CONTINUATION_SEGMENT_LIMITS.bytes - segmentBytes, "too-large");
      currentBytes += addition;
      segmentBytes += addition;
      currentTokens++;
    };
  };
  const planTokens = preflightCampaignPlanTokenCount(plan, writer("plan"));
  const planSegmentCount = segmentCount;
  const planSegmentBytes = segmentBytes;
  const checkpointTokens = checkpoint === null ? 0 : preflightCheckpointTokenCount(checkpoint, planTokens, writer("checkpoint"));
  return { planTokens, checkpointTokens, segmentCount, segmentBytes, planSegmentCount, planSegmentBytes,
    checkpointSegmentCount: segmentCount - planSegmentCount, checkpointSegmentBytes: segmentBytes - planSegmentBytes };
}

/**
 * Packs already-tokenized streams only. This is not a manifest, checkpoint validator, segment
 * reader or publication API. A caller must still validate plan/checkpoint semantics and all
 * manifest bindings; these bytes alone grant no execution or persistence authority.
 */
export async function packContinuationTokenStreams(input: {
  ownerBookId: string;
  campaignId: string;
  planDigest: string;
  streams: readonly { stream: "plan" | "checkpoint"; tokens: readonly unknown[] }[];
}): Promise<readonly PackedContinuationStream[]> {
  requireSegment(plainControl(input, ["ownerBookId", "campaignId", "planDigest", "streams"]), "corrupt");
  requireSegment(bookIdSchema.safeParse(input.ownerBookId).success, "corrupt");
  requireSegment(recordIdSchema.max(160).safeParse(input.campaignId).success, "corrupt");
  requireSegment(hashSchema.safeParse(input.planDigest).success, "corrupt");
  requireSegment(Array.isArray(input.streams) && input.streams.length > 0 && input.streams.length <= 2, "corrupt");
  requireSegment(Object.getPrototypeOf(input.streams) === Array.prototype &&
    Reflect.ownKeys(input.streams).length === input.streams.length + 1, "corrupt");
  const pending: PendingSegment[] = [];
  const streamInfos: { stream: "plan" | "checkpoint"; tokens: readonly unknown[]; tokenCount: number }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let totalTokens = 0;
  const owner = { bookId: input.ownerBookId };
  const common = { schemaVersion: 1 as const, kind: "review-campaign-segment" as const,
    owner, campaignId: input.campaignId, planDigest: input.planDigest, revision: 1 as const };
  for (let streamIndex = 0; streamIndex < input.streams.length; streamIndex++) {
    const property = Object.getOwnPropertyDescriptor(input.streams, String(streamIndex));
    requireSegment(property && "value" in property && property.enumerable, "corrupt");
    const source: (typeof input.streams)[number] = property.value;
    requireSegment(plainControl(source, ["stream", "tokens"]), "corrupt");
    requireSegment(source.stream === "plan" || source.stream === "checkpoint", "unsupported");
    requireSegment(!seen.has(source.stream), "corrupt");
    seen.add(source.stream);
    requireSegment(Array.isArray(source.tokens), "corrupt");
    // First measure *both* streams and every complete header. No token tree or token snapshots are
    // allocated until the combined count and byte budgets have passed.
    requireSegment(source.tokens.length <= CONTINUATION_TOKEN_LIMITS.tokens - totalTokens, "too-large");
    totalTokens += source.tokens.length;
    streamInfos.push({ stream: source.stream, tokens: source.tokens, tokenCount: source.tokens.length });
    let current: PendingSegment | undefined;
    let sequence = 0;
    for (let index = 0; index < source.tokens.length; index++) {
      const property = Object.getOwnPropertyDescriptor(source.tokens, String(index));
      requireSegment(property && "value" in property && property.enumerable, "corrupt");
      const original: unknown = property.value;
      const tokenBytes = visitCanonicalJsonBytes(original, CONTINUATION_TOKEN_LIMITS.tokenBytes);
      if (current && current.expectedBytes + 1 + tokenBytes > CONTINUATION_SEGMENT_LIMITS.documentBytes) current = undefined;
      if (!current) {
        requireSegment(pending.length < CONTINUATION_SEGMENT_LIMITS.segments, "too-large");
        // The ID has a fixed 66-byte ASCII spelling. Measure the actual complete header including it.
        const header = { ...common, stream: source.stream, sequence, firstToken: index,
          tokens: [], id: `s-${"0".repeat(64)}` };
        const headerBytes = visitCanonicalJsonBytes(header, CONTINUATION_SEGMENT_LIMITS.documentBytes);
        requireSegment(headerBytes + tokenBytes <= CONTINUATION_SEGMENT_LIMITS.documentBytes, "too-large");
        requireSegment(headerBytes <= CONTINUATION_SEGMENT_LIMITS.bytes - totalBytes, "too-large");
        totalBytes += headerBytes;
        current = { stream: source.stream, sequence: sequence++, firstToken: index, expectedBytes: headerBytes,
          inputTokens: source.tokens, tokenCount: 0, tokens: [] };
        pending.push(current);
      }
      const addition = tokenBytes + (current.tokenCount ? 1 : 0);
      requireSegment(addition <= CONTINUATION_SEGMENT_LIMITS.bytes - totalBytes, "too-large");
      totalBytes += addition;
      current.expectedBytes += addition;
      current.tokenCount++;
    }
  }
  for (const stream of streamInfos) inspectContinuationTokens(stream.tokens, stream.stream);
  for (const item of pending) {
    for (let index = item.firstToken; index < item.firstToken + item.tokenCount; index++) {
      // Detach each bounded token before the first asynchronous digest. There are no callbacks or
      // awaits between aggregate measurement, grammar validation and this snapshot.
      const original = Object.getOwnPropertyDescriptor(item.inputTokens, String(index))?.value as unknown;
      const bytes = encodeCanonicalJson(original, { maxBytes: CONTINUATION_TOKEN_LIMITS.tokenBytes });
      item.tokens.push(decodeStrictJsonBytes(bytes) as ContinuationToken);
    }
  }
  const results: PackedContinuationStream[] = [];
  for (const stream of streamInfos) {
    const segments: { reference: ContinuationSegmentReference; bytes: Uint8Array }[] = [];
    let segmentBytes = 0;
    for (const item of pending.filter((entry) => entry.stream === stream.stream)) {
      const body = { ...common, stream: item.stream, sequence: item.sequence, firstToken: item.firstToken, tokens: item.tokens };
      const bodyBytes = encodeCanonicalJson(body, { maxBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes });
      const id = `s-${await sha256(bodyBytes)}`;
      const bytes = encodeCanonicalJson({ ...body, id }, { maxBytes: CONTINUATION_SEGMENT_LIMITS.documentBytes });
      requireSegment(bytes.length === item.expectedBytes, "corrupt");
      const reference: ContinuationSegmentReference = { sequence: item.sequence, firstToken: item.firstToken,
        tokenCount: item.tokens.length, id, revision: 1, bytes: bytes.length, sha256: await sha256(bytes) };
      segmentBytes += bytes.length;
      segments.push({ reference, bytes });
    }
    results.push({ stream: stream.stream, tokenCount: stream.tokenCount, segmentBytes, segments });
  }
  return results;
}
