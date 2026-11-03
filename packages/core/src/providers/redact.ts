/**
 * A single redaction function used by every log line and error that crosses the process boundary.
 * Patterns are deliberately broad: a false positive in a log is cheap, a leaked key is not.
 */
const PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  /*
   * The order matters. Every provider with an `sk-` prefix is a shape of the same prefix, so the
   * specific ones have to run before the generic one or an `sk-ant-…` key is reported as an OpenAI
   * key — redacted either way, but labelled as the wrong provider in the log.
   */
  { name: "openrouter", pattern: /\bsk-or-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-or-[redacted]" },
  { name: "anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-ant-[redacted]" },
  { name: "openai", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "sk-[redacted]" },
  { name: "google", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: "AIza[redacted]" },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: "Bearer [redacted]" },
  { name: "basic", pattern: /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: "Basic [redacted]" },
  {
    name: "query-key",
    pattern: /([?&](?:api[_-]?key|key|access_token|code|refresh_token)=)[^&\s"']+/gi,
    replacement: "$1[redacted]"
  },
  {
    name: "json-key",
    pattern: /("(?:apiKey|api_key|access_token|refresh_token|secret|password)"\s*:\s*")[^"]+/gi,
    replacement: "$1[redacted]"
  },
  { name: "long-token", pattern: /\b[A-Fa-f0-9]{64,}\b/g, replacement: "[redacted-token]" }
];

export function redact(value: string): string {
  let result = value;
  for (const { pattern, replacement } of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * The secret shapes without replacements, for scanners that must name the file
 * and the class but never print the matching value. Derived from PATTERNS so the
 * two can never drift apart; the global flag is stripped because scanners test
 * many values with one expression.
 */
export function secretShapes(): Array<{ name: string; pattern: RegExp }> {
  return PATTERNS.map(({ name, pattern }) => ({
    name,
    pattern: new RegExp(pattern.source, pattern.flags.replace("g", ""))
  }));
}

/** Redact every string reachable from an unknown value without mutating it. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = /key|secret|token|password|authorization/i.test(key) ? "[redacted]" : redactDeep(item);
    }
    return output as T;
  }
  return value;
}
