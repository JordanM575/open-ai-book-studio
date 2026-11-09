import { unionCampaignRanges } from "./campaign-coverage";
import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { sameSavedIdentity } from "./sources";
import { visitCanonicalJsonBytes } from "./record-json";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS } from "./campaign-continuation-tokens";

function check(condition: unknown): asserts condition {
  if (!condition) throw new ContinuationTokenError("corrupt");
}
function add(a: number, b: number): number {
  check(Number.isSafeInteger(b) && b >= 0 && b <= Number.MAX_SAFE_INTEGER - a);
  return a + b;
}
async function digestCanonical(value: unknown): Promise<string> {
  const length = visitCanonicalJsonBytes(value, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(value, CONTINUATION_TOKEN_LIMITS.expandedBytes, (chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute manifest counts and both forms of the planned union for a locally provenanced plan only.
 * This is not a validator for a deserialized plan and does not establish source currentness.
 */
export async function measureProvenancedCampaign(plan: CampaignPlan) {
  requireCampaignPlan(plan);
  const { digest: _digest, ...content } = plan;
  const resolvedPlanBytes = visitCanonicalJsonBytes(content, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  const sourceById = new Map(plan.sources.map((source) => [source.sourceId, source]));
  check(sourceById.size === plan.sources.length);
  const primary = new Map<string, { start: number; end: number }[]>();
  let selectedSpans = 0;
  let selectedUtf16 = 0;
  let selectedUtf8 = 0;
  let holes = 0;
  const encoder = new TextEncoder();
  const sources = plan.sources.map((source) => {
    const planned = unionCampaignRanges(source.segments.map(({ start, end }) => ({ start, end })));
    selectedSpans = add(selectedSpans, source.segments.length);
    holes = add(holes, source.segments.length);
    for (const segment of source.segments) selectedUtf8 = add(selectedUtf8, encoder.encode(segment.text).length);
    for (const span of planned) selectedUtf16 = add(selectedUtf16, span.end - span.start);
    return { sourceId: source.sourceId, identity: source.identity, planned };
  });
  let rangeStages = 0;
  let synthesisStages = 0;
  let dependencyEdges = 0;
  for (const stage of plan.stages) {
    dependencyEdges = add(dependencyEdges, stage.dependencies.length);
    holes = add(holes, 2); // Each stage prompt and entire prior-feedback array.
    for (const source of stage.envelope.sources) {
      check(source.kind === "chapter");
      holes = add(holes, source.segments.length);
    }
    if (stage.kind === "synthesis") { synthesisStages = add(synthesisStages, 1); continue; }
    check(stage.kind === "range");
    rangeStages = add(rangeStages, 1);
    for (const origin of stage.origins) {
      const source = sourceById.get(origin.sourceId);
      check(source && sameSavedIdentity(source.identity, origin.identity));
      const ranges = primary.get(origin.sourceId) ?? [];
      for (const span of origin.primary) ranges.push({ start: span.start, end: span.end });
      primary.set(origin.sourceId, ranges);
    }
  }
  for (const source of sources) {
    const ranges = unionCampaignRanges(primary.get(source.sourceId) ?? []);
    check(ranges.length === source.planned.length && ranges.every((range, index) =>
      range.start === source.planned[index]?.start && range.end === source.planned[index]?.end));
  }
  const union = { ownerBookId: plan.ownerBookId, taxonomyVersion: plan.taxonomyVersion, categories: plan.categories,
    profile: { id: plan.profile.id, version: plan.profile.version, digest: plan.profile.digest }, sources };
  const plannedUnionDigest = await digestCanonical(union);
  return { counts: { sources: plan.sources.length, selectedSpans, stages: plan.stages.length, rangeStages,
    synthesisStages, dependencyEdges, selectedUtf16, selectedUtf8, resolvedPlanBytes, holes }, union, plannedUnionDigest };
}
