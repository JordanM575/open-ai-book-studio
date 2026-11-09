import { LibraryPortError } from "../library/errors";
import { isConflictCopyName } from "../markdown";
import { libraryPathFromArchivePath } from "../library/path";
import { syncJournalPath } from "../library/paths";
import { workflowReadLimit } from "../library/read-limits";
import type { LibraryFileSnapshot, LibraryPort } from "../library/port";
import { scanLibrary } from "./scan";
import {
  SYNC_SCHEMA_VERSION,
  type SyncFile,
  type SyncFileRecord,
  type SyncJournal
} from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const updating = new WeakMap<LibraryPort, Promise<unknown>>();

/**
 * Run one read-and-write of the baseline at a time per library. Chapters, conversations, images
 * and a turn's checkpoints all note themselves in the same file, and a turn's tool calls can finish
 * together: two updates at once would each write back a baseline missing the other's paths, and
 * the next scan would list the studio's own file as someone else's. `work` must not wait for
 * another update of the same library, or the two would wait for each other forever.
 */
export function updateSyncJournal<T>(storage: LibraryPort, work: () => Promise<T>): Promise<T> {
  const previous = updating.get(storage) ?? Promise.resolve();
  const next = previous.then(work, work);
  updating.set(
    storage,
    next.catch(() => {})
  );
  return next;
}

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
      ...(typeof record.plannedWriteId === "string" ? { plannedWriteId: record.plannedWriteId } : {}),
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

export interface AcceptDriftInput {
  deviceId: string;
  previous: SyncJournal | null;
  files: SyncFile[];
  /** The report paths the author reviewed and accepted as the disk version. */
  accept: Iterable<string>;
  now: string;
}

/**
 * Fold reviewed paths into the baseline without touching anything else. An accepted path that is
 * materialized records the disk bytes (clearing a tombstone); an accepted path that is missing or
 * unreadable becomes a tombstone. Paths outside `accept` keep their records byte for byte, so
 * accepting one change never reviews another. With no previous journal this builds the first
 * baseline, exactly like a full scan.
 */
export function acceptDriftPaths({ deviceId, previous, files, accept, now }: AcceptDriftInput): SyncJournal {
  if (!previous) return journalForScan({ deviceId, previous, files, now });
  const accepted = new Set(accept);
  if (accepted.size === 0) return previous;
  const current = new Map<string, SyncFile>();
  for (const file of files) current.set(file.path, file);
  const next: Record<string, SyncFileRecord> = {};
  for (const [path, record] of Object.entries(previous.files)) {
    if (!accepted.has(path)) {
      next[path] = record;
      continue;
    }
    const file = current.get(path);
    if (!file) {
      // Gone between the scan and the accept: record the deletion.
      next[path] = { ...record, deleted: true, observedAt: now };
      continue;
    }
    if (file.sha256 === null || file.placeholder === true || file.unreadable !== undefined) {
      // Not materialized: keep the old record so the next scan reports the path again.
      next[path] = record;
      continue;
    }
    next[path] = {
      sha256: file.sha256,
      ...(record.writtenSha256 === file.sha256 ? { writtenSha256: record.writtenSha256 } : {}),
      ...(file.version !== undefined ? { version: file.version } : {}),
      ...(file.size !== null ? { size: file.size } : {}),
      observedAt: now
    };
  }
  for (const path of accepted) {
    if (next[path] !== undefined) continue;
    const file = current.get(path);
    if (!file || file.sha256 === null || file.placeholder === true || file.unreadable !== undefined) continue;
    next[path] = {
      sha256: file.sha256,
      ...(file.version !== undefined ? { version: file.version } : {}),
      ...(file.size !== null ? { size: file.size } : {}),
      observedAt: now
    };
  }
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId,
    generation: previous.generation + 1,
    scannedAt: now,
    files: next
  };
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
export interface NoteFilesInput {
  storage: LibraryPort;
  deviceId: string;
  /** Archive-form paths (`books/<id>/chapters/<file>`), as the journal keys them. */
  paths: Iterable<string>;
  now: string;
}

/**
 * Only scanned roots are journaled; anything else (the catalog, staging areas) is noise. Conflict
 * copies are scanned but never noted as own writes: the failed save that made them still needs a
 * review, and the workspace banner is not the drift dialog.
 */
