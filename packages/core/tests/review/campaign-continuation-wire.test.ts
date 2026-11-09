import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { requireCampaignPlan } from "../../src/review/campaign-planner";
import { canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson } from "../../src/review/record-json";
import { packContinuationTokenStreams } from "../../src/review/campaign-continuation-segments";
import { compareContinuationWithLocalPlan } from "../../src/review/campaign-continuation-match";
import { measureProvenancedCampaign } from "../../src/review/campaign-continuation-metrics";
import { resolveContinuationWire } from "../../src/review/campaign-continuation-resolve";
import { ContinuationTokenError, resolveContinuationTokens, tokenizeCampaignPlan, tokenizeCheckpointValue, type ContinuationPath, type ContinuationToken } from "../../src/review/campaign-continuation-tokens";
import { CONTINUATION_WIRE_LIMITS, inspectContinuationWire, readContinuationManifest, readContinuationPublicationIntent } from "../../src/review/campaign-continuation-wire";
import { campaignInput, planned } from "./campaign-fixtures";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encoded = (value: unknown) => encodeCanonicalJson(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const timestamp = "2026-11-08T12:00:00.000Z";

async function fixture(checkpoint?: unknown) {
  const input = await campaignInput("SOURCE_SENTINEL 🧪\n");
  input.request.prompt = "PROMPT_SENTINEL";
  const plan = await planned(input);
  const planStream = await tokenizeCampaignPlan(plan);
  const checkpointStream = checkpoint === undefined ? null : await tokenizeCheckpointValue(checkpoint);
  const measured = await measureProvenancedCampaign(plan);
  const packed = await packContinuationTokenStreams({ ownerBookId: plan.ownerBookId, campaignId: plan.campaignId,
    planDigest: plan.digest, streams: [
      { stream: "plan", tokens: planStream.tokens },
      ...(checkpointStream ? [{ stream: "checkpoint" as const, tokens: checkpointStream.tokens }] : [])
    ] });
  const planPack = packed[0];
  if (!planPack) throw new Error("Missing plan stream");
  const checkpointPack = packed[1];
  const descriptor = (stream: typeof planPack, contentDigest: string) => ({ stream: stream.stream,
    tokenCount: stream.tokenCount, segmentBytes: stream.segmentBytes, contentDigest,
    segments: stream.segments.map(({ reference }) => ({ ...reference })) });
  const manifest = {
    schemaVersion: 2, kind: "review-campaign", owner: { bookId: plan.ownerBookId }, id: plan.campaignId,
    revision: 1, base: { kind: "absent", revision: 0 }, createdAt: timestamp, updatedAt: timestamp,
    publicationId: "op-synthetic", plannerSemantics: "review-campaign-planner-v1", planDigest: plan.digest,
    plan: descriptor(planPack, plan.digest),
    checkpoint: checkpointPack && checkpointStream ? descriptor(checkpointPack, checkpointStream.contentDigest) : null,
    counts: measured.counts,
    plannedUnionDigest: measured.plannedUnionDigest, segmentCount: packed.reduce((n, stream) => n + stream.segments.length, 0),
    segmentBytes: packed.reduce((n, stream) => n + stream.segmentBytes, 0),
    tokenCount: packed.reduce((n, stream) => n + stream.tokenCount, 0)
  };
  const files = new Map(packed.flatMap((stream) => stream.segments.map((segment) => [segment.reference.id, segment.bytes] as const)));
  const expected = { ownerBookId: plan.ownerBookId, campaignId: plan.campaignId };
  return { input, plan, manifest, files, expected };
}

function lookup(root: unknown, path: ContinuationPath): unknown {
  let value: unknown = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new Error("Bad fixture path");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}

function intentFor(manifestBytes: Uint8Array, manifest: ReturnType<typeof JSON.parse>) {
  return { schemaVersion: 1, kind: "review-campaign-publication-intent", owner: manifest.owner,
    id: manifest.publicationId, revision: 1, campaignId: manifest.id, createdAt: timestamp,
    expectedBase: manifest.base, candidate: { encoding: "base64", bytes: manifestBytes.length,
      sha256: digest(manifestBytes), data: Buffer.from(manifestBytes).toString("base64") } };
}

describe("continuation wire inspection and structural resolution", () => {
  test("verifies segment identities and checkpoint digest, retains unknowns and leaves the resolved plan untrusted", async () => {
    const checkpoint: unknown = JSON.parse('{"__proto__":{"note":"🧪"},"checkpointVersion":1,"stages":[]}');
    const f = await fixture(checkpoint);
    const manifest = { ...f.manifest, futureLoose: 1 };
    Object.defineProperty(manifest, "__proto__", { value: { unknown: true }, enumerable: true });
    const raw = encoded(manifest);
    const result = await inspectContinuationWire(raw, f.expected, (id) => f.files.get(id));
    expect(result.status).toBe("structural-only");
    expect(Object.hasOwn(result.manifest, "__proto__")).toBe(true);
    expect(result.streams).toHaveLength(2);
    expect(Object.hasOwn(result.streams[1]?.root as object, "__proto__")).toBe(true);
    for (const bytes of f.files.values()) {
      const text = new TextDecoder().decode(bytes);
      expect(text).not.toContain("SOURCE_SENTINEL");
      expect(text).not.toContain("PROMPT_SENTINEL");
    }
    const { digest: _digest, ...content } = f.plan;
    const resolved = await resolveContinuationTokens(result.streams[0]?.tokens ?? [], "plan", ({ path }) => lookup(content, path));
    expect(canonicalJsonText(resolved.root)).toBe(canonicalJsonText(content));
    expect(resolved.contentDigest).toBe(f.plan.digest);
    expect(() => requireCampaignPlan({ ...(resolved.root as typeof content), digest: f.plan.digest })).toThrow();
    const fresh = await planned(f.input);
    expect(fresh.digest).toBe(resolved.contentDigest);
  });

  test("refuses missing, changed, foreign, duplicate and reordered references or segment bytes", async () => {
    const f = await fixture(["x".repeat(1_100_000), "y".repeat(1_100_000)]);
    if (!f.manifest.checkpoint || f.manifest.checkpoint.segments.length < 2) throw new Error("Expected split checkpoint");
    const check = (manifest: typeof f.manifest, files = f.files) => inspectContinuationWire(encoded(manifest), f.expected, (id) => files.get(id));
    const missing = new Map(f.files);
    missing.delete(f.manifest.plan.segments[0]?.id ?? "");
    await expect(check(f.manifest, missing)).rejects.toThrow();
    const changed = new Map(f.files);
    const first = f.manifest.plan.segments[0];
    if (!first) throw new Error("Missing reference");
    const original = changed.get(first.id);
    if (!original) throw new Error("Missing bytes");
    const forged = new Uint8Array(original);
    forged[forged.length - 1] = 32;
    changed.set(first.id, forged);
    await expect(check(f.manifest, changed)).rejects.toThrow();
    const foreign = clone(f.manifest);
    foreign.owner.bookId = "book_999999";
    await expect(check(foreign)).rejects.toThrow();
    const duplicate = clone(f.manifest);
    if (!duplicate.checkpoint) throw new Error("Missing checkpoint");
    const duplicateReference = duplicate.plan.segments[0];
    if (!duplicateReference) throw new Error("Missing plan reference");
    duplicate.checkpoint.segments[0] = clone(duplicateReference);
    await expect(check(duplicate)).rejects.toThrow();
    const reordered = clone(f.manifest);
    if (!reordered.checkpoint) throw new Error("Missing checkpoint");
    reordered.checkpoint.segments.reverse();
    await expect(check(reordered)).rejects.toThrow();
    const badDigest = clone(f.manifest);
    if (!badDigest.checkpoint) throw new Error("Missing checkpoint");
    badDigest.checkpoint.contentDigest = "b".repeat(64);
    await expect(check(badDigest)).rejects.toThrow();
  }, 30_000);

  test("checks raw hash independently of the segment's semantic ID, and rejects closed-control extensions", async () => {
    const f = await fixture();
    const changed = clone(f.manifest);
    const ref = changed.plan.segments[0];
    if (!ref) throw new Error("Missing reference");
    const original = f.files.get(ref.id);
    if (!original) throw new Error("Missing segment");
    const segment = decodeStrictJsonBytes(original) as Record<string, unknown>;
    segment.future = "changed body";
    const bytes = encoded(segment);
    ref.sha256 = digest(bytes);
    ref.bytes = bytes.length;
    changed.plan.segmentBytes = bytes.length;
    changed.segmentBytes = bytes.length;
    const files = new Map(f.files).set(ref.id, bytes);
    await expect(inspectContinuationWire(encoded(changed), f.expected, (id) => files.get(id))).rejects.toThrow();
    const unknownControl = clone(f.manifest) as typeof f.manifest & { owner: { future?: boolean } };
    unknownControl.owner.future = true;
    expect(() => readContinuationManifest(encoded(unknownControl), f.expected)).toThrow();
    const future = clone(f.manifest);
    future.plannerSemantics = "future";
    expect(() => readContinuationManifest(encoded(future), f.expected)).toThrow();
    const wrongTotal = clone(f.manifest);
    wrongTotal.tokenCount++;
    expect(() => readContinuationManifest(encoded(wrongTotal), f.expected)).toThrow();
    expect(() => readContinuationManifest(new TextEncoder().encode('{"schemaVersion":2,"schemaVersion":2}'), f.expected)).toThrow();
  });

  test("validates exact canonical publication candidate, padded base64, binding and unknown intent data", async () => {
    const f = await fixture();
    const manifestBytes = encoded(f.manifest);
    const expected = { ...f.expected, operationId: f.manifest.publicationId };
    const intent = { ...intentFor(manifestBytes, f.manifest), note: "retained 🧪" };
    Object.defineProperty(intent, "__proto__", { value: { retained: true }, enumerable: true });
    const result = await readContinuationPublicationIntent(encoded(intent), expected);
    expect(result.status).toBe("structural-only");
    expect(Object.hasOwn(result.intent, "__proto__")).toBe(true);
    expect(Array.from(result.candidateBytes)).toEqual(Array.from(manifestBytes));
    const wrong = clone(intent);
    wrong.candidate.sha256 = "0".repeat(64);
    await expect(readContinuationPublicationIntent(encoded(wrong), expected)).rejects.toThrow();
    const badBase64 = clone(intent);
    badBase64.candidate.data += "\n";
    await expect(readContinuationPublicationIntent(encoded(badBase64), expected)).rejects.toThrow();
    const badBase = clone(intent);
    badBase.expectedBase = { kind: "absent", revision: 1 };
    await expect(readContinuationPublicationIntent(encoded(badBase), expected)).rejects.toThrow();
    const noncanonical = new TextEncoder().encode(` ${canonicalJsonText(f.manifest)}`);
    await expect(readContinuationPublicationIntent(encoded(intentFor(noncanonical, f.manifest)), expected)).rejects.toThrow();
  });

  test("matches full reconstructed content and recomputed counts/union only against an existing local plan", async () => {
    const f = await fixture();
    const { digest: _digest, ...content } = f.plan;
    const run = (manifest: typeof f.manifest, files = f.files) => compareContinuationWithLocalPlan(encoded(manifest), f.plan,
      (id) => files.get(id), ({ path }) => lookup(content, path));
    const result = await run(f.manifest);
    expect(result.status).toBe("matched-local-plan-only");
    expect(canonicalJsonText(result.untrustedPlanContent)).toBe(canonicalJsonText(content));
    expect(result.plannedUnionDigest).toBe(f.manifest.plannedUnionDigest);
    expect(result.checkpoint).toBeNull();
    expect(() => requireCampaignPlan({ ...(result.untrustedPlanContent as typeof content), digest: f.plan.digest })).toThrow();
    const countTamper = clone(f.manifest);
    countTamper.counts.selectedUtf8++;
    await expect(run(countTamper)).rejects.toThrow();
    const unionTamper = clone(f.manifest);
    unionTamper.plannedUnionDigest = "0".repeat(64);
    await expect(run(unionTamper)).rejects.toThrow();

    // Repack a structurally valid but semantically altered dependency, including valid segment IDs
    // and raw hashes. Hash checks alone are insufficient; the complete local plan comparison fails.
    const stream = await tokenizeCampaignPlan(f.plan);
    const tokens = [...stream.tokens];
    const dependencyKey = tokens.findIndex((token) => token.t === "K" && token.value === "dependencies");
    expect(dependencyKey).toBeGreaterThan(0);
    tokens.splice(dependencyKey + 2, 0, { t: "V", value: "foreign-stage" });
    const packed = await packContinuationTokenStreams({ ...f.expected, planDigest: f.plan.digest,
      streams: [{ stream: "plan", tokens }] });
    const changedStream = packed[0];
    if (!changedStream) throw new Error("Missing stream");
    const altered = clone(f.manifest);
    altered.plan.segments = changedStream.segments.map(({ reference }) => ({ ...reference }));
    altered.plan.tokenCount = changedStream.tokenCount;
    altered.plan.segmentBytes = changedStream.segmentBytes;
    altered.segmentCount = changedStream.segments.length;
    altered.segmentBytes = changedStream.segmentBytes;
    altered.tokenCount = changedStream.tokenCount;
    const files = new Map(changedStream.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
    await expect(run(altered, files)).rejects.toThrow();
  });

  test("distinguishes missing and wrong originals and refuses altered expansion counts or digests", async () => {
    const f = await fixture();
    const { digest: _digest, ...content } = f.plan;
    const read = (id: string) => f.files.get(id);
    const exact = ({ path }: { path: ContinuationPath }) => lookup(content, path);
    const run = (manifest = f.manifest, resolve = exact) => resolveContinuationWire(encoded(manifest), f.expected, read, resolve);
    const code = async (operation: Promise<unknown>) => {
      try { await operation; return "accepted"; } catch (error) {
        return error instanceof ContinuationTokenError ? error.code : (error as Error).name;
      }
    };
    expect(await code(run(f.manifest, () => undefined))).toBe("external-unavailable");
    expect(await code(run(f.manifest, () => "wrong original"))).toBe("external-mismatch");
    const wrongSize = clone(f.manifest);
    wrongSize.counts.resolvedPlanBytes++;
    expect(await code(run(wrongSize))).toBe("corrupt");
    const wrongHoles = clone(f.manifest);
    wrongHoles.counts.holes++;
    expect(await code(run(wrongHoles))).toBe("corrupt");
    const wrongDigest = clone(f.manifest);
    wrongDigest.planDigest = "0".repeat(64);
    wrongDigest.plan.contentDigest = wrongDigest.planDigest;
    expect(await code(run(wrongDigest))).toBe("corrupt");
  });

  test("distinguishes no checkpoint from a present null root, which local-plan validation refuses", async () => {
    const f = await fixture(null);
    const { digest: _digest, ...content } = f.plan;
    const read = (id: string) => f.files.get(id);
    const exact = ({ path }: { path: ContinuationPath }) => lookup(content, path);
    const resolved = await resolveContinuationWire(encoded(f.manifest), f.expected, read, exact);
    expect(resolved.checkpoint).toEqual({ root: null });
    await expect(compareContinuationWithLocalPlan(encoded(f.manifest), f.plan, read, exact)).rejects.toThrow();
  });

  test("self-consistent foreign source, coverage and dependency edits remain structural and cannot match the local plan", async () => {
    const f = await fixture();
    const { digest: _digest, ...content } = f.plan;
    const original = await tokenizeCampaignPlan(f.plan);
    const changes: ((tokens: ContinuationToken[]) => void)[] = [
      (tokens) => {
        const index = tokens.findIndex((token) => token.t === "K" && token.value === "chapterId");
        const value = tokens[index + 1];
        if (index < 0 || value?.t !== "V" || typeof value.value !== "string") throw new Error("Missing identity");
        tokens[index + 1] = { t: "V", value: `${value.value}x` };
      },
      (tokens) => {
        const index = tokens.findIndex((token) => token.t === "K" && token.value === "primary");
        const end = tokens.findIndex((token, position) => position > index && token.t === "K" && token.value === "end");
        const value = tokens[end + 1];
        if (index < 0 || end < 0 || value?.t !== "V" || typeof value.value !== "number") throw new Error("Missing coverage");
        tokens[end + 1] = { t: "V", value: value.value + 1 };
      },
      (tokens) => {
        const index = tokens.findIndex((token) => token.t === "K" && token.value === "dependencies");
        if (index < 0 || tokens[index + 1]?.t !== "A") throw new Error("Missing dependencies");
        tokens.splice(index + 2, 0, { t: "V", value: "foreign-stage" });
      }
    ];
    for (const change of changes) {
      const tokens = [...original.tokens];
      change(tokens);
      const resolve = ({ path }: { path: ContinuationPath }) => lookup(content, path);
      const changed = await resolveContinuationTokens(tokens, "plan", resolve);
      expect(changed.contentDigest).not.toBe(f.plan.digest);
      const packed = await packContinuationTokenStreams({ ...f.expected, planDigest: changed.contentDigest,
        streams: [{ stream: "plan", tokens }] });
      const stream = packed[0];
      if (!stream) throw new Error("Missing altered stream");
      const manifest = { ...f.manifest, planDigest: changed.contentDigest,
        plan: { stream: "plan", tokenCount: stream.tokenCount, segmentBytes: stream.segmentBytes,
          contentDigest: changed.contentDigest, segments: stream.segments.map(({ reference }) => reference) },
        counts: { ...f.manifest.counts, resolvedPlanBytes: changed.contentBytes },
        segmentCount: stream.segments.length, segmentBytes: stream.segmentBytes, tokenCount: stream.tokenCount };
      const files = new Map(stream.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
      const read = (id: string) => files.get(id);
      const inspected = await resolveContinuationWire(encoded(manifest), f.expected, read, resolve);
      expect(inspected.status).toBe("resolved-structural-only");
      expect(canonicalJsonText(inspected.untrustedPlanContent)).not.toBe(canonicalJsonText(content));
      await expect(compareContinuationWithLocalPlan(encoded(manifest), f.plan, read, resolve)).rejects.toThrow();
    }
  });

  test("enforces the combined 64-segment manifest limit across plan and checkpoint streams", () => {
    const ownerBookId = "book_123456";
    const campaignId = "campaign-synthetic";
    const planDigest = "a".repeat(64);
    const expected = { ownerBookId, campaignId };
    const refs = (count: number, offset: number) => Array.from({ length: count }, (_, index) => ({
      sequence: index, firstToken: index, tokenCount: 1,
      id: `s-${(offset + index).toString(16).padStart(64, "0")}`, revision: 1, bytes: 100, sha256: "c".repeat(64)
    }));
    const descriptorFor = (stream: "plan" | "checkpoint", count: number, offset: number, contentDigest: string) => ({
      stream, tokenCount: count, segmentBytes: count * 100, contentDigest, segments: refs(count, offset)
    });
    const manifestFor = (planCount: number, checkpointCount: number) => ({
      schemaVersion: 2, kind: "review-campaign", owner: { bookId: ownerBookId }, id: campaignId,
      revision: 1, base: { kind: "absent", revision: 0 }, createdAt: timestamp, updatedAt: timestamp,
      publicationId: "op-synthetic", plannerSemantics: "review-campaign-planner-v1", planDigest,
      plan: descriptorFor("plan", planCount, 0, planDigest),
      checkpoint: checkpointCount === 0 ? null : descriptorFor("checkpoint", checkpointCount, planCount, "d".repeat(64)),
      counts: { sources: 0, selectedSpans: 0, stages: 0, rangeStages: 0, synthesisStages: 0,
        dependencyEdges: 0, selectedUtf16: 0, selectedUtf8: 0, resolvedPlanBytes: 0, holes: 0 },
      plannedUnionDigest: "b".repeat(64),
      segmentCount: planCount + checkpointCount, segmentBytes: (planCount + checkpointCount) * 100,
      tokenCount: planCount + checkpointCount
    });
    const code = (planCount: number, checkpointCount: number): string => {
      try {
        const result = readContinuationManifest(encoded(manifestFor(planCount, checkpointCount)), expected);
        expect(result.plan.segments.length + (result.checkpoint?.segments.length ?? 0)).toBe(planCount + checkpointCount);
        return "accepted";
      } catch (error) {
        return error instanceof ContinuationTokenError ? error.code : (error as Error).name;
      }
    };
    expect(code(64, 0)).toBe("accepted");
    expect(code(65, 0)).not.toBe("accepted");
    expect(code(32, 32)).toBe("accepted");
    expect(code(32, 33)).toBe("too-large");
  });

  test("enforces real manifest and complete intent byte boundaries, including unknown fields", async () => {
    const f = await fixture();
    const empty = { ...f.manifest, note: "" };
    const filler = CONTINUATION_WIRE_LIMITS.manifestBytes - encoded(empty).length;
    const exact = { ...empty, note: "x".repeat(filler) };
    const raw = encoded(exact);
    expect(raw.length).toBe(CONTINUATION_WIRE_LIMITS.manifestBytes);
    expect(readContinuationManifest(raw, f.expected).id).toBe(f.plan.campaignId);
    expect(() => readContinuationManifest(encoded({ ...exact, note: `${exact.note}x` }), f.expected)).toThrow();
    const intent = { ...intentFor(raw, exact), note: "" };
    const padding = CONTINUATION_WIRE_LIMITS.intentBytes - encoded(intent).length;
    const full = { ...intent, note: "x".repeat(padding) };
    const expected = { ...f.expected, operationId: f.manifest.publicationId };
    expect(encoded(full).length).toBe(CONTINUATION_WIRE_LIMITS.intentBytes);
    expect((await readContinuationPublicationIntent(encoded(full), expected)).candidateBytes.length).toBe(raw.length);
    await expect(readContinuationPublicationIntent(encoded({ ...full, note: `${full.note}x` }), expected)).rejects.toThrow();
  }, 30_000);
});
