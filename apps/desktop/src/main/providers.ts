import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { Catalogue } from "@ai-book-studio/core/providers/models";
import { parseOpenRouterModels } from "@ai-book-studio/core/providers/catalogue";
import { endpointFor, parseProviderModels } from "@ai-book-studio/core/providers/keys";
import { applyModelPreset } from "@ai-book-studio/core/providers/compatibility";
import { providerById } from "@ai-book-studio/core/providers/registry";
import type { CredentialVault } from "@ai-book-studio/core/providers/credentials";
import { ProviderError, type ConnectionSummary, type CredentialStatus, type ProviderId, type StoredCredential } from "@ai-book-studio/core/providers/types";
import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import {
  OPENROUTER_KEY_EXCHANGE_URL,
  OPENROUTER_MODELS_URL,
  PKCE_TIMEOUT_MS,
  authorizeUrl,
  challengeFor,
  createPkce,
  parseKeyResponse,
  readCallback
} from "@ai-book-studio/core/providers/openrouter";
import { newConnectionId } from "./credential-file";

interface ActiveSignIn {
  server: Server;
  cancel: () => void;
}

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Owns provider connections in the desktop app. It is the only place that reads a secret from the
 * vault, and the only place that talks to a provider's auth and catalogue endpoints.
 */
export class ProviderService {
  private active: ActiveSignIn | null = null;
  private readonly catalogues = new Map<string, Catalogue>();

  constructor(
    private readonly vault: CredentialVault,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async list(): Promise<ConnectionSummary[]> {
    return this.vault.list();
  }

  /** Whether this computer can store a secret at all. The UI explains the refusal before a flow. */
  async available(): Promise<boolean> {
    return this.vault.isAvailable();
  }

  /** A non-secret health check for Settings; it never returns a key or a host path. */
  async status(): Promise<CredentialStatus> {
    const state = this.vault.status
      ? await this.vault.status()
      : { available: await this.vault.isAvailable(), backend: "Protected storage", detail: "" };
    return { ...state, connections: (await this.vault.list()).length };
  }

  /** The secret itself. Only the main process may call this, for a provider request. */
  async credential(connectionId: string): Promise<StoredCredential> {
    return this.requireCredential(connectionId);
  }

  async remove(connectionId: string): Promise<void> {
    await this.vault.remove(connectionId);
    this.catalogues.delete(connectionId);
  }

  async startOpenRouter(): Promise<ConnectionSummary> {
    const active = this.active;
    if (active) {
      throw new ProviderError("invalid-request", "A sign-in is already waiting in your browser. Finish it or cancel it first.");
    }
    const pkce = await createPkce();
    const challenge = await challengeFor(pkce.verifier);
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new ProviderError("unknown", "Could not open a local port for sign-in.");
    }
    const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
    const authUrl = authorizeUrl({ callbackUrl, challenge, state: pkce.state });

    const outcome = new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, code?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active = null;
        server.close();
        if (error) reject(error);
        else resolve(code ?? "");
      };
      const timer = setTimeout(() => {
        finish(new ProviderError("auth", "Sign-in timed out. Start again when you are ready."));
      }, PKCE_TIMEOUT_MS);
      timer.unref?.();

