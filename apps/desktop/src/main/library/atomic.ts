import { randomBytes } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { noteOwnWrite, sha256 } from "./own-writes";

/**
 * The legacy sibling temp name; production also uses this shape with a random base-36 suffix.
 * The library watcher matches both with `isAtomicTempName`.
 */
export function atomicTempName(name: string, pid = process.pid, now: number | bigint = Date.now()): string {
  return `.${name}.${pid}.${now.toString(36)}.tmp`;
}

const ATOMIC_TEMP = /^\..+\.\d+\.[0-9a-z]+\.tmp$/;

/** Whether a file name is one of the studio's own atomic temp files. */
export function isAtomicTempName(name: string): boolean {
  return ATOMIC_TEMP.test(name);
}

/**
 * Writes a file so a reader (or a sync agent) sees either the old content or the new content,
 * never a half-written file:
 *   1. write the bytes to a sibling temp file and fsync it,
 *   2. rename over the target (atomic on POSIX and on NTFS),
 *   3. try to fsync the directory (not supported on every filesystem).
 *
 * A sibling temp file keeps the rename on the same filesystem; a temp directory would not be
 * atomic and would break on network/sync volumes that do not support cross-device moves.
 *
 * The bytes are noted as the studio's own before the rename, so the library watcher can tell this
 * write from another writer's (`own-writes.ts`). This is not a compare-and-swap against other writers.
 * Cleanup assumes other processes do not replace our random temp pathname after creation; pathname
 * unlink cannot guarantee ownership in an adversarial shared directory.
 */
// Per-writer dependencies permit deterministic fault tests without process-wide filesystem mocks.
const defaults = {
  open, rename, stat, unlink, noteOwnWrite, sha256,
  tempName: (name: string) => atomicTempName(name, process.pid, BigInt(`0x${randomBytes(16).toString("hex")}`)),
  wait: () => new Promise<void>((resolve) => setTimeout(resolve, 60)),
};

/** @internal Test seam; production uses writeFileAtomic with the real filesystem. */
export function createAtomicWriter(overrides: Partial<typeof defaults> = {}) {
  const fs = { ...defaults, ...overrides };
  return async function write(path: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
    const dir = dirname(path);
    // Explicit modes retain open(2)'s umask semantics. Existing permission bits are sampled only;
    // concurrent changes, ACLs, ownership, xattrs, special bits and symlinks are not preserved.
    let mode = (options.mode ?? 0o644) & ~process.umask() & 0o777;
    if (options.mode === undefined) {
      try {
        mode = (await fs.stat(path)).mode & 0o777;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    let temp = "";
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = join(dir, fs.tempName(basename(path)));
      try {
        handle = await fs.open(candidate, "wx", 0o600);
        temp = candidate; // Only a successfully created pathname is ours to clean up.
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 9) throw error;
      }
    }
    if (!handle) throw new Error("Unable to create atomic temporary file");

    let settle: ((success: boolean) => void) | undefined;
    let published = false;
    try {
      let primary: unknown;
      let failed = false;
      try {
        await handle.writeFile(data);
        await handle.chmod(mode);
        await handle.sync();
      } catch (error) {
        failed = true;
        primary = error;
      }
      try {
        await handle.close();
      } catch (error) {
        if (!failed) { failed = true; primary = error; }
      }
      if (failed) throw primary;

      settle = fs.noteOwnWrite(path, fs.sha256(data));
      try {
        await fs.rename(temp, path);
      } catch (error) {
        if (!isRetryableRename(error)) throw error;
        await fs.wait();
        await fs.rename(temp, path);
      }
      published = true;
      settle(true);
    } catch (error) {
      if (settle && !published) {
        try { settle(false); } catch { /* Preserve the original error. */ }
      }
      if (!published) await fs.unlink(temp).catch(() => {});
      throw error;
    }

    // Best effort only: directory fsync and power-loss durability depend on the filesystem.
    try {
      const dirHandle = await fs.open(dir, "r");
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch { /* Publication already happened. */ }
  };
}

export const writeFileAtomic = createAtomicWriter();

function isRetryableRename(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}
