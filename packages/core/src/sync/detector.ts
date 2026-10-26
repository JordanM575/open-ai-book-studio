import { SCHEMA_VERSION } from "../schema";
import {
  emptyDriftCounts,
  SYNC_SCHEMA_VERSION,
  type DriftEntry,
  type DriftReport,
  type SyncFile,
  type SyncJournal,
  type SyncFileRecord
} from "./types";

export interface DriftInput {
  journal: SyncJournal | null;
  files: SyncFile[];
  /** Chapter ids with unsaved editor text. */
  dirtyChapterIds?: Iterable<string>;
  now: string;
}

const TRASH_PREFIX = ".studio/trash/";

const NO_BASELINE =
  "No sync baseline was available. This scan can report unreadable and online-only files, but it cannot tell what changed since the last session.";

/**
 * Compare what is on disk with this device's journal. Read-only: the caller decides whether to write a
 * new journal or open a conflict review.
 *
 * `clean` means "no external change needs review". A file this device wrote since the journal is
 * reported as `local-changed` but does not make the report dirty.
 */
export function detectDrift({ journal, files, dirtyChapterIds, now }: DriftInput): DriftReport {
  const counts = emptyDriftCounts();
  const entries: DriftEntry[] = [];
  const add = (entry: DriftEntry): void => {
    entries.push(entry);
    counts[entry.kind] += 1;
  };
  const dirty = new Set(dirtyChapterIds ?? []);
  const conflict = (file: SyncFile): boolean => file.conflict === true || /(^|\/)conflicts\//.test(file.path);

  if (!journal) {
    for (const file of files) {
      if (file.placeholder) {
        add(placeholderEntry(file));
        continue;
      }
      if (file.unreadable) {
        add(unreadableEntry(file));
        continue;
      }
      if (file.schemaVersion !== undefined && file.schemaVersion > SCHEMA_VERSION) {
        add(schemaEntry(file));
        continue;
      }
      if (conflict(file)) add(conflictEntry(file));
    }
    return {
      clean: entries.length === 0,
      scannedAt: now,
      entries,
      counts,
      warning: NO_BASELINE
    };
  }

  if (journal.schemaVersion !== SYNC_SCHEMA_VERSION) {
    return {
      clean: false,
      scannedAt: now,
      entries: [],
      counts,
      warning: "This sync journal was written by a newer version. Nothing was changed."
    };
  }

  const records = journal.files;
  const seen = new Set<string>();
  const newFiles: SyncFile[] = [];

  for (const file of files) {
    seen.add(file.path);

    if (file.placeholder) {
      add(placeholderEntry(file, records[file.path]));
      continue;
    }
    if (file.unreadable) {
      add(unreadableEntry(file, records[file.path]));
      continue;
    }
    if (file.schemaVersion !== undefined && file.schemaVersion > SCHEMA_VERSION) {
      add(schemaEntry(file, records[file.path]));
      continue;
    }
    if (conflict(file)) {
      // A conflict copy already recorded in the journal was reviewed on this device.
      if (!records[file.path]) add(conflictEntry(file));
      continue;
    }

    const previous = records[file.path];
    if (!previous) {
      newFiles.push(file);
      continue;
    }
    if (previous.deleted) {
      add({
        kind: "local-deleted",
        path: file.path,
        bookId: file.bookId,
        chapterId: file.chapterId,
        previous,
        current: currentOf(file),
        message: "This device recorded a deletion, but the file is present again."
      });
      continue;
    }
    if (file.sha256 === previous.sha256) continue;

    if (previous.writtenSha256 && file.sha256 === previous.writtenSha256) {
      add({
        kind: "local-changed",
        path: file.path,
        bookId: file.bookId,
        chapterId: file.chapterId,
        previous,
        current: currentOf(file),
        message: "This device wrote the file after the last journal update."
      });
      continue;
    }

    const both = Boolean(file.chapterId && dirty.has(file.chapterId));
    add({
      kind: both ? "both-changed" : "remote-changed",
      path: file.path,
      bookId: file.bookId,
      chapterId: file.chapterId,
      previous,
      current: currentOf(file),
      message: both
        ? "The file changed outside this device and this chapter has unsaved text."
        : "The file changed outside this device since the last scan."
    });
  }

  // Pair a new path with a missing record that has the same bytes before calling either a rename.
  // Trash is a destination, not a live path: a chapter moved there is a deletion, even though its
  // bytes are unchanged. Pairing it as a rename would hide the deletion from the author.
  const missing = Object.entries(records).filter(
    ([path, record]) => !record.deleted && !seen.has(path) && !path.startsWith(TRASH_PREFIX)
  );
  const renamed = new Set<string>();
  const unmatched: SyncFile[] = [];

  for (const file of newFiles) {
    if (!file.sha256 || file.path.startsWith(TRASH_PREFIX)) {
      unmatched.push(file);
      continue;
    }
    const match = missing.find(([path, record]) => !renamed.has(path) && record.sha256 === file.sha256);
    if (!match) {
      unmatched.push(file);
      continue;
    }
    renamed.add(match[0]);
    add({
      kind: "renamed",
      path: file.path,
      renamedFrom: match[0],
      bookId: file.bookId,
      chapterId: file.chapterId,
      previous: match[1],
      current: currentOf(file),
      message: "The file was renamed outside this device; its bytes are unchanged."
    });
  }

  for (const file of unmatched) {
    add({
      kind: "new-remote",
      path: file.path,
      bookId: file.bookId,
      chapterId: file.chapterId,
      current: currentOf(file),
      message: "A file appeared that this device has not seen."
    });
  }

  for (const [path, record] of missing) {
    if (renamed.has(path)) continue;
    add({
      kind: "remote-deleted",
      path,
      previous: record,
      message: "The file was removed outside this device."
    });
  }

  const needsReview = entries.some((entry) => entry.kind !== "local-changed");
  return { clean: !needsReview, scannedAt: now, entries, counts };
}

function currentOf(file: SyncFile): Pick<SyncFile, "sha256" | "size" | "version"> {
  return { sha256: file.sha256, size: file.size, version: file.version };
}

function placeholderEntry(file: SyncFile, previous?: SyncFileRecord): DriftEntry {
  return {
    kind: "placeholder",
    path: file.path,
    bookId: file.bookId,
    chapterId: file.chapterId,
    previous,
    message: "This file is online-only. The provider has not downloaded it, so it cannot be read."
  };
}

function unreadableEntry(file: SyncFile, previous?: SyncFileRecord): DriftEntry {
  return {
    kind: "unreadable",
    path: file.path,
    bookId: file.bookId,
    chapterId: file.chapterId,
    previous,
    message: file.unreadable ?? "This file could not be read."
  };
}

function schemaEntry(file: SyncFile, previous?: SyncFileRecord): DriftEntry {
  return {
    kind: "schema-newer",
    path: file.path,
    bookId: file.bookId,
    previous,
    message: `This book uses format version ${file.schemaVersion}; this studio understands ${SCHEMA_VERSION}.`
  };
}

function conflictEntry(file: SyncFile): DriftEntry {
  return {
    kind: "conflict-copy",
    path: file.path,
    bookId: file.bookId,
    chapterId: file.chapterId,
    message: "A conflict copy exists that this device has not reviewed."
  };
}
