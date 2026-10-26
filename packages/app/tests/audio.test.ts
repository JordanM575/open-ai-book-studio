import { describe, expect, test } from "bun:test";
import { DICTATION_SAMPLE_RATE, encodeWav, resampleMono } from "../src/lib/audio";

describe("dictation audio", () => {
  test("writes the mono 16-bit PCM WAV header Meta accepts", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5]), DICTATION_SAMPLE_RATE);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(16383);
  });

  test("resamples linearly and keeps the endpoints", () => {
    const output = resampleMono(new Float32Array([0, 1, 0, -1]), 16_000, 32_000);
    expect([...output]).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
    expect(resampleMono(new Float32Array([0.25, 0.5]), 16_000, 16_000)).toEqual(new Float32Array([0.25, 0.5]));
  });
});
