import { inspectCheckpointForCampaign } from "./campaign-continuation-checkpoint";
import { measureProvenancedCampaign } from "./campaign-continuation-metrics";
import { resolveContinuationWire } from "./campaign-continuation-resolve";
import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, type InspectedContinuationHole } from "./campaign-continuation-tokens";
import { visitCanonicalJsonBytes } from "./record-json";

function check(condition: unknown): asserts condition {
  if (!condition) throw new ContinuationTokenError("corrupt");
}

/** Compare exact canonical content, not just a digest, with a bounded temporary byte array. */
function sameCanonical(left: unknown, right: unknown): boolean {
  const length = visitCanonicalJsonBytes(left, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  if (visitCanonicalJsonBytes(right, CONTINUATION_TOKEN_LIMITS.expandedBytes) !== length) return false;
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(left, CONTINUATION_TOKEN_LIMITS.expandedBytes, (chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  offset = 0;
  let same = true;
  visitCanonicalJsonBytes(right, CONTINUATION_TOKEN_LIMITS.expandedBytes, (chunk) => {
    for (const byte of chunk) if (byte !== bytes[offset++]) same = false;
  });
  return same && offset === length;
}

/**
 * Bind wire inspection and exact hole resolution to a caller-supplied, already provenanced local
 * planner result. This does not obtain or authenticate source files, register the decoded object,
 * verify report files, publish anything, or supply a compatible-planner registry. The caller must
 * separately establish the local plan's source provenance and other host gates.
 */
export async function compareContinuationWithLocalPlan(manifestBytes: Uint8Array, plan: CampaignPlan,
  readSegment: (id: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>,
  resolve: (hole: InspectedContinuationHole) => unknown | Promise<unknown>) {
  requireCampaignPlan(plan);
  const resolved = await resolveContinuationWire(manifestBytes, { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId }, readSegment, resolve);
  check(resolved.manifest.planDigest === plan.digest);
  const { digest: _digest, ...content } = plan;
  check(sameCanonical(resolved.untrustedPlanContent, content));
  const measurements = await measureProvenancedCampaign(plan);
  const counts = resolved.manifest.counts as Record<string, unknown>;
  for (const [key, value] of Object.entries(measurements.counts)) check(counts[key] === value);
  check(resolved.manifest.plannedUnionDigest === measurements.plannedUnionDigest);
  const checkpointInspection = resolved.checkpoint === null ? null : inspectCheckpointForCampaign(resolved.checkpoint.root, plan);
  return { status: "matched-local-plan-only" as const, untrustedPlanContent: resolved.untrustedPlanContent,
    checkpoint: checkpointInspection, plannedUnionDigest: measurements.plannedUnionDigest };
}
