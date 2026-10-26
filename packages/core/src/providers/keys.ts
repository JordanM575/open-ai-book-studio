import { ProviderError, type ModelInfo, type ProviderId } from "./types";
import { providerById } from "./registry";

export const ANTHROPIC_VERSION = "2023-06-01";

export interface ProviderEndpoint {
  url: string;
  headers: Record<string, string>;
}

/**
 * Where a key is checked and models are listed. The key travels in a header, never a query string,
 * because URLs end up in logs and proxy histories.
 */
export function endpointFor(provider: ProviderId, secret: string, baseUrl?: string): ProviderEndpoint {
  switch (provider) {
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/key",
        headers: { authorization: `Bearer ${secret}` }
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { authorization: `Bearer ${secret}` }
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": secret, "anthropic-version": ANTHROPIC_VERSION }
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        headers: { "x-goog-api-key": secret }
      };
    case "meta": {
      const base = normalizeBaseUrl(baseUrl, provider);
      return { url: `${base}/models`, headers: { authorization: `Bearer ${secret}` } };
    }
  }
}

export function normalizeBaseUrl(baseUrl: string | undefined, provider: ProviderId): string {
  if (!baseUrl?.trim()) {
    throw new ProviderError("invalid-request", `${providerById(provider).name} needs a base URL from its developer console.`);
  }
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ProviderError("invalid-request", "That base URL is not a valid address.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new ProviderError("invalid-request", "Use an https address for the provider's base URL.");
  }
  return url.toString().replace(/\/+$/, "");
}

/** Parse the model list each provider returns into the studio's shape, leaving unknown fields null. */
export function parseProviderModels(provider: ProviderId, payload: unknown): ModelInfo[] {
  const body = payload as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return [];

  if (provider === "gemini") {
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .flatMap((entry): ModelInfo[] => {
        const raw = entry as Record<string, unknown>;
        const fullName = typeof raw.name === "string" ? raw.name : "";
        const id = fullName.replace(/^models\//, "");
        if (!id) return [];
        return [
          {
            id,
            name: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : id,
            contextLength: positiveInteger(raw.inputTokenLimit),
            supportsTools: null,
            supportsImages: null,
            inputPricePerMillion: null,
            outputPricePerMillion: null
          }
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .flatMap((entry): ModelInfo[] => {
      const raw = entry as Record<string, unknown>;
      if (typeof raw.id !== "string" || !raw.id) return [];
      const name =
        typeof raw.display_name === "string" && raw.display_name
          ? raw.display_name
          : typeof raw.name === "string" && raw.name
            ? raw.name
            : raw.id;
      return [
        {
          id: raw.id,
          name,
          contextLength: positiveInteger(raw.context_window ?? raw.input_token_limit),
          supportsTools: null,
          supportsImages: null,
          inputPricePerMillion: null,
          outputPricePerMillion: null
        }
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
