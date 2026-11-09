import {
  AuthoringError, WORKFLOW_LIMITS, validateOwner, validateReference,
  type Owner, type Reference
} from "../authoring";
import { bookIdSchema, hashSchema } from "./contract";
import { recordIdSchema, recordTimestampSchema } from "./record-format";
import { CAMPAIGN_PLANNER_SEMANTICS } from "./campaign-continuation-replan";
import type {
  ContinuationFixedHistoryInspection, ContinuationGroupInspection, ContinuationInspectResult,
  ContinuationReportResolutionResult
} from "./campaign-continuation-store";

/**
 * Pure integration contract leaf for 039 T018 seam 6a: map one checked
 * continuation campaign into the counted inputs a 037 coordinator host needs
 * for a check-in, without host wiring, provider calls or execution authority.
 *
 * Inputs are the existing store readers' results (`inspectContinuation`,
 * `resolveContinuationReports`, group/fixed-history inspection) plus the
 * host-supplied 037 run owner and current direction reference. Every counted
 * orchestration value is copied verbatim from the codec manifest and its
 * `counts` object; this leaf never recounts prose, re-encodes stored bytes or
 * mutates its inputs, so supported unknown fields on stored artifacts survive
 * untouched (their keys are only enumerated, read-only).
 *
 * Refusals reuse the store error vocabulary where it applies (`conflict` for
 * a stale expectation, `uncertain` for a partial group, `not-found` for a
 * group with no active campaign, `replan-required` for a compatibly differing
 * semantics label, the inspection's own code for refused/future campaigns,
 * `corrupt` for cross-book or inconsistent artifacts, `too-large` for shapes
 * one 037 context/phase cannot admit). Shapes the current authoring contracts
 * cannot admit keep their `AuthoringError` code (for example
 * `foreign-reference`); unknown shapes are refused, never coerced.
 *
 * Deliberate boundary: the codec retains no word count and the authoring
 * contracts define no check-in cadence type, no campaign-stage task role and
 * no way to derive `Brief.targetWords`, so this leaf emits counted scalar,
 * byte, stage and receipt progress only. A host must not relabel
 * `selectedUtf16`/`selectedUtf8` as words or invent a cadence from them.
 */

const MANIFEST_KEYS = ["schemaVersion", "kind", "owner", "id", "revision", "base", "createdAt",
  "updatedAt", "publicationId", "plannerSemantics", "planDigest", "plan", "checkpoint", "counts",
  "plannedUnionDigest", "segmentCount", "segmentBytes", "tokenCount"];
const COUNT_KEYS = ["sources", "selectedSpans", "stages", "rangeStages", "synthesisStages",
  "dependencyEdges", "selectedUtf16", "selectedUtf8", "resolvedPlanBytes", "holes"];
const CHECKPOINT_KEYS = ["checkpointVersion", "owner", "campaignId", "planDigest", "capturedAt", "stages"];
const RECEIPT_STATUSES = ["planned", "running", "completed", "incomplete", "failed", "stopped"];

type RecordValue = Record<string, unknown>;

export interface ContinuationCheckinCounts {
  sources: number; selectedSpans: number; stages: number; rangeStages: number;
  synthesisStages: number; dependencyEdges: number; selectedUtf16: number;
  selectedUtf8: number; resolvedPlanBytes: number; holes: number;
}

export interface ContinuationCheckinInput {
  campaignId: string;
  ownerBookId: string;
  revision: number;
  planDigest: string;
  plannedUnionDigest: string;
  plannerSemantics: string;
  manifestHash: string;
  coordinator: { owner: Owner; direction: Reference<"direction"> };
  counts: ContinuationCheckinCounts;
  segments: { count: number; bytes: number; tokens: number; unknownBearingSegments: number };
  checkpoint: {
    capturedAt: string; stageCount: number;
    receipts: { absent: number; planned: number; running: number; completed: number;
      incomplete: number; failed: number; stopped: number };
    completedStageIds: string[];
  } | null;
  reports: { owned: number; foreign: number; unavailable: number; total: number } | null;
  unknownFieldKeys: { manifest: string[]; counts: string[]; checkpoint: string[] };
}

