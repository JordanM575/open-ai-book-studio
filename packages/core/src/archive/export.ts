import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { LibraryEnvironment } from "../library/port";
import { toLibraryPath, type LibraryPath } from "../library/path";
import { ArchiveError } from "./errors";
import {
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_LIMITS,
  isExcludedFromArchive,
  parseArchiveManifest,
  type ArchiveEntry,
  type ArchiveManifest
} from "./manifest";

export interface ArchiveExportOptions {
  appVersion: string;
  createdAt?: string;
  limits?: typeof ARCHIVE_LIMITS;
}

export interface LibraryArchive {
  manifest: ArchiveManifest;
  /** ZIP bytes, produced incrementally. Iterate once and write each chunk to the destination. */
  chunks: AsyncIterable<Uint8Array>;
}

const textEncoder = new TextEncoder();
const COMPRESSIBLE = /\.(md|json|txt|csv|html|xml|svg)$/i;
const MAX_DEPTH = 32;

/**
 * Read the whole library and prepare a portable archive.
 *
 * The manifest is complete before any ZIP byte is produced, so the caller can report the size
 * and file count first. Files are read one at a time while the archive streams, which keeps
 * memory bounded by the largest single file rather than the library.
 */
export async function createLibraryArchive(
  env: LibraryEnvironment,
  options: ArchiveExportOptions
): Promise<LibraryArchive> {
  const limits = options.limits ?? ARCHIVE_LIMITS;
  const entries = await collectEntries(env, limits);
  const manifest = parseArchiveManifest(
    {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      appVersion: options.appVersion,
      createdAt: options.createdAt ?? env.runtime.now(),
      entryCount: entries.length,
      expandedBytes: entries.reduce((total, entry) => total + entry.size, 0),
      entries
    },
    limits
  );

  return { manifest, chunks: streamArchive(env, manifest) };
}

async function collectEntries(env: LibraryEnvironment, limits: typeof ARCHIVE_LIMITS): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  let total = 0;

  const walk = async (directory: LibraryPath, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      throw new ArchiveError("too-large", "The library folder is nested too deeply to archive.");
    }
    for (const item of await env.storage.listDirectory(directory)) {
      const path = [...directory, item.name];
      const archivePath = path.join("/");
      if (item.kind === "directory") {
        await walk(toLibraryPath(path), depth + 1);
        continue;
      }
      if (isExcludedFromArchive(archivePath)) continue;

      const snapshot = await env.storage.readFile(toLibraryPath(path));
      if (!snapshot) continue;
      if (snapshot.bytes.byteLength > limits.maxFileBytes) {
        throw new ArchiveError("too-large", `One file is larger than ${formatBytes(limits.maxFileBytes)}: ${archivePath}.`);
      }
      total += snapshot.bytes.byteLength;
      if (total > limits.maxTotalBytes) {
        throw new ArchiveError("too-large", `The library is larger than ${formatBytes(limits.maxTotalBytes)}.`);
      }
      entries.push({ path: archivePath, size: snapshot.bytes.byteLength, sha256: snapshot.sha256 });
      if (entries.length > limits.maxEntries) {
        throw new ArchiveError("too-many-entries", `The library has more than ${limits.maxEntries.toLocaleString()} files.`);
      }
    }
  };

  await walk(toLibraryPath([]), 0);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function* streamArchive(env: LibraryEnvironment, manifest: ArchiveManifest): AsyncGenerator<Uint8Array> {
  const queue = new ByteQueue();
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      queue.fail(new ArchiveError("io", `The archive could not be written: ${error.message}`));
      return;
    }
    if (chunk.length > 0) queue.push(chunk);
    if (final) queue.finish();
  });

  void (async () => {
    const manifestStream = new ZipPassThrough("manifest.json");
    zip.add(manifestStream);
    manifestStream.push(textEncoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), true);
    await queue.drain();

    for (const entry of manifest.entries) {
      const snapshot = await env.storage.readFile(toLibraryPath(entry.path.split("/")));
      if (!snapshot) {
        throw new ArchiveError("changed-during-export", `${entry.path} disappeared while the archive was being written.`);
      }
      if (snapshot.sha256 !== entry.sha256 || snapshot.bytes.byteLength !== entry.size) {
        throw new ArchiveError("changed-during-export", `${entry.path} changed while the archive was being written. Try again.`);
      }

      const file = COMPRESSIBLE.test(entry.path)
        ? new ZipDeflate(entry.path, { level: 6 })
        : new ZipPassThrough(entry.path);
      zip.add(file);
      file.push(snapshot.bytes, true);
      await queue.drain();
    }

    zip.end();
    await queue.drain();
    queue.finish();
  })().catch((error: unknown) => {
    queue.fail(error instanceof ArchiveError ? error : new ArchiveError("io", (error as Error)?.message ?? "The archive failed."));
  });

  try {
    yield* queue;
  } finally {
    queue.cancel();
  }
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 ** 2))} MiB`;
}

/**
 * Small push/pull queue with backpressure. fflate emits synchronously, so the producer waits
 * for the consumer to drain each file before reading the next one.
 */
class ByteQueue {
  private chunks: Uint8Array[] = [];
  private waiters: Array<() => void> = [];
  private drainWaiters: Array<() => void> = [];
  private done = false;
  private cancelled = false;
  private failure: unknown = null;

  push(chunk: Uint8Array): void {
    if (this.cancelled) return;
    this.chunks.push(chunk);
    this.wake();
  }

  finish(): void {
    this.done = true;
    this.wake();
  }

  fail(error: unknown): void {
    this.failure = error;
    this.done = true;
    this.wake();
  }

  cancel(): void {
    this.cancelled = true;
    this.chunks = [];
    this.wake();
    this.wakeDrain();
  }

  async drain(): Promise<void> {
    while (!this.cancelled && this.chunks.length > 0) {
      await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
    }
    if (this.cancelled) throw new ArchiveError("io", "The archive download was cancelled.");
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    while (true) {
      if (this.failure) throw this.failure;
      const chunk = this.chunks.shift();
      if (chunk) {
        if (this.chunks.length === 0) this.wakeDrain();
        yield chunk;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private wake(): void {
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private wakeDrain(): void {
    const waiters = this.drainWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
