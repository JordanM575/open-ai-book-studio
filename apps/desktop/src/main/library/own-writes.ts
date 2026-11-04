import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/*
 * What the studio itself last left at each path it wrote, so the library watcher can tell the
 * studio's own changes from another writer's without a time window.
 *
 * A path maps to the SHA-256 of the bytes the studio put there, or to `null` once the studio removed
 * it or moved it away. While a write is in flight both the old and the new state count as the
 * studio's own, so a check that lands between the temp file and the rename is not mistaken for
 * someone else. A path whose bytes differ from every state noted here was changed by another writer.
 *
 * Writes the studio makes for the toolkit's control plane or the phone bridge run inside
 * `asOtherWriter` and are not noted: the open window did not make them, so they are announced like
 * any outside edit and the author can refresh.
 */

const LIMIT = 4096;
const states = new Map<string, Set<string | null>>();
const removedFolders = new Set<string>();
const otherWriter = new AsyncLocalStorage<true>();

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function remember(path: string, accepted: Set<string | null>): void {
  states.delete(path);
  states.set(path, accepted);
  if (states.size > LIMIT) {
    const oldest = states.keys().next().value;
    if (oldest !== undefined) states.delete(oldest);
  }
}

/** Note bytes the studio is about to commit at `path`; call the result once the write landed or failed. */
export function noteOwnWrite(path: string, digest: string): (landed: boolean) => void {
  if (otherWriter.getStore()) return () => {};
  const key = resolve(path);
  const previous = states.get(key);
  remember(key, new Set([...(previous ?? []), digest]));
  return (landed) => {
    if (landed) remember(key, new Set([digest]));
    else if (previous) remember(key, previous);
    else states.delete(key);
  };
}

/** Note bytes the studio moved into place without rewriting them. */
export function noteOwnFile(path: string, digest: string): void {
  if (otherWriter.getStore()) return;
  remember(resolve(path), new Set([digest]));
}

/** Note that the studio removed a file, or a folder with everything in it, or moved it away. */
export function noteOwnRemoval(path: string, folder = false): void {
  if (otherWriter.getStore()) return;
  const key = resolve(path);
  remember(key, new Set([null]));
  if (!folder) return;
  removedFolders.delete(`${key}${sep}`);
  removedFolders.add(`${key}${sep}`);
  if (removedFolders.size > LIMIT) {
    const oldest = removedFolders.values().next().value;
    if (oldest !== undefined) removedFolders.delete(oldest);
  }
}

/** Run work for another client of the studio, such as the toolkit or the phone, so its writes are announced. */
export function asOtherWriter<T>(work: () => T): T {
  return otherWriter.run(true, work);
}

/**
 * Whether `path` is exactly as the studio last left it. A folder is never a change by itself: the
 * files in it are reported on their own. A file that cannot be read is reported, never assumed.
 */
export async function isOwnState(path: string): Promise<boolean> {
  const key = resolve(path);
  let digest: string | null;
  try {
    digest = sha256(await readFile(key));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EISDIR") return true;
    if (code !== "ENOENT") return false;
    digest = null;
  }
  if (states.get(key)?.has(digest)) return true;
  if (digest !== null) return false;
  for (const folder of removedFolders) {
    if (key.startsWith(folder)) return true;
  }
  return false;
}
