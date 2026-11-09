import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { serializeHistoryRecord, type HistoryRecord } from "../../src/library/history";
import type { LibraryRuntime } from "../../src/library/port";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import { resolveContinuationWire } from "../../src/review/campaign-continuation-resolve";
import { packContinuationTokenStreams } from "../../src/review/campaign-continuation-segments";
import { resolveContinuationTokens, tokenizeCampaignPlan, type ContinuationPath } from "../../src/review/campaign-continuation-tokens";
import { readContinuationManifest } from "../../src/review/campaign-continuation-wire";
import { requireCampaignPlan, type CampaignPlan } from "../../src/review/campaign-planner";
import {
  CAMPAIGN_PLANNER_SEMANTICS, COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS, CONTINUATION_REPLAN_SOURCE_LIMITS,
  inspectCampaignContinuationCompatibility, replanCampaignContinuation, serveCampaignContinuation,
  validateContinuationSources, type ContinuationSourceExpectation
} from "../../src/review/campaign-continuation-replan";
import { canonicalJsonText, encodeCanonicalJson } from "../../src/review/record-json";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const time = "2026-11-08T12:00:00.000Z";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const runtime: LibraryRuntime = {
  now: () => time, newId: (prefix) => `${prefix}_123456`,
  sha256: async (bytes) => sha256(bytes)
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function at(root: unknown, path: ContinuationPath): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new Error("Bad fixture path");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}