export interface ContinuationCheckinRequest {
  inspection: ContinuationInspectResult;
  reports: ContinuationReportResolutionResult | null;
  group: ContinuationGroupInspection | ContinuationFixedHistoryInspection | null;
  coordinatorOwner: Owner;
  direction: Reference<"direction">;
  /** Caller-held view of the checked campaign; any mismatch is stale. */
  expected?: { manifestHash?: string; revision?: number };
}

export type ContinuationCheckinResult =
  | { status: "mapped"; checkin: ContinuationCheckinInput }
  | { status: "refused"; code: string };

function refused(code: string): ContinuationCheckinResult {
  return { status: "refused", code };
}
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function unknownKeys(value: RecordValue, known: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !known.includes(key)).sort();
}

/** Map a checked continuation campaign to 037 check-in inputs, or refuse. Never throws on data. */
export function mapCampaignContinuationCheckin(
  request: ContinuationCheckinRequest
): ContinuationCheckinResult {
  try {
    return mapChecked(request);
  } catch (error) {
    if (error instanceof AuthoringError) return refused(error.code);
    return refused("corrupt");
  }
}

function mapChecked(request: ContinuationCheckinRequest): ContinuationCheckinResult {
  const input = record(request);
  if (!input) return refused("corrupt");
  const inspection = request.inspection;
  if (!inspection || typeof inspection !== "object") return refused("corrupt");
  if (inspection.status === "refused") return refused(inspection.code);
  if (inspection.status === "replan-required") return refused("replan-required");
  if (inspection.status !== "structural-only") return refused("unsupported");

  const manifest = record(inspection.manifest);
  if (!manifest) return refused("corrupt");
  const ownerRecord = record(manifest.owner);
  const ownerBookId = ownerRecord?.bookId;
  const campaignId = manifest.id;
  if (typeof ownerBookId !== "string" || !bookIdSchema.safeParse(ownerBookId).success ||
    typeof campaignId !== "string" || !recordIdSchema.max(160).safeParse(campaignId).success) {
    return refused("corrupt");
  }
  if (manifest.plannerSemantics !== CAMPAIGN_PLANNER_SEMANTICS) return refused("unsupported");
  const revision = count(manifest.revision);
  if (revision === null || revision < 1) return refused("corrupt");
  if (!hashSchema.safeParse(manifest.planDigest).success ||
    !hashSchema.safeParse(manifest.plannedUnionDigest).success) return refused("corrupt");

  const rawCounts = record(manifest.counts);
  if (!rawCounts) return refused("corrupt");
  const counts = {} as Record<string, number>;
  for (const key of COUNT_KEYS) {
    const value = count(rawCounts[key]);
    if (value === null) return refused("corrupt");
    counts[key] = value;
  }
  const segmentCount = count(manifest.segmentCount);
  const segmentBytes = count(manifest.segmentBytes);
  const tokenCount = count(manifest.tokenCount);
  if (segmentCount === null || segmentBytes === null || tokenCount === null) return refused("corrupt");

  // The 037 run owner/direction are host-supplied identities; the campaign
  // itself carries only a book id, so no run identity is ever invented here.
  validateOwner(request.coordinatorOwner);
  if (request.coordinatorOwner.bookId !== ownerBookId) return refused("corrupt");
  validateReference(request.direction, "direction", request.coordinatorOwner);

  if (request.expected) {
    if (request.expected.revision !== undefined && request.expected.revision !== revision) {
      return refused("conflict");
    }
    if (request.expected.manifestHash !== undefined &&
      request.expected.manifestHash !== inspection.manifestHash) return refused("conflict");
  }

  if (request.group !== null && request.group !== undefined) {
    const group = request.group;
    if (group.ownerBookId !== ownerBookId || group.campaignId !== campaignId) return refused("corrupt");
    if (group.state === "partial") return refused("uncertain");
    if (group.state !== "active") return refused("not-found");
  }

  // One 037 context record names at most WORKFLOW_LIMITS.contextSources
  // sources and one phase plan at most WORKFLOW_LIMITS.tasksPerPlan tasks;
  // a larger checked campaign needs a future linked-phase contract, not
  // truncation or coercion into a single check-in input.
  if ((counts.sources as number) > WORKFLOW_LIMITS.contextSources ||
    (counts.stages as number) > WORKFLOW_LIMITS.tasksPerPlan) return refused("too-large");

  let reports: ContinuationCheckinInput["reports"] = null;
  if (request.reports !== null && request.reports !== undefined) {
    const resolved = request.reports;
    if (resolved.status === "refused") return refused(resolved.code);
    if (resolved.ownerBookId !== ownerBookId || resolved.campaignId !== campaignId) {
      return refused("corrupt");
    }
    if (resolved.owned + resolved.foreign + resolved.unavailable !== resolved.entries.length) {
      return refused("corrupt");
    }
    reports = { owned: resolved.owned, foreign: resolved.foreign,
      unavailable: resolved.unavailable, total: resolved.entries.length };
  }

  const planStream = inspection.streams.find((stream) => stream.stream === "plan");
  if (!planStream) return refused("corrupt");
  const checkpointStream = inspection.streams.find((stream) => stream.stream === "checkpoint");
  if ((manifest.checkpoint === null) === (checkpointStream !== undefined)) return refused("corrupt");
  const unknownBearingSegments = inspection.streams.reduce(
    (total, stream) => total + stream.segments.filter((segment) => segment.hasUnknownFields).length, 0);

  let checkpoint: ContinuationCheckinInput["checkpoint"] = null;
  let checkpointUnknown: string[] = [];
  if (checkpointStream) {
    const root = record(checkpointStream.root);
    if (!root) return refused("corrupt");
    if (root.checkpointVersion !== 1) return refused("unsupported");
    const rootOwner = record(root.owner);
    if (rootOwner?.bookId !== ownerBookId || root.campaignId !== campaignId ||
      root.planDigest !== manifest.planDigest) return refused("corrupt");
    if (!recordTimestampSchema.safeParse(root.capturedAt).success) return refused("corrupt");
    if (!Array.isArray(root.stages) || root.stages.length !== counts.stages) return refused("corrupt");
    const receipts = { absent: 0, planned: 0, running: 0, completed: 0, incomplete: 0, failed: 0, stopped: 0 };
    const completedStageIds: string[] = [];
    for (const entryValue of root.stages) {
      const entry = record(entryValue);
      if (!entry || typeof entry.stageId !== "string" || entry.stageId.length === 0 ||
        !Object.hasOwn(entry, "receipt")) return refused("corrupt");
      if (entry.receipt === null) { receipts.absent += 1; continue; }
      const receipt = record(entry.receipt);
      if (!receipt || typeof receipt.status !== "string") return refused("corrupt");
      if (!RECEIPT_STATUSES.includes(receipt.status)) return refused("unsupported");
      if (!Array.isArray(receipt.completedCategories) ||
        receipt.completedCategories.some((category) => typeof category !== "string")) {
        return refused("corrupt");
      }
      receipts[receipt.status as keyof typeof receipts] += 1;
      if (receipt.status === "completed") completedStageIds.push(entry.stageId);
    }
    checkpointUnknown = unknownKeys(root, CHECKPOINT_KEYS);
    checkpoint = { capturedAt: root.capturedAt as string, stageCount: root.stages.length,
      receipts, completedStageIds };
  }

  const checkin: ContinuationCheckinInput = {
    campaignId, ownerBookId, revision,
    planDigest: manifest.planDigest as string,
    plannedUnionDigest: manifest.plannedUnionDigest as string,
    plannerSemantics: CAMPAIGN_PLANNER_SEMANTICS,
    manifestHash: inspection.manifestHash,
    coordinator: {
      owner: { ...request.coordinatorOwner },
      direction: { ...request.direction, owner: { ...request.direction.owner } }
    },
    counts: counts as unknown as ContinuationCheckinCounts,
    segments: { count: segmentCount, bytes: segmentBytes, tokens: tokenCount, unknownBearingSegments },
    checkpoint, reports,
    unknownFieldKeys: {
      manifest: unknownKeys(manifest, MANIFEST_KEYS),
      counts: unknownKeys(rawCounts, COUNT_KEYS),
      checkpoint: checkpointUnknown
    }
  };
  return { status: "mapped", checkin };
}