function isJournaledPath(path: string): boolean {
  if (!path.startsWith("books/") && !path.startsWith(".studio/trash/")) return false;
  return !isConflictCopyName(path.split("/").pop() ?? "");
}

/**
 * Record a caller's current observation. Checked commits instead settle their initiating receipt
 * with the verified result, so an old snapshot cannot replace a newer same-path journal decision.
 */
export async function noteWrittenFiles({ storage, deviceId, paths, now }: NoteFilesInput): Promise<void> {
  const wanted = [...new Set(paths)].filter(isJournaledPath);
  if (wanted.length === 0) return;
  await updateSyncJournal(storage, () => noteWritten(storage, deviceId, wanted, now));
}

/**
 * Persist the hash a write is about to commit before touching the author file. If the process
 * stops after the atomic manuscript commit but before the receipt can update the observed
 * hash, the next scan can still recognize those exact bytes. A definitive prepublication refusal
 * must settle this receipt as not-published; an exception or uncertain publication must retain it.
 */
export async function notePlannedWrite({ storage, deviceId, paths, sha256, now }: NoteFilesInput & { sha256: string }): Promise<PlannedWriteReceipt> {
  const wanted = [...new Set(paths)].filter(isJournaledPath);
  const entries: PlannedEntry[] = [];
  await updateSyncJournal(storage, async () => {
    try {
      if (wanted.length === 0) return;
      const previous = await readSyncJournal(storage, deviceId);
      if (!previous) return;
      const active = plannedWrites.get(storage) ?? new Map<string, PlannedEntry>();
      plannedWrites.set(storage, active);
      const id = globalThis.crypto.randomUUID();
      const files = { ...previous.files };
      for (const path of wanted) {
        const old = files[path];
        const key = `${deviceId}\0${path}`;
        let prior = active.get(key);
        while (prior && !sameRecord(old, prior.after)) prior = prior.prior;
        // Even an equal-hash intent has a distinct owner. Hash equality cannot cancel another call.
        // An unjournaled path has an in-memory owner, not an invented observed baseline.
        const after = old ? { ...old, writtenSha256: sha256, plannedWriteId: id } : undefined;
        const entry: PlannedEntry = { key, path, before: old, after, prior,
          beforeGeneration: previous.generation, outcome: "pending" };
        entries.push(entry);
        active.set(key, entry);
        if (after) files[path] = after;
      }
      if (entries.some((entry) => entry.after)) await writeSyncJournal(storage, { ...previous, generation: previous.generation + 1, scannedAt: now, files });
    } catch {
      // A note can have published before throwing. Keep its receipt for conditional reconciliation.
      // Journal I/O must never fail an author-file save.
    }
  });
  let settled = false;
  return { settle: (outcome) => updateSyncJournal(storage, async () => {
    if (settled) return;
    settled = true;
    for (const entry of entries) {
      entry.outcome = typeof outcome === "string" ? outcome : "possible";
      if (typeof outcome !== "string") entry.verified = {
        ...(entry.before?.version !== undefined ? { version: entry.before.version } : {}),
        sha256, writtenSha256: sha256, size: outcome.size, observedAt: outcome.now
      };
    }
    try {
      if (typeof outcome !== "string") {
        await noteWritten(storage, deviceId, wanted, outcome.now, { sha256, size: outcome.size, entries });
        return;
      }
      if (outcome !== "not-published" || entries.length === 0) return;
      const previous = await readSyncJournal(storage, deviceId);
      if (!previous) return;
      const files = { ...previous.files };
      let changed = false;
      for (const entry of entries) {
        // Restore only this exact attempt's unchanged record. Other paths, newer same-hash notes,
        // accepted scans, removals and verified writes are not ours to undo.
        if (entry.retired || !sameRecord(files[entry.path], entry.after) ||
            (!entry.after && plannedWrites.get(storage)?.get(entry.key) !== entry)) continue;
        let before = entry.before;
        let prior = entry.prior;
        // Overlapping refusals may finish in either order. Do not resurrect an already-refused plan.
        while (prior?.outcome === "not-published") {
          before = prior.before;
          prior = prior.prior;
        }
        // A predecessor may have verified its bytes while this newer attempt still owned the
        // journal. On this definitive refusal its actual snapshot is safe to restore as well.
        if (prior?.verified) before = prior.verified;
        if (!sameRecord(files[entry.path], before)) {
          if (before) files[entry.path] = before;
          else delete files[entry.path];
          changed = true;
        }
      }
      if (changed) await writeSyncJournal(storage, { ...previous, generation: previous.generation + 1, scannedAt: now, files });
    } catch {
      // Best effort: failed reconciliation can leave an interrupted-write intent. Never retry the
      // author-file publication or substitute an outside observation for the baseline.
    } finally {
      const active = plannedWrites.get(storage);
      for (const entry of entries) {
        if (active?.get(entry.key) !== entry) continue;
        let prior = entry.prior;
        while (prior?.outcome === "not-published") prior = prior.prior;
        if (outcome === "not-published" && prior?.outcome === "pending") active.set(entry.key, prior);
        else active.delete(entry.key);
      }
      if (active?.size === 0) plannedWrites.delete(storage);
    }
  }) };
}

