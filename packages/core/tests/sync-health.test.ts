import { describe, expect, test } from "bun:test";
import { locationHealth, type LocationProbeState } from "../src/sync/health";
import { SYNC_SCHEMA_VERSION, type SyncFile, type SyncFileRecord, type SyncJournal } from "../src/sync/types";

const NOW = "2026-10-26T00:00:00.000Z";

function file(path: string, extra: Partial<SyncFile> = {}): SyncFile {
  return { path, sha256: "a".repeat(64), size: 12, ...extra };
}

function record(): SyncFileRecord {
  return { sha256: "a".repeat(64), observedAt: NOW };
}

function journal(files: Record<string, SyncFileRecord> = {}): SyncJournal {
  return { schemaVersion: SYNC_SCHEMA_VERSION, deviceId: "device_test000001", generation: 1, scannedAt: NOW, files };
}

describe("locationHealth", () => {
  test("a materialized location with no unresolved issues is ready", () => {
    const result = locationHealth([file("books/book_test000001/book.json")], journal());

    expect(result).toMatchObject({ state: "ready", label: "Ready", count: 0, severity: "info" });
    expect(result.action.safe).toBe(true);
    expect(result.message).toContain("location is ready");
  });

  test("counts online-only placeholders without treating them as empty files", () => {
    const fixtureFolder = [
      file("books/book_test000001/chapters/0001-one.md", { sha256: null, size: null, placeholder: true }),
      file("books/book_test000001/chapters/0002-two.md", { sha256: null, size: null, placeholder: true })
    ];
    const result = locationHealth(fixtureFolder, journal());

    expect(result).toMatchObject({ state: "not-downloaded", label: "Not downloaded", count: 2, severity: "danger" });
    expect(result.message).toContain("2 files are still online-only");
    expect(result.action).toMatchObject({ id: "download-files", safe: true });
  });

  test("uses explicit probe observations for offline, permission and checking states", () => {
    const cases: Array<{ probe: LocationProbeState; state: string }> = [
      { probe: "offline", state: "offline" },
      { probe: "permission-needed", state: "permission-needed" },
      { probe: "checking", state: "checking" }
    ];

    for (const { probe, state } of cases) {
      const result = locationHealth([], journal(), probe);
      expect(result.state).toBe(state);
      expect(result.count).toBe(0);
      expect(result.action.safe).toBe(true);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  test("an unreadable fixture that reports a permission problem needs access", () => {
    const result = locationHealth(
      [file("books/book_test000001/book.json", { unreadable: "Permission denied." })],
      journal()
    );

    expect(result.state).toBe("permission-needed");
  });

  test("counts conflict copies not already reviewed in the journal", () => {
    const reviewedPath = "books/book_test000001/conflicts/reviewed.md";
    const pendingPath = "books/book_test000001/conflicts/pending.md";
    const result = locationHealth(
      [
        file(reviewedPath, { conflict: true }),
        file(pendingPath, { conflict: true }),
        file("books/book_test000001/conflicts/pending-two.md", { conflict: true })
      ],
      journal({ [reviewedPath]: record() })
    );

    expect(result).toMatchObject({ state: "conflicts", label: "Conflicts", count: 2, severity: "warning" });
    expect(result.message).toContain("2 conflict copies need review");
    expect(result.action).toMatchObject({ id: "review-conflicts", safe: true });
  });

  test("a journal with an unknown schema cannot hide a conflict copy", () => {
    const path = "books/book_test000001/conflicts/pending.md";
    const result = locationHealth(
      [file(path, { conflict: true })],
      { ...journal({ [path]: record() }), schemaVersion: SYNC_SCHEMA_VERSION + 1 }
    );

    expect(result).toMatchObject({ state: "conflicts", count: 1 });
  });
});
