import type { Stats } from "node:fs";
import { open } from "node:fs/promises";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import { readTooLarge } from "@ai-book-studio/core/library/read-limits";

/** Pin the opened file and check both its initial size and any subsequent growth. */
export async function readBoundedSnapshot(absolute: string, limit: number): Promise<{ bytes: Uint8Array; info: Stats }> {
  const file = await open(absolute, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() && !info.isDirectory()) {
      throw new LibraryPortError("unsupported", "Symbolic links and special files are not supported inside a library.");
    }
    if (info.size > limit) throw readTooLarge();
    const bytes = await readBoundedBytes(async (buffer) => (await file.read(buffer, 0, buffer.length, null)).bytesRead, limit);
    return { bytes, info };
  } finally {
    await file.close();
  }
}

/** Read at most the limit plus a sentinel byte; never return a truncated snapshot. */
export async function readBoundedBytes(
  read: (buffer: Buffer) => Promise<number>,
  limit: number
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(65_536, limit - total + 1));
    const bytesRead = await read(chunk);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > limit) throw readTooLarge();
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}