export interface PlannedWriteReceipt {
  /** Settle once. A verified result must match the initiating bytes, not a later file observation. */
  settle(outcome: PlannedWriteOutcome): Promise<void>;
}

export type PlannedWriteOutcome = "not-published" | "possible" | { kind: "verified"; size: number; now: string };

interface PlannedEntry {
  key: string;
  path: string;
  before: SyncFileRecord | undefined;
  after: SyncFileRecord | undefined;
  beforeGeneration: number;
  verified?: SyncFileRecord;
  retired?: true;
  prior: PlannedEntry | undefined;
  outcome: "pending" | "not-published" | "possible";
}

// Only live receipts retain this chain; persisted hashes still support recovery after process loss.
// Completed predecessors remain reachable only while a newer pending receipt needs their outcome.
const plannedWrites = new WeakMap<LibraryPort, Map<string, PlannedEntry>>();

function sameRecord(a: SyncFileRecord | undefined, b: SyncFileRecord | undefined): boolean {
  if (!a || !b) return a === b;
  return a.plannedWriteId === b.plannedWriteId && a.sha256 === b.sha256 &&
    a.writtenSha256 === b.writtenSha256 && a.observedAt === b.observedAt && a.version === b.version &&
    a.size === b.size && a.deleted === b.deleted;
}

/** Inside the journal queue: a newer reviewed decision also supersedes a not-yet-journaled path. */
export function supersedePlannedWriteNotes(storage: LibraryPort, deviceId: string, paths?: Iterable<string>): void {
  const wanted = paths === undefined ? undefined : new Set(paths);
  retireWriteNotes(storage, deviceId, (path) => wanted === undefined || wanted.has(path));
}

function retireWriteNotes(storage: LibraryPort, deviceId: string, matches: (path: string) => boolean): void {
  const active = plannedWrites.get(storage);
  for (const [key, entry] of active ?? []) {
    if (!key.startsWith(`${deviceId}\0`) || !matches(entry.path)) continue;
    // An existing tombstone may remain byte-identical. Retire the whole receipt chain so a
    // later refusal cannot restore a verified predecessor through that unchanged record.
    for (let prior: PlannedEntry | undefined = entry; prior; prior = prior.prior) prior.retired = true;
    active?.delete(key);
  }
  if (active?.size === 0) plannedWrites.delete(storage);
}

async function noteWritten(
  storage: LibraryPort,
  deviceId: string,
  wanted: string[],
  now: string,
  verifiedWrite?: { sha256: string; size: number; entries: PlannedEntry[] }
): Promise<void> {
  try {
    const previous = await readSyncJournal(storage, deviceId);
    if (!previous) return;
    const files = { ...previous.files };
    let changed = false;
    for (const path of wanted) {
      if (verifiedWrite) {
        const entry = verifiedWrite.entries.find((item) => item.path === path);
        if (!entry || plannedWrites.get(storage)?.get(entry.key) !== entry) continue;
        // The persistent attempt marker owns an existing baseline. If its note failed before
        // publication, require the exact initiating generation and record instead. Missing paths
        // rely on the port/device/path owner; accepts, removals and moves explicitly retire it.
        if (!sameRecord(files[path], entry.after) &&
            !(previous.generation === entry.beforeGeneration && sameRecord(files[path], entry.before))) continue;
      }
      let snapshot: LibraryFileSnapshot | null | undefined;
      try {
        const libraryPath = libraryPathFromArchivePath(path);
        const limit = workflowReadLimit(libraryPath);
        snapshot = await storage.readFile(libraryPath, limit === undefined ? undefined : { maxBytes: limit });
      } catch {
        // A verified readback remains the baseline, even if this later observation failed.
      }
      if (!verifiedWrite && !snapshot) continue;
      const old = files[path];
      const sha256 = verifiedWrite?.sha256 ?? snapshot?.sha256;
      if (!sha256) continue;
      files[path] = {
        ...(old?.version !== undefined ? { version: old.version } : {}),
        ...(verifiedWrite ? { size: verifiedWrite.size } : old?.size !== undefined ? { size: old.size } : {}),
        sha256,
        writtenSha256: sha256,
        observedAt: now
      };
      changed = true;
    }
    if (!changed) return;
    await writeSyncJournal(storage, { ...previous, generation: previous.generation + 1, scannedAt: now, files });
  } catch {
    // Detection degrades to a reviewable report; a baseline note must never fail a save.
  }
}

