import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, type LanguageModel } from "ai";
import { normalizeModelCheckError, parseRetryAfter } from "@ai-book-studio/core/providers/errors";
import type { ProviderId, StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";

/** A fetch passed in replaces the global one for this model only; the runtime never passes one. */
type Adapter = (credential: StoredCredential, modelId: string, fetchImpl?: typeof fetch) => LanguageModel;

/**
 * The single provider compatibility table. Every provider (OpenRouter, OpenAI, Anthropic, Gemini and
 * Meta) is translated to the AI SDK `LanguageModel` interface here, so the agent runtime, tools and
 * tests only see one endpoint shape. Keys exist only in this process and only for the model object's
 * lifetime. Nothing here fetches or logs.
 */
const ADAPTERS: Record<ProviderId, Adapter> = {
  openrouter: (credential, modelId, fetchImpl) =>
    createOpenRouter({ apiKey: credential.secret, ...withFetch(fetchImpl) })(modelId),
  openai: (credential, modelId, fetchImpl) => createOpenAI({ apiKey: credential.secret, ...withFetch(fetchImpl) })(modelId),
  anthropic: (credential, modelId, fetchImpl) =>
    createAnthropic({ apiKey: credential.secret, ...withFetch(fetchImpl) })(modelId),
  gemini: (credential, modelId, fetchImpl) =>
    createGoogleGenerativeAI({ apiKey: credential.secret, ...withFetch(fetchImpl) })(modelId),
  meta: (credential, modelId, fetchImpl) => {
    const baseURL = credential.metadata?.baseUrl;
    if (!baseURL) {
      throw new ProviderError("invalid-request", "Meta needs a base URL before it can be used.");
    }
    return createOpenAICompatible({ name: "meta", baseURL, apiKey: credential.secret, ...withFetch(fetchImpl) })(modelId);
  }
};

function withFetch(fetchImpl: typeof fetch | undefined): { fetch?: typeof fetch } {
  return fetchImpl ? { fetch: fetchImpl } : {};
}

export function modelFor(credential: StoredCredential, modelId: string, fetchImpl?: typeof fetch): LanguageModel {
  if (!modelId.trim()) {
    throw new ProviderError("invalid-request", "No model was chosen for this book.");
  }
  const adapter = ADAPTERS[credential.provider];
  if (!adapter) {
    throw new ProviderError("unsupported", `This build cannot call ${credential.provider} yet.`);
  }
  return adapter(credential, modelId, fetchImpl);
}

/** The whole of a model check: fixed words that carry no book text. */
export const MODEL_CHECK_PROMPT = "Reply with OK.";

/**
 * The smallest answer limit every adapter accepts. OpenAI's Responses API refuses fewer than 16
 * output tokens, so a one-token check would turn away a model that works.
 */
export const MODEL_CHECK_MAX_TOKENS = 16;

const MODEL_CHECK_TIMEOUT_MS = 30_000;

/**
 * Prove that a hand-entered model answers on this connection (FR-007). The check is one short request
 * through the same adapter a turn uses, so it goes only to the connection's own endpoint and base URL.
 * It never retries: a failure is reported in the shared provider vocabulary, never repeated.
 */
export async function checkModel(credential: StoredCredential, modelId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const model = modelFor(credential, modelId, fetchImpl);
  try {
    await generateText({
      model,
      prompt: MODEL_CHECK_PROMPT,
      maxOutputTokens: MODEL_CHECK_MAX_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(MODEL_CHECK_TIMEOUT_MS)
    });
  } catch (error) {
    // The same reading of a provider failure as a turn's: status, body and headers when the provider
    // answered, only words when it did not.
    const apiError = APICallError.isInstance(error) ? error : null;
    const retryAfter = parseRetryAfter(
      apiError?.responseHeaders?.["retry-after"] ?? apiError?.responseHeaders?.["Retry-After"]
    );
    throw normalizeModelCheckError({
      provider: credential.provider,
      message: error instanceof Error ? error.message : String(error),
      ...(apiError?.statusCode !== undefined ? { status: apiError.statusCode } : {}),
      ...(apiError?.responseBody ? { body: apiError.responseBody } : {}),
      ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
    });
  }
}

/** Exposed for capability tests; the runtime uses `modelFor` only. */
export function providerAdapterIds(): ProviderId[] {
  return Object.keys(ADAPTERS) as ProviderId[];
}
