import { z } from "zod";

export const PROVIDER_IDS = ["openrouter", "openai", "anthropic", "gemini", "meta"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const providerIdSchema = z.enum(PROVIDER_IDS);

/** A connection id crosses the IPC boundary; validate it before any vault lookup. */
export const connectionIdSchema = z.string().regex(/^conn_[A-Za-z0-9]{6,}$/).max(200);

export const AUTH_KINDS = ["oauth", "api-key", "chatgpt-plan", "subscription"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/**
 * Whether a provider can be called from a browser origin. The web build reads this table; it never
 * decides for itself. `unknown` is treated as unavailable until a browser-access test says otherwise.
 */
export const BROWSER_ACCESS = ["yes", "no", "opt-in-header", "unknown"] as const;
export type BrowserAccess = (typeof BROWSER_ACCESS)[number];

export const CONNECTION_KINDS = ["openrouter-oauth", "api-key", "chatgpt-plan"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export interface ProviderDescription {
  id: ProviderId;
  name: string;
  /** Hosts the build may contact for this provider, used to derive the content security policy. */
  hosts: string[];
  authKinds: AuthKind[];
  browserAccess: BrowserAccess;
  docsUrl: string;
  /** Shown in the interface when the author asks what a provider costs or needs. */
  note: string;
}

/** What the renderer is allowed to know about a connection. Never contains a secret. */
export interface ConnectionSummary {
  id: string;
  provider: ProviderId;
  label: string;
  kind: ConnectionKind;
  createdAt: string;
  lastUsedAt?: string;
  /** The ChatGPT plan reports whether the plan itself may be used, separately from being signed in. */
  planUsable?: boolean;
}

export interface StoredCredential extends ConnectionSummary {
  secret: string;
  refreshToken?: string;
  metadata?: Record<string, string>;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number | null;
  supportsTools: boolean | null;
  supportsImages: boolean | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  /** Cached-input price when the provider publishes one, in USD per million tokens. */
  cachedInputPricePerMillion?: number | null;
  /** True when the provider may use prompts and completions to train its models. */
  trainingOnData?: boolean | null;
  /** Reasoning levels the provider advertises for this model, strongest last. */
  reasoningEfforts?: string[] | null;
  /** Short provider or policy note shown in the model picker. */
  note?: string | null;
}

export type ProviderErrorCode =
  | "auth"
  | "rate-limit"
  | "quota"
  | "context"
  | "refusal"
  | "offline"
  | "invalid-request"
  | "not-found"
  | "unsupported"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly options: { provider?: ProviderId; retryAfterSeconds?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
