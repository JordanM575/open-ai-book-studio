import { bookIdSchema, hashSchema } from "./contract";
import { recordIdSchema, recordTimestampSchema } from "./record-format";
import { decodeStrictJsonBytes, encodeCanonicalJson, visitCanonicalJsonBytes } from "./record-json";
import { ContinuationTokenError } from "./campaign-continuation-tokens";

/**
 * Pure wire helpers for campaign continuation group moves and cross-book report
 * references (039 T014/T015, D-201 format sections 5 and 7.3).
 *
 * This leaf reads and writes no files. It validates the immutable group-move
 * intent, canonicalises directory inventories and extracts checkpoint report
 * references from already-inspected structural roots. Storage, moves and report
 * file reads stay with `CampaignContinuationStore`, which reuses the checked
 * publication and recovery semantics instead of re-implementing them here.
 * Nothing here grants execution authority, adopts a foreign report, or rewrites
 * retained bytes: supported unknown fields survive because intent and inventory
 * bytes are never re-encoded from a lossy projection.
 */

export const CONTINUATION_GROUP_LIMITS = Object.freeze({
  /** Format section 1: each complete group-move intent, including unknown fields. */
  intentBytes: 1_048_576,
  /** Format section 1: one group move's full preflight across all three components. */
  entries: 65_536,
  fileBytes: 1_073_741_824,
  inventoryBytes: 16_777_216,
  /** Format section 1: each file read by the move is at most this large. */
  fileBytesEach: 2_500_000
});

export type ContinuationGroupAction = "trash" | "restore";
export type ContinuationGroupLocation = "active" | "trash";
export type ContinuationGroupComponentName = "segments" | "publication-intents" | "manifest";

/** Fixed component order required by format section 7.3. */
export const CONTINUATION_GROUP_COMPONENT_ORDER: readonly ContinuationGroupComponentName[] =
  Object.freeze(["segments", "publication-intents", "manifest"] as const);

export interface ContinuationGroupComponent {
  name: ContinuationGroupComponentName;
  type: "file" | "directory";
  sourceLocation: ContinuationGroupLocation;
  destinationLocation: ContinuationGroupLocation;
  entries: number;
  bytes: number;
  inventoryDigest: string;
}

