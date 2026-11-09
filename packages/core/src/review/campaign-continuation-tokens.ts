import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { ReviewRecordError } from "./record-error";
import { REVIEW_RECORD_DEPTH, visitCanonicalJsonBytes } from "./record-json";

/** Token-tree budgets, not a relaxation of the saved-record document boundary. */
export const CONTINUATION_TOKEN_LIMITS = Object.freeze({
  tokenBytes: 1_900_000,
  tokens: 1_000_000,
  expandedBytes: 134_217_728,
  depth: REVIEW_RECORD_DEPTH
});

export type ContinuationHoleKind = "source-text" | "stage-prompt" | "prior-feedback";
export type ContinuationPath = readonly (string | number)[];
export type ContinuationToken =
  | { t: "O" | "}" | "A" | "]" }
  | { t: "K"; value: string }
  | { t: "V"; value: null | boolean | number | string }
  | { t: "H"; kind: ContinuationHoleKind; bytes: number; digest: string };

export type ContinuationTokenErrorCode = "corrupt" | "unsupported" | "too-large" | "external-unavailable" | "external-mismatch";

/** Refusals in this token primitive do not assert that any files have been opened or written. */
export class ContinuationTokenError extends Error {
  constructor(readonly code: ContinuationTokenErrorCode) {
    super(`Campaign continuation token stream refused: ${code}.`);
    this.name = "ContinuationTokenError";
  }
}

function requireToken(condition: unknown, code: ContinuationTokenErrorCode): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}

function holeKind(path: ContinuationPath): ContinuationHoleKind | undefined {
  const index = (value: string | number | undefined) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (path.length === 5 && path[0] === "sources" && index(path[1]) && path[2] === "segments" && index(path[3]) && path[4] === "text") return "source-text";
  if (path.length === 8 && path[0] === "stages" && index(path[1]) && path[2] === "envelope" && path[3] === "sources" && index(path[4]) && path[5] === "segments" && index(path[6]) && path[7] === "text") return "source-text";
  if (path.length === 4 && path[0] === "stages" && index(path[1]) && path[2] === "envelope" && path[3] === "prompt") return "stage-prompt";
  if (path.length === 4 && path[0] === "stages" && index(path[1]) && path[2] === "envelope" && path[3] === "priorFeedback") return "prior-feedback";
  return undefined;
}

function properExternalType(kind: ContinuationHoleKind, value: unknown): boolean {
  return kind === "prior-feedback" ? Array.isArray(value) : typeof value === "string";
}

