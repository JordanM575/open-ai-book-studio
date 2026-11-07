import { expect, test } from "bun:test";
import { DEFAULT_SEGMENTER_CONFIG, PcmSegmenter, type SegmenterConfig, type VadDecision } from "../../src/voice-session";

function fixture(config: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG) {
  let decision: VadDecision = "silence";
  let now = 0;
  const segmenter = new PcmSegmenter(config, () => decision, () => now);
  return {
    segmenter,
    tick(next: VadDecision, value = 0, samples = config.maxReadSamples) {
      decision = next;
      now += 100;
      return segmenter.push(new Float32Array(samples).fill(value));
    },
  };
}

test("construction and silence/noise/echo/unqualified speech cause zero utterances", () => {
  const f = fixture();
  expect(f.tick("qualified-near-end", 0.2).consumed).toBe(0);
  expect(f.segmenter.status).toBe("stopped");
  f.segmenter.resume();
  for (const decision of ["silence", "noise", "echo", "speech"] as const) {
    for (let i = 0; i < 100; i++) {
      expect(f.tick(decision).segment).toBeNull();
      expect(f.segmenter.bufferedSamples).toBeLessThanOrEqual(4_000);
    }
  }
  expect(f.segmenter.finish()).toBeNull();
  expect(f.segmenter.pendingId).toBeNull();
});

test("qualified onset retains exactly 250ms preroll and ends after 1.2s sample silence", () => {
  const f = fixture();
  f.segmenter.resume();
  f.tick("silence", 0.1);
  f.tick("silence", 0.2);
  f.tick("silence", 0.3);
  expect(f.tick("qualified-near-end", 0.4).onset).toBe(true);
  for (let i = 0; i < 11; i++) expect(f.tick("silence").segment).toBeNull();
  const result = f.tick("silence");
  expect(result.segment?.reason).toBe("end-silence");
  expect(result.segment?.samples.length).toBe(4_000 + 1_600 + 19_200);
  expect(result.segment?.samples[0]).toBeCloseTo(0.1);
  expect(result.segment?.samples[799]).toBeCloseTo(0.1);
  expect(result.segment?.samples[800]).toBeCloseTo(0.2);
  expect(result.segment?.samples[2_400]).toBeCloseTo(0.3);
  expect(result.segment?.samples[4_000]).toBeCloseTo(0.4);
  expect(result.state).toBe("held");
  expect(f.segmenter.bufferedSamples).toBe(0);
});

test("a short silence followed by speech resets the endpointer", () => {
  const f = fixture();
  f.segmenter.resume();
  f.tick("qualified-near-end", 0.2);
  for (let i = 0; i < 10; i++) f.tick("silence");
  f.tick("speech", 0.3);
  for (let i = 0; i < 11; i++) expect(f.tick("silence").segment).toBeNull();
  expect(f.tick("silence").segment?.reason).toBe("end-silence");
});

test("60-second maximum is bounded and holds all later reads until exact settlement and resume", () => {
  const f = fixture();
  f.segmenter.resume();
  f.tick("qualified-near-end", 0.2);
  for (let i = 0; i < 598; i++) {
    expect(f.tick("speech", 0.2).segment).toBeNull();
    expect(f.segmenter.bufferedSamples).toBeLessThanOrEqual(f.segmenter.capacitySamples);
  }
  const result = f.tick("speech", 0.2);
  expect(result.segment?.samples.length).toBe(960_000);
  expect(result.segment?.reason).toBe("limit");
  expect(result.reason).toContain("shorter utterance");
  expect(f.segmenter.capacitySamples).toBe(964_000);
  expect(f.tick("qualified-near-end", 0.4).consumed).toBe(0);
  expect(f.segmenter.resume()).toBe(false);
  expect(f.segmenter.acknowledge(99)).toBe(false);
  expect(f.segmenter.acknowledge(1)).toBe(true);
  expect(f.segmenter.status).toBe("held");
  expect(f.tick("qualified-near-end", 0.4).consumed).toBe(0);
  expect(f.segmenter.resume()).toBe(true);
  f.tick("qualified-near-end", 0.4);
  expect(f.segmenter.finish()?.id).toBe(2);
});

test("a boundary inside a read returns the exact unconsumed suffix", () => {
  const f = fixture({ ...DEFAULT_SEGMENTER_CONFIG, sampleRate: 8_000, maxReadSamples: 800,
    maxUtteranceMs: 1_050, endSilenceMs: 100, prerollMs: 0 });
  f.segmenter.resume();
  f.tick("qualified-near-end", 0.2);
  for (let i = 0; i < 9; i++) f.tick("speech", 0.2);
  const result = f.tick("speech", 0.3);
  expect(result.consumed).toBe(400);
  expect(result.segment?.samples.length).toBe(8_400);
  expect(result.segment?.samples[8_399]).toBeCloseTo(0.3);
  expect(result.state).toBe("held");
});

test("stop clears local PCM but never releases an unsettled STT slot", () => {
  const f = fixture();
  f.segmenter.resume();
  f.tick("qualified-near-end", 0.2);
  f.segmenter.finish();
  f.segmenter.stop();
  expect(f.segmenter.status).toBe("stopped");
  expect(f.segmenter.bufferedSamples).toBe(0);
  expect(f.segmenter.resume()).toBe(false);
  f.segmenter.acknowledge(1);
  expect(f.segmenter.status).toBe("stopped");
});

test.each([
  { sampleRate: NaN }, { sampleRate: 192_000 }, { sampleRate: 0 }, { endSilenceMs: 0 },
  { endSilenceMs: 60_000 }, { prerollMs: -1 }, { prerollMs: Infinity }, { maxUtteranceMs: 60_001 },
  { maxUtteranceMs: 999 }, { maxReadSamples: 0 }, { maxReadSamples: 1_601 }, { sampleRate: 16_000.1 },
])("rejects invalid config before allocating: %j", (patch) => {
  expect(() => fixture({ ...DEFAULT_SEGMENTER_CONFIG, ...patch })).toThrow(RangeError);
});

test("invalid PCM, read size, clock or classifier does not consume buffered speech", () => {
  let now = 100;
  let decision: VadDecision = "qualified-near-end";
  const segmenter = new PcmSegmenter(DEFAULT_SEGMENTER_CONFIG, () => decision, () => now);
  segmenter.resume();
  segmenter.push(new Float32Array(1_600).fill(0.2));
  for (const pcm of [new Float32Array(), new Float32Array(1_601), new Float32Array([NaN]),
    new Float32Array([Infinity]), new Float32Array([1.1])]) {
    expect(() => segmenter.push(pcm)).toThrow(RangeError);
    expect(segmenter.bufferedSamples).toBe(1_600);
  }
  now = 99;
  expect(() => segmenter.push(new Float32Array(1))).toThrow(RangeError);
  now = 101;
  decision = "invalid" as VadDecision;
  expect(() => segmenter.push(new Float32Array(1))).toThrow(RangeError);
  expect(segmenter.finish()?.samples.length).toBe(1_600);
});

test("the injected VAD cannot rewrite accepted PCM through its borrowed read", () => {
  const source = new Float32Array(100).fill(0.25);
  const segmenter = new PcmSegmenter(DEFAULT_SEGMENTER_CONFIG, (pcm) => {
    pcm.fill(NaN);
    source.fill(0.75);
    return "qualified-near-end";
  }, () => 0);
  segmenter.resume();
  segmenter.push(source);
  expect(segmenter.finish()?.samples.every((value) => value === 0.25)).toBe(true);
});
