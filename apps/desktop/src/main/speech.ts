import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import {
  chunkForSpeech,
  joinAudio,
  ttsCapability,
  ttsRequestBody,
  wrapPcmAsWav,
  type SpokenAudio,
  type TtsOptions
} from "@ai-book-studio/core/providers/tts";
import { ProviderError, type ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type { ProviderService } from "./providers";

const SPEAK_TIMEOUT_MS = 120_000;

export interface SpeakInput {
  connectionId?: string;
  text: string;
  voice?: string;
  speed?: number;
  instructions?: string;
}

export interface SpeakResult extends SpokenAudio {
  connectionLabel: string;
  model: string;
  /** How many requests it took, because a chapter is more than one. */
  chunks: number;
  /** What the request cost, when the service reported it. */
  costUsd: number | null;
}

/**
 * The speaking half of the voice pipeline.
 *
 * `VoiceService` listens: it sends a recording to Meta and returns words. This speaks: it sends
 * words to a voice service and returns audio. Together they close the loop the ambient agent
 * needs — the author talks, the agent answers, and the answer comes back in a voice rather than
 * as a silent line of text.
 *
 * There are two text-to-speech services — OpenAI directly, and OpenRouter, which offers the same
 * endpoint with fifteen models behind it and one of them free. The shape is the same, so there is
 * one request and one set of responses, and the difference is only the model and whether a voice
 * has to be named.
 *
 * The text is split at sentence boundaries before it is sent, because one request carries a few
 * thousand characters and a chapter is far longer, and the audio is joined back into one sound.
 */
export class SpeechService {
  constructor(
    private readonly providers: ProviderService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Connections that can speak, for the panel that offers a voice. */
  async connections(): Promise<ConnectionSummary[]> {
    return (await this.providers.list()).filter((connection) => ttsCapability(connection.provider) !== null);
  }

  async speak(input: SpeakInput): Promise<SpeakResult> {
    const text = input.text.trim();
    if (!text) throw new ProviderError("invalid-request", "There is nothing to say.");

    const available = await this.connections();
    const connection = input.connectionId
      ? available.find((entry) => entry.id === input.connectionId)
      : available[0];
    if (!connection) {
      throw new ProviderError(
        "invalid-request",
        "Connect a voice service in Settings before asking the agent to speak."
      );
    }

    const credential = await this.providers.credential(connection.id);
    const capability = ttsCapability(credential.provider, credential.metadata?.baseUrl);
    if (!capability) {
      throw new ProviderError("unsupported", "This build cannot speak with that connection.");
    }

    // A voice is sent only when the caller chose one or the provider requires one.
    const voice = input.voice ?? capability.defaultVoice;

    const chunks = chunkForSpeech(text);
    const parts: Uint8Array[] = [];
    let mimeType = "audio/mpeg";

    for (const chunk of chunks) {
      const body = ttsRequestBody(chunk, {
        // The capability names the model: OpenRouter's ids are not OpenAI's.
        model: capability.model,
        ...(voice ? { voice: voice as TtsOptions["voice"] } : {}),
        ...(input.speed !== undefined ? { speed: input.speed } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {})
      });

      let response: Response;
      try {
        response = await this.fetchImpl(capability.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.secret}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS)
        });
      } catch (error) {
        throw new ProviderError("offline", "Could not reach the voice service. Check your connection.", {
          provider: credential.provider,
          cause: error
        });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw normalizeProviderError({
          provider: credential.provider,
          status: response.status,
          body: detail
        });
      }

      const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new ProviderError("unknown", "The voice service returned no audio.");
      }

      // A few providers answer with raw samples rather than a file. A WAV header turns those into
      // something the renderer can play, rather than a blob it cannot.
      if (type === "audio/pcm" || type === "audio/l16") {
        parts.push(
          wrapPcmAsWav(bytes, {
            sampleRate: capability.sampleRate ?? 24_000,
            channels: 1,
            bitsPerSample: 16
          })
        );
        mimeType = "audio/wav";
      } else {
        if (type) mimeType = type;
        parts.push(bytes);
      }
    }

    return {
      bytes: joinAudio(parts),
      mimeType,
      characters: text.length,
      connectionLabel: connection.label,
      model: capability.model,
      chunks: chunks.length,
      costUsd: null
    };
  }
}
