import { expect, test } from "bun:test";
import { aggregateCampaignCoverage, unionCampaignRanges } from "../../src/review/campaign-coverage";
import { editReaderProfile, profileSchema } from "../../src/review/profiles";
import { campaignInput, completed, first, planned, withSynthesis } from "./campaign-fixtures";

test("interval union merges overlap/duplicates/adjacency but never bridges gaps", () => {
  expect(unionCampaignRanges([{ start: 8, end: 10 }, { start: 0, end: 4 }, { start: 2, end: 6 },
    { start: 0, end: 4 }, { start: 6, end: 7 }])).toEqual([{ start: 0, end: 7 }, { start: 8, end: 10 }]);
  for (const range of [{ start: 1, end: 1 }, { start: -1, end: 3 }, { start: 0.5, end: 1 },
    { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => unionCampaignRanges([range])).toThrow();
});

test("missing/stopped/failed stages and missing categories leave exact primary gaps", async () => {
  const input = await campaignInput("abcdefghijk\n");
  input.policy.maxPrimaryScalars = 3;
  input.policy.boundaryScalars = 2;
  const plan = await planned(input);
  const receipts = completed(plan);
  const partial = [
    { ...first(receipts), completedCategories: ["clarity"] },
    { ...receipts[1], status: "failed", completedCategories: [] },
    { ...receipts[2], status: "stopped", completedCategories: [] }
  ];
  const aggregate = aggregateCampaignCoverage(plan, partial);
  expect(first(aggregate.coverage).completed).toEqual([{ start: 0, end: 3 }]);
  expect(first(aggregate.coverage).missing).toEqual([{ start: 3, end: 12 }]);
  expect(aggregate.coverage[1]?.completedUtf16).toBe(0);
  expect(aggregate.sourceCoverageComplete).toBe(false);
  expect(aggregate.execution.at(-1)?.status).toBe("missing");
  expect(aggregate.synthesis.status).toBe("not-requested");
  expect(aggregate.evidence).toBe("not-assessed");
  expect(first(aggregate.coverage).currency).toBe("not-checked");
});

test("failed synthesis cannot erase source completion; claimed synthesis completion needs dependencies", async () => {
  const plan = await planned(withSynthesis(await campaignInput()));
  const receipts = completed(plan);
  const failedSynthesis = receipts.map((receipt, i) => i === receipts.length - 1 ?
    { ...receipt, status: "failed", completedCategories: [] } : receipt);
  const aggregate = aggregateCampaignCoverage(plan, failedSynthesis);
  expect(aggregate.sourceCoverageComplete).toBe(true);
  expect(aggregate.executionComplete).toBe(false);
  expect(aggregate.synthesis.status).toBe("incomplete");
  const missingDependency = aggregateCampaignCoverage(plan, receipts.slice(1));
  expect(missingDependency.synthesis.status).toBe("incomplete");
  expect(first(missingDependency.synthesis.stages).dependenciesComplete).toBe(false);
});

test("exact source hash/version/category/profile identity and freshness are independent", async () => {
  const input = await campaignInput();
  const original = await planned(input);
  const source = first(original.sources);
  const receipts = completed(original);
  const current = aggregateCampaignCoverage(original, receipts, [{ sourceId: source.sourceId, identity: source.identity }]);
  expect(first(current.coverage).currency).toBe("current");
  for (const identity of [{ ...source.identity, version: source.identity.version + 1 },
    { ...source.identity, hash: "b".repeat(64) }, { ...source.identity, bookId: "book_foreign" }]) {
    const stale = aggregateCampaignCoverage(original, receipts, [{ sourceId: source.sourceId, identity }]);
    expect(first(stale.coverage).currency).toBe("stale");
    expect(stale.sourceCoverageComplete).toBe(true);
  }
  expect(first(aggregateCampaignCoverage(original, receipts, []).coverage).currency).toBe("unavailable");
  first(input.sources).saved.version++;
  const changed = await planned(input);
  expect(() => aggregateCampaignCoverage(changed, receipts)).toThrow("coverage-plan-mismatch");
  expect(first(current.coverage).key).not.toBe(first(aggregateCampaignCoverage(changed, []).coverage).key);
  expect(current.coverage[0]?.key).not.toBe(current.coverage[1]?.key);
});

test("duplicate/foreign receipts, stale plans, invalid categories and forged plans refuse", async () => {
  const plan = await planned(await campaignInput());
  const receipt = first(completed(plan));
  for (const receipts of [[receipt, receipt], [{ ...receipt, stageId: "foreign" }],
    [{ ...receipt, planDigest: "b".repeat(64) }], [{ ...receipt, completedCategories: ["continuity"] }],
    [{ ...receipt, completedCategories: ["clarity", "clarity"] }], [{ ...receipt, status: "failed" }]]) {
    expect(() => aggregateCampaignCoverage(plan, receipts)).toThrow();
  }
  expect(() => aggregateCampaignCoverage(structuredClone(plan), [])).toThrow("unvalidated-campaign-plan");
});

test("overlapping input selections union once; profile version changes cannot borrow coverage", async () => {
  const input = await campaignInput("abcdefghij\n");
  first(input.sources).ranges = [{ start: 0, end: 5 }, { start: 3, end: 8 }, { start: 0, end: 5 }];
  const content = { name: "Author lens", purpose: "Test", focus: input.profile.focus, guidance: "First" };
  input.profile = profileSchema.parse(await editReaderProfile(input.profile, content, "author-lens"));
  const before = await planned(input);
  const old = aggregateCampaignCoverage(before, completed(before));
  expect(first(old.coverage).completedUtf16).toBe(8);
  expect(first(old.coverage).planned).toEqual([{ start: 0, end: 8 }]);
  input.profile = profileSchema.parse(await editReaderProfile(input.profile, { ...content, guidance: "Second" }));
  const after = await planned(input);
  expect(after.profile.version).toBe(2);
  expect(first(aggregateCampaignCoverage(after, []).coverage).key).not.toBe(first(old.coverage).key);
  expect(() => aggregateCampaignCoverage(after, completed(before))).toThrow("coverage-plan-mismatch");
});
