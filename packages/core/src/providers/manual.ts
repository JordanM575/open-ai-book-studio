import { applyModelPreset } from "./compatibility";
import type { ModelInfo, ProviderId } from "./types";

/**
 * Model ids the author enters by hand for a connection whose list leaves them out (FR-007). They live
 * in the connection's own record beside its base URL, so they survive a restart and go when the
 * connection is removed (FR-027). An id is kept only after the model answered one short request.
 */

/** The connection metadata key that holds the ids, as a JSON array of strings. */
export const MANUAL_MODELS_KEY = "manualModels";

/**
 * One token as providers spell model ids, such as `vendor/model-name:free`. Gemini puts the id in the
 * request path, so spaces, query characters and `.`/`..` segments are refused before any request.
 */
const MODEL_ID = /^[A-Za-z0-9~][A-Za-z0-9._:/@+~-]{0,199}$/;

export function isManualModelId(value: string): boolean {
  return MODEL_ID.test(value) && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The ids a connection keeps, oldest first. A value that cannot be read counts as none. */
export function readManualModelIds(metadata: Record<string, string> | undefined): string[] {
  const raw = metadata?.[MANUAL_MODELS_KEY];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && isManualModelId(id)))];
  } catch {
    return [];
  }
}

/** The same metadata with one more id. An id the connection already keeps is not repeated. */
export function withManualModelId(metadata: Record<string, string> | undefined, id: string): Record<string, string> {
  const ids = readManualModelIds(metadata);
  return { ...metadata, [MANUAL_MODELS_KEY]: JSON.stringify(ids.includes(id) ? ids : [...ids, id]) };
}

/**
 * A hand-entered model as the picker shows it. The check proves only that the model answers, so every
 * fact stays unknown unless a documented preset supplies it (FR-002, FR-003).
 */
export function manualModel(provider: ProviderId, id: string): ModelInfo {
  return {
    ...applyModelPreset(provider, {
      id,
      name: id,
      contextLength: null,
      supportsTools: null,
      supportsImages: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null
    }),
    manual: true
  };
}

/** A listed model wins over its hand-entered copy: the provider's own facts replace the unknowns. */
export function withManualModels(listed: ModelInfo[], manual: ModelInfo[]): ModelInfo[] {
  const ids = new Set(listed.map((model) => model.id));
  return [...listed, ...manual.filter((model) => !ids.has(model.id))];
}
