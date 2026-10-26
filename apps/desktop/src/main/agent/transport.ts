import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";

/**
 * The single place that turns a stored connection into an AI SDK language model. Keys exist only in
 * this process and only for the lifetime of the model object. Nothing here fetches or logs.
 */
export function modelFor(credential: StoredCredential, modelId: string): LanguageModel {
  if (!modelId.trim()) {
    throw new ProviderError("invalid-request", "No model was chosen for this book.");
  }
  switch (credential.provider) {
    case "openrouter":
      return createOpenRouter({ apiKey: credential.secret })(modelId);
    case "openai":
      return createOpenAI({ apiKey: credential.secret })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: credential.secret })(modelId);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: credential.secret })(modelId);
    case "meta": {
      const baseURL = credential.metadata?.baseUrl;
      if (!baseURL) {
        throw new ProviderError("invalid-request", "Meta needs a base URL before it can be used.");
      }
      return createOpenAICompatible({ name: "meta", baseURL, apiKey: credential.secret })(modelId);
    }
  }
}
