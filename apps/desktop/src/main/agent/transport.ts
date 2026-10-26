import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ProviderId, StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";

type Adapter = (credential: StoredCredential, modelId: string) => LanguageModel;

/**
 * The single provider compatibility table. Every provider (OpenRouter, OpenAI, Anthropic, Gemini and
 * Meta) is translated to the AI SDK `LanguageModel` interface here, so the agent runtime, tools and
 * tests only see one endpoint shape. Keys exist only in this process and only for the model object's
 * lifetime. Nothing here fetches or logs.
 */
const ADAPTERS: Record<ProviderId, Adapter> = {
  openrouter: (credential, modelId) => createOpenRouter({ apiKey: credential.secret })(modelId),
  openai: (credential, modelId) => createOpenAI({ apiKey: credential.secret })(modelId),
  anthropic: (credential, modelId) => createAnthropic({ apiKey: credential.secret })(modelId),
  gemini: (credential, modelId) => createGoogleGenerativeAI({ apiKey: credential.secret })(modelId),
  meta: (credential, modelId) => {
    const baseURL = credential.metadata?.baseUrl;
    if (!baseURL) {
      throw new ProviderError("invalid-request", "Meta needs a base URL before it can be used.");
    }
    return createOpenAICompatible({ name: "meta", baseURL, apiKey: credential.secret })(modelId);
  }
};

export function modelFor(credential: StoredCredential, modelId: string): LanguageModel {
  if (!modelId.trim()) {
    throw new ProviderError("invalid-request", "No model was chosen for this book.");
  }
  const adapter = ADAPTERS[credential.provider];
  if (!adapter) {
    throw new ProviderError("unsupported", `This build cannot call ${credential.provider} yet.`);
  }
  return adapter(credential, modelId);
}

/** Exposed for capability tests; the runtime uses `modelFor` only. */
export function providerAdapterIds(): ProviderId[] {
  return Object.keys(ADAPTERS) as ProviderId[];
}
