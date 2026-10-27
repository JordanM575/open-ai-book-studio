import { describe, expect, test } from "bun:test";
import { DICTATION_SAMPLE_RATE, encodeWav, mixToMono, recordedBlobToWav, resampleMono } from "../src/lib/audio";
import {
  countWords,
  formatCount,
  formatWords,
  must,
  pluralize,
  savedTime
} from "../src/lib/utils";

/**
 * The small helpers the interface leans on.
 *
 * None is clever, which is why they are worth pinning: a wrong plural in the status line or a word
 * count that is off by one reads to an author as the product being broken.
 */

describe("dictation audio", () => {
  test("mixing stereo averages the channels so nothing clips", () => {
    const buffer = {
      numberOfChannels: 2,
      length: 3,
      sampleRate: 48_000,
      getChannelData: (channel: number) =>
        channel === 0 ? new Float32Array([1, 0, -1]) : new Float32Array([0, 0, 1])
    } as unknown as AudioBuffer;
    expect([...mixToMono(buffer)]).toEqual([0.5, 0, 0]);
  });

  test("a mono buffer comes through unchanged rather than being halved", () => {
    const buffer = {
      numberOfChannels: 1,
      length: 2,
      sampleRate: 16_000,
      getChannelData: () => new Float32Array([0.5, -0.5])
    } as unknown as AudioBuffer;
    expect([...mixToMono(buffer)]).toEqual([0.5, -0.5]);
  });

  test("resampling refuses a rate of zero rather than dividing by it", () => {
    expect(() => resampleMono(new Float32Array([0, 1]), 0, 16_000)).toThrow("Sample rates must be positive.");
    expect(() => resampleMono(new Float32Array([0, 1]), 16_000, 0)).toThrow("Sample rates must be positive.");
  });

  test("resampling keeps a single sample from disappearing", () => {
    // A very short recording still has to produce a playable buffer.
    const output = resampleMono(new Float32Array([0.4]), 48_000, 16_000);
    expect(output.length).toBe(1);
  });

  test("a recording becomes the WAV the provider documents", async () => {
    const real = (globalThis as { AudioContext?: unknown }).AudioContext;
    class Decoder {
      async decodeAudioData(): Promise<unknown> {
        return {
          numberOfChannels: 1,
          length: 4,
          sampleRate: 32_000,
          getChannelData: () => new Float32Array([0, 0.5, -0.5, 1])
        };
      }
      async close(): Promise<void> {}
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = Decoder;
    try {
      const wav = await recordedBlobToWav(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
      // Resampled from the decoder's 32 kHz to the 16 kHz Meta accepts.
      expect(view.getUint32(24, true)).toBe(DICTATION_SAMPLE_RATE);
      // Half the samples, at two bytes each.
      expect(view.getUint32(40, true)).toBe(4);
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = real;
    }
  });

  test("a decoder that is closed even when it fails", async () => {
    const real = (globalThis as { AudioContext?: unknown }).AudioContext;
    let closed = false;
    class Decoder {
      async decodeAudioData(): Promise<unknown> {
        throw new Error("this is not audio");
      }
      async close(): Promise<void> {
        closed = true;
      }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = Decoder;
    try {
      await expect(recordedBlobToWav(new Blob([]))).rejects.toThrow("this is not audio");
      expect(closed).toBe(true);
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = real;
    }
  });

  test("the WAV header is the one a provider can parse", () => {
    const bytes = encodeWav(new Float32Array([0, 0.5]), 24_000);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  });
});

describe("words and numbers", () => {
  test("word counts ignore whitespace but not punctuation", () => {
    expect(countWords("   ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("  one\ntwo\tthree  ")).toBe(3);
    expect(countWords("one — two")).toBe(3);
  });

  test("a count is pluralised in the status line", () => {
    expect(formatWords(0)).toBe("0 words");
    expect(formatWords(1)).toBe("1 word");
    expect(formatWords(12_345)).toBe("12,345 words");
    expect(formatCount(12_345)).toBe("12,345");
  });

  test("pluralize takes its own plural when the word is irregular", () => {
    expect(pluralize(1, "chapter")).toBe("chapter");
    expect(pluralize(0, "chapter")).toBe("chapters");
    expect(pluralize(2, "copy", "copies")).toBe("copies");
  });

  test("a save time is a time, not a timestamp", () => {
    expect(savedTime(Date.UTC(2026, 9, 26, 15, 4))).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("the IPC envelope", () => {
  test("unwraps a success", async () => {
    expect(await must(Promise.resolve({ ok: true as const, data: "answered" }))).toBe("answered");
  });

  test("turns a refusal into the app's own sentence", async () => {
    const failure = must(Promise.resolve({ ok: false as const, error: { code: "invalid", message: "The book is gone." } }));
    await expect(failure).rejects.toThrow("The book is gone.");
  });
});
