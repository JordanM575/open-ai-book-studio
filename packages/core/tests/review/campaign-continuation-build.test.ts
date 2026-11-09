import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import { compareContinuationWithLocalPlan } from "../../src/review/campaign-continuation-match";
import { resolveContinuationWire } from "../../src/review/campaign-continuation-resolve";
import { CONTINUATION_SEGMENT_LIMITS, preflightContinuationPacking } from "../../src/review/campaign-continuation-segments";
import { requireCampaignPlan, type CampaignPlan } from "../../src/review/campaign-planner";
import { inspectContinuationWire, readContinuationManifest, readContinuationPublicationIntent } from "../../src/review/campaign-continuation-wire";
import { canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson } from "../../src/review/record-json";
import { CONTINUATION_TOKEN_LIMITS, preflightCampaignPlanTokenCount, preflightCheckpointTokenCount,
  type ContinuationPath, type ContinuationToken } from "../../src/review/campaign-continuation-tokens";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const time = "2026-11-08T12:00:00.000Z";
const later = "2026-11-08T12:01:00.000Z";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function at(root: unknown, path: ContinuationPath): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new Error("Bad fixture path");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}
function checkpointFor(plan: CampaignPlan) {
  return { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
    planDigest: plan.digest, capturedAt: time, stages: plan.stages.map((stage) => ({ stageId: stage.stageId,
      receipt: null as null | { status: string; completedCategories: string[]; at: string | null;
        actualScopeDigest: string | null; report: null | { ownerBookId: string; runId: string; sha256: string } } })) };
}
function segmentMap(result: Awaited<ReturnType<typeof buildCampaignContinuation>>) {
  return new Map(result.segments.map(({ reference, bytes }) => [reference.id, bytes]));
}
const options = { operationId: "operation-one", createdAt: time, updatedAt: time };

