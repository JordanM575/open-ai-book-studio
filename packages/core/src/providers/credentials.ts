import type { ConnectionSummary, ProviderId, StoredCredential, CredentialStatus } from "./types";

/** Shown wherever the browser build offers credentials. It is deliberately not a security claim. */
export const BROWSER_CREDENTIAL_DISCLOSURE =
  "Provider credentials live in this browser's origin storage, not the operating system keychain. Same-origin scripts can read them, and clearing site data removes them. They are never written into the library, logs or archives.";

/**
 * The credential boundary. The renderer only ever sees `ConnectionSummary`; a secret leaves the
 * vault exclusively inside the main process (desktop) or worker (browser) for a provider call.
 */
export interface CredentialVault {
  isAvailable(): Promise<boolean>;
  list(): Promise<ConnectionSummary[]>;
  get(id: string): Promise<StoredCredential | null>;
  set(credential: StoredCredential): Promise<void>;
  remove(id: string): Promise<void>;
  /** Record that a connection was used, without rewriting the secret. */
  touch(id: string, at?: string): Promise<void>;
  /** Probe the protected storage without exposing a secret. */
  status?(): Promise<Omit<CredentialStatus, "connections">>;
}

export class MemoryVault implements CredentialVault {
  private readonly records = new Map<string, StoredCredential>();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async list(): Promise<ConnectionSummary[]> {
    return [...this.records.values()]
      .map(({ secret: _secret, refreshToken: _refresh, metadata: _meta, ...summary }) => summary)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<StoredCredential | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async set(credential: StoredCredential): Promise<void> {
    this.records.set(credential.id, { ...credential });
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }

  async touch(id: string, at: string = new Date().toISOString()): Promise<void> {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, lastUsedAt: at });
  }

  async status(): Promise<Omit<CredentialStatus, "connections">> {
    return { available: true, backend: "In-memory test vault", detail: "" };
  }
}

/** A connection id that satisfies the shared schema; the desktop vault has its own equivalent. */
export function newConnectionId(): string {
  return `conn_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function connectionLabel(provider: ProviderId, count: number): string {
  const base = provider === "openrouter" ? "OpenRouter" : provider;
  return count > 1 ? `${base} (${count})` : base;
}
