import { z } from "zod";
import { canonicalJson, freeze, hashSchema, idSchema, isReviewData, requireContract, spanSchema, type Span } from "./contract";
import { requireCampaignPlan, type CampaignPlan } from "./campaign-planner";
import { categorySchema } from "./profiles";
import { sameSavedIdentity, savedIdentitySchema } from "./sources";

/** Union half-open UTF-16 intervals. Callers supplying text must check scalar endpoints too. */
export function unionCampaignRanges(value: unknown): readonly Span[] {
  requireContract(isReviewData(value), "invalid-coverage-data");
  const ranges = z.array(spanSchema).parse(value).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const range of ranges) {
    requireContract(range.end > range.start, "invalid-coverage-range");
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return freeze(merged);
}

function missingRanges(planned: readonly Span[], completed: readonly Span[]): Span[] {
  const result: Span[] = [];
  let index = 0;
  for (const range of planned) {
    let cursor = range.start;
    while (index < completed.length) {
      const done = completed[index];
      if (!done || done.start >= range.end) break;
      if (done.end > cursor) {
        if (done.start > cursor) result.push({ start: cursor, end: done.start });
        cursor = Math.max(cursor, done.end);
      }
      if (done.end > range.end) break;
      index++;
    }
    if (cursor < range.end) result.push({ start: cursor, end: range.end });
  }
  return result;
}

const receiptSchema = z.strictObject({
  stageId: idSchema, planDigest: hashSchema,
  status: z.enum(["planned", "running", "completed", "incomplete", "failed", "stopped"]),
  /** Explicit completed categories; an incomplete/stopped range earns no coverage. */
  completedCategories: z.array(categorySchema)
});
export type CampaignStageReceipt = z.infer<typeof receiptSchema>;

const currentSchema = z.array(z.strictObject({
  sourceId: idSchema, identity: savedIdentitySchema.nullable()
}));

/** Host-supplied execution facts are NOT evidence verification, scheduler authority or a save receipt.
 * Missing receipts stay incomplete; a completed synthesis cannot conceal a failed dependency.
 */
export function aggregateCampaignCoverage(plan: CampaignPlan, receipts: unknown, current?: unknown) {
  requireCampaignPlan(plan);
  requireContract(isReviewData(receipts), "invalid-coverage-data");
  const parsed = z.array(receiptSchema).parse(receipts);
  requireContract(new Set(parsed.map((receipt) => receipt.stageId)).size === parsed.length, "duplicate-campaign-receipt");
  const stages = new Map(plan.stages.map((stage) => [stage.stageId, stage]));
  for (const receipt of parsed) {
    requireContract(receipt.planDigest === plan.digest, "coverage-plan-mismatch");
    requireContract(stages.has(receipt.stageId), "foreign-campaign-stage");
    requireContract(new Set(receipt.completedCategories).size === receipt.completedCategories.length &&
      receipt.completedCategories.every((category) => plan.categories.includes(category)), "invalid-coverage-category");
    requireContract(receipt.status === "completed" || receipt.completedCategories.length === 0, "unfinished-stage-coverage");
  }
  requireContract(current === undefined || isReviewData(current), "invalid-coverage-currency");
  const facts = current === undefined ? undefined : currentSchema.parse(current);
  requireContract(!facts || (new Set(facts.map((fact) => fact.sourceId)).size === facts.length &&
    facts.every((fact) => plan.sources.some((source) => source.sourceId === fact.sourceId))), "ambiguous-coverage-currency");
  const byId = new Map(parsed.map((receipt) => [receipt.stageId, receipt]));
  const effective = new Map<string, boolean>();
  const execution = plan.stages.map((stage) => {
    const receipt = byId.get(stage.stageId);
    const dependenciesComplete = stage.dependencies.every((id) => effective.get(id) === true);
    const complete = receipt?.status === "completed" && dependenciesComplete &&
      plan.categories.every((category) => receipt.completedCategories.includes(category));
    effective.set(stage.stageId, complete);
    return { stageId: stage.stageId, kind: stage.kind, status: receipt?.status ?? "missing",
      dependenciesComplete, complete };
  });
  const completedBySource = new Map<string, Map<string, Span[]>>();
  for (const stage of plan.stages) {
    const receipt = byId.get(stage.stageId);
    if (stage.kind !== "range" || receipt?.status !== "completed") continue;
    for (const origin of stage.origins) {
      let categories = completedBySource.get(origin.sourceId);
      if (!categories) { categories = new Map(); completedBySource.set(origin.sourceId, categories); }
      for (const category of receipt.completedCategories) {
        let ranges = categories.get(category);
        if (!ranges) { ranges = []; categories.set(category, ranges); }
        ranges.push(...origin.primary.map((range) => ({ ...range })));
      }
    }
  }
  const coverage = plan.sources.flatMap((source) => plan.categories.map((category) => {
    const planned = unionCampaignRanges(source.segments.map(({ start, end }) => ({ start, end })));
    const completed = unionCampaignRanges(completedBySource.get(source.sourceId)?.get(category) ?? []);
    const missing = missingRanges(planned, completed);
    const fact = facts?.find((entry) => entry.sourceId === source.sourceId);
    const currency = facts === undefined ? "not-checked" : !fact?.identity ? "unavailable" :
      sameSavedIdentity(source.identity, fact.identity) ? "current" : "stale";
    return {
      key: canonicalJson({ identity: source.identity, taxonomyVersion: plan.taxonomyVersion, category,
        profile: { id: plan.profile.id, version: plan.profile.version, digest: plan.profile.digest } }),
      sourceId: source.sourceId, identity: source.identity, taxonomyVersion: plan.taxonomyVersion, category,
      profile: { id: plan.profile.id, version: plan.profile.version, digest: plan.profile.digest },
      planned, completed, missing,
      plannedUtf16: planned.reduce((sum, range) => sum + range.end - range.start, 0),
      completedUtf16: completed.reduce((sum, range) => sum + range.end - range.start, 0),
      complete: missing.length === 0, currency
    };
  }));
  const synthesis = execution.filter((stage) => stage.kind === "synthesis");
  return freeze({
    planDigest: plan.digest, coverage, execution,
    sourceCoverageComplete: coverage.every((entry) => entry.complete),
    executionComplete: execution.every((stage) => stage.complete),
    synthesis: { status: synthesis.length === 0 ? "not-requested" : synthesis.every((stage) => stage.complete) ? "complete" : "incomplete",
      stages: synthesis },
    // Nothing in primary-range arithmetic verifies quotes or measures exhaustive detection/quality.
    evidence: "not-assessed" as const
  });
}