describe("in-memory continuation candidate builder", () => {
  test("builds absent, empty-facts and host-reported checkpoints and round-trips exact content without provenance", async () => {
    const input = withSynthesis(await campaignInput("SOURCE_SENTINEL 🧪\n"));
    input.request.prompt = "PROMPT_SENTINEL";
    input.request.priorFeedback = [{ id: "feedback-one", runId: "run-one", label: "synthetic", text: "FEEDBACK_SENTINEL" }];
    const plan = await planned(input);
    const fresh = await planned(input);
    const root = checkpointFor(plan);
    const first = root.stages[0];
    if (!first) throw new Error("Missing stage");
    const reported = clone(root);
    const receiptStage = reported.stages[0];
    if (!receiptStage) throw new Error("Missing stage");
    receiptStage.receipt = { status: "completed", completedCategories: [plan.categories[0] ?? ""], at: time,
      actualScopeDigest: "a".repeat(64), report: { ownerBookId: plan.ownerBookId, runId: first.stageId, sha256: "b".repeat(64) } };
    const { digest: _digest, ...content } = plan;
    for (const checkpoint of [null, root, reported]) {
      const result = await buildCampaignContinuation(plan, { ...options, checkpoint });
      expect(result.status).toBe("candidate-only");
      expect(result.unresolvedReportCount).toBe(checkpoint === reported ? 1 : 0);
      const files = segmentMap(result);
      const expected = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
      const manifest = readContinuationManifest(result.manifestBytes, expected);
      expect(manifest.checkpoint === null).toBe(checkpoint === null);
      const intent = await readContinuationPublicationIntent(result.intentBytes, { ...expected, operationId: options.operationId });
      expect(Array.from(intent.candidateBytes)).toEqual(Array.from(result.manifestBytes));
      const resolved = await resolveContinuationWire(result.manifestBytes, expected, (id) => files.get(id), ({ path }) => at(content, path));
      expect(resolved.status).toBe("resolved-structural-only");
      expect(canonicalJsonText(resolved.untrustedPlanContent)).toBe(canonicalJsonText(content));
      expect(resolved.checkpoint === null).toBe(checkpoint === null);
      const matched = await compareContinuationWithLocalPlan(result.manifestBytes, fresh, (id) => files.get(id), ({ path }) => at(content, path));
      expect(canonicalJsonText(matched.untrustedPlanContent)).toBe(canonicalJsonText(content));
      if (typeof manifest.plannedUnionDigest !== "string") throw new Error("Missing union digest");
      expect(matched.plannedUnionDigest).toBe(manifest.plannedUnionDigest);
      expect(() => requireCampaignPlan({ ...(matched.untrustedPlanContent as typeof content), digest: plan.digest })).toThrow();
      for (const bytes of [result.manifestBytes, result.intentBytes, ...files.values()]) {
        const text = new TextDecoder().decode(bytes);
        for (const secret of ["SOURCE_SENTINEL", "PROMPT_SENTINEL", "FEEDBACK_SENTINEL"]) expect(text).not.toContain(secret);
      }
    }
  });

  test("changed plans get new immutable segments; unmappable segment extensions refuse a rewrite", async () => {
    const original = await planned(await campaignInput("Original synthetic text.\n"));
    const changed = await planned(await campaignInput("Different synthetic text.\n"));
    const first = await buildCampaignContinuation(original, { ...options, checkpoint: null });
    const files = segmentMap(first);
    const identity = { ownerBookId: original.ownerBookId, campaignId: original.campaignId };
    const previous = { manifestBytes: first.manifestBytes, plan: original, readSegment: (id: string) => files.get(id) };
    const next = await buildCampaignContinuation(changed, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: null, previous });
    const nextFiles = segmentMap(next);
    const nextManifest = readContinuationManifest(next.manifestBytes, identity);
    expect(nextManifest.planDigest).toBe(changed.digest);
    expect(nextManifest.plan.segments.every((ref) => !files.has(ref.id))).toBe(true);
    const { digest: _digest, ...content } = changed;
    const matched = await compareContinuationWithLocalPlan(next.manifestBytes, changed, (id) => nextFiles.get(id), ({ path }) => at(content, path));
    expect(canonicalJsonText(matched.untrustedPlanContent)).toBe(canonicalJsonText(content));

    const priorManifest = readContinuationManifest(first.manifestBytes, identity);
    const ref = priorManifest.plan.segments[0];
    if (!ref || priorManifest.plan.segments.length !== 1) throw new Error("Expected one plan segment");
    const raw = files.get(ref.id);
    if (!raw) throw new Error("Missing plan segment");
    const { id: _id, ...body } = decodeStrictJsonBytes(raw) as Record<string, unknown>;
    const extended = { ...body, future: { keep: true } };
    const id = `s-${hash(encodeCanonicalJson(extended))}`;
    const bytes = encodeCanonicalJson({ ...extended, id });
    const replacement = { ...ref, id, bytes: bytes.length, sha256: hash(bytes) };
    const manifestBytes = encodeCanonicalJson({ ...priorManifest,
      plan: { ...priorManifest.plan, segmentBytes: bytes.length, segments: [replacement] }, segmentBytes: bytes.length });
    files.set(id, bytes);
    await expect(buildCampaignContinuation(changed, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: null, previous: { ...previous, manifestBytes } })).rejects.toThrow();
  });

  test("retains loose own fields and immutable unknown plan-segment bytes on a checkpoint revision", async () => {
    const plan = await planned(await campaignInput());
    const initialCheckpoint = checkpointFor(plan);
    const entry = initialCheckpoint.stages[0];
    if (!entry) throw new Error("Missing stage");
    entry.receipt = { status: "completed", completedCategories: [...plan.categories], at: time, actualScopeDigest: null, report: null };
    Object.defineProperty(initialCheckpoint, "__proto__", { value: { root: true }, enumerable: true });
    Object.defineProperty(entry, "__proto__", { value: { stage: true }, enumerable: true });
    Object.defineProperty(entry.receipt, "__proto__", { value: { receipt: true }, enumerable: true });
    const unknown: unknown = JSON.parse('{"__proto__":{"note":"retained"},"future":"🧪"}');
    const first = await buildCampaignContinuation(plan, { ...options, checkpoint: initialCheckpoint,
      manifestUnknown: unknown, countsUnknown: { futureCount: [1, 2] }, intentUnknown: unknown });
    const files = segmentMap(first);
    const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
    const manifest = readContinuationManifest(first.manifestBytes, identity);
    const ref = manifest.plan.segments[0];
    if (!ref) throw new Error("Missing plan reference");
    const original = files.get(ref.id);
    if (!original) throw new Error("Missing plan segment");
    const document = decodeStrictJsonBytes(original) as Record<string, unknown>;
    Object.defineProperty(document, "__proto__", { value: { segment: true }, enumerable: true });
    const { id: _oldId, ...body } = document;
    const id = `s-${hash(encodeCanonicalJson(body))}`;
    const replacement = encodeCanonicalJson({ ...body, id });
    const replacementRef = { ...ref, id, bytes: replacement.length, sha256: hash(replacement) };
    const changedManifest = { ...manifest, plan: { ...manifest.plan, segments: [replacementRef], segmentBytes: replacement.length },
      segmentBytes: (manifest.segmentBytes as number) - ref.bytes + replacement.length };
    const priorBytes = encodeCanonicalJson(changedManifest);
    files.set(id, replacement);
    const newCheckpoint = checkpointFor(plan);
    const newEntry = newCheckpoint.stages[0];
    if (!newEntry) throw new Error("Missing stage");
    newEntry.receipt = { status: "completed", completedCategories: [], at: later, actualScopeDigest: null, report: null };
    const updated = await buildCampaignContinuation(plan, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: newCheckpoint, previous: { manifestBytes: priorBytes, plan, readSegment: (key) => files.get(key) } });
    const updatedFiles = segmentMap(updated);
    const inspection = await inspectContinuationWire(updated.manifestBytes, identity, (key) => updatedFiles.get(key));
    expect(inspection.manifest.revision).toBe(2);
    expect(inspection.manifest.base).toEqual({ kind: "sha256", revision: 1, value: hash(priorBytes) });
    expect(Object.hasOwn(inspection.manifest, "__proto__")).toBe(true);
    expect((inspection.manifest.counts as Record<string, unknown>).futureCount).toEqual([1, 2]);
    expect(inspection.manifest.plan.segments[0]?.id).toBe(id);
    expect(updatedFiles.get(id)).toEqual(replacement);
    const savedCheckpoint = inspection.streams.find((stream) => stream.stream === "checkpoint")?.root as Record<string, unknown>;
    expect(Object.hasOwn(savedCheckpoint, "__proto__")).toBe(true);
    const stages = savedCheckpoint.stages as Record<string, unknown>[];
    expect(Object.hasOwn(stages[0] as object, "__proto__")).toBe(true);
    const receipt = stages[0]?.receipt as Record<string, unknown>;
    expect(Object.hasOwn(receipt, "__proto__")).toBe(true);
    expect(receipt.at).toBe(later);
  });

  test("refuses discarded receipt or segment unknowns, forged previous counts and unprovenanced plans", async () => {
    const input = await campaignInput();
    const plan = await planned(input);
    const cp = checkpointFor(plan);
    const entry = cp.stages[0];
    if (!entry) throw new Error("Missing stage");
    entry.receipt = { status: "completed", completedCategories: [...plan.categories], at: time, actualScopeDigest: null, report: null };
    Object.defineProperty(entry.receipt, "__proto__", { value: { keep: true }, enumerable: true });
    const first = await buildCampaignContinuation(plan, { ...options, checkpoint: cp });
    const files = segmentMap(first);
    const previous = { manifestBytes: first.manifestBytes, plan, readSegment: (id: string) => files.get(id) };
    await expect(buildCampaignContinuation(plan, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: checkpointFor(plan), previous })).rejects.toThrow();
    await expect(buildCampaignContinuation({ ...plan }, { ...options, checkpoint: null })).rejects.toThrow();
    await expect(buildCampaignContinuation(plan, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: cp, previous: { ...previous, plan: { ...plan } } })).rejects.toThrow();
    const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
    const manifest = readContinuationManifest(first.manifestBytes, identity);
    const counts = { ...(manifest.counts as Record<string, unknown>), stages: 999 };
    const forged = encodeCanonicalJson({ ...manifest, counts });
    await expect(buildCampaignContinuation(plan, { operationId: "operation-two", createdAt: time, updatedAt: later,
      checkpoint: cp, previous: { ...previous, manifestBytes: forged } })).rejects.toThrow();
  });

  test("does not silently replace supported unknown fields during revisions", async () => {
    const plan = await planned(await campaignInput());
    const checkpoint = checkpointFor(plan);
    const entry = checkpoint.stages[0];
    if (!entry) throw new Error("Missing stage");
    entry.receipt = { status: "completed", completedCategories: [], at: time, actualScopeDigest: null, report: null };
    Object.assign(checkpoint, { futureRoot: { value: 1 } });
    Object.assign(entry, { futureStage: [1] });
    Object.assign(entry.receipt, { futureReceipt: "original" });
    const first = await buildCampaignContinuation(plan, { ...options, checkpoint,
      manifestUnknown: { futureManifest: "original" }, countsUnknown: { futureCount: 1 } });
    const files = segmentMap(first);
    const previous = { manifestBytes: first.manifestBytes, plan, readSegment: (id: string) => files.get(id) };
    const next = { operationId: "operation-two", createdAt: time, updatedAt: later, previous };
    await expect(buildCampaignContinuation(plan, { ...next, checkpoint: clone(checkpoint),
      manifestUnknown: { futureManifest: "original" }, countsUnknown: { futureCount: 1 } })).resolves.toBeDefined();
    await expect(buildCampaignContinuation(plan, { ...next, checkpoint, manifestUnknown: { futureManifest: "changed" } })).rejects.toThrow("unsupported");
    await expect(buildCampaignContinuation(plan, { ...next, checkpoint, countsUnknown: { futureCount: 2 } })).rejects.toThrow("unsupported");
    for (const level of ["root", "stage", "receipt"]) {
      const changed = clone(checkpoint) as typeof checkpoint & { futureRoot: { value: number } };
      const stage = changed.stages[0] as (typeof entry) & { futureStage: number[] };
      const receipt = stage.receipt as NonNullable<typeof entry.receipt> & { futureReceipt: string };
      if (level === "root") changed.futureRoot.value = 2;
      if (level === "stage") stage.futureStage.push(2);
      if (level === "receipt") receipt.futureReceipt = "changed";
      await expect(buildCampaignContinuation(plan, { ...next, checkpoint: changed })).rejects.toThrow("unsupported");
    }
  });

  test("preflights retained segment extensions against the real combined byte limit", async () => {
    const plan = await planned(await campaignInput());
    const first = await buildCampaignContinuation(plan, { ...options, checkpoint: null });
    const files = segmentMap(first);
    const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
    const manifest = readContinuationManifest(first.manifestBytes, identity);
    const ref = manifest.plan.segments[0];
    if (!ref || manifest.plan.segments.length !== 1) throw new Error("Expected one plan segment");
    const original = files.get(ref.id);
    if (!original) throw new Error("Missing segment");
    const { id: _id, ...body } = decodeStrictJsonBytes(original) as Record<string, unknown>;
    const extended = { ...body, future: "z".repeat(2_048) };
    const id = `s-${hash(encodeCanonicalJson(extended))}`;
    const bytes = encodeCanonicalJson({ ...extended, id });
    const delta = bytes.length - ref.bytes;
    const newRef = { ...ref, id, bytes: bytes.length, sha256: hash(bytes) };
    const previousBytes = encodeCanonicalJson({ ...manifest, plan: { ...manifest.plan, segmentBytes: bytes.length, segments: [newRef] },
      segmentBytes: bytes.length });
    files.set(id, bytes);
    const large = "x".repeat(1_899_900);
    const checkpoint = { ...checkpointFor(plan), future: [...Array<string>(17).fill(large), "y".repeat(500_000)] };
    const initial = preflightContinuationPacking(plan, checkpoint);
    const tail = 500_000 + CONTINUATION_SEGMENT_LIMITS.bytes - delta - initial.segmentBytes + 1;
    expect(tail).toBeGreaterThan(500_000);
    expect(tail).toBeLessThan(CONTINUATION_TOKEN_LIMITS.tokenBytes - 100);
    checkpoint.future[17] = "y".repeat(tail);
    const projected = preflightContinuationPacking(plan, checkpoint);
    expect(projected.segmentBytes + delta).toBe(CONTINUATION_SEGMENT_LIMITS.bytes + 1);
    await expect(buildCampaignContinuation(plan, { operationId: "operation-two", createdAt: time, updatedAt: later, checkpoint,
      previous: { manifestBytes: previousBytes, plan, readSegment: (key) => files.get(key) } })).rejects.toThrow("too-large");
  }, 90_000);

  test("takes detached checkpoint and extension snapshots before yielding and rejects synthesis reservation as actual", async () => {
    const plan = await planned(withSynthesis(await campaignInput()));
    const checkpoint = checkpointFor(plan);
    const extra = { note: "before" };
    const pending = buildCampaignContinuation(plan, { ...options, checkpoint, manifestUnknown: extra });
    extra.note = "after";
    checkpoint.capturedAt = later;
    const result = await pending;
    const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
    const files = segmentMap(result);
    const wire = await inspectContinuationWire(result.manifestBytes, identity, (id) => files.get(id));
    expect(wire.manifest.note).toBe("before");
    const saved = wire.streams.find((stream) => stream.stream === "checkpoint");
    if (!saved) throw new Error("Missing checkpoint");
    expect((saved.root as Record<string, unknown>).capturedAt).toBe(time);
    const synthesis = plan.stages.findIndex((stage) => stage.kind === "synthesis");
    const stage = plan.stages[synthesis];
    const entry = checkpoint.stages[synthesis];
    if (!stage || !entry) throw new Error("Missing synthesis stage");
    entry.receipt = { status: "completed", completedCategories: [], at: time, actualScopeDigest: stage.envelope.scopeDigest, report: null };
    await expect(buildCampaignContinuation(plan, { ...options, checkpoint })).rejects.toThrow();
  });

  test("preflights the actual combined million-token budget before snapshotting a checkpoint", async () => {
    const plan = await planned(await campaignInput());
    const planCount = preflightCampaignPlanTokenCount(plan);
    const checkpoint = { ...checkpointFor(plan), future: [] as null[] };
    const emptyCount = preflightCheckpointTokenCount(checkpoint, planCount);
    checkpoint.future = Array<null>(CONTINUATION_TOKEN_LIMITS.tokens - planCount - emptyCount).fill(null);
    const checkpointCount = preflightCheckpointTokenCount(checkpoint, planCount);
    expect(planCount + checkpointCount).toBe(CONTINUATION_TOKEN_LIMITS.tokens);
    checkpoint.future.push(null);
    expect(() => preflightCheckpointTokenCount(checkpoint, planCount)).toThrow("too-large");
    await expect(buildCampaignContinuation(plan, { ...options, checkpoint })).rejects.toThrow("too-large");
  }, 90_000);

  test("preflights the real combined segment-byte limit before checkpoint or token snapshots", async () => {
    const plan = await planned(await campaignInput());
    const large = "x".repeat(1_899_900);
    const checkpoint = { ...checkpointFor(plan), future: [...Array<string>(17).fill(large), "y".repeat(500_000)] };
    const initial = preflightContinuationPacking(plan, checkpoint);
    expect(initial.segmentCount).toBeGreaterThan(1);
    const tail = 500_000 + CONTINUATION_SEGMENT_LIMITS.bytes - initial.segmentBytes;
    expect(tail).toBeGreaterThan(500_000);
    expect(tail).toBeLessThan(CONTINUATION_TOKEN_LIMITS.tokenBytes - 100);
    checkpoint.future[17] = "y".repeat(tail);
    const exact = preflightContinuationPacking(plan, checkpoint);
    expect(exact.segmentBytes).toBe(CONTINUATION_SEGMENT_LIMITS.bytes);
    checkpoint.future[17] = "y".repeat(tail + 1);
    expect(() => preflightContinuationPacking(plan, checkpoint)).toThrow("too-large");
    await expect(buildCampaignContinuation(plan, { ...options, checkpoint })).rejects.toThrow("too-large");
  }, 90_000);

  test("reconstructs the complete 70k and 250k word plans through actual manifest and segment bytes", async () => {
    for (const words of [70_000, 250_000]) {
      const input = withSynthesis(await campaignInput("word ".repeat(words)));
      const plan = await planned(input);
      const fresh = await planned(input);
      const result = await buildCampaignContinuation(plan, { ...options, checkpoint: null });
      const files = segmentMap(result);
      const { digest: _digest, ...content } = plan;
      const matched = await compareContinuationWithLocalPlan(result.manifestBytes, fresh, (id) => files.get(id), ({ path }) => at(content, path));
      expect(canonicalJsonText(matched.untrustedPlanContent)).toBe(canonicalJsonText(content));
      expect(fresh.digest).toBe(plan.digest);
      const manifest = readContinuationManifest(result.manifestBytes, { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId });
      if (typeof manifest.plannedUnionDigest !== "string") throw new Error("Missing union digest");
      expect(matched.plannedUnionDigest).toBe(manifest.plannedUnionDigest);
      expect(() => requireCampaignPlan({ ...(matched.untrustedPlanContent as typeof content), digest: plan.digest })).toThrow();
    }
  }, 90_000);

  test("round-trips 120 sources and actual cross-segment dependencies without losing any planner field", async () => {
    const input = withSynthesis(await campaignInput());
    const template = input.sources[0];
    if (!template) throw new Error("Missing fixture source");
    input.sources = Array.from({ length: 120 }, (_, index) => {
      const body = `${"word ".repeat(index === 119 ? 2_123 : 2_083)}\n`;
      return { ...template, sourceId: `source-${index}`, position: index + 1,
        saved: { ...template.saved, chapterId: `ch_${String(index).padStart(6, "0")}`, body },
        ranges: [{ start: 0, end: body.length }] };
    });
    input.request.destination.model += "x".repeat(20_000);
    const plan = await planned(input);
    const fresh = await planned(input);
    const built = await buildCampaignContinuation(plan, { ...options, checkpoint: null });
    const files = segmentMap(built);
    const identity = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
    const manifest = readContinuationManifest(built.manifestBytes, identity);
    expect(plan.sources).toHaveLength(120);
    expect(plan.stages.length).toBeGreaterThan(120);
    expect(manifest.plan.segments.length).toBeGreaterThan(1);
    const locations = new Map<string, number[]>();
    for (const [index, ref] of manifest.plan.segments.entries()) {
      const bytes = files.get(ref.id);
      if (!bytes) throw new Error("Missing plan segment");
      const document = decodeStrictJsonBytes(bytes) as { tokens: ContinuationToken[] };
      for (const token of document.tokens) if (token.t === "V" && typeof token.value === "string") {
        const found = locations.get(token.value) ?? [];
        found.push(index);
        locations.set(token.value, found);
      }
    }
    expect(plan.stages.some((stage) => stage.dependencies.some((dependency) => {
      const earlier = locations.get(dependency)?.[0];
      const later = locations.get(stage.stageId)?.at(-1);
      return earlier !== undefined && later !== undefined && earlier < later;
    }))).toBe(true);
    const { digest: _digest, ...content } = plan;
    const matched = await compareContinuationWithLocalPlan(built.manifestBytes, fresh, (id) => files.get(id), ({ path }) => at(content, path));
    expect(canonicalJsonText(matched.untrustedPlanContent)).toBe(canonicalJsonText(content));
    if (typeof manifest.plannedUnionDigest !== "string") throw new Error("Missing union digest");
    expect(matched.plannedUnionDigest).toBe(manifest.plannedUnionDigest);
    expect(fresh.digest).toBe(plan.digest);
  }, 120_000);

  test("retains every one of 70 disjoint selected spans through the complete wire", async () => {
    const input = await campaignInput("a_".repeat(70));
    const source = input.sources[0];
    if (!source) throw new Error("Missing source");
    source.ranges = Array.from({ length: 70 }, (_, index) => ({ start: index * 2, end: index * 2 + 1 }));
    const plan = await planned(input);
    const result = await buildCampaignContinuation(plan, { ...options, checkpoint: null });
    const files = segmentMap(result);
    const { digest: _digest, ...content } = plan;
    const matched = await compareContinuationWithLocalPlan(result.manifestBytes, plan, (id) => files.get(id), ({ path }) => at(content, path));
    expect(plan.sources[0]?.segments.length).toBe(70);
    expect(plan.stages.length).toBe(70);
    expect(canonicalJsonText(matched.untrustedPlanContent)).toBe(canonicalJsonText(content));
  }, 90_000);
});
