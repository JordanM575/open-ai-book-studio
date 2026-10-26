import type { ModelInfo, ProviderId } from "./types";

/** OpenRouter's `/api/v1/models` payload, narrowed to what the studio actually uses. */
interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  supported_parameters?: unknown;
  architecture?: { input_modalities?: unknown } | null;
}

export function parseOpenRouterModels(payload: unknown): ModelInfo[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const models: ModelInfo[] = [];
  for (const raw of data as OpenRouterModel[]) {
    if (typeof raw?.id !== "string") continue;
    const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
    const modalities = raw.architecture && Array.isArray(raw.architecture.input_modalities) ? raw.architecture.input_modalities : [];
    models.push({
      id: raw.id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : raw.id,
      contextLength: positiveInteger(raw.context_length),
      supportsTools: params.length > 0 ? params.includes("tools") : null,
      supportsImages: modalities.length > 0 ? modalities.includes("image") : null,
      inputPricePerMillion: perMillion(raw.pricing?.prompt),
      outputPricePerMillion: perMillion(raw.pricing?.completion)
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function perMillion(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 1_000_000 * 1_000_000) / 1_000_000;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/** A stable, human label for a model id, used when a provider gives none. */
export function modelLabel(provider: ProviderId, id: string): string {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim() || provider;
}
