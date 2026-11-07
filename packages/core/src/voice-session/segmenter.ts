import { safeCounter } from "./contracts";

export interface SegmenterConfig {
  readonly sampleRate: number;
  readonly endSilenceMs: number;
  readonly prerollMs: number;
  readonly maxUtteranceMs: number;
  readonly maxReadSamples: number;
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = Object.freeze({
  sampleRate: 16_000, endSilenceMs: 1_200, prerollMs: 250, maxUtteranceMs: 60_000, maxReadSamples: 1_600,
});

/** Injected local acoustic classification, NOT a detector implemented or certified by this module. */
export type VadDecision = "qualified-near-end" | "speech" | "silence" | "noise" | "echo";
export interface Segment {
  readonly id: number;
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly reason: "end-silence" | "limit" | "explicit-finish";
}
export interface PcmResult {
  /** Any unconsumed suffix remains the caller's property; never silently throw it away. */
  readonly consumed: number;
  readonly onset: boolean;
  readonly at: number;
  readonly segment: Segment | null;
  readonly state: "listening" | "recording" | "held" | "stopped";
  readonly reason: string | null;
}

function bounded(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/**
 * Single-owner, memory-only PCM accumulator. Constructing it does not activate capture.
 * A completed segment occupies one slot until exact acknowledgement AND explicit resume.
 * No microphone, timer, filesystem, network, provider or transport is accessed here.
 */
export class PcmSegmenter {
  readonly config: SegmenterConfig;
  private readonly buffer: Float32Array;
  private readonly preroll: Float32Array;
  private prerollSize = 0;
  private prerollCursor = 0;
  private length = 0;
  private silence = 0;
  private state: PcmResult["state"] = "stopped";
  private pending: number | null = null;
  private sequence = 0;
  private lastTime = 0;
  private reason: string | null = null;

  constructor(
    config: SegmenterConfig,
    private readonly classify: (pcm: Readonly<Float32Array>) => VadDecision,
    private readonly now: () => number,
  ) {
    if (!bounded(config.sampleRate, 8_000, 48_000) || !bounded(config.endSilenceMs, 100, 5_000) ||
        !bounded(config.prerollMs, 0, 1_000) || !bounded(config.maxUtteranceMs, 1_000, 60_000) ||
        config.endSilenceMs >= config.maxUtteranceMs || config.prerollMs >= config.maxUtteranceMs ||
        !bounded(config.maxReadSamples, 1, Math.floor(config.sampleRate / 10))) {
      throw new RangeError("Invalid conversational PCM bounds.");
    }
    this.config = Object.freeze({ ...config });
    this.buffer = new Float32Array(Math.floor(config.sampleRate * config.maxUtteranceMs / 1_000));
    this.preroll = new Float32Array(Math.floor(config.sampleRate * config.prerollMs / 1_000));
  }

  get status(): PcmResult["state"] { return this.state; }
  get bufferedSamples(): number { return this.length + this.prerollSize; }
  /** Fixed internal capacity; emitted PCM and caller-owned input have separate ownership. */
  get capacitySamples(): number { return this.buffer.length + this.preroll.length; }
  get pendingId(): number | null { return this.pending; }

  resume(): boolean {
    if (this.pending !== null || this.state === "recording") return false;
    this.state = "listening";
    this.reason = null;
    return true;
  }

  acknowledge(id: number): boolean {
    if (this.pending !== id || !safeCounter(id)) return false;
    this.pending = null;
    // Never automatically start capturing on a late STT result.
    return true;
  }

  stop(): void {
    this.clear();
    this.state = "stopped";
    this.reason = "Capture stopped; buffered audio was explicitly discarded.";
    // An in-flight operation still owns its slot, even if abort never settles.
  }

  push(pcm: Float32Array): PcmResult {
    const at = this.now();
    if (!safeCounter(at) || at < this.lastTime) throw new RangeError("PCM clock must be monotonic safe milliseconds.");
    if (!(pcm instanceof Float32Array) || pcm.length === 0 || pcm.length > this.config.maxReadSamples) {
      throw new RangeError("PCM read exceeds the bounded chunk size or is empty.");
    }
    // Own the bounded read; neither a caller's reused buffer nor the VAD adapter may mutate accepted PCM.
    const samples = pcm.slice();
    for (const value of samples) {
      if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError("PCM must be finite normalized mono samples.");
    }
    const result = (consumed: number, onset = false, segment: Segment | null = null): PcmResult => ({
      consumed, onset, at, segment, state: this.state, reason: this.reason,
    });
    if (this.state === "held" || this.state === "stopped") return result(0);
    const decision = this.classify(samples.slice());
    if (!["qualified-near-end", "speech", "silence", "noise", "echo"].includes(decision)) {
      throw new RangeError("Invalid injected VAD decision.");
    }
    this.lastTime = at;
    const onset = this.state === "listening" && decision === "qualified-near-end";
    if (onset) {
      this.state = "recording";
      const start = this.prerollSize === this.preroll.length ? this.prerollCursor : 0;
      for (let i = 0; i < this.prerollSize; i++) {
        this.buffer[this.length++] = this.preroll[(start + i) % this.preroll.length] ?? 0;
      }
      this.prerollSize = 0;
      this.prerollCursor = 0;
      this.preroll.fill(0);
    }
    if (this.state === "listening") {
      // Unqualified sound can never itself create a request or command.
      for (const value of samples) {
        if (this.preroll.length === 0) break;
        this.preroll[this.prerollCursor] = value;
        this.prerollCursor = (this.prerollCursor + 1) % this.preroll.length;
        this.prerollSize = Math.min(this.prerollSize + 1, this.preroll.length);
      }
      return result(pcm.length);
    }
    const speech = decision === "qualified-near-end" || decision === "speech";
    const silenceLimit = Math.ceil(this.config.sampleRate * this.config.endSilenceMs / 1_000);
    for (let i = 0; i < pcm.length; i++) {
      this.buffer[this.length++] = samples[i] ?? 0;
      this.silence = speech ? 0 : this.silence + 1;
      if (this.length === this.buffer.length || this.silence >= silenceLimit) {
        const segment = this.complete(this.length === this.buffer.length ? "limit" : "end-silence");
        return result(i + 1, onset, segment);
      }
    }
    return result(pcm.length, onset);
  }

  finish(): Segment | null {
    return this.state === "recording" ? this.complete("explicit-finish") : null;
  }

  private complete(reason: Segment["reason"]): Segment {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError("PCM segment identity exhausted; stop capture.");
    const segment = { id: ++this.sequence, samples: this.buffer.slice(0, this.length),
      sampleRate: this.config.sampleRate, reason };
    this.pending = segment.id;
    this.clear();
    this.state = "held";
    this.reason = reason === "limit"
      ? "Utterance limit reached. Review this segment and explicitly continue with a shorter utterance."
      : "Capture held until transcription settles and listening is explicitly resumed.";
    return segment;
  }

  private clear(): void {
    this.buffer.fill(0, 0, this.length);
    this.preroll.fill(0);
    this.length = 0;
    this.silence = 0;
    this.prerollSize = 0;
    this.prerollCursor = 0;
  }
}
