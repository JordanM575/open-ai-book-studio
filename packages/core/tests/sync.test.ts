import { describe, expect, test } from "bun:test";
import { detectDrift } from "../src/sync/detector";
import { journalForScan, pruneJournal, readSyncJournal, writeSyncJournal } from "../src/sync/journal";
import {
  SYNC_SCHEMA_VERSION,
  type SyncFile,
  type SyncFileRecord,
  type SyncJournal
} from "../src/sync/types";
import { syncJournalPath } from "../src/library/paths";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const NOW = "2026-10-25T23:00:00.000Z";
const LATER = "2026-10-26T00:00:00.000Z";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ONE = "books/book_test000001/chapters/0001-one.md";
const TWO = "books/book_test000001/chapters/0002-two.md";

function record(sha256 = A, extra: Partial<SyncFileRecord> = {}): SyncFileRecord {
  return { sha256, observedAt: NOW, ...extra };
}

function journal(files: Record<string, SyncFileRecord> = {}): SyncJournal {
  return { schemaVersion: SYNC_SCHEMA_VERSION, deviceId: "device_test000001", generation: 1, scannedAt: NOW, files };
}

function file(path: string, sha256: string | null = A, extra: Partial<SyncFile> = {}): SyncFile {
  return { path, sha256, size: 10, ...extra };
}

const encoder = new TextEncoder();

describe("detectDrift", () => {
  test("an unchanged file is clean", () => {
    const report = detectDrift({ journal: journal({ [ONE]: record(A) }), files: [file(ONE, A)], now: NOW });
    expect(report.clean).toBe(true);
    expect(report.entries).toEqual([]);
  });

  test("a changed hash is a remote change", () => {
    const report = detectDrift({ journal: journal({ [ONE]: record(A) }), files: [file(ONE, B)], now: NOW });
    expect(report.clean).toBe(false);
    expect(report.entries).toEqual([
      expect.objectContaining({ kind: "remote-changed", path: ONE, previous: expect.objectContaining({ sha256: A }) })
    ]);
    expect(report.counts["remote-changed"]).toBe(1);
  });

  test("a hash this device wrote is local, not remote", () => {
    const report = detectDrift({
      journal: journal({ [ONE]: record(A, { writtenSha256: B }) }),
      files: [file(ONE, B)],
      now: NOW
    });
    expect(report.entries).toEqual([expect.objectContaining({ kind: "local-changed" })]);
    expect(report.clean).toBe(true);
  });

  test("a remote change plus unsaved text is both-changed", () => {
    const report = detectDrift({
      journal: journal({ [ONE]: record(A) }),
      files: [file(ONE, B, { chapterId: "ch_test000001" })],
      dirtyChapterIds: ["ch_test000001"],
      now: NOW
    });
    expect(report.entries).toEqual([expect.objectContaining({ kind: "both-changed", chapterId: "ch_test000001" })]);
    expect(report.clean).toBe(false);
  });

  test("a new file is reported, and an unchanged-hash move is a rename", () => {
    const added = detectDrift({ journal: journal(), files: [file(TWO, B)], now: NOW });
    expect(added.entries).toEqual([expect.objectContaining({ kind: "new-remote", path: TWO })]);

    const moved = detectDrift({
      journal: journal({ [ONE]: record(A) }),
      files: [file(TWO, A)],
      now: NOW
    });
    expect(moved.entries).toEqual([
      expect.objectContaining({ kind: "renamed", path: TWO, renamedFrom: ONE })
    ]);
  });

  test("a chapter moved to the trash is a deletion, not a rename", () => {
    const trashed = ".studio/trash/book_test000001/2026-10-25T23-00-00-000Z-0001-one.md";
    const report = detectDrift({
      journal: journal({ [ONE]: record(A) }),
      files: [file(trashed, A, { bookId: "book_test000001" })],
      now: NOW
    });

    expect(report.entries.map((entry) => entry.kind).sort()).toEqual(["new-remote", "remote-deleted"]);
    expect(report.counts.renamed).toBe(0);
    expect(report.clean).toBe(false);
  });

  test("deletions use tombstones and do not resurrect", () => {
    const removed = detectDrift({ journal: journal({ [ONE]: record(A) }), files: [], now: NOW });
    expect(removed.entries).toEqual([expect.objectContaining({ kind: "remote-deleted", path: ONE })]);

    const tombstoned = detectDrift({
      journal: journal({ [ONE]: record(A, { deleted: true }) }),
      files: [file(ONE, A)],
      now: NOW
    });
    expect(tombstoned.entries).toEqual([expect.objectContaining({ kind: "local-deleted", path: ONE })]);
  });

  test("placeholders, unreadable files, newer schema and conflict copies are distinct", () => {
    const report = detectDrift({
      journal: journal(),
      files: [
        file(ONE, null, { placeholder: true }),
        file(TWO, null, { unreadable: "Permission denied." }),
        file("books/book_test000001/book.json", A, { schemaVersion: 99 }),
        file("books/book_test000001/conflicts/0001-one.conflicted.md", C, { conflict: true })
      ],
      now: NOW
    });
    expect(report.entries.map((entry) => entry.kind).sort()).toEqual([
      "conflict-copy",
      "placeholder",
      "schema-newer",
      "unreadable"
    ]);
  });

  test("a placeholders and unreadable files are reported without a baseline", () => {
    const report = detectDrift({
      journal: null,
      files: [file(ONE, null, { placeholder: true }), file(TWO, null, { unreadable: "Permission denied." })],
      now: NOW
    });
    expect(report.clean).toBe(false);
    expect(report.warning).toContain("No sync baseline");
    expect(report.entries.map((entry) => entry.kind)).toEqual(["placeholder", "unreadable"]);
  });

  test("scanning twice produces the same report", () => {
    const input = {
      journal: journal({ [ONE]: record(A) }),
      files: [file(ONE, B), file(TWO, C)],
      now: NOW
    };
    expect(detectDrift(input)).toEqual(detectDrift(input));
  });
});

