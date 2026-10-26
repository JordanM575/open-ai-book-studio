import type { ProviderId } from "@ai-book-studio/core/providers/types";

/** A JSON value, which is what a provider option may hold. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The provider-specific options a message or tool definition may carry.
 *
 * The AI SDK does not re-export this type, so it is described here: a map from a provider name to
 * that provider's own options.
 */
export type ProviderOptions = Record<string, Record<string, JsonValue>>;

/**
 * The cacheable prefix of the agent's request.
 *
 * The system instructions and the tool definitions do not change between the turns of one
 * conversation, so they are the natural prefix to cache (FR-001). Where the provider has an
 * explicit cache marker it is applied; where it does not, the request is left alone (D-147).
 */

/** The provider options for a cacheable system message. */
export interface CachePrefix {
  /** The provider options to put on the system message, or `undefined` for no marker. */
  systemProviderOptions?: ProviderOptions;
  /** The provider options to put on the tool definitions, or `undefined` for no marker. */
  toolProviderOptions?: ProviderOptions;
}

/** How long the provider should keep the prefix, when it offers the choice. */
const CACHE_TTL = "5m" as const;

/**
 * The cache marker for a provider, if it has one.
 *
 * Anthropic names the option `cacheControl`; the OpenAI-compatible providers cache automatically
 * and reject the unknown option, so they are left unmarked rather than broken.
 */
export function cachePrefixFor(provider: ProviderId, enabled: boolean): CachePrefix {
  if (!enabled) return {};
  if (provider !== "anthropic") return {};
  return {
    systemProviderOptions: {
      anthropic: { cacheControl: { type: "ephemeral", ttl: CACHE_TTL } }
    },
    toolProviderOptions: {
      anthropic: { cacheControl: { type: "ephemeral", ttl: CACHE_TTL } }
    }
  };
}
