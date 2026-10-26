import { open, rename, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

/**
 * Writes a file so a reader (or a sync agent) sees either the old content or the new content,
 * never a half-written file:
 *   1. write the bytes to a sibling temp file and fsync it,
 *   2. rename over the target (atomic on POSIX and on NTFS),
 *   3. fsync the directory so the rename itself is durable.
 *
 * A sibling temp file keeps the rename on the same filesystem; a temp directory would not be
 * atomic and would break on network/sync volumes that do not support cross-device moves.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
  const dir = dirname(path);
  const temp = join(dir, `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const handle = await open(temp, "w", options.mode ?? 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    // Windows can refuse a rename over an existing file when another process holds a handle.
    // One short retry covers the common case of an editor or indexer reading the file.
    if (isRetryableRename(error)) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await rename(temp, path);
    } else {
      throw error;
    }
  }

  // Durability of the directory entry. Best effort: not supported on every platform/filesystem.
  try {
    const dirHandle = await open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // ignore: the file content is already durable
  }
}

function isRetryableRename(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}
