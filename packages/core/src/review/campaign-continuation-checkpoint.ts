import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { bookIdSchema, hashSchema } from "./contract";
import { recordTimestampSchema } from "./record-format";
import { visitCanonicalJsonBytes } from "./record-json";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS } from "./campaign-continuation-tokens";
import { CONTINUATION_SEGMENT_LIMITS } from "./campaign-continuation-segments";

function check(condition: unknown, code: "corrupt" | "unsupported"): asserts condition {
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

/**
 * Check host-reported checkpoint shape against an already locally provenanced plan. Loose unknown
 * fields survive. Report references are never called verified: their independently owned files and
 * actual scope require a separate authorized resolver. Nothing here grants execution authority.
 */
export function inspectCheckpointForCampaign(value: unknown, plan: CampaignPlan) {
  requireCampaignPlan(plan);
  // A checkpoint has no holes: even its compact root alone must fit the combined segment budget.
  visitCanonicalJsonBytes(value, CONTINUATION_SEGMENT_LIMITS.bytes);
  const length = visitCanonicalJsonBytes(value, CONTINUATION_TOKEN_LIMITS.expandedBytes);
  const bytes = new Uint8Array(length);
  let offset = 0;
  visitCanonicalJsonBytes(value, CONTINUATION_TOKEN_LIMITS.expandedBytes, (chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  const root = object(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  check(root.checkpointVersion === 1, "unsupported");
  check(closed(root.owner, ["bookId"]).bookId === plan.ownerBookId && root.campaignId === plan.campaignId &&
    root.planDigest === plan.digest, "corrupt");
  check(recordTimestampSchema.safeParse(root.capturedAt).success, "corrupt");
  check(Array.isArray(root.stages) && root.stages.length === plan.stages.length, "corrupt");
  const reports = new Set<string>();
  for (const [index, input] of root.stages.entries()) {
    const entry = object(input);
    const stage = plan.stages[index];
    check(stage && entry.stageId === stage.stageId && Object.hasOwn(entry, "receipt"), "corrupt");
    if (entry.receipt === null) continue;
    const receipt = object(entry.receipt);
    check(typeof receipt.status === "string" && ["planned", "running", "completed", "incomplete", "failed", "stopped"].includes(receipt.status), "unsupported");
    check(Array.isArray(receipt.completedCategories), "corrupt");
    let previous = -1;
    for (const category of receipt.completedCategories) {
      const position = plan.categories.indexOf(category);
      check(position > previous, "corrupt");
      previous = position;
    }
    check(receipt.status === "completed" || receipt.completedCategories.length === 0, "corrupt");
    check(receipt.at === null || recordTimestampSchema.safeParse(receipt.at).success, "corrupt");
    check(receipt.actualScopeDigest === null || hashSchema.safeParse(receipt.actualScopeDigest).success, "corrupt");
    check(stage.kind !== "synthesis" || receipt.actualScopeDigest === null ||
      receipt.actualScopeDigest !== stage.envelope.scopeDigest, "corrupt");
    check(Object.hasOwn(receipt, "report"), "corrupt");
    if (receipt.report === null) continue;
    const report = closed(receipt.report, ["ownerBookId", "runId", "sha256"]);
    check(bookIdSchema.safeParse(report.ownerBookId).success && report.runId === stage.envelope.requestId &&
      hashSchema.safeParse(report.sha256).success && receipt.actualScopeDigest !== null, "corrupt");
    check(stage.envelope.books.some((book) => book.bookId === report.ownerBookId), "corrupt");
    const key = JSON.stringify([report.ownerBookId, report.runId]);
    check(!reports.has(key), "corrupt");
    reports.add(key);
  }
  return { status: "structural-only" as const, checkpoint: root, unresolvedReportCount: reports.size };
}
