import { normalizeBody } from "../../src/markdown";
import { planReviewCampaign, type CampaignPlan, type CampaignPlanInput } from "../../src/review/campaign-planner";
import { builtinReaderProfile, profileSchema } from "../../src/review/profiles";
import { input, saved } from "./scoped-fixtures";

export async function campaignInput(body = "Synthetic chapter.\n"): Promise<CampaignPlanInput> {
  const ordinary = input();
  const canonical = normalizeBody(body);
  return {
    operation: "plan-full-book-review", campaignId: "campaign-synthetic", ownerBookId: saved.bookId,
    plannedAt: "2026-11-08T12:00:00.000Z", taxonomyVersion: 1, categories: ["clarity", "character-motivation"],
    profile: profileSchema.parse(await builtinReaderProfile("alpha")),
    request: { destination: ordinary.destination, environment: ordinary.environment, books: ordinary.books,
      prompt: "Review all planned primary ranges.", priorFeedback: [] },
    sources: [{ sourceId: "source-1", saved: { ...saved, body: canonical }, bookTitle: "Synthetic book",
      title: "Synthetic chapter", position: 1, ranges: [{ start: 0, end: canonical.length }] }],
    policy: { maxPrimaryScalars: 65_536, boundaryScalars: 32, synthesis: null }
  };
}

export function first<T>(values: readonly T[]): T {
  const result = values[0];
  if (result === undefined) throw new Error("Missing synthetic fixture");
  return result;
}

export async function planned(input: CampaignPlanInput): Promise<CampaignPlan> {
  const result = await planReviewCampaign(input);
  if (result.status === "refused") throw new Error(result.code);
  return result.plan;
}

export function withSynthesis(input: CampaignPlanInput) {
  const synthesis = { fanIn: 4, summaryBytes: 256, evidence: [{ sourceId: "source-1", ranges: [{ start: 0, end: 1 }] }] };
  return { ...input, policy: { ...input.policy, synthesis } };
}

export function completed(plan: CampaignPlan) {
  return plan.stages.map((stage) => ({ stageId: stage.stageId, planDigest: plan.digest,
    status: "completed" as const, completedCategories: [...plan.categories] }));
}
