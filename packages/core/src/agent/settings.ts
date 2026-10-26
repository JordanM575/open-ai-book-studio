import { z } from "zod";

/**
 * The per-book agent settings.
 *
 * They live in `BookMeta.settings.agent`, so two books in one library can behave differently and
 * a copied book carries its own behaviour with it.
 */
export const agentSettingsSchema = z
  .object({
    /**
     * The built-in tools the author has withdrawn from this book. A withdrawn tool is never offered
     * to the model and cannot be reached through the loopback backend or the MCP server.
     */
    disabledTools: z.array(z.string().min(2).max(60)).max(64).default([]),
    /** Whether the book's `SKILLS.md` is given to the agent. */
    skillsEnabled: z.boolean().default(true)
  })
  /**
   * The default is on the *input*, so a book written before this setting existed still opens:
   * the missing object is filled in rather than refused.
   */
  .prefault({});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = agentSettingsSchema.parse({});

/** How the agent's request is marked for the provider's cache. */
export const CACHE_PREFIX_MODES = ["off", "auto"] as const;
export type CachePrefixMode = (typeof CACHE_PREFIX_MODES)[number];

/**
 * The cache settings.
 *
 * They are per book, because a long book and a short one cache differently and the author may want
 * to turn it off for one of them.
 */
export const cacheSettingsSchema = z
  .object({
    /** `auto` marks the stable prefix where the provider supports it. `off` never does. */
    prefixMode: z.enum(CACHE_PREFIX_MODES).default("auto")
  })
  /** The same input default as the agent settings: an older book still opens. */
  .prefault({});

export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const DEFAULT_CACHE_SETTINGS: CacheSettings = cacheSettingsSchema.parse({});
