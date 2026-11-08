import { describe, expect, test } from "bun:test";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { META_SPEECH_MODEL, type VoiceTranscript } from "@ai-book-studio/core/providers/speech";
import type { ConnectionSummary, StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import type { TransportEvent } from "../../../packages/core/src/voice-session/transport";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@ai-book-studio/core/providers/voice-preferences";
import { ProviderService } from "../src/main/providers";
import { SpeechService, type SpeakResult } from "../src/main/speech";
import { VoiceService } from "../src/main/voice";
import {
  reportedCharge, requestSignal, settlementForFailure, settlementForSpeech, settlementForTranscript,
} from "../src/main/voice-transport";

function wav(seconds = 1): Uint8Array {
  const sampleRate = 16_000;
  const dataBytes = sampleRate * seconds * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const metaCredential: StoredCredential = {
  id: "conn_meta0000001", provider: "meta", label: "Meta", kind: "api-key",
  createdAt: "2026-11-07T00:00:00.000Z", secret: "synthetic-meta-key",
  metadata: { baseUrl: "https://api.meta.ai/v1" },
};

function voiceService(fetchImpl: typeof fetch): VoiceService {
  const vault = new MemoryVault();
  void vault.set(metaCredential);
  const providers = new ProviderService(vault, async () => {}, (async () => {
    throw new Error("provider catalogue must not be called");
  }) as unknown as typeof fetch);
  const preferences: VoicePreferences = {
    ...DEFAULT_VOICE_PREFERENCES,
    transcription: { connectionId: metaCredential.id, model: META_SPEECH_MODEL },
  };
  return new VoiceService(providers, fetchImpl, () => preferences);
}

const speaker: ConnectionSummary = {
  id: "conn_openai01", provider: "openai", label: "OpenAI", kind: "api-key",
  createdAt: "2026-11-07T00:00:00.000Z",
};
const speakerCredential: StoredCredential = { ...speaker, secret: "synthetic-openai-key" };

function speechService(fetchImpl: typeof fetch): SpeechService {
  const providers = {
    list: async () => [speaker],
    credential: async (id: string) => {
      if (id !== speaker.id) throw new Error("no such connection");
      return speakerCredential;
    },
  } as unknown as ProviderService;
  const preferences: VoicePreferences = {
    ...DEFAULT_VOICE_PREFERENCES,
    speaking: { connectionId: speaker.id, model: "gpt-4o-mini-tts", voice: "nova" },
  };
  return new SpeechService(providers, fetchImpl, () => preferences);
}

describe("voice transport charge vocabulary", () => {
  test("only a provider-reported finite, non-negative amount is a report", () => {
    expect(reportedCharge(0.12)).toEqual({ state: "reported", usd: 0.12 });
    expect(reportedCharge(0)).toEqual({ state: "reported", usd: 0 });
    for (const unknown of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(reportedCharge(unknown)).toEqual({ state: "unknown" });
    }
  });

  test("reported results keep the reported amount; an absent amount stays unknown", () => {
    const transcript = {
      text: "Synthetic.", provider: "meta", connectionLabel: "Meta", model: META_SPEECH_MODEL,
      durationMs: 1_000, costUsd: 0.02, turns: [],
    } satisfies VoiceTranscript;
    expect(settlementForTranscript(transcript)).toEqual({ outcome: "success", costUsd: 0.02 });
    expect(settlementForTranscript({ ...transcript, costUsd: null }))
      .toEqual({ outcome: "success", costUsd: null });

    const speech = {
      bytes: new Uint8Array(), mimeType: "audio/mpeg", characters: 10,
      connectionLabel: "OpenAI", model: "gpt-4o-mini-tts", voice: "nova", chunks: 1, costUsd: null,
    } satisfies SpeakResult;
    expect(settlementForSpeech(speech)).toEqual({ outcome: "success", costUsd: null });
  });
});

describe("voice transport failure settlement", () => {
  test("distinguishes local refusal, provider failure and cancellation", () => {
    for (const code of ["invalid-request", "not-found", "unsupported"] as const) {
      expect(settlementForFailure(new ProviderError(code, "Refused before sending.")).outcome).toBe("refusal");
    }
    for (const code of ["auth", "offline", "rate-limit", "unknown"] as const) {
      expect(settlementForFailure(new ProviderError(code, "May have been sent.")).outcome).toBe("failure");
    }
    expect(settlementForFailure(new DOMException("Aborted", "AbortError")).outcome).toBe("cancellation");
    expect(settlementForFailure(new ProviderError("unknown", "Cancelled.", {
      cause: new DOMException("Aborted", "AbortError"),
    })).outcome).toBe("cancellation");
  });

  test("a dispatched request is never labelled a pre-send refusal", () => {
    expect(settlementForFailure(new ProviderError("invalid-request", "Provider said 400."),
      { dispatched: true })).toEqual({ outcome: "failure", failure: "Provider said 400." });
    expect(settlementForFailure(new ProviderError("not-found", "404."), { dispatched: true }).outcome)
      .toBe("failure");
    // The settlement type composes with the ledger's settle event without a cast.
    const local: TransportEvent = {
      type: "settle", operationId: 1, chunkId: 1,
      outcome: settlementForFailure(new ProviderError("invalid-request", "Local check.")).outcome,
      failure: "Local check."
    };
    expect(local.outcome).toBe("refusal");
  });

  test("keeps the message bounded and never substitutes a zero charge", () => {
    expect(settlementForFailure(new ProviderError("offline", "Connection refused.")))
      .toEqual({ outcome: "failure", failure: "Connection refused." });
    expect(settlementForFailure(new ProviderError("offline", "x".repeat(65_537))).failure)
      .toBe("The external operation failed. Review its host receipt before continuing.");
    expect(settlementForFailure(new ProviderError("offline", "  ")).failure)
      .toBe("The external operation failed. Review its host receipt before continuing.");
  });
});

describe("cancellable service seams", () => {
  test("the deadline stays local and host abort closes it immediately", () => {
    const controller = new AbortController();
    const signal = requestSignal(60_000, controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
    expect(requestSignal(60_000).aborted).toBe(false);
  });

  test("VoiceService forwards host cancellation and maps it to a cancellation receipt", async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: AbortSignal | null = null;
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = init?.signal ?? null;
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;

    let failure: unknown = null;
    try {
      await voiceService(fetchImpl).transcribe({
        audio: wav(), expectedSelection: { connectionId: metaCredential.id, model: META_SPEECH_MODEL },
        signal: controller.signal,
      });
    } catch (error) {
      failure = error;
    }
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    expect(failure).toMatchObject({ code: "unknown", message: "The transcription request was cancelled." });
    expect(settlementForFailure(failure)).toMatchObject({ outcome: "cancellation" });
  });

  test("SpeechService stops before the next chunk after an author stop", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      // The first chunk is already paid for; the author stops before the second is sent.
      controller.abort();
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch;

    let failure: unknown = null;
    try {
      await speechService(fetchImpl).speak({ text: "One. ".repeat(900), signal: controller.signal });
    } catch (error) {
      failure = error;
    }
    expect(calls).toBe(1);
    expect(failure).toMatchObject({ code: "unknown", message: "The speaking request was cancelled." });
    expect(settlementForFailure(failure)).toMatchObject({ outcome: "cancellation" });
  });
});
