import { bookIdSchema, hashSchema } from "./contract";
import { recordIdSchema, recordTimestampSchema } from "./record-format";
import { decodeStrictJsonBytes, encodeCanonicalJson } from "./record-json";
import { ContinuationTokenError } from "./campaign-continuation-tokens";
import { CONTINUATION_GROUP_LIMITS } from "./campaign-continuation-group";
import { historyMetaSchema, readHistoryEnvelope, HistoryError } from "../library/history";

/**
 * Pure wire helpers for the fixed-history group move (039 T014/T015, D-201
 * format sections 5 and 7.3, seam 5).
 *
 * The fixed-history group is the preserved history sidecar set belonging to a
 * book's continuation: the book's entire 032 chapter-history tree
 * (`books/<owner>/history/`) together with the campaign's manifest, segment
 * directory and publication-intent directory. It moves between the active
 * reviews/history locations and
 * `.studio/trash/<owner>/reviews/campaign-<groupId>/` under one immutable
 * `review-campaign-fixed-history-intent`.
 *
 * Differences from the seam-4 campaign group (format section 7.3), stated here
 * so readers do not conflate the two:
 * - Membership: four fixed components, not three. `history` (the whole
 *   `history/` directory tree) is added beside `segments`,
 *   `publication-intents` and `manifest`. The history tree is book-scoped, so
 *   one move carries every chapter's preserved snapshots/safety/intents for
 *   the owner book; the other three components stay campaign-scoped.
 * - Ordering: `history` moves first, then `segments`, then
 *   `publication-intents`, then `manifest` last. The manifest-last guarantee
 *   of section 7.3 is preserved; history-first keeps the preserved source
 *   material's move ahead of the segment moves it may be needed to replan.
 * - Dispatch: two-level. The manifest dispatches on its recorded
 *   `plannerSemantics` exactly as seam 4 (current label served, compatibly
 *   differing label only through a local normalized comparison copy, stored
 *   bytes never altered, future/unknown refused). Every history record
 *   additionally dispatches on its own `schemaVersion`/`kind`/identity:
 *   schema 1 `snapshot`/`safety`/`intent` records naming the caller owner and
 *   their directory chapter, with a verifying body hash, are movable
 *   byte-identically; a future schema, unknown kind, foreign identity or
 *   divergent body refuses before any move. History bytes are never
 *   re-encoded or normalized.
 *
 * This leaf reads and writes no files. It validates the immutable move intent
 * and single history records from already-read bytes. Storage, inventories,
 * moves and wire verification stay with `CampaignContinuationStore`, which
 * reuses the seam-4 inventory/wire machinery instead of duplicating it here.
 * Nothing here grants execution authority or rewrites retained bytes:
 * supported unknown fields survive because intent and history bytes are never
 * re-encoded from a lossy projection.
 */

export const CONTINUATION_FIXED_HISTORY_LIMITS = CONTINUATION_GROUP_LIMITS;

export type ContinuationFixedHistoryAction = "trash" | "restore";
export type ContinuationFixedHistoryLocation = "active" | "trash";
export type ContinuationFixedHistoryComponentName =
  | "history" | "segments" | "publication-intents" | "manifest";

/** Fixed component order for the fixed-history move: history first, manifest last. */
export const CONTINUATION_FIXED_HISTORY_COMPONENT_ORDER: readonly ContinuationFixedHistoryComponentName[] =
  Object.freeze(["history", "segments", "publication-intents", "manifest"] as const);

export interface ContinuationFixedHistoryComponent {
  name: ContinuationFixedHistoryComponentName;
  type: "file" | "directory";
  sourceLocation: ContinuationFixedHistoryLocation;
  destinationLocation: ContinuationFixedHistoryLocation;
  entries: number;
  bytes: number;
  inventoryDigest: string;
}

function check(condition: unknown, code: "corrupt" | "unsupported" | "too-large"): asserts condition {
  if (!condition) throw new ContinuationTokenError(code);
}

function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "corrupt");
  return value as Record<string, unknown>;
}

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  const actual = Object.keys(result);
  check(actual.length === keys.length && actual.every((key) => keys.includes(key)), "unsupported");
  return result;
}

function count(value: unknown, minimum = 0): asserts value is number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum, "corrupt");
}

/** Validate the four fixed components of a fixed-history move intent. */
export function validateContinuationFixedHistoryComponents(
  value: unknown, action: ContinuationFixedHistoryAction
): ContinuationFixedHistoryComponent[] {
  check(Array.isArray(value) && value.length === 4, "corrupt");
  const expectedSource: ContinuationFixedHistoryLocation = action === "trash" ? "active" : "trash";
  const expectedDestination: ContinuationFixedHistoryLocation = action === "trash" ? "trash" : "active";
  const components: ContinuationFixedHistoryComponent[] = [];
  for (const [index, raw] of value.entries()) {
    const item = closed(raw, ["name", "type", "sourceLocation", "destinationLocation", "entries", "bytes", "inventoryDigest"]);
    const name = CONTINUATION_FIXED_HISTORY_COMPONENT_ORDER[index];
    check(item.name === name, "corrupt");
    check(item.type === (name === "manifest" ? "file" : "directory"), "corrupt");
    check(item.sourceLocation === expectedSource && item.destinationLocation === expectedDestination, "corrupt");
    count(item.entries, 1);
    count(item.bytes, 0);
    check(hashSchema.safeParse(item.inventoryDigest).success, "corrupt");
    if (name === "manifest") check(item.entries === 1, "corrupt");
    components.push(item as unknown as ContinuationFixedHistoryComponent);
  }
  return components;
}

