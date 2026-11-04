/** OpenRouter's page where the author revokes a key it issued to the studio (011 FR-013). */
export const OPENROUTER_KEYS_PAGE_URL = "https://openrouter.ai/settings/keys";

/**
 * The only pages the studio opens in the author's browser on request. The main process compares whole
 * strings against this list, so no prefix, query, host or scheme can widen it.
 */
export const EXTERNAL_LINKS = [OPENROUTER_KEYS_PAGE_URL] as const;

export type ExternalLink = (typeof EXTERNAL_LINKS)[number];
