const DB_NAME = "ai-book-studio";
const DB_VERSION = 1;
const STORE = "storage";

let database: Promise<IDBDatabase> | null = null;

/**
 * A tiny origin-scoped store for the chosen folder handle and browser library id.
 *
 * It deliberately holds no manuscript text, no book catalog and no credentials: the library
 * remains the ordinary file tree, and credentials belong to the separate vault in spec 011.
 */
function open(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not offer IndexedDB."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab. Close it and try again."));
  });
  return database;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The browser storage request failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The browser storage request was aborted."));
  });
}

export async function readStorageSetting<T>(key: string): Promise<T | null> {
  const value = await run<T | undefined>("readonly", (store) => store.get(key) as IDBRequest<T | undefined>);
  return value ?? null;
}

export async function writeStorageSetting(key: string, value: unknown): Promise<void> {
  await run("readwrite", (store) => store.put(value, key));
}

export async function deleteStorageSetting(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}

/** Test-only reset so an isolated profile can start without a stale handle. */
export function resetIndexedDbConnection(): void {
  database = null;
}
