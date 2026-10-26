import { ProviderError, type ProviderId } from "./types";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/key";
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const PKCE_TIMEOUT_MS = 10 * 60 * 1000;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface PkceState {
  verifier: string;
  state: string;
  createdAt: number;
}

/** RFC 7636 verifier: 43–128 characters from the unreserved set. */
export function createVerifier(): string {
  return base64Url(randomBytes(48));
}

export function createState(): string {
  return base64Url(randomBytes(24));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function createPkce(now: number = Date.now()): Promise<PkceState> {
  const verifier = createVerifier();
  return { verifier, state: createState(), createdAt: now };
}

export function authorizeUrl(input: {
  callbackUrl: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", input.callbackUrl);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface CallbackResult {
  code: string;
}

/**
 * Validate a callback before the code is exchanged. The state must match exactly; an expired or
 * mismatched callback is rejected rather than retried, because codes are single use.
 */
export function readCallback(rawUrl: string, expectedState: string, now: number = Date.now(), createdAt?: number): CallbackResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderError("invalid-request", "The sign-in callback was not a valid address.");
  }
  if (createdAt !== undefined && now - createdAt > PKCE_TIMEOUT_MS) {
    throw new ProviderError("auth", "The sign-in request expired. Start again.");
  }
  const returnedState = url.searchParams.get("state");
  if (!returnedState || returnedState !== expectedState) {
    throw new ProviderError("auth", "The sign-in response did not match this request, so it was ignored.");
  }
  const error = url.searchParams.get("error");
  if (error) {
    throw new ProviderError("auth", `OpenRouter declined the sign-in: ${error}`);
  }
  const code = url.searchParams.get("code");
  if (!code) {
    throw new ProviderError("auth", "The sign-in response did not include a code.");
  }
  return { code };
}

/**
 * OpenRouter reports the amount it charged in the provider metadata of the final step. Read it
 * defensively: a missing, negative or non-numeric value means the cost is unknown, never zero.
 * Other providers do not report a price here and stay unknown.
 */
export function reportedCost(provider: ProviderId, metadata: unknown): number | null {
  if (provider !== "openrouter" || !metadata || typeof metadata !== "object") return null;
  const openrouter = (metadata as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  const record = openrouter as Record<string, unknown>;
  const usage = record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : null;
  const value = usage?.cost ?? record.cost;
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function parseKeyResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object" || typeof (payload as { key?: unknown }).key !== "string") {
    throw new ProviderError("unknown", "OpenRouter did not return a key.");
  }
  const key = (payload as { key: string }).key;
  if (!key.trim()) throw new ProviderError("unknown", "OpenRouter returned an empty key.");
  return key;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
