/**
 * A single redaction function used by every log line and error that crosses the process boundary.
 * Patterns are deliberately broad: a false positive in a log is cheap, a leaked key is not.
 */
const PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "openrouter", pattern: /\bsk-or-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-or-[redacted]" },
  { name: "openai", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "sk-[redacted]" },
  { name: "anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, replacement: "sk-ant-[redacted]" },
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
