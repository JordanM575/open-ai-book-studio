import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import {
  inspectWav,
  parseSpeechResponse,
  speechCapability,
  speechForm,
  type VoiceTranscript
} from "@ai-book-studio/core/providers/speech";
import { ProviderError, type ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type { ProviderService } from "./providers";

const TRANSCRIBE_TIMEOUT_MS = 120_000;

export interface TranscribeInput {
  connectionId?: string;
  audio: Uint8Array;
  languageBias?: string[];
  keywords?: string[];
}

/**
 * The only place audio leaves the studio. It reads the Meta secret in the main process, sends the
 * documented multipart form and returns text. The recording is never written to disk and never
 * reaches the renderer again.
 */
export class VoiceService {
  constructor(
    private readonly providers: ProviderService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Connections that can transcribe audio, for the editor's microphone state. */
  async connections(): Promise<ConnectionSummary[]> {
    return (await this.providers.list()).filter((connection) => speechCapability(connection.provider) !== null);
  }

  async transcribe(input: TranscribeInput): Promise<VoiceTranscript> {
    const check = inspectWav(input.audio);
    if (!check.ok) throw new ProviderError("invalid-request", check.reason);

    const available = await this.connections();
    const connection = input.connectionId
      ? available.find((entry) => entry.id === input.connectionId)
      : available[0];
    if (!connection) {
      throw new ProviderError(
        "invalid-request",
        input.connectionId
          ? "That connection cannot transcribe audio. Connect Meta in Settings first."
          : "Connect Meta in Settings before using voice dictation."
      );
    }

    const credential = await this.providers.credential(connection.id);
    const capability = speechCapability(credential.provider, credential.metadata?.baseUrl);
    if (!capability) {
      throw new ProviderError("unsupported", "This build cannot transcribe audio with that connection.");
    }

    const body = speechForm(input.audio, {
      mode: "PUSH_TO_TALK",
      ...(input.languageBias?.length ? { languageBias: input.languageBias } : {}),
      ...(input.keywords?.length ? { keywords: input.keywords } : {})
    });

    let response: Response;
    try {
      response = await this.fetchImpl(capability.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${credential.secret}` },
        body,
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ProviderError("offline", "Could not reach Meta to transcribe the recording. Check your connection.", {
        provider: "meta",
        cause: error
      });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw normalizeProviderError({ provider: "meta", status: response.status, body: errorBody });
    }

    const parsed = parseSpeechResponse(await response.json().catch(() => null));
    return {
      text: parsed.text,
      provider: "meta",
      connectionLabel: credential.label,
      model: capability.model,
      durationMs: parsed.providerDurationMs ?? check.info.durationMs,
      turns: parsed.turns
    };
  }
}
