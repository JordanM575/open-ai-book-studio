import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { measureProvenancedCampaign } from "../../src/review/campaign-continuation-metrics";
import { tokenizeCampaignPlan } from "../../src/review/campaign-continuation-tokens";
import { canonicalJsonText } from "../../src/review/record-json";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

describe("provenanced campaign union and counts", () => {
  test("counts disjoint scalar-safe selections once and matches independently hashed union and token holes", async () => {
    const input = withSynthesis(await campaignInput("🧪_a_b_c_🧪"));
    const source = input.sources[0];
    if (!source) throw new Error("Missing source");
    source.ranges = [{ start: 0, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 6 }, { start: 9, end: 11 }];
    input.policy.synthesis.evidence[0] = { sourceId: source.sourceId, ranges: [{ start: 0, end: 2 }] };
    input.policy.maxPrimaryScalars = 1;
    const plan = await planned(input);
    const metrics = await measureProvenancedCampaign(plan);
    const stream = await tokenizeCampaignPlan(plan);
    expect(metrics.union.sources[0]?.planned).toEqual(source.ranges);
    expect(metrics.counts.selectedSpans).toBe(4);
    expect(metrics.counts.selectedUtf16).toBe(6);
    expect(metrics.counts.selectedUtf8).toBe(10);
    expect(metrics.counts.holes).toBe(stream.holes);
    expect(metrics.counts.resolvedPlanBytes).toBe(stream.contentBytes);
    expect(metrics.counts.rangeStages).toBe(4);
    expect(metrics.counts.synthesisStages).toBeGreaterThan(0);
    expect(metrics.counts.rangeStages + metrics.counts.synthesisStages).toBe(plan.stages.length);
    expect(metrics.plannedUnionDigest).toBe(createHash("sha256").update(canonicalJsonText(metrics.union)).digest("hex"));
    await expect(measureProvenancedCampaign({ ...plan })).rejects.toThrow();
  });
});
