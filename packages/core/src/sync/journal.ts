import { LibraryPortError } from "../library/errors";
import { syncJournalPath } from "../library/paths";
import type { LibraryPort } from "../library/port";
import {
  SYNC_SCHEMA_VERSION,
  type SyncFile,
  type SyncFileRecord,
  type SyncJournal
} from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Read this device's baseline. A missing, foreign or corrupt file is treated as no baseline. */
export async function readSyncJournal(storage: LibraryPort, deviceId: string): Promise<SyncJournal | null> {
  const snapshot = await storage.readFile(syncJournalPath(deviceId));
  if (!snapshot) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(snapshot.bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const journal = parsed as Partial<SyncJournal>;
  if (journal.schemaVersion !== SYNC_SCHEMA_VERSION) return null;
  if (journal.deviceId !== deviceId) return null;
  if (typeof journal.generation !== "number" || !Number.isInteger(journal.generation) || journal.generation < 0) return null;
  if (typeof journal.scannedAt !== "string") return null;
  if (!journal.files || typeof journal.files !== "object" || Array.isArray(journal.files)) return null;

  const files: Record<string, SyncFileRecord> = {};
  for (const [path, value] of Object.entries(journal.files)) {
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<SyncFileRecord>;
    if (typeof record.sha256 !== "string" || record.sha256.length === 0) return null;
    if (typeof record.observedAt !== "string") return null;
    files[path] = {
      sha256: record.sha256,
      ...(typeof record.writtenSha256 === "string" ? { writtenSha256: record.writtenSha256 } : {}),
      ...(typeof record.version === "number" ? { version: record.version } : {}),
      ...(typeof record.size === "number" ? { size: record.size } : {}),
      observedAt: record.observedAt,
      ...(record.deleted === true ? { deleted: true } : {})
    };
  }

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId,
    generation: journal.generation,
    scannedAt: journal.scannedAt,
    files
  };
}

/** Write the baseline atomically. A failed write is never reported as a successful scan. */
export async function writeSyncJournal(storage: LibraryPort, journal: SyncJournal): Promise<void> {
  const bytes = encoder.encode(`${JSON.stringify(journal, null, 2)}\n`);
  const result = await storage.commitFile(syncJournalPath(journal.deviceId), bytes, { kind: "any" });
  if (result.status !== "written") {
    throw new LibraryPortError("io", "The sync baseline could not be written.", true);
  }
}

export interface JournalScanInput {
  deviceId: string;
  previous: SyncJournal | null;
  files: SyncFile[];
  now: string;
  /** Paths this device wrote since the previous scan. */
  written?: Iterable<string>;
}

/**
 * Build the next baseline from a completed scan. Call after the author has reviewed the report, not
 * during detection. Missing files become tombstones; a reappearing path clears its tombstone.
 */
export function journalForScan({ deviceId, previous, files, now, written }: JournalScanInput): SyncJournal {
  const writtenPaths = new Set(written ?? []);
  const next: Record<string, SyncFileRecord> = {};
  const seen = new Set<string>();

  for (const file of files) {
    if (file.sha256 === null || file.placeholder || file.unreadable) continue;
    seen.add(file.path);
    const old = previous?.files[file.path];
    const writtenSha256 = writtenPaths.has(file.path) || old?.writtenSha256 === file.sha256 ? file.sha256 : undefined;
    next[file.path] = {
      sha256: file.sha256,
      ...(writtenSha256 ? { writtenSha256 } : {}),
      ...(file.version !== undefined ? { version: file.version } : {}),
      ...(file.size !== null ? { size: file.size } : {}),
      observedAt: now
    };
  }

  for (const [path, record] of Object.entries(previous?.files ?? {})) {
    if (seen.has(path)) continue;
    next[path] = record.deleted ? record : { ...record, deleted: true, observedAt: now };
  }

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId,
    generation: (previous?.generation ?? 0) + 1,
    scannedAt: now,
    files: next
  };
}

/** Drop tombstones older than the retention window; live records are untouched. */
export function pruneJournal(journal: SyncJournal, options: { now: string; maxTombstoneDays?: number }): SyncJournal {
  const cutoff = Date.parse(options.now) - (options.maxTombstoneDays ?? 30) * 86_400_000;
  const files = Object.fromEntries(
    Object.entries(journal.files).filter(([, record]) => {
      if (!record.deleted) return true;
      const observed = Date.parse(record.observedAt);
      return !Number.isFinite(observed) || observed >= cutoff;
    })
  );
  return { ...journal, files };
}
