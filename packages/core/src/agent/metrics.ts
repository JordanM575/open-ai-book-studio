/**
 * The tool metrics.
 *
 * The agent already knows whether every tool call worked; the app did not keep the count. These
 * are the shapes that make it visible, per book.
 */

export interface ToolMetric {
  /** The tool's name. */
  name: string;
  /** How many times the agent called it. */
  calls: number;
  /** How many of those calls succeeded. */
  successes: number;
  /** How many failed. */
  failures: number;
  /** The share of calls that succeeded, between 0 and 1. */
  successRate: number;
}

export interface ToolMetricsSummary {
  /** Every tool the agent called, most called first. */
  tools: ToolMetric[];
  /** The total number of calls. */
  calls: number;
  /** The total number of failed calls. */
  failures: number;
}

/** One recorded call. */
export interface ToolCallRecord {
  /** The tool's name. */
  name: string;
  /** Whether the call worked. */
  ok: boolean;
  /** Why it failed, when the failure had a reason. */
  errorCode?: string;
  /** When it happened. */
  at: string;
}

export function summarizeToolMetrics(records: ToolCallRecord[]): ToolMetricsSummary {
  const byName = new Map<string, { calls: number; successes: number; failures: number }>();
  for (const record of records) {
    const entry = byName.get(record.name) ?? { calls: 0, successes: 0, failures: 0 };
    entry.calls += 1;
    if (record.ok) entry.successes += 1;
    else entry.failures += 1;
    byName.set(record.name, entry);
  }
  const tools: ToolMetric[] = [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      calls: entry.calls,
      successes: entry.successes,
      failures: entry.failures,
      successRate: entry.calls === 0 ? 0 : entry.successes / entry.calls
    }))
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name));
  return {
    tools,
    calls: tools.reduce((total, tool) => total + tool.calls, 0),
    failures: tools.reduce((total, tool) => total + tool.failures, 0)
  };
}

/**
 * The cache hit rate for a book.
 *
 * `null` means the provider did not report its cache, which is different from a rate of zero
 * (D-147). The app must never show "not reported" as "no cache".
 */
export interface CacheSummary {
  /** The input tokens the provider served from its cache. */
  cachedInputTokens: number;
  /** The input tokens it did not. */
  freshInputTokens: number;
  /** The share of input tokens that came from the cache, or `null` when it was not reported. */
  hitRate: number | null;
  /** How many turns reported a cache at all. */
  turnsWithCache: number;
  /** How many turns were counted. */
  turns: number;
}

export function summarizeCache(
  turns: Array<{ cachedInputTokens: number; inputTokens: number; reported: boolean }>
): CacheSummary {
  let cachedInputTokens = 0;
  let freshInputTokens = 0;
  let turnsWithCache = 0;
  let reported = 0;
  for (const turn of turns) {
    if (!turn.reported) continue;
    reported += 1;
    cachedInputTokens += turn.cachedInputTokens;
    freshInputTokens += Math.max(0, turn.inputTokens - turn.cachedInputTokens);
    if (turn.cachedInputTokens > 0) turnsWithCache += 1;
  }
  const total = cachedInputTokens + freshInputTokens;
  return {
    cachedInputTokens,
    freshInputTokens,
    hitRate: reported === 0 ? null : total === 0 ? null : cachedInputTokens / total,
    turnsWithCache,
    turns: reported
  };
}

/** What the app shows about a book's agent: how its tools did, and how well the cache worked. */
export interface AgentMetrics {
  /** The tool metrics. */
  tools: ToolMetricsSummary;
  /** The cache rate, or `null` when the provider did not report one. */
  cache: CacheSummary;
}

/** One tool in the agent's list, with whether the author has withdrawn it and how it has done. */
export interface AgentToolStatus {
  name: string;
  description: string;
  tier: "read" | "write" | "destructive";
  /** False when the author withdrew the tool for this book. */
  enabled: boolean;
  /** How many times the agent called it. */
  calls: number;
  /** How many of those calls succeeded. */
  successes: number;
  /** How many failed. */
  failures: number;
  /** The share of calls that succeeded, between 0 and 1. */
  successRate: number;
}

/** The book's skills file, when it has one. */
export interface AgentSkillsStatus {
  /** Whether the book folder holds a `SKILLS.md`. */
  present: boolean;
  /** Whether the agent is given it. */
  enabled: boolean;
  /** How many characters of instructions it holds. */
  characters: number;
}

/** Everything the app shows about a book's agent, in one call. */
export interface AgentStatus {
  /** The tools the agent may call, and which ones are withdrawn. */
  tools: AgentToolStatus[];
  /** The totals across every tool. */
  toolTotals: ToolMetricsSummary;
  /** The book's skills file. */
  skills: AgentSkillsStatus;
  /** The cache settings and what the cache actually did. */
  cache: CacheSummary & { mode: "off" | "auto" };
  /** The plugin folder and what it provides. */
  plugins: PluginStatus;
}

/** What the app shows about the plugin folder. */
export interface PluginStatus {
  /** The folder, or `null` when none is set. */
  folder: string | null;
  /** The plugins that loaded, by name. */
  loaded: string[];
  /** The tools they provide, by name. */
  tools: string[];
  /** The files that did not load, and why. */
  failures: Array<{ file: string; reason: string }>;
}
