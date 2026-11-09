import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { bookFilePath } from "../../src/library/paths";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import {
  mapCampaignContinuationCheckin, type ContinuationCheckinCounts
} from "../../src/review/campaign-continuation-checkin";
import {
  CampaignContinuationStore, continuationManifestPath,
  type CampaignContinuationHost, type ContinuationCandidate
} from "../../src/review/campaign-continuation-store";
import type { Owner, Reference } from "../../src/authoring";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { campaignInput, first, planned, withSynthesis } from "./campaign-fixtures";

const time = "2026-11-08T12:00:00.000Z";
const owner = "book_123456";
const otherOwner = "book_654321";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (n = 1) => n.toString(16).padStart(64, "0");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function writeBook(port: InMemoryLibraryPort, bookId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, id: bookId, title: "Synthetic book", description: "", outline: "",
    createdAt: time, updatedAt: time
  }));
  await port.commitFile(bookFilePath(bookId), bytes, { kind: "absent" });
}

function makeHarness() {
  const port = new InMemoryLibraryPort({ id: "device_fixture01", name: "Fixture device", createdAt: time }, () => time);
  const host: CampaignContinuationHost = {
    storage: port, runtime: port, deviceId: "device_fixture01",
    withBook: async (_bookId, work) => work(),
    commitFile: (path, bytes, expected) => port.commitFile(path, bytes, expected),
    createImmutableFile: (path, bytes) => port.createImmutableFile(path, bytes)
  };
  return { port, store: new CampaignContinuationStore(host) };
}

