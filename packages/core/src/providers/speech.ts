import { ProviderError, type ProviderId } from "./types";

/**
 * Meta's file transcription endpoint and model. The endpoint is not the OpenAI
 * `/audio/transcriptions` shape: it takes a JSON `request` part and an `audio` WAV part.
 * Docs: https://dev.meta.ai/docs/speech-to-text
 */
export const META_SPEECH_HOST = "https://api.meta.ai";
export const META_SPEECH_MODEL = "muse-voice-transcribe-1.0";
export const MAX_SPEECH_BYTES = 32 * 1024 * 1024;
export const MAX_SPEECH_DURATION_MS = 10 * 60 * 1000;
export const SPEECH_SAMPLE_RATES = [16_000, 24_000] as const;
export const MAX_LANGUAGE_BIASES = 4;
export const MAX_KEYWORDS = 50;

export interface SpeechCapability {
  provider: ProviderId;
  endpoint: string;
  model: string;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
}

export type WavCheck = { ok: true; info: WavInfo } | { ok: false; reason: string };

export interface SpeechSettings {
  mode?: "PUSH_TO_TALK" | "ENDPOINTING" | "DIARIZATION";
  languageBias?: string[];
  keywords?: string[];
}

export interface SpeechTurn {
  turnId: number;
  startMs: number;
  endMs: number;
  transcript: string;
  speaker?: string;
}

export interface VoiceTranscript {
  text: string;
  provider: ProviderId;
  connectionLabel: string;
  model: string;
  durationMs: number;
  turns: SpeechTurn[];
}

/**
 * Where a connection's speech requests go. Only Meta is enabled in v1: its file endpoint is
 * documented and the model is named by the event. An OpenAI-compatible shape is a separate adapter,
 * not a silent guess.
 */
export function speechCapability(provider: ProviderId, baseUrl?: string): SpeechCapability | null {
  if (provider !== "meta") return null;
  const base = normalizeSpeechBase(baseUrl);
  return {
    provider,
    endpoint: base.endsWith("/v1") ? `${base}/asr/transcribe` : `${base}/v1/asr/transcribe`,
    model: META_SPEECH_MODEL
  };
}

function normalizeSpeechBase(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim() || `${META_SPEECH_HOST}/v1`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("invalid-request", "The Meta base URL is not a valid address.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ProviderError("invalid-request", "Use an https address for Meta's base URL.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * Validate the container the provider accepts before spending a request. Meta requires a RIFF/WAVE
 * file with mono, 16-bit integer PCM at 16 kHz or 24 kHz, up to 10 minutes and 32 MB.
 */
export function inspectWav(bytes: Uint8Array): WavCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: "The recording is empty." };
  if (bytes.byteLength > MAX_SPEECH_BYTES) {
    return { ok: false, reason: "The recording is larger than 32 MB. Record a shorter clip." };
  }
  if (bytes.byteLength < 44) return { ok: false, reason: "The recording is not a complete WAV file." };
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return { ok: false, reason: "The recording is not a WAV file. Meta accepts WAV audio only." };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataBytes: number | null = null;

  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength) {
      return { ok: false, reason: "The recording is truncated." };
    }
    if (id === "fmt ") {
      if (size < 16) return { ok: false, reason: "The WAV format header is incomplete." };
      format = {
        audioFormat: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bitsPerSample: view.getUint16(start + 14, true)
      };
    } else if (id === "data") {
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }

  if (!format) return { ok: false, reason: "The WAV file has no format header." };
  if (dataBytes === null) return { ok: false, reason: "The WAV file has no audio data." };
  if (format.audioFormat !== 1) {
    return { ok: false, reason: "The recording must be 16-bit PCM, not compressed WAV." };
  }
  if (format.channels !== 1) return { ok: false, reason: "The recording must be mono." };
  if (format.bitsPerSample !== 16) return { ok: false, reason: "The recording must be 16-bit audio." };
  if (!SPEECH_SAMPLE_RATES.includes(format.sampleRate as (typeof SPEECH_SAMPLE_RATES)[number])) {
    return { ok: false, reason: "The recording must be sampled at 16 kHz or 24 kHz." };
  }
  if (dataBytes <= 0) return { ok: false, reason: "The recording contains no audio." };

  const durationMs = (dataBytes / (format.sampleRate * format.channels * 2)) * 1000;
  if (durationMs > MAX_SPEECH_DURATION_MS) {
    return { ok: false, reason: "The recording is longer than 10 minutes. Record a shorter clip." };
  }

  return {
    ok: true,
    info: {
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitsPerSample: format.bitsPerSample,
      dataBytes,
      durationMs: Math.round(durationMs)
    }
  };
}

/** The multipart body Meta documents. It is deliberately not the OpenAI `file`/`model` shape. */
export function speechForm(audio: Uint8Array, options: SpeechSettings = {}): FormData {
  const request = {
    mode: options.mode ?? "PUSH_TO_TALK",
    model: META_SPEECH_MODEL,
    audioEncoding: "WAV",
    ...(options.languageBias?.length ? { languageBias: options.languageBias } : {}),
    ...(options.keywords?.length ? { keywords: options.keywords } : {})
  };
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }), "request.json");
  const copy = new Uint8Array(audio.byteLength);
  copy.set(audio);
  form.append("audio", new Blob([copy], { type: "audio/wav" }), "dictation.wav");
  return form;
}

export interface ParsedSpeech {
  text: string;
  turns: SpeechTurn[];
  providerDurationMs: number | null;
}

/** Parse the documented JSON response without inventing fields the provider did not send. */
export function parseSpeechResponse(payload: unknown): ParsedSpeech {
  const body = payload as { transcript?: unknown; turns?: unknown; audioDurationMs?: unknown } | null;
  if (!body || typeof body !== "object" || typeof body.transcript !== "string") {
    throw new ProviderError("unknown", "Meta returned a response without a transcript.");
  }
  const turns: SpeechTurn[] = [];
  if (Array.isArray(body.turns)) {
    for (const entry of body.turns) {
      const raw = entry as Record<string, unknown>;
      if (
        typeof raw.turnId !== "number" ||
        typeof raw.startMs !== "number" ||
        typeof raw.endMs !== "number" ||
        typeof raw.transcript !== "string"
      ) {
        continue;
      }
      turns.push({
        turnId: raw.turnId,
        startMs: raw.startMs,
        endMs: raw.endMs,
        transcript: raw.transcript,
        ...(typeof raw.speaker === "string" ? { speaker: raw.speaker } : {})
      });
    }
  }
  return {
    text: body.transcript.trim(),
    turns,
    providerDurationMs:
      typeof body.audioDurationMs === "number" && Number.isFinite(body.audioDurationMs) && body.audioDurationMs >= 0
        ? Math.round(body.audioDurationMs)
        : null
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}
