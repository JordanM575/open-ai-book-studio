import { describe, expect, test } from "bun:test";
import {
  canSpeak,
  chatAudioRequestBody,
  chunkForSpeech,
  clampSpeed,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  joinAudio,
  readChatAudio,
  MAX_TTS_CHARACTERS,
  TTS_VOICES,
  ttsCapability,
  ttsRequestBody,
  wrapPcmAsWav
} from "../src/providers/tts";

describe("the voice service", () => {
  test("is available for OpenAI and nothing else", () => {
    expect(canSpeak("openai")).toBe(true);
    expect(canSpeak("meta")).toBe(false);
    expect(canSpeak("anthropic")).toBe(false);
  });

  test("points at the speech endpoint of the stored base URL", () => {
    const capability = ttsCapability("openai", "https://api.openai.com/v1");
    expect(capability?.endpoint).toBe("https://api.openai.com/v1/audio/speech");
    expect(capability?.model).toBe(DEFAULT_TTS_MODEL);
    expect(capability?.voices).toContain(DEFAULT_TTS_VOICE);
  });

  test("defaults to OpenAI when no base URL is stored", () => {
    expect(ttsCapability("openai")?.endpoint).toBe("https://api.openai.com/v1/audio/speech");
  });

  test("refuses a base URL that is not https", () => {
    expect(() => ttsCapability("openai", "http://api.example.com")).toThrow(/https/i);
  });

  test("trims a trailing slash rather than doubling it", () => {
    expect(ttsCapability("openai", "https://api.example.com/v1/")?.endpoint).toBe(
      "https://api.example.com/v1/audio/speech"
    );
  });
});

describe("the request", () => {
  test("asks for mp3, a voice and the model", () => {
    const body = ttsRequestBody("The door was open.");
    expect(body).toMatchObject({
      model: DEFAULT_TTS_MODEL,
      input: "The door was open.",
      voice: DEFAULT_TTS_VOICE,
      response_format: "mp3"
    });
  });

  test("carries a reading instruction only for the model that understands one", () => {
    const modern = ttsRequestBody("Read this.", { instructions: "slowly, and pause" });
    expect(modern.instructions).toBe("slowly, and pause");
    const older = ttsRequestBody("Read this.", { model: "tts-1", instructions: "slowly" });
    expect(older.instructions).toBeUndefined();
  });

  test("clamps the speed to what the service accepts", () => {
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(10)).toBe(4);
    expect(ttsRequestBody("hi", { speed: 0.1 }).speed).toBe(0.25);
  });

  test("refuses nothing, and refuses too much", () => {
    expect(() => ttsRequestBody("   ")).toThrow(/nothing to say/i);
    expect(() => ttsRequestBody("x".repeat(MAX_TTS_CHARACTERS + 1))).toThrow(/at most/i);
  });

  test("offers real voices", () => {
    expect(TTS_VOICES.length).toBeGreaterThan(6);
    expect(TTS_VOICES).toContain("nova");
  });
});

describe("chunking a passage", () => {
  test("leaves a short passage whole", () => {
    expect(chunkForSpeech("The door was open.")).toEqual(["The door was open."]);
  });

  test("returns nothing for nothing", () => {
    expect(chunkForSpeech("   \n  ")).toEqual([]);
  });

  test("splits a long passage at sentence boundaries", () => {
    const sentence = "The storm came in low and the lamp would not turn. ";
    const text = sentence.repeat(120);
    const chunks = chunkForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_TTS_CHARACTERS);
      // Every chunk ends at a sentence, not in the middle of one.
      expect(chunk.trimEnd().endsWith(".")).toBe(true);
    }
  });

  test("loses nothing", () => {
    const text = "One. Two. Three. ".repeat(400);
    const joined = chunkForSpeech(text).join(" ");
    const words = (value: string) => value.split(/\s+/).filter(Boolean);
    expect(words(joined).length).toBe(words(text).length);
  });

  test("splits a sentence longer than the limit on word boundaries", () => {
    const word = "lighthouse";
    const text = Array.from({ length: 900 }, () => word).join(" ");
    const chunks = chunkForSpeech(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      // A word is never cut in half.
      expect(chunk).not.toMatch(/lighthous$/);
    }
  });

  test("does not loop forever on one enormous word", () => {
    const chunks = chunkForSpeech("x".repeat(1200), 500);
    expect(chunks.join("")).toBe("x".repeat(1200));
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  test("honours a custom limit", () => {
    const chunks = chunkForSpeech("One. Two. Three. Four.", 12);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12);
  });
});

describe("joining the audio", () => {
  test("returns one sound from several parts", () => {
    const joined = joinAudio([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
    expect([...joined]).toEqual([1, 2, 3, 4, 5]);
  });

  test("handles a single part and none at all", () => {
    expect([...joinAudio([new Uint8Array([9])])]).toEqual([9]);
    expect(joinAudio([]).byteLength).toBe(0);
  });
});

describe("the cheap path", () => {
  test("OpenRouter speaks through a chat completion, not a speech endpoint", () => {
    const capability = ttsCapability("openrouter");
    expect(capability?.kind).toBe("chat-audio");
    expect(capability?.endpoint).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(capability?.sampleRate).toBe(24_000);
  });

  test("asks for audio in its own words", () => {
    const body = chatAudioRequestBody("The door was open.", { voice: "onyx" });
    expect(body).toMatchObject({ modalities: ["text", "audio"], stream: true });
    expect(body.audio).toEqual({ voice: "onyx", format: "pcm16" });
    expect(String((body.messages as Array<{ content: string }>)[0]!.content)).toContain(
      "The door was open."
    );
    expect(String((body.messages as Array<{ content: string }>)[0]!.content)).toMatch(/exactly/i);
  });

  test("reads the audio slices out of the stream in order", () => {
    const first = Buffer.from([1, 2, 3, 4]).toString("base64");
    const second = Buffer.from([5, 6]).toString("base64");
    const stream = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Reading. " } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: first } } }] })}`,
      "data: not json",
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: second } } }] })}`,
      `data: ${JSON.stringify({ usage: { cost: 0.0002 } })}`,
      "data: [DONE]"
    ].join("\n");
    const audio = readChatAudio(stream);
    expect([...audio.pcm]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(audio.text).toBe("Reading.");
    expect(audio.costUsd).toBeCloseTo(0.0002);
  });

  test("keeps the audio when one event is malformed", () => {
    const chunk = Buffer.from([9, 9]).toString("base64");
    const stream = [
      "data: {broken",
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: chunk } } }] })}`
    ].join("\n");
    expect([...readChatAudio(stream).pcm]).toEqual([9, 9]);
  });

  test("wraps samples in a playable WAV", () => {
    const pcm = new Uint8Array([0, 1, 2, 3]);
    const wav = wrapPcmAsWav(pcm, { sampleRate: 24_000 });
    const view = new DataView(wav.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...wav.slice(offset, offset + length));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(4);
    expect(wav.byteLength).toBe(48);
    expect([...wav.slice(44)]).toEqual([0, 1, 2, 3]);
  });
});
