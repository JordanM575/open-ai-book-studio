import type { ModelInfo } from "./types";

export const CATALOGUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type CatalogueFreshness = "fresh" | "stale" | "absent";

export interface Catalogue<T extends ModelInfo = ModelInfo> {
  models: T[];
  fetchedAt: string | null;
  /**
   * Why the provider's own list could not be read, when `models` holds only the ids the author
   * entered by hand (FR-007). Absent whenever the list was read.
   */
  listError?: string | undefined;
}

export function catalogueFreshness(
  catalogue: Catalogue,
  now: number = Date.now(),
  maxAgeMs: number = CATALOGUE_MAX_AGE_MS
): CatalogueFreshness {
  if (!catalogue.fetchedAt) return "absent";
  const fetched = Date.parse(catalogue.fetchedAt);
  if (Number.isNaN(fetched)) return "absent";
  return now - fetched <= maxAgeMs ? "fresh" : "stale";
}

/**
 * Merge a fresh catalogue with what we already knew. Known models keep their existing entry when a
 * provider omits a field; models that vanished are kept but marked unavailable, so a saved default
 * never becomes a crash.
 */
export function mergeCatalogue(previous: Catalogue, fresh: ModelInfo[], now: string = new Date().toISOString()): Catalogue {
  const previousById = new Map(previous.models.map((model) => [model.id, model]));
  const merged = fresh.map((model) => {
    const old = previousById.get(model.id);
    if (!old) return model;
    return {
      ...old,
      ...model,
      contextLength: model.contextLength ?? old.contextLength,
      supportsTools: model.supportsTools ?? old.supportsTools,
      supportsImages: model.supportsImages ?? old.supportsImages
    };
  });
  return { models: merged, fetchedAt: now };
}

export function findModel(catalogue: Catalogue, id: string): ModelInfo | null {
  return catalogue.models.find((model) => model.id === id) ?? null;
}

/** The writing agent needs tools and a context size it can trust; `null` is not good enough. */
export function canRunAgent(model: ModelInfo | null): boolean {
  return model !== null && model.supportsTools === true && model.contextLength !== null;
}

export function unavailableReason(model: ModelInfo | null): string | null {
  if (!model) return "This model is no longer in the provider's list.";
  if (model.supportsTools === false) return "This model cannot use tools, which the writing agent needs.";
  if (model.supportsTools === null) return "This provider does not say whether the model supports tools.";
  if (model.contextLength === null) return "This provider does not report the model's context size.";
  return null;
}
