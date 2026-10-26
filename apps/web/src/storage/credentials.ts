import type { CredentialVault } from "@ai-book-studio/core/providers/credentials";
import type { ConnectionSummary, CredentialStatus, StoredCredential } from "@ai-book-studio/core/providers/types";

const DEFAULT_DB = "ai-book-studio-credentials";
const STORE = "connections";

/**
 * Origin-scoped browser credential vault (D-105).
 *
 * There is no OS keychain in a browser and no passphrase claim: the records live in this origin's
 * IndexedDB. Same-origin scripts can read them, and clearing site data removes them. The library,
 * logs, archives and URLs never receive the secret. The desktop vault remains the stronger store.
 */
export class BrowserCredentialVault implements CredentialVault {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly name: string = DEFAULT_DB) {}

  async isAvailable(): Promise<boolean> {
    return typeof indexedDB !== "undefined";
  }

  async status(): Promise<Omit<CredentialStatus, "connections">> {
    const available = await this.isAvailable();
    return {
      available,
      backend: "Browser origin storage",
      detail: available
        ? "Same-origin scripts can read this vault; clearing site data removes it."
        : "This browser cannot store credentials."
    };
  }

  async list(): Promise<ConnectionSummary[]> {
    const records = await this.all();
    return records
      .map(({ secret: _secret, refreshToken: _refresh, metadata: _metadata, ...summary }) => summary)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredCredential | null> {
    const record = await this.request<StoredCredential | undefined>("readonly", (store) => store.get(id));
    return record ? { ...record } : null;
  }

  async set(credential: StoredCredential): Promise<void> {
    await this.request("readwrite", (store) => store.put({ ...credential }));
  }

  async remove(id: string): Promise<void> {
    await this.request("readwrite", (store) => store.delete(id));
  }

  async touch(id: string, at: string = new Date().toISOString()): Promise<void> {
    const record = await this.get(id);
    if (!record) return;
    await this.set({ ...record, lastUsedAt: at });
  }

  /** Explicit author action; also used by tests to start from an empty origin. */
  async clear(): Promise<void> {
    await this.request("readwrite", (store) => store.clear());
  }

  private async all(): Promise<StoredCredential[]> {
    const records = await this.request<StoredCredential[]>("readonly", (store) => store.getAll());
    return Array.isArray(records) ? records : [];
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("This browser does not offer origin storage for credentials."));
        return;
      }
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("The credential vault could not be opened."));
      request.onblocked = () => reject(new Error("The credential vault is blocked by another tab."));
    });
    return this.database;
  }

  private async request<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("The credential request failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The credential transaction was aborted."));
    });
  }
}
