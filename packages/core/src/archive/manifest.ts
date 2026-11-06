import { z } from "zod";
import { libraryPathFromArchivePath } from "../library/path";
import { ArchiveError } from "./errors";

export const ARCHIVE_FORMAT_VERSION = 1;

export const ARCHIVE_LIMITS = {
  maxEntries: 10_000,
  maxTotalBytes: 2 * 1024 ** 3,
  maxFileBytes: 512 * 1024 ** 2,
  /** The manifest itself is small; this keeps a forged header from exhausting memory. */
  maxManifestBytes: 16 * 1024 ** 2
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hash");

export const archiveEntrySchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: sha256Schema
});

export const archiveManifestSchema = z.object({
  formatVersion: z.literal(ARCHIVE_FORMAT_VERSION),
  appVersion: z.string().min(1),
  createdAt: z.string().min(1),
  entryCount: z.number().int().nonnegative(),
  expandedBytes: z.number().int().nonnegative(),
  entries: z.array(archiveEntrySchema)
});

export type ArchiveEntry = z.infer<typeof archiveEntrySchema>;
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

const EXCLUDED_EXACT = new Set(["library.json", "manifest.json"]);

/** Derived, per-install and transient files never travel in an archive. */
export function isExcludedFromArchive(path: string): boolean {
  if (EXCLUDED_EXACT.has(path)) return true;
  // Everything under .studio is this install's metadata (identity, indexes, credentials)
  // except the author's trash, which is part of the library.
  if (path.startsWith(".studio/") && !path.startsWith(".studio/trash/")) return true;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".tmp") || name.endsWith(".lock") || name === ".DS_Store";
}

/**
 * Validate a manifest and every path before any destination is written.
 *
 * Paths are normalized library-relative names. The archive may contain unknown author files,
 * but never a credential, catalog, device identity, temporary file or duplicate path.
 */
export function parseArchiveManifest(value: unknown, limits = ARCHIVE_LIMITS): ArchiveManifest {
  const version = (value as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === "number" && version > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError(
      "unsupported-version",
      "This archive was written by a newer version of Open Book Studio. Update the app before importing it."
    );
  }

  let parsed: ArchiveManifest;
  try {
    parsed = archiveManifestSchema.parse(value);
  } catch (error) {
    throw new ArchiveError("invalid-manifest", `The archive manifest is not valid: ${describe(error)}`);
  }

  if (parsed.entries.length > limits.maxEntries) {
    throw new ArchiveError("too-many-entries", `The archive has more than ${limits.maxEntries.toLocaleString()} files.`);
  }
  if (parsed.entries.length !== parsed.entryCount) {
    throw new ArchiveError("invalid-manifest", "The archive manifest does not match its file count.");
  }

  const paths = new Set<string>();
  let total = 0;
  for (const entry of parsed.entries) {
    if (entry.size > limits.maxFileBytes) {
      throw new ArchiveError("too-large", `One file in the archive is larger than ${formatBytes(limits.maxFileBytes)}.`);
    }
    total += entry.size;
    if (total > limits.maxTotalBytes) {
      throw new ArchiveError("too-large", `The archive expands to more than ${formatBytes(limits.maxTotalBytes)}.`);
    }
    if (isExcludedFromArchive(entry.path)) {
      throw new ArchiveError("invalid-manifest", `The archive contains a file that must not travel: ${entry.path}.`);
    }
    let path: readonly string[];
    try {
      path = libraryPathFromArchivePath(entry.path);
    } catch {
      throw new ArchiveError("unsafe-path", `The archive contains an unsafe path: ${entry.path}.`);
    }
    const normalized = path.join("/");
    if (normalized !== entry.path) {
      throw new ArchiveError("unsafe-path", `The archive path is not normalized: ${entry.path}.`);
    }
    if (paths.has(normalized)) {
      throw new ArchiveError("duplicate-path", `The archive contains the same path twice: ${entry.path}.`);
    }
    paths.add(normalized);
  }

  if (total !== parsed.expandedBytes) {
    throw new ArchiveError("invalid-manifest", "The archive manifest does not match its expanded size.");
  }

  return parsed;
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "manifest"} ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 ** 2))} MiB`;
}
