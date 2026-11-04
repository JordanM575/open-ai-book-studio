import type { ProviderErrorCode, ProviderId } from "./types";
import { ProviderError } from "./types";

interface NormalizeInput {
  provider: ProviderId;
  status?: number | undefined;
  body?: string | undefined;
  message?: string | undefined;
  retryAfterSeconds?: number | undefined;
}

const AUTH = /invalid.*(key|token)|unauthor|forbidden|authentication|expired/i;
const PERMISSION = /permission|insufficient.*scope|missing.*scope|not entitled|entitlement|forbidden/i;
const QUOTA = /quota|insufficient.*credit|billing|payment required/i;
const CONTEXT = /context.*(length|window)|too many tokens|maximum.*tokens/i;
const REFUSAL = /content policy|safety|refus|moderation/i;
const RATE = /rate limit|too many requests|slow down/i;

/**
 * `Retry-After` arrives as seconds or an HTTP date. Either way the studio counts whole
 * seconds from now; anything else means the provider named no wait.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** One place that turns a provider response into something the interface can explain. */
export function normalizeProviderError(input: NormalizeInput): ProviderError {
  const haystack = `${input.message ?? ""} ${input.body ?? ""}`.trim();
  const status = input.status;
  const options = {
    provider: input.provider,
    ...(input.retryAfterSeconds !== undefined ? { retryAfterSeconds: input.retryAfterSeconds } : {})
  };

  if (status === 429) {
    // When the provider says how long to wait, the chat names that wait; "shortly" would be a second one.
    const wait = input.retryAfterSeconds !== undefined ? "" : " Try again shortly.";
    return new ProviderError("rate-limit", `The provider is rate limiting this account.${wait}`, options);
  }
  if (status === 402 || QUOTA.test(haystack)) {
    return new ProviderError("quota", "This account has no credit or has reached its quota.", options);
  }
  if (REFUSAL.test(haystack)) {
    return new ProviderError("refusal", "The provider's content policy declined this request.", options);
  }
  if (status === 403 || PERMISSION.test(haystack)) {
    return new ProviderError(
      "permission",
      "This key does not have permission for that request. Check the key's scopes or plan.",
      options
    );
  }
  if (status === 401 || AUTH.test(haystack)) {
    return new ProviderError("auth", "The provider rejected this connection. Reconnect or check the key.", options);
  }
  if (CONTEXT.test(haystack)) {
    return new ProviderError(
      "context",
      "The request is larger than this model can read. Choose a larger model or start a new conversation.",
      options
    );
  }
  if (RATE.test(haystack)) {
    return new ProviderError("rate-limit", "The provider asked us to slow down. Try again shortly.", options);
  }
  if (status === 400 || status === 422) {
    return new ProviderError("invalid-request", "The provider could not accept this request.", options);
  }
  if (status !== undefined && status >= 500) {
    return new ProviderError("unknown", "The provider had a problem on its side. Your text is safe; try again.", options);
  }
  if (isOffline(input)) {
    return new ProviderError("offline", "The provider could not be reached. Check your connection.", options);
  }
  return new ProviderError("unknown", input.message ?? "The provider returned an unexpected response.", options);
}

const MODEL_MISSING =
  /not a valid model|model_not_found|not_found_error|(?:unknown|invalid|no such) model|model\b[^.]{0,60}\b(?:not found|does not exist|not exist)/i;

/**
 * Why a hand-entered model id failed its check (FR-007). A 404, or a 400 that says the model does not
 * exist, means the id is wrong for this connection. Every other answer keeps the shared mapping, so no
 * access, rate limits and an unreachable provider read the same here as they do anywhere else.
 */
export function normalizeModelCheckError(input: NormalizeInput): ProviderError {
  const haystack = `${input.message ?? ""} ${input.body ?? ""}`;
  const missing =
    input.status === 404 || ((input.status === 400 || input.status === 422) && MODEL_MISSING.test(haystack));
  if (missing) {
    return new ProviderError(
      "not-found",
      "This connection does not offer a model with that id. Check the spelling and that your account can use it.",
      { provider: input.provider }
    );
  }
  return normalizeProviderError(input);
}

function isOffline(input: NormalizeInput): boolean {
  if (input.status !== undefined) return false;
  return /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|abort/i.test(input.message ?? "");
}

export function isProviderErrorCode(value: string): value is ProviderErrorCode {
  return [
    "auth",
    "permission",
    "rate-limit",
    "quota",
    "context",
    "refusal",
    "offline",
    "invalid-request",
    "unsupported",
    "unknown"
  ].includes(value);
}
