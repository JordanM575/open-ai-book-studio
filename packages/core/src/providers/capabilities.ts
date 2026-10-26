import type { BrowserAccess, ModelInfo, ProviderId } from "./types";
import { providerById } from "./registry";
import { unavailableReason } from "./models";

export interface Capabilities {
  provider: ProviderId;
  browser: BrowserAccess;
  canRunAgent: boolean;
  supportsTools: boolean | null;
  supportsImages: boolean | null;
  contextLength: number | null;
  /** Author-facing reasons an action is unavailable. Empty when the model can run the agent. */
  reasons: string[];
}

/**
 * The one place an interface asks "can this provider and model do X?". A missing value from the
 * provider is reported as unknown, never guessed into a capability.
 */
export function capabilitiesFor(provider: ProviderId, model: ModelInfo | null): Capabilities {
  const description = providerById(provider);
  const reason = unavailableReason(model);
  return {
    provider,
    browser: description.browserAccess,
    canRunAgent: reason === null,
    supportsTools: model?.supportsTools ?? null,
    supportsImages: model?.supportsImages ?? null,
    contextLength: model?.contextLength ?? null,
    reasons: reason ? [reason] : []
  };
}
