import type { ModelInfo, ProviderId } from "./types";

/**
 * The compatibility layer is intentionally one seam: every provider is translated into an AI SDK
 * `LanguageModel` by `modelFor` in the desktop main process. This module carries the provider-neutral
 * model facts the picker and the agent policy need, so the runtime never branches on a provider.
 */

export const MUSE_SPARK_CONTRIBUTOR = "muse-spark-1.3-contributor";
export const MUSE_SPARK_STANDARD = "muse-spark-1.3";

export const CONTRIBUTOR_WARNING =
  "Contributor mode: Meta may use this book's prompts and responses to train its models. Do not use it with an author's private manuscript.";

/** Known Meta facts, keyed by the stable model ID from Meta's model list. */
export const META_MODEL_PRESETS: Record<string, Partial<ModelInfo>> = {
  [MUSE_SPARK_CONTRIBUTOR]: {
    name: "Muse Spark 1.3 Contributor",
    contextLength: 1_048_576,
    supportsTools: true,
    supportsImages: true,
    inputPricePerMillion: 0.1,
    cachedInputPricePerMillion: 0.002,
    outputPricePerMillion: 0.2,
    trainingOnData: true,
    reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
    note: CONTRIBUTOR_WARNING
  },
  [MUSE_SPARK_STANDARD]: {
    name: "Muse Spark 1.3",
    contextLength: 1_048_576,
    supportsTools: true,
    supportsImages: true,
    inputPricePerMillion: 1.25,
    cachedInputPricePerMillion: 0.15,
    outputPricePerMillion: 4.25,
    trainingOnData: false,
    reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
    note: "Standard mode: prompts and completions are not used to train Meta models."
  }
};

/** Add the facts a provider does not publish in `/models`, without overwriting what it did send. */
export function applyModelPreset(provider: ProviderId, model: ModelInfo): ModelInfo {
  if (provider !== "meta") return model;
  const preset = META_MODEL_PRESETS[model.id];
  if (!preset) return model;
  return {
    ...model,
    ...preset,
    id: model.id,
    name: model.name && model.name !== model.id ? model.name : (preset.name ?? model.name)
  };
}

/** The name an author reads for a model id: Meta's own name when the studio knows it, else the id's last part. */
export function modelDisplayName(modelId: string): string {
  return META_MODEL_PRESETS[modelId]?.name ?? modelId.slice(modelId.lastIndexOf("/") + 1);
}

export function isContributorModelId(modelId: string): boolean {
  return /(?:^|[/-])contributor(?:$|[/-])/.test(modelId);
}

export function isContributorModel(model: ModelInfo | null): boolean {
  return model?.trainingOnData === true || isContributorModelId(model?.id ?? "");
}

export function contributorWarning(model: ModelInfo | null): string | null {
  return isContributorModel(model) ? CONTRIBUTOR_WARNING : null;
}