export type ContinuationInventoryEntry =
  | { path: string[]; type: "directory" }
  | { path: string[]; type: "file"; bytes: number; sha256: string };

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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Canonical bytes of a value measured through the bounded visitor (no 2.5 MB record cap). */
export function canonicalInventoryBytes(value: unknown): Uint8Array {
  const length = visitCanonicalJsonBytes(value, CONTINUATION_GROUP_LIMITS.inventoryBytes);
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(value, CONTINUATION_GROUP_LIMITS.inventoryBytes, (chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes;
}

export async function continuationInventoryDigest(inventory: readonly ContinuationInventoryEntry[]): Promise<string> {
  return sha256(canonicalInventoryBytes(inventory));
}

/**
 * Component-by-component UTF-16 code-unit order, prefix before descendants
 * (format section 7.3). Returns a new sorted array; the input is not mutated.
 */
export function sortContinuationInventory(
  entries: readonly ContinuationInventoryEntry[]
): ContinuationInventoryEntry[] {
  const sorted = [...entries];
  sorted.sort((left, right) => {
    const a = left.path;
    const b = right.path;
    const shared = Math.min(a.length, b.length);
    for (let index = 0; index < shared; index++) {
      const x = a[index] as string;
      const y = b[index] as string;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return a.length - b.length;
  });
  return sorted;
}

/**
 * Validate one directory inventory against format section 7.3: the root entry,
 * sorted unique paths with plain components, checked file accounting, and the
 * per-operation scan budgets. Refuses rather than truncating.
 */
export function validateContinuationInventory(entries: readonly ContinuationInventoryEntry[]): {
  entries: number; bytes: number; inventoryBytes: number
} {
  check(Array.isArray(entries) && entries.length >= 1, "corrupt");
  check(entries.length <= CONTINUATION_GROUP_LIMITS.entries, "too-large");
  const root = entries[0];
  check(root !== undefined && root.type === "directory" && root.path.length === 0, "corrupt");
  const sorted = sortContinuationInventory(entries);
  for (let index = 0; index < entries.length; index++) {
    check(entries[index] === sorted[index] ||
      JSON.stringify(entries[index]) === JSON.stringify(sorted[index]), "corrupt");
  }
  const seen = new Set<string>();
  let bytes = 0;
  for (const entry of entries) {
    check(Array.isArray(entry.path), "corrupt");
    for (const part of entry.path) {
      check(typeof part === "string" && part.length > 0 && part !== "." && part !== ".." &&
        !part.includes("/") && !part.includes("\\"), "corrupt");
    }
    const key = JSON.stringify(entry.path);
    check(!seen.has(key), "corrupt");
    seen.add(key);
    if (entry.type === "file") {
      count(entry.bytes, 1);
      check(entry.bytes <= CONTINUATION_GROUP_LIMITS.fileBytesEach, "too-large");
      check(hashSchema.safeParse(entry.sha256).success, "corrupt");
      check(entry.bytes <= CONTINUATION_GROUP_LIMITS.fileBytes - bytes, "too-large");
      bytes += entry.bytes;
    } else {
      check(entry.type === "directory", "unsupported");
    }
  }
  const inventoryBytes = visitCanonicalJsonBytes(entries, CONTINUATION_GROUP_LIMITS.inventoryBytes);
  return { entries: entries.length, bytes, inventoryBytes };
}

/** Validate the three fixed components of a group-move intent. */
export function validateContinuationGroupComponents(
  value: unknown, action: ContinuationGroupAction
): ContinuationGroupComponent[] {
  check(Array.isArray(value) && value.length === 3, "corrupt");
  const expectedSource: ContinuationGroupLocation = action === "trash" ? "active" : "trash";
  const expectedDestination: ContinuationGroupLocation = action === "trash" ? "trash" : "active";
  const components: ContinuationGroupComponent[] = [];
  for (const [index, raw] of value.entries()) {
    const item = closed(raw, ["name", "type", "sourceLocation", "destinationLocation", "entries", "bytes", "inventoryDigest"]);
    const name = CONTINUATION_GROUP_COMPONENT_ORDER[index];
    check(item.name === name, "corrupt");
    check(item.type === (name === "manifest" ? "file" : "directory"), "corrupt");
    check(item.sourceLocation === expectedSource && item.destinationLocation === expectedDestination, "corrupt");
    count(item.entries, 1);
    count(item.bytes, 0);
    check(hashSchema.safeParse(item.inventoryDigest).success, "corrupt");
    if (name === "manifest") check(item.entries === 1, "corrupt");
    components.push(item as unknown as ContinuationGroupComponent);
  }
  return components;
}

/**
 * Strictly validate an immutable group-move intent. The root stays loose so
 * supported unknown fields survive; each component is a closed control.
 */
export function readContinuationGroupIntent(
  bytes: Uint8Array,
  expected: { ownerBookId: string; campaignId: string; operationId: string }
) {
  check(bytes instanceof Uint8Array && bytes.byteLength <= CONTINUATION_GROUP_LIMITS.intentBytes, "too-large");
  check(bookIdSchema.safeParse(expected.ownerBookId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(expected.campaignId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(expected.operationId).success, "corrupt");
  const intent = object(decodeStrictJsonBytes(bytes, { maxBytes: CONTINUATION_GROUP_LIMITS.intentBytes }));
  check(intent.schemaVersion === 1 && intent.kind === "review-campaign-group-intent", "unsupported");
  const owner = closed(intent.owner, ["bookId"]);
  check(owner.bookId === expected.ownerBookId, "corrupt");
  check(intent.id === expected.operationId && intent.campaignId === expected.campaignId && intent.revision === 1, "corrupt");
  check(intent.action === "trash" || intent.action === "restore", "unsupported");
  check(recordIdSchema.max(160).safeParse(intent.groupId).success, "corrupt");
  check(recordTimestampSchema.safeParse(intent.createdAt).success, "corrupt");
  const components = validateContinuationGroupComponents(intent.components, intent.action as ContinuationGroupAction);
  return { intent, components };
}

/** Canonical bytes for a new group-move intent; known fields win over unknowns. */
export function buildContinuationGroupIntentBytes(input: {
  ownerBookId: string; campaignId: string; operationId: string; groupId: string;
  action: ContinuationGroupAction; createdAt: string;
  components: readonly ContinuationGroupComponent[];
  unknownFields?: Record<string, unknown>;
}): Uint8Array {
  check(bookIdSchema.safeParse(input.ownerBookId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.campaignId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.operationId).success, "corrupt");
  check(recordIdSchema.max(160).safeParse(input.groupId).success, "corrupt");
  check(recordTimestampSchema.safeParse(input.createdAt).success, "corrupt");
  const components = validateContinuationGroupComponents(input.components, input.action);
  const intent = {
    ...(input.unknownFields ?? {}),
    schemaVersion: 1, kind: "review-campaign-group-intent",
    owner: { bookId: input.ownerBookId }, id: input.operationId, revision: 1,
    campaignId: input.campaignId, action: input.action, groupId: input.groupId,
    createdAt: input.createdAt, components
  };
  const bytes = encodeCanonicalJson(intent, { maxBytes: CONTINUATION_GROUP_LIMITS.intentBytes });
  // The freshly built intent must read back through its own strict reader.
  readContinuationGroupIntent(bytes, {
    ownerBookId: input.ownerBookId, campaignId: input.campaignId, operationId: input.operationId
  });
  return bytes;
}

export interface ContinuationReportReference {
  stageId: string;
  stageIndex: number;
  reference: { ownerBookId: string; runId: string; sha256: string };
  actualScopeDigest: string | null;
}

/**
 * Extract checkpoint report references from structural plan/checkpoint roots.
 * Each reference is bound to its stage's envelope request ID and participating
 * books exactly as the checkpoint reader requires; duplicates refuse at the
 * checkpoint level, while a malformed single reference is returned as a
 * corrupt marker for the caller to bound as unavailable rather than dropped.
 * Returns references in stage order without mutating either root.
 */
export function extractContinuationReportReferences(
  planRoot: unknown, checkpointRoot: unknown
): { references: ContinuationReportReference[]; checkpoint: Record<string, unknown> } | null {
  if (checkpointRoot === null || checkpointRoot === undefined) return null;
  const checkpoint = object(checkpointRoot);
  const plan = object(planRoot);
  check(Array.isArray(plan.stages), "corrupt");
  check(Array.isArray(checkpoint.stages), "corrupt");
  check(checkpoint.stages.length === plan.stages.length, "corrupt");
  const references: ContinuationReportReference[] = [];
  const seen = new Set<string>();
  for (const [index, stageValue] of checkpoint.stages.entries()) {
    const entry = object(stageValue);
    const planStage = object((plan.stages as unknown[])[index]);
    check(entry.stageId === planStage.stageId, "corrupt");
    if (entry.receipt === null || entry.receipt === undefined) continue;
    const receipt = object(entry.receipt);
    if (receipt.report === null || receipt.report === undefined) continue;
    const report = closed(receipt.report, ["ownerBookId", "runId", "sha256"]);
    check(bookIdSchema.safeParse(report.ownerBookId).success, "corrupt");
    check(hashSchema.safeParse(report.sha256).success, "corrupt");
    const envelope = object(planStage.envelope);
    check(report.runId === envelope.requestId, "corrupt");
    check(receipt.actualScopeDigest === null || hashSchema.safeParse(receipt.actualScopeDigest).success, "corrupt");
    check(receipt.actualScopeDigest !== null, "corrupt");
    check(Array.isArray(envelope.books) &&
      (envelope.books as Array<Record<string, unknown>>).some((book) => book.bookId === report.ownerBookId), "corrupt");
    const key = JSON.stringify([report.ownerBookId, report.runId]);
    check(!seen.has(key), "corrupt");
    seen.add(key);
    references.push({
      stageId: entry.stageId as string, stageIndex: index,
      reference: {
        ownerBookId: report.ownerBookId as string, runId: report.runId as string,
        sha256: report.sha256 as string
      },
      actualScopeDigest: receipt.actualScopeDigest as string
    });
  }
  return { references, checkpoint };
}
