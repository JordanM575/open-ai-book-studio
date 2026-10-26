import type { Dirent } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  detectDrift,
  journalForScan,
  readSyncJournal,
  scanLibrary,
  writeSyncJournal,
  type DriftReport,
  type SyncFile,
  type SyncJournal
} from "@ai-book-studio/core/sync";
import { FileSystemLibraryPort } from "../../src/main/library/fs-port";
import { Library } from "../../src/main/library/store";

/**
 * Two libraries and a folder-sync transport, with no network.
 *
 * The transport models what a provider does to *author* files: it copies bytes, can stop midway,
 * tear a file, deliver a batch late, and rename a path. Device identity, the journals and the
 * catalog are per-install metadata, so they stay on each system; a journal copied from the other
 * device is written by a test when that behaviour needs to be exercised.
 */
const SYNC_ROOTS = ["books", ".studio/trash"] as const;
const IGNORED_NAME = /(^|\/)(\.DS_Store)$|\.(tmp|lock|icloud)$/i;

export interface ScanOptions {
  /** Defaults to the current time. Pass a fixed value when comparing two reports. */
  now?: string;
  /** Chapter ids with unsaved editor text. */
  dirtyChapterIds?: Iterable<string>;
}

export interface ScanSnapshot {
  journal: SyncJournal | null;
  files: SyncFile[];
  warnings: string[];
  report: DriftReport;
}

export class System {
  private constructor(
    readonly name: string,
    readonly root: string,
    readonly library: Library,
    readonly port: FileSystemLibraryPort
  ) {}

  static async open(name: string): Promise<System> {
    const root = await mkdtemp(join(tmpdir(), `ai-book-studio-sync-${name}-`));
    const library = await Library.open(root);
    return new System(name, root, library, new FileSystemLibraryPort(root));
  }

  /** Read-only: enumerate files, compare them with this device's journal, write nothing. */
  async scan(options: ScanOptions = {}): Promise<ScanSnapshot> {
    const journal = await readSyncJournal(this.port, this.library.deviceId);
    const { files, warnings } = await scanLibrary(this.port, { isPlaceholder: placeholderProbe(this.root) });
    const report = detectDrift({
      journal,
      files,
      ...(options.dirtyChapterIds === undefined ? {} : { dirtyChapterIds: options.dirtyChapterIds }),
      now: options.now ?? new Date().toISOString()
    });
    return { journal, files, warnings, report };
  }

  /** Accept what the scan saw as the new baseline. Call only after the author reviewed it. */
  async accept(snapshot: ScanSnapshot, written?: Iterable<string>): Promise<SyncJournal> {
    const previous = await readSyncJournal(this.port, this.library.deviceId);
    const journal = journalForScan({
      deviceId: this.library.deviceId,
      previous,
      files: snapshot.files,
      now: snapshot.report.scannedAt,
      ...(written === undefined ? {} : { written })
    });
    await writeSyncJournal(this.port, journal);
    return journal;
  }

  /**
   * Stands in for the save path writing its hash into the journal. Until the service does this
   * itself, a local save would otherwise be reported as a change from outside.
   */
  async recordWrite(paths: Iterable<string>): Promise<SyncJournal> {
    return this.accept(await this.scan(), paths);
  }

  /** Stands in for the delete path recording a tombstone, so its own deletion is not drift. */
  async recordDeletion(path: string): Promise<SyncJournal> {
    const journal = await this.accept(await this.scan());
    if (!journal.files[path]?.deleted) throw new Error(`The deletion of ${path} was not recorded.`);
    return journal;
  }

  async readText(path: string): Promise<string> {
    return readFile(hostPath(this.root, path), "utf8");
  }

  async writeText(path: string, text: string): Promise<void> {
    const absolute = hostPath(this.root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, text);
  }
}

export interface SyncOptions {
  /** Copy only these library-relative paths. */
  only?: string[];
  /** Wait between files, to widen the window a real provider would have. */
  delayMs?: number;
  /** Copy at most this many files and stop; models an interrupted batch. */
  stopAfter?: number;
  /** Write only a fraction of one file's bytes; models a torn provider write. */
  truncate?: { path: string; fraction: number };
  /** Delete destination files that no longer exist on the source. Defaults to true for a full sync. */
  deleteExtras?: boolean;
  /** Rename this file on the source before copying; models a rename racing the provider. */
  rename?: { from: string; to: string };
}

export interface SyncResult {
  copied: string[];
  deleted: string[];
  skipped: string[];
}

export class Transport {
  /** Queue syncs until `deliver()`, the way changes wait while a device is offline. */
  offline(): OfflineBatch {
    return new OfflineBatch(this);
  }