describe("sync journal", () => {
  test("round-trips through the storage port", async () => {
    const port = new InMemoryLibraryPort();
    const baseline = journal({ [ONE]: record(A) });
    expect(await readSyncJournal(port, "device_test000001")).toBeNull();
    await writeSyncJournal(port, baseline);
    expect(await readSyncJournal(port, "device_test000001")).toEqual(baseline);
  });

  test("a foreign device id or corrupt JSON is not accepted as this device's baseline", async () => {
    const port = new InMemoryLibraryPort();
    const baseline = journal({ [ONE]: record(A) });
    const path = syncJournalPath("device_test000001");

    await port.commitFile(path, encoder.encode(JSON.stringify({ ...baseline, deviceId: "device_other0001" })), {
      kind: "any"
    });
    expect(await readSyncJournal(port, "device_test000001")).toBeNull();

    await port.commitFile(path, encoder.encode("{not json"), { kind: "any" });
    expect(await readSyncJournal(port, "device_test000001")).toBeNull();

    await port.commitFile(path, encoder.encode("{}"), { kind: "any" });
    expect(await readSyncJournal(port, "device_test000001")).toBeNull();
  });

  test("a scan preserves local writes, records tombstones, and clears a reappearing file", () => {
    const previous = journal({ [ONE]: record(A) });
    const next = journalForScan({
      deviceId: "device_test000001",
      previous,
      files: [file(ONE, A), file(TWO, B)],
      now: LATER,
      written: [TWO]
    });

    expect(next.generation).toBe(2);
    expect(next.scannedAt).toBe(LATER);
    expect(next.files[ONE]?.sha256).toBe(A);
    expect(next.files[TWO]).toMatchObject({ sha256: B, writtenSha256: B });

    const missing = journalForScan({ deviceId: "device_test000001", previous, files: [file(TWO, B)], now: LATER });
    expect(missing.files[ONE]).toMatchObject({ sha256: A, deleted: true });

    const reappeared = journalForScan({
      deviceId: "device_test000001",
      previous: journal({ [ONE]: record(A, { deleted: true }) }),
      files: [file(ONE, B)],
      now: LATER
    });
    expect(reappeared.files[ONE]?.deleted).toBeUndefined();
    expect(reappeared.files[ONE]?.sha256).toBe(B);
  });

  test("an existing tombstone survives a scan with no file", () => {
    const tombstone = journal({ [ONE]: record(A, { deleted: true }) });
    const next = journalForScan({ deviceId: "device_test000001", previous: tombstone, files: [], now: LATER });
    expect(next.files[ONE]).toMatchObject({ sha256: A, deleted: true });
  });

  test("pruning drops only old tombstones", () => {
    const old = "2026-08-01T00:00:00.000Z";
    const baseline = journal({
      [ONE]: record(A, { deleted: true, observedAt: old }),
      [TWO]: record(B, { deleted: true, observedAt: NOW }),
      "books/book_test000001/book.json": record(C, { observedAt: old })
    });
    const pruned = pruneJournal(baseline, { now: NOW, maxTombstoneDays: 30 });
    expect(pruned.files[ONE]).toBeUndefined();
    expect(pruned.files[TWO]).toBeDefined();
    expect(pruned.files["books/book_test000001/book.json"]).toBeDefined();
  });
});
