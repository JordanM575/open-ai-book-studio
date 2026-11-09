import { describe, expect, test } from "bun:test";
import { inspectCheckpointForCampaign } from "../../src/review/campaign-continuation-checkpoint";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const timestamp = "2026-11-08T12:00:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("checkpoint shape against a locally provenanced plan", () => {
  test("preserves absent facts, loose unknown fields and host-reported receipts without claiming execution", async () => {
    const plan = await planned(withSynthesis(await campaignInput("abc def ghi jkl mno")));
    const root = { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
      planDigest: plan.digest, capturedAt: timestamp,
      stages: plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null as null | Record<string, unknown> })) };
    expect(inspectCheckpointForCampaign(root, plan).unresolvedReportCount).toBe(0);
    const first = root.stages[0];
    if (!first) throw new Error("Missing stage");
    first.receipt = { status: "completed", completedCategories: [plan.categories[0]], at: timestamp,
      actualScopeDigest: null, report: null, futureReceipt: { retained: true } };
    Object.defineProperty(root, "__proto__", { value: { retained: true }, enumerable: true });
    Object.defineProperty(first, "__proto__", { value: [1], enumerable: true });
    const result = inspectCheckpointForCampaign(root, plan);
    expect(result.status).toBe("structural-only");
    expect(Object.hasOwn(result.checkpoint, "__proto__")).toBe(true);
    const stages = result.checkpoint.stages as Record<string, unknown>[];
    const firstStage = stages[0];
    if (!firstStage) throw new Error("Missing checkpoint stage");
    expect(Object.hasOwn(firstStage, "__proto__")).toBe(true);
    expect((firstStage.receipt as Record<string, unknown>).futureReceipt).toEqual({ retained: true });
    expect(() => inspectCheckpointForCampaign(root, { ...plan })).toThrow();
  });

  test("rejects stage/order/category/status/report tampering and leaves references unresolved", async () => {
    const plan = await planned(await campaignInput());
    const stage = plan.stages[0];
    if (!stage) throw new Error("Missing stage");
    const root = { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
      planDigest: plan.digest, capturedAt: timestamp, stages: plan.stages.map((item) => ({ stageId: item.stageId,
        receipt: { status: "completed", completedCategories: [...plan.categories], at: null,
          actualScopeDigest: "a".repeat(64), report: { ownerBookId: plan.ownerBookId, runId: item.envelope.requestId, sha256: "b".repeat(64) } } })) };
    expect(inspectCheckpointForCampaign(root, plan).unresolvedReportCount).toBe(plan.stages.length);
    const invalidStage = clone(root);
    if (!invalidStage.stages[0]) throw new Error("Missing stage");
    invalidStage.stages[0].stageId = "foreign";
    expect(() => inspectCheckpointForCampaign(invalidStage, plan)).toThrow();
    const reversed = clone(root);
    reversed.stages[0]?.receipt.completedCategories.reverse();
    expect(() => inspectCheckpointForCampaign(reversed, plan)).toThrow();
    const unfinished = clone(root);
    if (!unfinished.stages[0]) throw new Error("Missing stage");
    unfinished.stages[0].receipt.status = "running";
    expect(() => inspectCheckpointForCampaign(unfinished, plan)).toThrow();
    const future = clone(root);
    if (!future.stages[0]) throw new Error("Missing stage");
    future.stages[0].receipt.status = "future";
    expect(() => inspectCheckpointForCampaign(future, plan)).toThrow();
    const wrongReport = clone(root);
    if (!wrongReport.stages[0]) throw new Error("Missing stage");
    wrongReport.stages[0].receipt.report.runId = "foreign";
    expect(() => inspectCheckpointForCampaign(wrongReport, plan)).toThrow();
    const closedControl = clone(root) as typeof root & { owner: { future?: boolean } };
    closedControl.owner.future = true;
    expect(() => inspectCheckpointForCampaign(closedControl, plan)).toThrow();
  });
});