  async sync(from: System, to: System, options: SyncOptions = {}): Promise<SyncResult> {
    if (options.rename) {
      const destination = hostPath(from.root, options.rename.to);
      await mkdir(dirname(destination), { recursive: true });
      await rename(hostPath(from.root, options.rename.from), destination);
    }

    const available = await listAuthorFiles(from.root);
    let targets = available;
    if (options.only) {
      const missing = options.only.filter((path) => !available.includes(path));
      if (missing.length > 0) throw new Error(`The source does not have: ${missing.join(", ")}.`);
      targets = available.filter((path) => options.only?.includes(path));
    }
    const interrupted = options.stopAfter !== undefined || options.truncate !== undefined;
    const skipped = available.filter((path) => !targets.includes(path));

    if (options.stopAfter !== undefined) {
      skipped.push(...targets.slice(options.stopAfter));
      targets = targets.slice(0, options.stopAfter);
    }

    const copied: string[] = [];
    for (const path of targets) {
      if (options.delayMs) await sleep(options.delayMs);
      const bytes = await readFile(hostPath(from.root, path));
      const fraction = options.truncate?.path === path ? options.truncate.fraction : 1;
      const payload =
        fraction >= 1 ? bytes : bytes.subarray(0, Math.max(0, Math.floor(bytes.byteLength * fraction)));
      const destination = hostPath(to.root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, payload);
      copied.push(path);
    }

    const deleted: string[] = [];
    const shouldDelete = options.deleteExtras ?? (options.only === undefined && !interrupted);
    if (shouldDelete) {
      for (const path of await listAuthorFiles(to.root)) {
        if (available.includes(path)) continue;
        await unlink(hostPath(to.root, path));
        deleted.push(path);
      }
    }

    return { copied, deleted, skipped };
  }
}

export class OfflineBatch {
  private readonly operations: Array<{ from: System; to: System; options: SyncOptions | undefined }> = [];

  constructor(private readonly transport: Transport) {}

  sync(from: System, to: System, options?: SyncOptions): void {
    this.operations.push({ from, to, options });
  }

  async deliver(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const operation of this.operations) {
      results.push(await this.transport.sync(operation.from, operation.to, operation.options));
    }
    return results;
  }
}

export interface TwoSystems {
  a: System;
  b: System;
  transport: Transport;
  cleanup(): Promise<void>;
}

export async function createTwoSystem(): Promise<TwoSystems> {
  const a = await System.open("a");
  const b = await System.open("b");
  return {
    a,
    b,
    transport: new Transport(),
    cleanup: async () => {
      await rm(a.root, { recursive: true, force: true });
      await rm(b.root, { recursive: true, force: true });
    }
  };
}

/** Mark a file the way iCloud leaves an evicted item: zero bytes plus a sidecar. */
export async function markPlaceholder(system: System, path: string): Promise<void> {
  const absolute = hostPath(system.root, path);
  await writeFile(absolute, new Uint8Array());
  await writeFile(`${absolute}.icloud`, JSON.stringify({ placeholder: true }));
}

/** Remove the sidecar after the bytes have been materialized again. */
export async function dropPlaceholderMarker(system: System, path: string): Promise<void> {
  try {
    await unlink(`${hostPath(system.root, path)}.icloud`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** The probe the desktop adapter will eventually answer with NSURLUbiquitousItemDownloadingStatus. */
export function placeholderProbe(root: string): (path: string) => Promise<boolean> {
  return async (path) => {
    try {
      await access(`${hostPath(root, path)}.icloud`);
      return true;
    } catch {
      return false;
    }
  };
}

/** iCloud names the copy beside the original, not under `conflicts/`. */
export async function injectConflictCopy(system: System, path: string, text: string): Promise<string> {
  const segments = path.split("/");
  const name = segments.pop() ?? "chapter.md";
  const conflict = [...segments, `${name.replace(/\.md$/i, "")} (conflicted copy 2026-10-25).md`].join("/");
  await system.writeText(conflict, text);
  return conflict;
}

/** Change a file's timestamps without touching its bytes. */
export async function skewClock(system: System, path: string, at: string): Promise<void> {
  const date = new Date(at);
  await utimes(hostPath(system.root, path), date, date);
}

async function listAuthorFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const relative of SYNC_ROOTS) {
    files.push(...(await listTree(root, relative)));
  }
  return files.sort();
}

async function listTree(root: string, relative: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(hostPath(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listTree(root, path)));
      continue;
    }
    if (!entry.isFile() || IGNORED_NAME.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}

function hostPath(root: string, relative: string): string {
  return join(root, ...relative.split("/"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
