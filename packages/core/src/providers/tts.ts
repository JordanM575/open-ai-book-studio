import { ProviderError, type ProviderId } from "./types";

/**
 * Speaking.
 *
 * `speech.ts` is the listening half: Meta's transcription endpoint takes a WAV and returns words.
 * This is the other half. A voice pipeline needs both, because the agent's answer has to come back
 * out of the machine in a voice the author would recognise, not in the browser's default one.
 *
 * OpenAI's text-to-speech is the first adapter: a JSON request, and audio bytes back. The seam is
 * the provider, not OpenAI, so another voice service can be added without touching the caller.
 */

/** The OpenAI voices. Each one is a different speaker, not a different tone of the same one. */
export const TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse"
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number];

/** The default voice. Warm and clear, and it does not sound like a narrator. */
export const DEFAULT_TTS_VOICE: TtsVoice = "nova";

/**
 * The models that can speak.
 *
 * `gpt-4o-mini-tts` is the one to use: it understands a plain instruction about how to read, so
 * the studio can say "read this slowly" rather than only choosing a voice.
 */
export const TTS_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;

export type TtsModel = (typeof TTS_MODELS)[number];

export const DEFAULT_TTS_MODEL: TtsModel = "gpt-4o-mini-tts";

/**
 * The most characters one request may carry.
 *
 * A chapter is far longer than this, so the pipeline splits the text at sentence boundaries and
 * joins the audio back together. MP3 frames concatenate cleanly, so the caller gets one sound.
 */
export const MAX_TTS_CHARACTERS = 4_000;

/**
 * The free path.
 *
 * OpenRouter has a real text-to-speech endpoint — the same `audio/speech` shape as OpenAI's — with
 * fifteen models behind it, and one of them is free. `fish-audio/s2.1-pro-free:free` needs no
 * voice, takes the words, and returns MP3, so a check that runs on every change costs nothing and
 * says exactly what it was given. Some of the other models there require a voice and reject one
 * they do not know, so a voice is only sent when the caller asked for it.
 */
export const OPENROUTER_TTS_MODEL = "fish-audio/s2.1-pro-free:free";
export const OPENROUTER_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export const OPENROUTER_TTS_SAMPLE_RATE = 24_000;

/** OpenAI's slowest and fastest speaking rates. */
export const MIN_TTS_SPEED = 0.25;
export const MAX_TTS_SPEED = 4;

export interface TtsCapability {
  provider: ProviderId;
  endpoint: string;
  model: string;
  /** The voices worth offering. Empty when the provider picks its own. */
  voices: readonly string[];
  /**
   * The voice to send when the caller did not choose one.
   *
   * OpenAI requires a voice, so it names one. OpenRouter's free model does not, and its other
   * models want voices the studio does not know, so the choice is left alone there.
   */
  defaultVoice?: string;
  /** The sample rate of raw PCM, when a provider may answer with that instead of a file. */
  sampleRate?: number;
}

/**
 * Where a connection's speech requests go.
 *
 * Both services use OpenAI's `audio/speech` shape — OpenRouter added the same endpoint — so there
 * is one request and one set of responses to handle, not two. What differs is the model, and
 * whether a voice has to be named.
 */
export function ttsCapability(provider: ProviderId, baseUrl?: string): TtsCapability | null {
  if (provider === "openai") {
    return {
      provider,
      endpoint: `${normalizeTtsBase(baseUrl, "https://api.openai.com/v1")}/audio/speech`,
      model: DEFAULT_TTS_MODEL,
      voices: TTS_VOICES,
      defaultVoice: DEFAULT_TTS_VOICE
    };
  }
  if (provider === "openrouter") {
    return {
      provider,
      endpoint: `${normalizeTtsBase(baseUrl, "https://openrouter.ai/api/v1")}/audio/speech`,
      model: OPENROUTER_TTS_MODEL,
      voices: OPENROUTER_TTS_VOICES,
      sampleRate: OPENROUTER_TTS_SAMPLE_RATE
    };
  }
  return null;
}

/** Whether the provider can speak at all. Used to decide whether to offer a voice. */
export function canSpeak(provider: ProviderId): boolean {
  return ttsCapability(provider) !== null;
}