/**
 * Strictly validate an immutable fixed-history move intent. The root stays
 * loose so supported unknown fields survive; each component is a closed
 * control, exactly as for the seam-4 group intent.
 */
export function readContinuationFixedHistoryIntent(
  bytes: Uint8Array,
  expected: { ownerBookId: string; campaignId: string; operationId: string }
) {
  check(bytes instanceof Uint8Array && bytes.byteLength <= CONTINUATION_FIXED_HISTORY_LIMITS.intentBytes, "too-large");
  check(bookIdSchema.safeParse(expected.ownerBookId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(expected.campaignId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(expected.operationId).success, "corrupt");
  const intent = object(decodeStrictJsonBytes(bytes, { maxBytes: CONTINUATION_FIXED_HISTORY_LIMITS.intentBytes }));
  check(intent.schemaVersion === 1 && intent.kind === "review-campaign-fixed-history-intent", "unsupported");
  const owner = closed(intent.owner, ["bookId"]);
  check(owner.bookId === expected.ownerBookId, "corrupt");
  check(intent.id === expected.operationId && intent.campaignId === expected.campaignId && intent.revision === 1, "corrupt");
  check(intent.action === "trash" || intent.action === "restore", "unsupported");
  check(recordIdSchema.max(160).safeParse(intent.groupId).success, "corrupt");
  check(recordTimestampSchema.safeParse(intent.createdAt).success, "corrupt");
  const components = validateContinuationFixedHistoryComponents(intent.components, intent.action as ContinuationFixedHistoryAction);
  return { intent, components };
}

/** Canonical bytes for a new fixed-history move intent; known fields win over unknowns. */
export function buildContinuationFixedHistoryIntentBytes(input: {
  ownerBookId: string; campaignId: string; operationId: string; groupId: string;
  action: ContinuationFixedHistoryAction; createdAt: string;
  components: readonly ContinuationFixedHistoryComponent[];
  unknownFields?: Record<string, unknown>;
}): Uint8Array {
  check(bookIdSchema.safeParse(input.ownerBookId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.campaignId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.operationId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.groupId).success, "corrupt");
  check(recordTimestampSchema.safeParse(input.createdAt).success, "corrupt");
  const components = validateContinuationFixedHistoryComponents(input.components, input.action);
  const intent = {
    ...(input.unknownFields ?? {}),
    schemaVersion: 1, kind: "review-campaign-fixed-history-intent",
    owner: { bookId: input.ownerBookId }, id: input.operationId, revision: 1,
    campaignId: input.campaignId, action: input.action, groupId: input.groupId,
    createdAt: input.createdAt, components
  };
  const bytes = encodeCanonicalJson(intent, { maxBytes: CONTINUATION_FIXED_HISTORY_LIMITS.intentBytes });
  readContinuationFixedHistoryIntent(bytes, {
    ownerBookId: input.ownerBookId, campaignId: input.campaignId, operationId: input.operationId
  });
  return bytes;
}

/**
 * Dispatch one preserved history record from its exact bytes (032 format).
 * Movable only when the envelope parses, `schemaVersion` is 1, `kind` is a
 * known snapshot/safety/intent, the recorded book/chapter equal the caller's
 * owner and the directory chapter, and the canonical body hashes to
 * `bodyHash` (intents carry the empty body). A future schema or unknown kind
 * is `unsupported`; malformed, foreign or divergent bytes are `corrupt`.
 * The bytes are inspected, never re-encoded.
 */
export async function inspectFixedHistoryRecord(
  bytes: Uint8Array,
  expected: { ownerBookId: string; chapterId: string },
  sha256: (bytes: Uint8Array) => Promise<string>
): Promise<{ kind: string; id: string }> {
  check(bytes instanceof Uint8Array, "corrupt");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContinuationTokenError("corrupt");
  }
  let envelope: ReturnType<typeof readHistoryEnvelope>;
  try {
    envelope = readHistoryEnvelope(text);
  } catch (error) {
    if (error instanceof HistoryError && error.code === "newer-schema") {
      throw new ContinuationTokenError("unsupported");
    }
    throw new ContinuationTokenError("corrupt");
  }
  const metadata = envelope.metadata as Record<string, unknown> | null;
  check(metadata !== null && typeof metadata === "object" && !Array.isArray(metadata), "corrupt");
  if (typeof metadata.schemaVersion === "number" && metadata.schemaVersion > 1) {
    throw new ContinuationTokenError("unsupported");
  }
  const parsed = historyMetaSchema.safeParse(metadata);
  if (!parsed.success) {
    // A record that names a future schema is a version refusal, not corruption.
    if (typeof metadata.schemaVersion === "number" && metadata.schemaVersion > 1) {
      throw new ContinuationTokenError("unsupported");
    }
    throw new ContinuationTokenError("corrupt");
  }
  const meta = parsed.data;
  check(meta.bookId === expected.ownerBookId && meta.chapterId === expected.chapterId, "corrupt");
  const content = envelope.content;
  if (meta.kind === "intent") {
    check(content === "", "corrupt");
  }
  const digest = await sha256(new TextEncoder().encode(content));
  check(digest === meta.bodyHash, "corrupt");
  return { kind: meta.kind, id: meta.id };
}