/**
 * Tombstone paths this device just removed or moved to the trash. A tombstoned path that
 * reappears is reported again rather than silently resurrected.
 */
export async function noteRemovedFiles({ storage, deviceId, paths, now }: NoteFilesInput): Promise<void> {
  const wanted = [...new Set(paths)].filter(isJournaledPath);
  if (wanted.length === 0) return;
  await updateSyncJournal(storage, () => noteRemoved(storage, deviceId, wanted, now));
}

async function noteRemoved(storage: LibraryPort, deviceId: string, wanted: string[], now: string): Promise<void> {
  try {
    supersedePlannedWriteNotes(storage, deviceId, wanted);
    const previous = await readSyncJournal(storage, deviceId);
    if (!previous) return;
    const files = { ...previous.files };
    let changed = false;
    for (const path of wanted) {
      const old = files[path];
      if (!old || old.deleted === true) continue;
      files[path] = { ...old, deleted: true, observedAt: now };
      changed = true;
    }
    if (!changed) return;
    await writeSyncJournal(storage, { ...previous, generation: previous.generation + 1, scannedAt: now, files });
  } catch {
    // Detection degrades to a reviewable report; a baseline note must never fail a delete.
  }
}

export interface NoteMoveInput {
  storage: LibraryPort;
  deviceId: string;
  /** Archive-form source: one file path or a directory prefix (`books/<id>`). */
  from: string;
  /** Archive-form destination file or directory. */
  to: string;
  now: string;
}

/**
 * Follow a trash move in the baseline: tombstone everything journaled under `from`, record what
 * the rescan finds under `to`. Runs after the move succeeds. Trash moves are rare, so a full
 * rescan here is cheaper than getting the file list wrong.
 */
export function noteMovedPrefix(input: NoteMoveInput): Promise<void> {
  return updateSyncJournal(input.storage, () => noteMoved(input));
}

async function noteMoved({ storage, deviceId, from, to, now }: NoteMoveInput): Promise<void> {
  try {
    retireWriteNotes(storage, deviceId, (path) => path === from || path.startsWith(`${from}/`) ||
      path === to || path.startsWith(`${to}/`));
    const previous = await readSyncJournal(storage, deviceId);
    if (!previous) return;
    const { files } = await scanLibrary(storage);
    const current = new Map(files.map((file) => [file.path, file]));
    const next = { ...previous.files };
    let changed = false;
    for (const [path, record] of Object.entries(next)) {
      if (path !== from && !path.startsWith(`${from}/`)) continue;
      if (record.deleted === true) continue;
      next[path] = { ...record, deleted: true, observedAt: now };
      changed = true;
    }
    for (const [path, file] of current) {
      if (path !== to && !path.startsWith(`${to}/`)) continue;
      if (file.sha256 === null || file.placeholder === true || file.unreadable !== undefined) continue;
      next[path] = {
        sha256: file.sha256,
        ...(file.version !== undefined ? { version: file.version } : {}),
        ...(file.size !== null ? { size: file.size } : {}),
        observedAt: now
      };
      changed = true;
    }
    if (!changed) return;
    await writeSyncJournal(storage, { ...previous, generation: previous.generation + 1, scannedAt: now, files: next });
  } catch {
    // Detection degrades to a reviewable report; a baseline note must never fail a delete.
  }
}

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