      this.active = {
        server,
        cancel: () => finish(new ProviderError("auth", "Sign-in cancelled."))
      };

      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", callbackUrl);
        if (url.pathname !== "/callback") {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        try {
          const { code } = readCallback(url.toString(), pkce.state, Date.now(), pkce.createdAt);
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          response.end(
            "<!doctype html><meta charset=\"utf-8\"><title>AI Book Studio</title><body style=\"font:15px -apple-system,system-ui,sans-serif;padding:3rem;max-width:32rem;margin:auto\"><h1 style=\"font-size:1.25rem\">You are signed in</h1><p>You can close this tab and return to AI Book Studio.</p></body>"
          );
          finish(null, code);
        } catch (error) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("This sign-in link is not valid. Return to AI Book Studio and try again.");
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      server.on("error", (error) => finish(error));
    });
    // If opening the browser or the exchange fails before this promise settles, cancel it here so a
    // rejection is never left unobserved. `finish` is idempotent.
    void outcome.catch(() => {});

    try {
      await this.openExternal(authUrl);
      const code = await outcome;
      const key = await this.exchangeCode(code, pkce.verifier);
      const id = newConnectionId();
      const createdAt = new Date().toISOString();
      const existing = (await this.vault.list()).filter((connection) => connection.provider === "openrouter");
      await this.vault.set({
        id,
        provider: "openrouter",
        label: existing.length === 0 ? "OpenRouter" : `OpenRouter (${existing.length + 1})`,
        kind: "openrouter-oauth",
        createdAt,
        secret: key
      });
      return {
        id,
        provider: "openrouter",
        label: existing.length === 0 ? "OpenRouter" : `OpenRouter (${existing.length + 1})`,
        kind: "openrouter-oauth",
        createdAt
      };
    } catch (error) {
      this.active?.cancel();
      throw error;
    }
  }

  cancelOpenRouter(): void {
    this.active?.cancel();
  }

  /**
   * Validate a key before it is saved. A rejected or unreachable provider writes nothing; the caller
   * gets the normalized reason and can try again.
   */
  async addKey(input: {
    provider: ProviderId;
    secret: string;
    label?: string | undefined;
    baseUrl?: string | undefined;
  }): Promise<ConnectionSummary> {
    const secret = input.secret.trim();
    if (secret.length < 8) {
      throw new ProviderError("invalid-request", "That key looks too short. Paste the whole key.", { provider: input.provider });
    }
    const endpoint = endpointFor(input.provider, secret, input.baseUrl);
    await this.request(endpoint.url, endpoint.headers, input.provider);

    const existing = (await this.vault.list()).filter((connection) => connection.provider === input.provider);
    const providerName = providerById(input.provider).name;
    const label = input.label?.trim() || (existing.length === 0 ? providerName : `${providerName} (${existing.length + 1})`);
    const createdAt = new Date().toISOString();
    const id = newConnectionId();
    await this.vault.set({
      id,
      provider: input.provider,
      label,
      kind: "api-key",
      createdAt,
      secret,
      ...(input.baseUrl ? { metadata: { baseUrl: input.baseUrl } } : {})
    });
    return { id, provider: input.provider, label, kind: "api-key", createdAt };
  }

  async models(connectionId: string): Promise<Catalogue> {
    const cached = this.catalogues.get(connectionId);
    if (cached) return cached;
    const credential = await this.requireCredential(connectionId);
    const endpoint =
      credential.provider === "openrouter"
        ? {
            url: OPENROUTER_MODELS_URL,
            headers: {
              authorization: `Bearer ${credential.secret}`,
              "http-referer": "https://ai-book-studio.local",
              "x-title": "AI Book Studio"
            }
          }
        : endpointFor(credential.provider, credential.secret, credential.metadata?.baseUrl);
    const response = await this.request(endpoint.url, endpoint.headers, credential.provider);
    const payload = await response.json();
    const models =
      credential.provider === "openrouter"
        ? parseOpenRouterModels(payload)
        : parseProviderModels(credential.provider, payload);
    const enriched = models.map((model) => applyModelPreset(credential.provider, model));
    const catalogue: Catalogue = { models: enriched, fetchedAt: new Date().toISOString() };
    this.catalogues.set(connectionId, catalogue);
    await this.vault.touch(connectionId);
    return catalogue;
  }

  async test(connectionId: string): Promise<{ message: string }> {
    const credential = await this.requireCredential(connectionId);
    const endpoint = endpointFor(credential.provider, credential.secret, credential.metadata?.baseUrl);
    const response = await this.request(endpoint.url, endpoint.headers, credential.provider);
    await this.vault.touch(connectionId);
    if (credential.provider !== "openrouter") {
      return { message: `${providerById(credential.provider).name} accepted this connection.` };
    }
    const payload = (await response.json()) as { data?: { label?: unknown; limit_remaining?: unknown } };
    const remaining = payload.data?.limit_remaining;
    const suffix = typeof remaining === "number" ? ` $${remaining.toFixed(2)} of credit remains.` : "";
    return { message: `OpenRouter accepted this connection.${suffix}` };
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ProviderError("offline", "Could not reach OpenRouter to finish sign-in. Check your connection and try again.", {
        provider: "openrouter",
        cause: error
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw normalizeProviderError({ provider: "openrouter", status: response.status, body });
    }
    return parseKeyResponse(await response.json().catch(() => null));
  }

  private async request(url: string, headers: Record<string, string>, provider: ProviderId): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ProviderError("offline", "Could not reach the provider. Check your connection and try again.", {
        provider,
        cause: error
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw normalizeProviderError({
        provider,
        status: response.status,
        body,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"))
      });
    }
    return response;
  }

  private async requireCredential(connectionId: string) {
    const credential = await this.vault.get(connectionId);
    if (!credential) {
      throw new ProviderError("auth", "That connection no longer exists. Connect again.", { provider: "openrouter" });
    }
    return credential;
  }
}

/** `Retry-After` is either seconds or an HTTP date; return seconds or undefined. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
