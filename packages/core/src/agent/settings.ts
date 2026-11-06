import { z } from "zod";

/**
 * The per-book agent settings.
 *
 * They live in `BookMeta.settings.agent`, so two books in one library can behave differently and
 * a copied book carries its own behaviour with it.
 */
export const ANSWER_LENGTHS = ["brief", "standard", "detailed"] as const;
export type AgentAnswerLength = (typeof ANSWER_LENGTHS)[number];

export const agentSettingsSchema = z
  .looseObject({
    /**
     * The built-in tools the author has withdrawn from this book. A withdrawn tool is never offered
     * to the model and cannot be reached through the loopback backend or the MCP server.
     */
    disabledTools: z.array(z.string().min(2).max(60)).max(64).default([]),
    /** Whether the book's `SKILLS.md` is given to the agent. */
    skillsEnabled: z.boolean().default(true),
    /**
     * Optional per-book tone, shown to the author as free text and included
     * with submitted turns. Empty means no tone instruction.
     */
    tone: z.string().max(500).default(""),
    /** Answer length for this book's turns. Standard is the default. */
    answerLength: z.enum(ANSWER_LENGTHS).default("standard"),
    /**
     * Informational spending hooks (011 T036). A per-turn cost ceiling and a monthly
     * warning level, in US dollars. Both default to unset: nothing warns until the author
     * sets them, and a warning never blocks, refuses or retries a turn — enforcement
     * waits on D-116.
     */
    perTurnCeilingUsd: z.number().positive().finite().nullable().default(null),
    monthlyWarningUsd: z.number().positive().finite().nullable().default(null)
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
  .looseObject({
    /** `auto` marks the stable prefix where the provider supports it. `off` never does. */
    prefixMode: z.enum(CACHE_PREFIX_MODES).default("auto")
  })
  /** The same input default as the agent settings: an older book still opens. */
  .prefault({});

export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const DEFAULT_CACHE_SETTINGS: CacheSettings = cacheSettingsSchema.parse({});