function chapterFile(body: string): Uint8Array {
  return new TextEncoder().encode(serializeChapter({
    id: "ch_123456", title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version: 3,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
}

async function fixture(checkpointOverride?: Record<string, unknown> | null) {
  const body = normalizeBody("Synthetic chapter prose for check-in mapping.\nSecond synthetic line.\n");
  const rawBytes = chapterFile(body);
  const input = withSynthesis(await campaignInput(body));
  const source = first(input.sources);
  source.saved = { ...source.saved, hash: sha256(rawBytes) };
  const plan = await planned(input);
  const checkpoint = checkpointOverride === undefined
    ? { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
        planDigest: plan.digest, capturedAt: time,
        stages: plan.stages.map((stage, index) => ({
          stageId: stage.stageId,
          receipt: index === 0
            ? { status: "completed", completedCategories: [...plan.categories], at: time,
                actualScopeDigest: null, report: null }
            : null
        })) }
    : checkpointOverride;
  const built = await buildCampaignContinuation(plan, {
    operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint
  });
  const candidate: ContinuationCandidate = {
    manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments
  };
  return { body, plan, built, candidate };
}

const coordinatorOwner = (bookId = owner): Owner =>
  ({ libraryRegistration: "lib_fixture", bookId, runId: "run_fixture" });
const direction = (bookId = owner): Reference<"direction"> =>
  ({ kind: "direction", owner: coordinatorOwner(bookId), id: "direction_fixture", revision: 1, hash: hash(7) });

async function checkedCampaign(checkpointOverride?: Record<string, unknown> | null) {
  const { port, store } = makeHarness();
  await writeBook(port, owner);
  const f = await fixture(checkpointOverride);
  await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
  const inspection = await store.inspectContinuation(owner, f.plan.campaignId);
  const reports = await store.resolveContinuationReports(owner, f.plan.campaignId);
  const group = await store.inspectContinuationGroup(owner, f.plan.campaignId);
  return { port, store, f, inspection, reports, group };
}

describe("campaign continuation check-in adapter (039 T018 seam 6a)", () => {
  test("maps a checked campaign from the codec's own counters, never recounting prose", async () => {
    const { f, inspection, reports, group } = await checkedCampaign();
    expect(inspection.status).toBe("structural-only");
    const result = mapCampaignContinuationCheckin({
      inspection, reports, group,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    });
    expect(result.status).toBe("mapped");
    if (result.status !== "mapped") return;
    const manifest = JSON.parse(new TextDecoder().decode(f.built.manifestBytes)) as Record<string, unknown> & {
      revision: number; plannedUnionDigest: string; segmentCount: number; segmentBytes: number;
      tokenCount: number; counts: ContinuationCheckinCounts
    };
    // Every counted input is the manifest/codec value verbatim.
    expect(result.checkin.campaignId).toBe(f.plan.campaignId);
    expect(result.checkin.ownerBookId).toBe(owner);
    expect(result.checkin.revision).toBe(manifest.revision);
    expect(result.checkin.planDigest).toBe(f.plan.digest);
    expect(result.checkin.plannedUnionDigest).toBe(manifest.plannedUnionDigest);
    expect(result.checkin.counts).toEqual(manifest.counts);
    expect(result.checkin.segments.count).toBe(manifest.segmentCount);
    expect(result.checkin.segments.bytes).toBe(manifest.segmentBytes);
    expect(result.checkin.segments.tokens).toBe(manifest.tokenCount);
    // The prose has a handful of words; the codec counters are scalar/byte counts.
    // The adapter surfaces those counters and invents no word count of its own.
    expect(result.checkin.counts.selectedUtf16).toBe(manifest.counts.selectedUtf16);
    expect("targetWords" in result.checkin).toBe(false);
    expect("wordCount" in result.checkin).toBe(false);
    // Checkpoint check-in tallies count receipts, in plan order.
    expect(result.checkin.checkpoint?.stageCount).toBe(f.plan.stages.length);
    expect(result.checkin.checkpoint?.receipts.completed).toBe(1);
    expect(result.checkin.checkpoint?.receipts.absent).toBe(f.plan.stages.length - 1);
    expect(result.checkin.checkpoint?.completedStageIds).toEqual([first(f.plan.stages).stageId]);
    expect(result.checkin.reports).toMatchObject({ owned: 0, foreign: 0, unavailable: 0 });
    expect(result.checkin.coordinator.owner).toEqual(coordinatorOwner());
    expect(group.state).toBe("active");
  });

  test("refuses a stale expectation instead of mapping over newer saved state", async () => {
    const { inspection, reports, group } = await checkedCampaign();
    const stale = mapCampaignContinuationCheckin({
      inspection, reports, group, coordinatorOwner: coordinatorOwner(), direction: direction(),
      expected: { revision: 99 }
    });
    expect(stale).toEqual({ status: "refused", code: "conflict" });
    const wrongHash = mapCampaignContinuationCheckin({
      inspection, reports, group, coordinatorOwner: coordinatorOwner(), direction: direction(),
      expected: { manifestHash: hash(42) }
    });
    expect(wrongHash).toEqual({ status: "refused", code: "conflict" });
  });

  test("never maps a partial group, and refuses an archived group as not active", async () => {
    const { inspection, reports, group } = await checkedCampaign();
    const partial = mapCampaignContinuationCheckin({
      inspection, reports,
      group: { ...group, state: "partial" as const },
      coordinatorOwner: coordinatorOwner(), direction: direction()
    });
    expect(partial).toEqual({ status: "refused", code: "uncertain" });
    const archived = mapCampaignContinuationCheckin({
      inspection, reports,
      group: { ...group, state: "archived" as const },
      coordinatorOwner: coordinatorOwner(), direction: direction()
    });
    expect(archived).toEqual({ status: "refused", code: "not-found" });
  });

  test("refuses cross-book artifacts: coordinator owner and report owner must match", async () => {
    const { inspection, reports, group } = await checkedCampaign();
    const foreignCoordinator = mapCampaignContinuationCheckin({
      inspection, reports, group,
      coordinatorOwner: coordinatorOwner(otherOwner), direction: direction(otherOwner)
    });
    expect(foreignCoordinator).toEqual({ status: "refused", code: "corrupt" });
    const foreignReports = mapCampaignContinuationCheckin({
      inspection,
      reports: reports.status === "resolved" ? { ...reports, ownerBookId: otherOwner } : reports,
      group, coordinatorOwner: coordinatorOwner(), direction: direction()
    });
    expect(foreignReports).toEqual({ status: "refused", code: "corrupt" });
  });

  test("refuses future and compatible-only semantics labels without mapping them", async () => {
    const { port, store, f } = await checkedCampaign();
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    const { encodeCanonicalJson } = await import("../../src/review/record-json");
    manifest.plannerSemantics = "review-campaign-planner-v99";
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId),
      encodeCanonicalJson(manifest), { kind: "any" });
    const future = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(future.status).toBe("refused");
    expect(mapCampaignContinuationCheckin({
      inspection: future, reports: null, group: null,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    })).toEqual({ status: "refused", code: "unsupported" });

    manifest.plannerSemantics = "review-campaign-planner-v0";
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId),
      encodeCanonicalJson(manifest), { kind: "any" });
    const compatible = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(compatible.status).toBe("replan-required");
    expect(mapCampaignContinuationCheckin({
      inspection: compatible, reports: null, group: null,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    })).toEqual({ status: "refused", code: "replan-required" });
  });

  test("supported unknown fields survive: frozen stored artifacts map without mutation", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const body = normalizeBody("Synthetic chapter prose for check-in mapping.\n");
    const rawBytes = chapterFile(body);
    const input = withSynthesis(await campaignInput(body));
    const source = first(input.sources);
    source.saved = { ...source.saved, hash: sha256(rawBytes) };
    const plan = await planned(input);
    const checkpoint = {
      checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
      planDigest: plan.digest, capturedAt: time, futureCheckpointNote: "keep-checkpoint",
      stages: plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null }))
    };
    const built = await buildCampaignContinuation(plan, {
      operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint,
      manifestUnknown: { futureCheckinNote: "keep-manifest" }
    });
    await store.publishContinuation(owner, plan.campaignId,
      { manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments });
    const storedBefore = await port.readFile(continuationManifestPath(owner, plan.campaignId));
    const inspection = await store.inspectContinuation(owner, plan.campaignId);
    const reports = await store.resolveContinuationReports(owner, plan.campaignId);
    // A deep-frozen reader result proves the adapter reads without re-encoding or writing back.
    const result = mapCampaignContinuationCheckin({
      inspection: deepFreeze(clone(inspection)), reports: deepFreeze(clone(reports)), group: null,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    });
    expect(result.status).toBe("mapped");
    if (result.status !== "mapped") return;
    expect(result.checkin.unknownFieldKeys.manifest).toContain("futureCheckinNote");
    expect(result.checkin.unknownFieldKeys.checkpoint).toContain("futureCheckpointNote");
    const storedAfter = await port.readFile(continuationManifestPath(owner, plan.campaignId));
    expect(storedAfter?.bytes).toEqual(storedBefore?.bytes ?? new Uint8Array());
    expect(storedAfter?.bytes).toEqual(built.manifestBytes);
  });

  test("refuses shapes the current 037 contracts cannot admit, without coercion", async () => {
    const { inspection, reports, group } = await checkedCampaign();
    // More retained sources than one 037 context record can name (WORKFLOW_LIMITS.contextSources).
    const wide = clone(inspection);
    if (wide.status !== "structural-only") throw new Error("Expected structural inspection");
    (wide.manifest.counts as Record<string, unknown>).sources = 65;
    expect(mapCampaignContinuationCheckin({
      inspection: wide, reports, group,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    })).toEqual({ status: "refused", code: "too-large" });
    // More stages than one 037 phase plan can hold (WORKFLOW_LIMITS.tasksPerPlan).
    const deep = clone(inspection);
    if (deep.status !== "structural-only") throw new Error("Expected structural inspection");
    (deep.manifest.counts as Record<string, unknown>).stages = 1025;
    expect(mapCampaignContinuationCheckin({
      inspection: deep, reports, group,
      coordinatorOwner: coordinatorOwner(), direction: direction()
    })).toEqual({ status: "refused", code: "too-large" });
    // A coordinator direction owned by another run is a foreign 037 reference, refused as-is.
    const foreignDirection = mapCampaignContinuationCheckin({
      inspection, reports, group, coordinatorOwner: coordinatorOwner(),
      direction: { ...direction(), owner: { ...coordinatorOwner(), runId: "run_other" } }
    });
    expect(foreignDirection.status).toBe("refused");
    if (foreignDirection.status === "refused") expect(foreignDirection.code).toBe("foreign-reference");
  });
});
