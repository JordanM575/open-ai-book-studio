import { Unzip, UnzipInflate } from "fflate";
import { libraryPathFromArchivePath, type LibraryPath } from "../library/path";
import type { LibraryPort, LibraryRuntime } from "../library/port";
import { ArchiveError } from "./errors";
import {
  ARCHIVE_LIMITS,
  parseArchiveManifest,
  type ArchiveEntry,
  type ArchiveManifest
} from "./manifest";

/** A re-openable archive source: import validates once, then streams the bytes again to write. */
export interface ArchiveSource {
  open(): AsyncIterable<Uint8Array>;
}

export interface ArchiveImportOptions {
  limits?: typeof ARCHIVE_LIMITS;
}

const textDecoder = new TextDecoder();

export function archiveSourceFromBytes(bytes: Uint8Array, chunkSize = 64 * 1024): ArchiveSource {
  return {
    async *open() {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      }
    }
  };
}

/**
 * Validate an archive completely, then write it into a new or empty destination.
 *
 * The first pass reads only the manifest and entry metadata, so no destination byte is touched
 * until paths, versions, counts and sizes are acceptable. The second pass verifies each file's
 * hash before committing it. On failure, files written by this import are removed again; the
 * destination must not contain an existing library.
 */
export async function importLibraryArchive(
  source: ArchiveSource,
  target: LibraryPort,
  runtime: LibraryRuntime,
  options: ArchiveImportOptions = {}
): Promise<ArchiveManifest> {
  const limits = options.limits ?? ARCHIVE_LIMITS;
  const manifest = await readAndValidateManifest(source, limits);
  const written: LibraryPath[] = [];

  try {
    await extractVerified(source, target, runtime, manifest, limits, written);
    return manifest;
  } catch (error) {
    for (const path of written.reverse()) {
      await target.removeFile(path).catch(() => {});
    }
    throw error;
  }
}

async function readAndValidateManifest(
  source: ArchiveSource,
  limits: typeof ARCHIVE_LIMITS
): Promise<ArchiveManifest> {
  let manifestBytes: Uint8Array[] = [];
  let manifestSize = 0;
  let manifestSeen = false;
  let failure: unknown = null;
  const seen = new Map<string, number | undefined>();

  const unzip = new Unzip((file) => {
    if (file.name === "manifest.json") {
      if (manifestSeen) {
        failure = new ArchiveError("duplicate-path", "The archive contains more than one manifest.");
        return;
      }
      manifestSeen = true;
      file.ondata = (error, chunk) => {
        if (error) {
          failure = new ArchiveError("io", `The archive manifest could not be read: ${error.message}`);
          return;
        }
        manifestSize += chunk.length;
        if (manifestSize > limits.maxManifestBytes) {
          failure = new ArchiveError("too-large", "The archive manifest is unreasonably large.");
          file.terminate();
          return;
        }
        if (chunk.length > 0) manifestBytes.push(chunk);
      };
      try {
        file.start();
      } catch (error) {
        failure = new ArchiveError("io", `The archive manifest could not be opened: ${(error as Error).message}`);
      }
      return;
    }

    if (file.name.endsWith("/")) {
      failure = new ArchiveError("unexpected-entry", `The archive contains a directory entry: ${file.name}.`);
      return;
    }
    if (seen.has(file.name)) {
      failure = new ArchiveError("duplicate-path", `The archive contains the same path twice: ${file.name}.`);
      return;
    }
    seen.set(file.name, file.originalSize);
  });
  unzip.register(UnzipInflate);

  for await (const chunk of source.open()) {
    unzip.push(chunk);
    if (failure) throw failure;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  if (!manifestSeen) throw new ArchiveError("missing-entry", "The archive has no manifest.json.");

  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(concat(manifestBytes, manifestSize)));
  } catch (error) {
    throw new ArchiveError("invalid-manifest", `The archive manifest is not valid JSON: ${(error as Error).message}`);
  }

  const manifest = parseArchiveManifest(value, limits);
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const [name, size] of seen) {
    const entry = expected.get(name);
    if (!entry) throw new ArchiveError("unexpected-entry", `The archive contains a file that is not in its manifest: ${name}.`);
    if (size !== undefined && size !== entry.size) {
      throw new ArchiveError("invalid-manifest", `The size of ${name} does not match the manifest.`);
    }
    expected.delete(name);
  }
  if (expected.size > 0) {
    const missing = expected.keys().next().value ?? "a file";
    throw new ArchiveError("missing-entry", `The archive is missing ${missing}.`);
  }
  return manifest;
}

async function extractVerified(
  source: ArchiveSource,
  target: LibraryPort,
  runtime: LibraryRuntime,
  manifest: ArchiveManifest,
  limits: typeof ARCHIVE_LIMITS,
  written: LibraryPath[]
): Promise<void> {
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const completed: Array<{ entry: ArchiveEntry; bytes: Uint8Array }> = [];
  let failure: unknown = null;
  let actualTotal = 0;

  const flush = async (): Promise<void> => {
    while (completed.length > 0) {
      const item = completed.shift()!;
      const hash = await runtime.sha256(item.bytes);
      if (hash !== item.entry.sha256) {
        throw new ArchiveError("hash-mismatch", `${item.entry.path} does not match the manifest. The archive is damaged.`);
      }
      const path = libraryPathFromArchivePath(item.entry.path);
      const result = await target.commitFile(path, item.bytes, { kind: "absent" });
      if (result.status !== "written") {
        throw new ArchiveError("destination-not-empty", `The destination already contains ${item.entry.path}.`);
      }
      written.push(path);
    }
  };

  const unzip = new Unzip((file) => {
    if (file.name === "manifest.json") return;
    const entry = expected.get(file.name);
    if (!entry) {
      failure = new ArchiveError("unexpected-entry", `The archive contains a file that is not in its manifest: ${file.name}.`);
      return;
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = new ArchiveError("io", `${file.name} could not be extracted: ${error.message}`);
        return;
      }
      if (chunk.length > 0) {
        size += chunk.length;
        actualTotal += chunk.length;
        if (size > entry.size || actualTotal > limits.maxTotalBytes) {
          failure = new ArchiveError("too-large", `${file.name} expands beyond the size declared in the manifest.`);
          file.terminate();
          return;
        }
        chunks.push(chunk);
      }
      if (final) completed.push({ entry, bytes: concat(chunks, size) });
    };
    try {
      file.start();
    } catch (error) {
      failure = new ArchiveError("io", `${file.name} uses an unsupported compression method: ${(error as Error).message}`);
    }
  });
  unzip.register(UnzipInflate);

  for await (const chunk of source.open()) {
    unzip.push(chunk);
    if (failure) throw failure;
    await flush();
    if (failure) throw failure;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  await flush();

  if (written.length !== manifest.entries.length) {
    throw new ArchiveError("missing-entry", "The archive ended before every file was extracted.");
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