/** Measure first; only then allocate the complete canonical bytes required by Web Crypto. */
async function canonicalSnapshot(value: unknown, limit: number): Promise<{ bytes: Uint8Array; digest: string }> {
  const length = visitCanonicalJsonBytes(value, limit);
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(value, limit, (chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  requireToken(offset === length, "corrupt");
  const result = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { bytes, digest };
}

export interface TokenizedContinuation {
  readonly tokens: readonly ContinuationToken[];
  readonly holeBytes: number;
  readonly holes: number;
  readonly contentBytes: number;
  readonly contentDigest: string;
}

function preflight(root: unknown, stream: "plan" | "checkpoint", tokenLimit: number,
  onToken?: (token: ContinuationToken, ordinal: number) => void) {
  requireToken(Number.isSafeInteger(tokenLimit) && tokenLimit >= 0 && tokenLimit <= CONTINUATION_TOKEN_LIMITS.tokens, "corrupt");
  // Check the virtual value, every token, and every hole occurrence before allocating the complete
  // bytes for Web Crypto. In particular, an oversized scalar/key cannot hide in a smaller plan.
  visitCanonicalJsonBytes(root, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  let preflightTokens = 0;
  let preflightHoleBytes = 0;
  const check = (token: ContinuationToken): void => {
    requireToken(preflightTokens < tokenLimit, "too-large");
    visitCanonicalJsonBytes(token, CONTINUATION_TOKEN_LIMITS.tokenBytes);
    onToken?.(token, preflightTokens);
    preflightTokens++;
  };
  const preflight = (value: unknown, path: (string | number)[], depth: number): void => {
    requireToken(depth <= CONTINUATION_TOKEN_LIMITS.depth, "corrupt");
    const kind = stream === "plan" ? holeKind(path) : undefined;
    if (kind) {
      requireToken(properExternalType(kind, value), "corrupt");
      const bytes = visitCanonicalJsonBytes(value, CONTINUATION_TOKEN_LIMITS.expandedBytes - preflightHoleBytes);
      preflightHoleBytes += bytes;
      check({ t: "H", kind, bytes, digest: "0".repeat(64) });
    } else if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      check({ t: "V", value });
    } else {
      requireToken(typeof value === "object", "corrupt");
      if (Array.isArray(value)) {
        check({ t: "A" });
        for (let index = 0; index < value.length; index++) {
          path.push(index); preflight(value[index], path, depth + 1); path.pop();
        }
        check({ t: "]" });
      } else {
        check({ t: "O" });
        for (const key of Object.keys(value).sort()) {
          check({ t: "K", value: key });
          const property = Object.getOwnPropertyDescriptor(value, key);
          requireToken(property && "value" in property, "corrupt");
          path.push(key); preflight(property.value, path, depth + 1); path.pop();
        }
        check({ t: "}" });
      }
    }
  };
  preflight(root, [], 0);
  return { tokens: preflightTokens, holeBytes: preflightHoleBytes };
}

/** Count the actual plan tokens before making a checkpoint snapshot. This is not an encoding. */
export function preflightCampaignPlanTokenCount(plan: CampaignPlan,
  onToken?: (token: ContinuationToken, ordinal: number) => void): number {
  requireCampaignPlan(plan);
  const { digest: _digest, ...content } = plan;
  return preflight(content, "plan", CONTINUATION_TOKEN_LIMITS.tokens, onToken).tokens;
}

/** Count a checkpoint against the aggregate budget already consumed by the plan. */
export function preflightCheckpointTokenCount(value: unknown, planTokens: number,
  onToken?: (token: ContinuationToken, ordinal: number) => void): number {
  requireToken(Number.isSafeInteger(planTokens) && planTokens >= 0 && planTokens <= CONTINUATION_TOKEN_LIMITS.tokens, "corrupt");
  return preflight(value, "checkpoint", CONTINUATION_TOKEN_LIMITS.tokens - planTokens, onToken).tokens;
}

async function tokenize(root: unknown, stream: "plan" | "checkpoint", tokenLimit: number): Promise<TokenizedContinuation> {
  const checked = preflight(root, stream, tokenLimit);
  // Validate and bound the entire virtual value independently of the hole-occurrence budget.
  const content = await canonicalSnapshot(root, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  // Never traverse a caller-owned checkpoint after the asynchronous digest has yielded.
  const detached: unknown = JSON.parse(new TextDecoder().decode(content.bytes));
  const tokens: ContinuationToken[] = [];
  let holeBytes = 0;
  let holes = 0;
  const emit = (token: ContinuationToken): void => {
    requireToken(tokens.length < tokenLimit, "too-large");
    visitCanonicalJsonBytes(token, CONTINUATION_TOKEN_LIMITS.tokenBytes);
    tokens.push(token);
  };
  const walk = async (value: unknown, path: (string | number)[], depth: number): Promise<void> => {
    requireToken(depth <= CONTINUATION_TOKEN_LIMITS.depth, "corrupt");
    const kind = stream === "plan" ? holeKind(path) : undefined;
    if (kind) {
      requireToken(properExternalType(kind, value), "corrupt");
      const snapshot = await canonicalSnapshot(value, CONTINUATION_TOKEN_LIMITS.expandedBytes - holeBytes);
      holeBytes += snapshot.bytes.length;
      holes++;
      emit({ t: "H", kind, bytes: snapshot.bytes.length, digest: snapshot.digest });
      return;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      emit({ t: "V", value });
      return;
    }
    requireToken(typeof value === "object", "corrupt");
    if (Array.isArray(value)) {
      emit({ t: "A" });
      for (let index = 0; index < value.length; index++) {
        path.push(index);
        await walk(value[index], path, depth + 1);
        path.pop();
      }
      emit({ t: "]" });
    } else {
      emit({ t: "O" });
      for (const key of Object.keys(value).sort()) {
        emit({ t: "K", value: key });
        const property = Object.getOwnPropertyDescriptor(value, key);
        requireToken(property && "value" in property, "corrupt");
        path.push(key);
        await walk(property.value, path, depth + 1);
        path.pop();
      }
      emit({ t: "}" });
    }
  };
  await walk(detached, [], 0);
  requireToken(tokens.length === checked.tokens && holeBytes === checked.holeBytes, "corrupt");
  return { tokens, holeBytes, holes, contentBytes: content.bytes.length, contentDigest: content.digest };
}

/** Only an existing locally registered planner result may enter the plan-token encoder. */
export async function tokenizeCampaignPlan(plan: CampaignPlan): Promise<TokenizedContinuation> {
  requireCampaignPlan(plan);
  const { digest, ...content } = plan;
  const result = await tokenize(content, "plan", CONTINUATION_TOKEN_LIMITS.tokens);
  requireToken(result.contentDigest === digest, "corrupt");
  return result;
}

/** Token grammar only: the caller must separately validate checkpoint schema and plan binding. */
export async function tokenizeCheckpointValue(value: unknown, planTokens = 0): Promise<TokenizedContinuation> {
  requireToken(Number.isSafeInteger(planTokens) && planTokens >= 0 && planTokens <= CONTINUATION_TOKEN_LIMITS.tokens, "corrupt");
  return tokenize(value, "checkpoint", CONTINUATION_TOKEN_LIMITS.tokens - planTokens);
}

export interface InspectedContinuationHole {
  readonly path: ContinuationPath;
  readonly kind: ContinuationHoleKind;
  readonly bytes: number;
  readonly digest: string;
}

interface HoleSlot extends InspectedContinuationHole {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

function ownKeysExactly(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function readToken(input: unknown): ContinuationToken {
  visitCanonicalJsonBytes(input, CONTINUATION_TOKEN_LIMITS.tokenBytes);
  requireToken(input !== null && typeof input === "object" && !Array.isArray(input), "corrupt");
  const token = input as Record<string, unknown>;
  const tag = token.t;
  requireToken(typeof tag === "string", "corrupt");
  if (tag === "O" || tag === "}" || tag === "A" || tag === "]") {
    requireToken(ownKeysExactly(token, ["t"]), "unsupported");
    return { t: tag };
  }
  if (tag === "K") {
    requireToken(ownKeysExactly(token, ["t", "value"]), "unsupported");
    requireToken(typeof token.value === "string", "corrupt");
    return { t: "K", value: token.value };
  }
  if (tag === "V") {
    requireToken(ownKeysExactly(token, ["t", "value"]), "unsupported");
    requireToken(token.value === null || typeof token.value === "string" || typeof token.value === "boolean" || typeof token.value === "number", "corrupt");
    return { t: "V", value: token.value };
  }
  if (tag === "H") {
    requireToken(ownKeysExactly(token, ["t", "kind", "bytes", "digest"]), "unsupported");
    const { kind, bytes, digest } = token;
    requireToken(kind === "source-text" || kind === "stage-prompt" || kind === "prior-feedback", "unsupported");
    requireToken(typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0, "corrupt");
    requireToken(typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest), "corrupt");
    return { t: "H", kind, bytes, digest };
  }
  throw new ContinuationTokenError("unsupported");
}

function parseTokens(input: readonly unknown[], stream: "plan" | "checkpoint"): { root: unknown; slots: HoleSlot[]; holeBytes: number } {
  requireToken(stream === "plan" || stream === "checkpoint", "unsupported");
  requireToken(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype, "corrupt");
  requireToken(input.length <= CONTINUATION_TOKEN_LIMITS.tokens, "too-large");
  requireToken(Reflect.ownKeys(input).length === input.length + 1, "corrupt");
  let cursor = 0;
  let holeBytes = 0;
  const slots: HoleSlot[] = [];
  const next = (): ContinuationToken => {
    requireToken(cursor < input.length, "corrupt");
    const property = Object.getOwnPropertyDescriptor(input, String(cursor++));
    requireToken(property && "value" in property && property.enumerable, "corrupt");
    return readToken(property.value);
  };
  const value = (path: (string | number)[], depth: number, parent?: Record<string, unknown> | unknown[], key?: string | number): unknown => {
    requireToken(depth <= CONTINUATION_TOKEN_LIMITS.depth, "corrupt");
    const token = next();
    const expected = stream === "plan" ? holeKind(path) : undefined;
    if (expected) requireToken(token.t === "H" && token.kind === expected, "corrupt");
    if (token.t === "H") {
      requireToken(expected === token.kind && parent !== undefined && key !== undefined, "corrupt");
      requireToken(token.bytes <= CONTINUATION_TOKEN_LIMITS.expandedBytes - holeBytes, "too-large");
      holeBytes += token.bytes;
      slots.push({ path: [...path], kind: token.kind, bytes: token.bytes, digest: token.digest, parent, key });
      return { ...token };
    }
    if (token.t === "V") return token.value;
    if (token.t === "A") {
      const result: unknown[] = [];
      for (;;) {
        requireToken(cursor < input.length, "corrupt");
        const peek = readToken(Object.getOwnPropertyDescriptor(input, String(cursor))?.value);
        if (peek.t === "]") { next(); break; }
        const index = result.length;
        path.push(index);
        result.push(value(path, depth + 1, result, index));
        path.pop();
      }
      return result;
    }
    if (token.t === "O") {
      const result: Record<string, unknown> = {};
      let previous: string | undefined;
      for (;;) {
        const entry = next();
        if (entry.t === "}") break;
        requireToken(entry.t === "K" && (previous === undefined || previous < entry.value), "corrupt");
        previous = entry.value;
        path.push(entry.value);
        const child = value(path, depth + 1, result, entry.value);
        path.pop();
        Object.defineProperty(result, entry.value, { value: child, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    throw new ContinuationTokenError("corrupt");
  };
  const root = value([], 0);
  requireToken(cursor === input.length, "corrupt");
  return { root, slots, holeBytes };
}

/** Structural inspection only. Hole placeholders and the returned tree are not a validated plan. */
export function inspectContinuationTokens(input: readonly unknown[], stream: "plan" | "checkpoint") {
  const parsed = parseTokens(input, stream);
  return { status: "structural-only" as const, root: parsed.root, holeBytes: parsed.holeBytes,
    holes: parsed.slots.map(({ path, kind, bytes, digest }) => ({ path, kind, bytes, digest })) };
}

/**
 * Resolves only exact values supplied by the caller. This checks token structure and hole hashes,
 * not manifest/segment binding, plan semantics, checkpoint semantics or planner provenance.
 */
export async function resolveContinuationTokens(input: readonly unknown[], stream: "plan" | "checkpoint",
  resolver: (hole: InspectedContinuationHole) => unknown | Promise<unknown>) {
  const parsed = parseTokens(input, stream);
  // Measure the final canonical tree using the hole lengths before asking for or allocating any
  // external value. The temporary placeholders are ordinary canonical objects of known size.
  let projected = visitCanonicalJsonBytes(parsed.root, Number.MAX_SAFE_INTEGER);
  for (const slot of parsed.slots) {
    const placeholder = { t: "H", kind: slot.kind, bytes: slot.bytes, digest: slot.digest };
    projected += slot.bytes - visitCanonicalJsonBytes(placeholder, CONTINUATION_TOKEN_LIMITS.tokenBytes);
    requireToken(Number.isSafeInteger(projected) && projected >= 0, "too-large");
  }
  requireToken(projected <= CONTINUATION_TOKEN_LIMITS.expandedBytes, "too-large");
  for (const slot of parsed.slots) {
    const value = await resolver({ path: [...slot.path], kind: slot.kind, bytes: slot.bytes, digest: slot.digest });
    requireToken(value !== undefined, "external-unavailable");
    requireToken(properExternalType(slot.kind, value), "external-mismatch");
    let snapshot: { bytes: Uint8Array; digest: string };
    try {
      snapshot = await canonicalSnapshot(value, slot.bytes);
    } catch (error) {
      if (error instanceof ReviewRecordError) throw new ContinuationTokenError("external-mismatch");
      throw error;
    }
    requireToken(snapshot.bytes.length === slot.bytes && snapshot.digest === slot.digest, "external-mismatch");
    // The resolver's object can be mutable. Insert a detached copy of the exact hashed JSON bytes.
    const detached: unknown = JSON.parse(new TextDecoder().decode(snapshot.bytes));
    Object.defineProperty(slot.parent, slot.key, { value: detached, enumerable: true, writable: true, configurable: true });
  }
  const content = await canonicalSnapshot(parsed.root, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  requireToken(content.bytes.length === projected, "corrupt");
  return { status: "structural-only" as const, root: parsed.root, holes: parsed.slots.length,
    holeBytes: parsed.holeBytes, contentBytes: content.bytes.length, contentDigest: content.digest };
}