function normalizeTtsBase(baseUrl: string | undefined, fallback: string): string {
  const raw = baseUrl?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("invalid-request", "The voice service's base URL is not a valid address.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ProviderError("invalid-request", "Use an https address for the voice service's base URL.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export interface TtsOptions {
  voice?: TtsVoice | undefined;
  /** The model to use. Each provider names its own, so this is not limited to OpenAI's three. */
  model?: string | undefined;
  /** 0.25 to 4. */
  speed?: number | undefined;
  /**
   * How to read it, in plain words, for a model that understands them.
   *
   * "Read this slowly, and pause at the full stops." Ignored by the `tts-1` models.
   */
  instructions?: string;
}

/** The JSON body OpenAI documents. */
export function ttsRequestBody(text: string, options: TtsOptions = {}): Record<string, unknown> {
  const input = text.trim();
  if (!input) throw new ProviderError("invalid-request", "There is nothing to say.");
  if (input.length > MAX_TTS_CHARACTERS) {
    throw new ProviderError(
      "invalid-request",
      `One request may carry at most ${MAX_TTS_CHARACTERS} characters. Split the text first.`
    );
  }
  const model = options.model ?? DEFAULT_TTS_MODEL;
  return {
    model,
    input,
    // Some providers require a voice and others reject one they do not know, so it is only sent
    // when the caller named it. The capability supplies the default where one is required.
    ...(options.voice ? { voice: options.voice } : {}),
    response_format: "mp3",
    ...(options.speed !== undefined
      ? { speed: clampSpeed(options.speed) }
      : {}),
    // The instruction field only exists on the model that understands it.
    ...(options.instructions && model === "gpt-4o-mini-tts"
      ? { instructions: options.instructions.trim() }
      : {})
  };
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_TTS_SPEED, Math.max(MIN_TTS_SPEED, speed));
}

/**
 * Split text into what one request can carry, at sentence boundaries where possible.
 *
 * A paragraph or a chapter both come out as a list that can be sent in order and joined back into
 * one sound. Nothing is dropped: a single sentence longer than the limit is split on a word
 * boundary rather than truncated, because a truncated sentence is a wrong sentence.
 */
export function chunkForSpeech(text: string, limit: number = MAX_TTS_CHARACTERS): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= limit) return [cleaned];

  const sentences = splitSentences(cleaned);
  const chunks: string[] = [];
  let current = "";

  const push = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      // A single enormous sentence: split it on word boundaries so nothing is lost.
      push();
      for (const piece of splitLong(sentence, limit)) {
        chunks.push(piece);
      }
      continue;
    }
    if (current.length + sentence.length + 1 > limit) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return chunks;
}

/** Sentences, with their punctuation, without losing the space between them. */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?\n]+[.!?]*\s*/g);
  if (!parts) return [text];
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** One sentence that is longer than the limit. Split it on words; never truncate it. */
function splitLong(sentence: string, limit: number): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > limit) {
      // A single word longer than the limit. Cut it rather than loop forever; it is not prose.
      if (current) pieces.push(current);
      for (let index = 0; index < word.length; index += limit) {
        pieces.push(word.slice(index, index + limit));
      }
      current = "";
      continue;
    }
    if (current.length + word.length + 1 > limit) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export interface SpokenAudio {
  bytes: Uint8Array;
  mimeType: string;
  /** How many characters were spoken, so the caller can report it. */
  characters: number;
}

/** Join the per-chunk audio into one sound. MP3 frames concatenate; nothing else is assumed. */
export function joinAudio(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/**
 * Wrap raw PCM in a RIFF/WAVE header, so the renderer can play it as one sound.
 *
 * The service streams samples; it does not send a file. A WAV header is 44 bytes and turns the
 * samples into something an `<audio>` element accepts.
 */
export function wrapPcmAsWav(
  pcm: Uint8Array,
  options: { sampleRate: number; channels?: number; bitsPerSample?: number }
): Uint8Array {
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const byteRate = (options.sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  const ascii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index);
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, options.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const wav = new Uint8Array(header.byteLength + pcm.byteLength);
  wav.set(header, 0);
  wav.set(pcm, header.byteLength);
  return wav;
}