function chapterFile(body: string, version = 3, chapterId = "ch_123456"): Uint8Array {
  return new TextEncoder().encode(serializeChapter({
    id: chapterId, title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
}

async function fixture(bodyText = "Synthetic chapter prose for replan.\nSecond synthetic line.\n") {
  const body = normalizeBody(bodyText);
  const rawBytes = chapterFile(body);
  const input = withSynthesis(await campaignInput(body));
  const source = input.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.saved = { ...source.saved, hash: sha256(rawBytes) };
  input.request.prompt = "Review all planned primary ranges.";
  input.request.priorFeedback = [{ id: "feedback-one", runId: "run-one", label: "synthetic", text: "Earlier synthetic feedback." }];
  const plan = await planned(input);
  const built = await buildCampaignContinuation(plan, { operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint: null });
  const files = new Map(built.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
  const expectation: ContinuationSourceExpectation = {
    sourceId: plan.sources[0]?.sourceId ?? "",
    identity: { ...(plan.sources[0]?.identity as { bookId: string; chapterId: string; version: number; hash: string }) },
    bodyLength: plan.sources[0]?.bodyLength ?? 0,
    segments: (plan.sources[0]?.segments ?? []).map(({ start, end, startLine }) => ({ start, end, startLine }))
  };
  return { body, rawBytes, input, plan, built, files, expectation,
    readSegment: (id: string) => files.get(id), source: { kind: "current" as const, sourceId: expectation.sourceId, rawBytes } };
}

function semanticsManifest(manifestBytes: Uint8Array, semantics: string): Uint8Array {
  const manifest = clone(JSON.parse(new TextDecoder().decode(manifestBytes))) as Record<string, unknown>;
  manifest.plannerSemantics = semantics;
  return encodeCanonicalJson(manifest);
}

describe("continuation compatibility dispatch, source validation and replan", () => {
  test("serves a same-semantics continuation only through an already provenanced local plan", async () => {
    const f = await fixture();
    expect(inspectCampaignContinuationCompatibility(f.built.manifestBytes)).toEqual({
      decision: "serve-unchanged", plannerSemantics: CAMPAIGN_PLANNER_SEMANTICS
    });
    const fresh = await planned(f.input);
    const { digest: _digest, ...content } = fresh;
    const served = await serveCampaignContinuation(f.built.manifestBytes, fresh, f.readSegment, ({ path }) => at(content, path));
    expect(served.status).toBe("matched-local-plan-only");
    if (served.status !== "matched-local-plan-only") throw new Error("Expected served continuation");
    expect(served.plan).toBe(fresh);
    expect(served.recordedPlannerSemantics).toBe(CAMPAIGN_PLANNER_SEMANTICS);
    expect(() => requireCampaignPlan(served.plan)).not.toThrow();
    expect(canonicalJsonText(served.untrustedPlanContent)).toBe(canonicalJsonText(content));
  });

  test("replans a compatibly differing semantics label and matches the fresh provenanced plan", async () => {
    const f = await fixture();
    const compatible = COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS[0];
    if (!compatible) throw new Error("Expected a compatible predecessor semantics label");
    const retained = semanticsManifest(f.built.manifestBytes, compatible);
    expect(inspectCampaignContinuationCompatibility(retained)).toEqual({
      decision: "replan-required", plannerSemantics: compatible
    });
    // The accepted wire reader still refuses the differing label; dispatch is this seam's job.
    expect(() => readContinuationManifest(retained, { ownerBookId: f.plan.ownerBookId, campaignId: f.plan.campaignId })).toThrow();
    const { digest: _digest, ...content } = f.plan;
    const served = await serveCampaignContinuation(retained, f.plan, f.readSegment, ({ path }) => at(content, path));
    expect(served.status).toBe("refused");
    if (served.status === "refused") expect(served.code).toBe("replan-required");

    const replanned = await replanCampaignContinuation(retained, f.readSegment, {
      sources: [f.source], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    });
    expect(replanned.status).toBe("matched-local-plan-only");
    if (replanned.status !== "matched-local-plan-only") throw new Error("Expected replanned continuation");
    expect(replanned.plan).not.toBe(f.plan);
    expect(replanned.plan.digest).toBe(f.plan.digest);
    expect(replanned.recordedPlannerSemantics).toBe(compatible);
    expect(replanned.compatibility).toBe("replan-required");
    expect(() => requireCampaignPlan(replanned.plan)).not.toThrow();
    expect(canonicalJsonText(replanned.untrustedPlanContent)).toBe(canonicalJsonText(content));
  });

  test("replans a current-semantics continuation from an explicitly chosen historical record", async () => {
    const f = await fixture();
    const record: HistoryRecord = {
      meta: {
        schemaVersion: 1, kind: "snapshot", id: "hist_123456", bookId: f.expectation.identity.bookId,
        chapterId: f.expectation.identity.chapterId, label: "Synthetic snapshot", capturedAt: time,
        sourceVersion: f.expectation.identity.version, sourceHash: f.expectation.identity.hash,
        bodyHash: sha256(new TextEncoder().encode(f.body))
      },
      content: f.body
    };
    const rawBytes = new TextEncoder().encode(await serializeHistoryRecord(record, runtime));
    const replanned = await replanCampaignContinuation(f.built.manifestBytes, f.readSegment, {
      sources: [{ kind: "historical", sourceId: f.expectation.sourceId, rawBytes }],
      prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    });
    expect(replanned.status).toBe("matched-local-plan-only");
    if (replanned.status !== "matched-local-plan-only") throw new Error("Expected historical replan");
    expect(replanned.compatibility).toBe("serve-unchanged");
    expect(() => requireCampaignPlan(replanned.plan)).not.toThrow();
  });

  test("replans multiple sources and returns the retained checkpoint inspection", async () => {
    const bodyA = normalizeBody("First synthetic chapter.\n");
    const bodyB = normalizeBody("Second synthetic chapter with more prose.\n");
    const rawA = chapterFile(bodyA, 3, "ch_123456");
    const rawB = chapterFile(bodyB, 5, "ch_654321");
    const input = withSynthesis(await campaignInput(bodyA));
    const firstSource = input.sources[0];
    if (!firstSource) throw new Error("Missing fixture source");
    firstSource.saved = { ...firstSource.saved, hash: sha256(rawA) };
    input.sources.push({ sourceId: "source-2", saved: { bookId: firstSource.saved.bookId, chapterId: "ch_654321",
      version: 5, hash: sha256(rawB), body: bodyB }, bookTitle: "Synthetic book", title: "Second synthetic chapter",
      position: 2, ranges: [{ start: 0, end: bodyB.length }] });
    if (input.policy.synthesis) input.policy.synthesis.evidence.push({ sourceId: "source-2", ranges: [{ start: 0, end: 1 }] });
    const plan = await planned(input);
    const checkpoint = { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
      planDigest: plan.digest, capturedAt: time,
      stages: plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null })) };
    const built = await buildCampaignContinuation(plan, { operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint });
    const files = new Map(built.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
    const replanned = await replanCampaignContinuation(built.manifestBytes, (id) => files.get(id), {
      sources: [
        { kind: "current", sourceId: "source-1", rawBytes: rawA },
        { kind: "current", sourceId: "source-2", rawBytes: rawB }
      ],
      prompt: input.request.prompt, priorFeedback: input.request.priorFeedback
    });
    expect(replanned.status).toBe("matched-local-plan-only");
    if (replanned.status !== "matched-local-plan-only") throw new Error("Expected multi-source replan");
    expect(replanned.plan.digest).toBe(plan.digest);
    expect(replanned.checkpoint?.checkpoint).toMatchObject({ checkpointVersion: 1, campaignId: plan.campaignId });
    expect(() => requireCampaignPlan(replanned.plan)).not.toThrow();
  });

  test("refuses incompatible semantics and schema versions before any source is used", async () => {
    const f = await fixture();
    const future = semanticsManifest(f.built.manifestBytes, "review-campaign-planner-v99");
    expect(inspectCampaignContinuationCompatibility(future)).toEqual({ decision: "refuse", code: "unsupported" });
    const noSources = { sources: [], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback };
    expect(await replanCampaignContinuation(future, f.readSegment, noSources)).toEqual({ status: "refused", code: "unsupported" });
    expect((await serveCampaignContinuation(future, f.plan, f.readSegment, () => undefined)).status).toBe("refused");
    const schema = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    schema.schemaVersion = 3;
    expect(inspectCampaignContinuationCompatibility(encodeCanonicalJson(schema))).toEqual({ decision: "refuse", code: "unsupported" });
    expect(inspectCampaignContinuationCompatibility(new TextEncoder().encode("not json"))).toEqual({ decision: "refuse", code: "corrupt" });
    expect(inspectCampaignContinuationCompatibility(new Uint8Array(262_145))).toEqual({ decision: "refuse", code: "too-large" });
  });

  test("self-consistently rehashed foreign content still cannot pass the match path", async () => {
    const f = await fixture();
    const tokens = [...(await tokenizeCampaignPlan(f.plan)).tokens];
    const index = tokens.findIndex((token) => token.t === "K" && token.value === "chapterId");
    const value = tokens[index + 1];
    if (index < 0 || value?.t !== "V" || typeof value.value !== "string") throw new Error("Missing identity token");
    tokens[index + 1] = { t: "V", value: `${value.value}x` };
    const { digest: _digest, ...content } = f.plan;
    const resolve = ({ path }: { path: ContinuationPath }) => at(content, path);
    const changed = await resolveContinuationTokens(tokens, "plan", resolve);
    const packed = await packContinuationTokenStreams({ ownerBookId: f.plan.ownerBookId, campaignId: f.plan.campaignId,
      planDigest: changed.contentDigest, streams: [{ stream: "plan", tokens }] });
    const stream = packed[0];
    if (!stream) throw new Error("Missing altered stream");
    const manifest = JSON.parse(new TextDecoder().decode(f.built.manifestBytes)) as Record<string, unknown>;
    const forged = encodeCanonicalJson({ ...manifest, planDigest: changed.contentDigest,
      plan: { stream: "plan", tokenCount: stream.tokenCount, segmentBytes: stream.segmentBytes,
        contentDigest: changed.contentDigest, segments: stream.segments.map(({ reference }) => reference) },
      counts: { ...(manifest.counts as Record<string, unknown>), resolvedPlanBytes: changed.contentBytes },
      segmentCount: stream.segments.length, segmentBytes: stream.segmentBytes, tokenCount: stream.tokenCount });
    const forgedFiles = new Map(stream.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
    const read = (id: string) => forgedFiles.get(id);
    // Hash agreement is structural only; complete comparison with the local plan still refuses.
    expect((await resolveContinuationWire(forged, { ownerBookId: f.plan.ownerBookId, campaignId: f.plan.campaignId }, read, resolve)).status)
      .toBe("resolved-structural-only");
    expect((await serveCampaignContinuation(forged, f.plan, read, resolve)).status).toBe("refused");
    expect(await replanCampaignContinuation(forged, read, {
      sources: [f.source], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    })).toEqual({ status: "refused", code: "external-mismatch" });
  });

  test("refuses substituted, missing, extra and unverifiable sources before planning", async () => {
    const f = await fixture();
    const substituted = { kind: "current" as const, sourceId: f.expectation.sourceId,
      rawBytes: chapterFile(normalizeBody("Substituted synthetic prose.\n")) };
    expect(await validateContinuationSources([f.expectation], [substituted])).toEqual({ status: "refused", code: "external-mismatch" });
    expect(await replanCampaignContinuation(f.built.manifestBytes, f.readSegment, {
      sources: [substituted], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    })).toEqual({ status: "refused", code: "external-mismatch" });
    expect(await validateContinuationSources([f.expectation], [])).toEqual({ status: "refused", code: "external-unavailable" });
    expect(await validateContinuationSources([f.expectation], [f.source, { ...f.source, sourceId: "source-extra" }]))
      .toEqual({ status: "refused", code: "corrupt" });
    const wrongVersion = { kind: "current" as const, sourceId: f.expectation.sourceId, rawBytes: chapterFile(f.body, 4) };
    expect(await validateContinuationSources([f.expectation], [wrongVersion])).toEqual({ status: "refused", code: "external-mismatch" });
    const tamperedHistory: HistoryRecord = {
      meta: {
        schemaVersion: 1, kind: "snapshot", id: "hist_123456", bookId: f.expectation.identity.bookId,
        chapterId: f.expectation.identity.chapterId, label: "Synthetic snapshot", capturedAt: time,
        sourceVersion: f.expectation.identity.version, sourceHash: f.expectation.identity.hash,
        bodyHash: sha256(new TextEncoder().encode("Tampered synthetic body.\n"))
      },
      content: "Tampered synthetic body.\n"
    };
    const historical = { kind: "historical" as const, sourceId: f.expectation.sourceId,
      rawBytes: new TextEncoder().encode(await serializeHistoryRecord(tamperedHistory, runtime)) };
    expect(await validateContinuationSources([f.expectation], [historical])).toEqual({ status: "refused", code: "external-mismatch" });
    const validated = await validateContinuationSources([f.expectation], [f.source]);
    expect(validated.status).toBe("validated");
    if (validated.status === "validated") {
      expect(validated.sources[0]?.body).toBe(f.body);
      expect(validated.sources[0]?.identity).toEqual(f.expectation.identity);
    }
  });

  test("refuses a replanned result that does not match instead of force-fitting it", async () => {
    const f = await fixture();
    const result = await replanCampaignContinuation(f.built.manifestBytes, f.readSegment, {
      sources: [f.source], prompt: "A different supplied prompt.", priorFeedback: f.input.request.priorFeedback
    });
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.code).toBe("external-mismatch");
  });

  test("does not transfer provenance to reconstructed or cloned plans", async () => {
    const f = await fixture();
    const replanned = await replanCampaignContinuation(f.built.manifestBytes, f.readSegment, {
      sources: [f.source], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    });
    if (replanned.status !== "matched-local-plan-only") throw new Error("Expected replanned continuation");
    expect(() => requireCampaignPlan(replanned.plan)).not.toThrow();
    const reconstructed = JSON.parse(JSON.stringify(replanned.plan)) as CampaignPlan;
    expect(() => requireCampaignPlan(reconstructed)).toThrow();
    expect(() => requireCampaignPlan({ ...replanned.plan })).toThrow();
    const { digest: _digest, ...content } = replanned.plan;
    const served = await serveCampaignContinuation(f.built.manifestBytes, reconstructed, f.readSegment, ({ path }) => at(content, path));
    expect(served.status).toBe("refused");
    if (served.status === "refused") expect(served.code).toBe("unvalidated-campaign-plan");
  });

  test("enforces per-file and total raw source bounds at their exact boundaries", async () => {
    const f = await fixture();
    const { fileBytes, totalBytes } = CONTINUATION_REPLAN_SOURCE_LIMITS;
    expect(totalBytes).toBe(4 * fileBytes);
    const exact = new Uint8Array(fileBytes);
    const atLimit = await validateContinuationSources([f.expectation], [{ kind: "current", sourceId: f.expectation.sourceId, rawBytes: exact }]);
    expect(atLimit).toEqual({ status: "refused", code: "external-mismatch" });
    const overLimit = await validateContinuationSources([f.expectation],
      [{ kind: "current", sourceId: f.expectation.sourceId, rawBytes: new Uint8Array(fileBytes + 1) }]);
    expect(overLimit).toEqual({ status: "refused", code: "too-large" });
    const files = [exact, new Uint8Array(fileBytes), new Uint8Array(fileBytes), new Uint8Array(fileBytes)];
    const inputs = files.map((rawBytes, index) => ({ kind: "current" as const, sourceId: `source-${index}`, rawBytes }));
    const expectations = inputs.map((input) => ({ ...f.expectation, sourceId: input.sourceId }));
    expect(await validateContinuationSources(expectations, inputs)).toEqual({ status: "refused", code: "external-mismatch" });
    expect(await validateContinuationSources(expectations, [...inputs, { kind: "current" as const, sourceId: "source-extra", rawBytes: new Uint8Array(1) }]))
      .toEqual({ status: "refused", code: "too-large" });
  }, 90_000);
});
