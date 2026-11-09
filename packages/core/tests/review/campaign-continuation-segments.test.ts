import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { packContinuationTokenStreams, CONTINUATION_SEGMENT_LIMITS } from "../../src/review/campaign-continuation-segments";
import { ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, tokenizeCampaignPlan, tokenizeCheckpointValue, type ContinuationToken } from "../../src/review/campaign-continuation-tokens";
import { canonicalJsonText, decodeStrictJsonBytes } from "../../src/review/record-json";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const ownerBookId = "book_123456";
const campaignId = "campaign-synthetic";
const planDigest = "a".repeat(64);
const base = { ownerBookId, campaignId, planDigest };
const size = (value: unknown) => Buffer.byteLength(canonicalJsonText(value));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("continuation segment packing primitive", () => {
  test("packs plan and checkpoint streams with distinct body IDs and exact raw references", async () => {
    const plan = await planned(await campaignInput("SOURCE_SENTINEL and escaped 🧪\n"));
    const planTokens = await tokenizeCampaignPlan(plan);
    const checkpoint = await tokenizeCheckpointValue({ checkpointVersion: 1, stages: [] });
    const streams = await packContinuationTokenStreams({ ownerBookId: plan.ownerBookId,
      campaignId: plan.campaignId, planDigest: plan.digest, streams: [
        { stream: "plan", tokens: planTokens.tokens }, { stream: "checkpoint", tokens: checkpoint.tokens }
      ] });
    expect(streams.map((stream) => stream.stream)).toEqual(["plan", "checkpoint"]);
    for (const stream of streams) {
      let first = 0;
      for (const [index, segment] of stream.segments.entries()) {
        const raw = decodeStrictJsonBytes(segment.bytes) as Record<string, unknown>;
        const { id, ...body } = raw;
        if (typeof id !== "string") throw new Error("Missing segment ID");
        expect(id).toBe(`s-${hash(new TextEncoder().encode(canonicalJsonText(body)))}`);
        expect(segment.reference.sha256).toBe(hash(segment.bytes));
        expect(segment.reference.id).toBe(id);
        expect(segment.reference.bytes).toBe(segment.bytes.length);
        expect(segment.reference.sequence).toBe(index);
        expect(segment.reference.firstToken).toBe(first);
        expect(raw.stream).toBe(stream.stream);
        expect(new TextDecoder().decode(segment.bytes)).not.toContain("SOURCE_SENTINEL");
        first += segment.reference.tokenCount;
      }
      expect(first).toBe(stream.tokenCount);
      expect(stream.segmentBytes).toBe(stream.segments.reduce((sum, segment) => sum + segment.bytes.length, 0));
    }
  });

  test("packs the maximal complete-document prefix at 2,000,000 bytes and splits at plus one", async () => {
    const header = { schemaVersion: 1, kind: "review-campaign-segment", owner: { bookId: ownerBookId },
      campaignId, planDigest, revision: 1, stream: "checkpoint", sequence: 0, firstToken: 0,
      tokens: [], id: `s-${"0".repeat(64)}` };
    const a: ContinuationToken = { t: "A" };
    const close: ContinuationToken = { t: "]" };
    const first: ContinuationToken = { t: "V", value: "x".repeat(1_899_900) };
    const otherLength = CONTINUATION_SEGMENT_LIMITS.documentBytes - size(header) - size(a) - size(first) - size(close) - 3 - size({ t: "V", value: "" });
    expect(otherLength).toBeGreaterThan(0);
    const tokens = (extra: number): ContinuationToken[] => [a, first, { t: "V", value: "y".repeat(otherLength + extra) }, close];
    const exact = await packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens: tokens(0) }] });
    expect(exact[0]?.segments).toHaveLength(1);
    expect(exact[0]?.segments[0]?.bytes.length).toBe(CONTINUATION_SEGMENT_LIMITS.documentBytes);
    const plusOne = await packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens: tokens(1) }] });
    expect(plusOne[0]?.segments).toHaveLength(2);
    expect(plusOne[0]?.segments[0]?.reference.tokenCount).toBe(3);
    expect(plusOne[0]?.segments[1]?.reference.firstToken).toBe(3);
    expect(plusOne[0]?.segments.every((segment) => segment.bytes.length <= CONTINUATION_SEGMENT_LIMITS.documentBytes)).toBe(true);
  }, 30_000);

  test("enforces the real 33,554,432-byte combined segment budget and its plus one", async () => {
    const large = "x".repeat(1_899_900);
    const header = (sequence: number, firstToken: number) => ({ schemaVersion: 1, kind: "review-campaign-segment",
      owner: { bookId: ownerBookId }, campaignId, planDigest, revision: 1, stream: "checkpoint",
      sequence, firstToken, tokens: [], id: `s-${"0".repeat(64)}` });
    // Seventeen large values each start a segment; the last smaller value and the array closure
    // occupy an eighteenth. The first and final segments each have one token separator.
    let headers = 0;
    for (let sequence = 0; sequence < 18; sequence++) headers += size(header(sequence, sequence === 0 ? 0 : sequence + 1));
    const emptyValue = size({ t: "V", value: "" });
    const fixed = headers + size({ t: "A" }) + 17 * (emptyValue + large.length) + emptyValue + size({ t: "]" }) + 2;
    const tailLength = CONTINUATION_SEGMENT_LIMITS.bytes - fixed;
    expect(tailLength).toBeGreaterThan(0);
    const tokens = (extra: number): ContinuationToken[] => [
      { t: "A" }, ...Array.from({ length: 17 }, () => ({ t: "V" as const, value: large })),
      { t: "V", value: "y".repeat(tailLength + extra) }, { t: "]" }
    ];
    const exact = await packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens: tokens(0) }] });
    expect(exact[0]?.segments).toHaveLength(18);
    expect(exact[0]?.segmentBytes).toBe(CONTINUATION_SEGMENT_LIMITS.bytes);
    await expect(packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens: tokens(1) }] })).rejects.toThrow();
  }, 60_000);

  test("detaches tokens and stream descriptors before asynchronous hashing", async () => {
    const tokens: ContinuationToken[] = [{ t: "A" }, { t: "V", value: "original" }, { t: "]" }];
    const streams: { stream: "checkpoint"; tokens: ContinuationToken[] }[] = [{ stream: "checkpoint", tokens }];
    const pending = packContinuationTokenStreams({ ...base, streams });
    tokens[1] = { t: "V", value: "mutated" };
    streams.length = 0;
    const result = await pending;
    expect(result).toHaveLength(1);
    expect(result[0]?.tokenCount).toBe(3);
    const text = new TextDecoder().decode(result[0]?.segments[0]?.bytes);
    expect(text).toContain("original");
    expect(text).not.toContain("mutated");
  });

  test("packs a 120-source, 250k-word plan with real dependencies crossing segment boundaries", async () => {
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
    expect(plan.sources).toHaveLength(120);
    expect(plan.stages.length).toBeGreaterThan(120);
    const stream = await tokenizeCampaignPlan(plan);
    const packed = await packContinuationTokenStreams({ ownerBookId: plan.ownerBookId, campaignId: plan.campaignId,
      planDigest: plan.digest, streams: [{ stream: "plan", tokens: stream.tokens }] });
    const segments = packed[0]?.segments;
    if (!segments) throw new Error("Missing segments");
    expect(segments.length).toBeGreaterThan(1);
    const locations = new Map<string, number[]>();
    for (const [index, segment] of segments.entries()) {
      const raw = decodeStrictJsonBytes(segment.bytes) as { tokens: ContinuationToken[] };
      for (const token of raw.tokens) if (token.t === "V" && typeof token.value === "string") {
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
    expect(segments.reduce((sum, segment) => sum + segment.reference.tokenCount, 0)).toBe(stream.tokens.length);
  }, 90_000);

  test("refuses malformed streams, duplicate stream kinds and invalid identities", async () => {
    const empty = await tokenizeCheckpointValue({});
    const stream = { stream: "checkpoint" as const, tokens: empty.tokens };
    await expect(packContinuationTokenStreams({ ...base, streams: [stream, stream] })).rejects.toThrow();
    await expect(packContinuationTokenStreams({ ...base, campaignId: "../escape", streams: [stream] })).rejects.toThrow();
    await expect(packContinuationTokenStreams({ ...base, planDigest: "A".repeat(64), streams: [stream] })).rejects.toThrow();
    await expect(packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens: [{ t: "Q" }] }] })).rejects.toThrow();
  });

  test("refuses combined token overflow before inspecting the second stream", async () => {
    const overflowing = Array<unknown>(CONTINUATION_TOKEN_LIMITS.tokens).fill({ t: "Q" });
    try {
      await packContinuationTokenStreams({ ...base, streams: [
        { stream: "plan", tokens: [{ t: "V", value: null }] },
        { stream: "checkpoint", tokens: overflowing }
      ] });
      throw new Error("Expected combined token overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationTokenError);
      expect((error as ContinuationTokenError).code).toBe("too-large");
    }
  });

  test("refuses aggregate bytes before reconstructing an oversized malformed token tree", async () => {
    const value = "x".repeat(1_899_900);
    // Missing the closing token on purpose: a grammar-first implementation reports corruption
    // only after allocating the oversized reconstructed array.
    const tokens = [{ t: "A" }, ...Array.from({ length: 18 }, () => ({ t: "V", value }))];
    try {
      await packContinuationTokenStreams({ ...base, streams: [{ stream: "checkpoint", tokens }] });
      throw new Error("Expected aggregate byte overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationTokenError);
      expect((error as ContinuationTokenError).code).toBe("too-large");
    }
  }, 60_000);
});
