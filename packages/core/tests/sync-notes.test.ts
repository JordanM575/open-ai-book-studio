import { describe, expect, test } from "bun:test";
import { toLibraryFilePath } from "../src/library/path";
import { noteRemovedFiles, noteWrittenFiles, readSyncJournal, writeSyncJournal } from "../src/sync/journal";
import { SYNC_SCHEMA_VERSION } from "../src/sync/types";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/*
 * Every store notes its own writes in the one baseline file: chapters, conversations, images and a
 * turn's checkpoints. A turn's tool calls can finish together, so two notes can arrive at once, and
 * each reads the baseline, adds its paths and writes it back. They must take turns, or the second
 * write drops the first one's paths and the next scan lists the studio's own file as someone
 * else's (spec 016 FR-005).
 */

const DEVICE = "device_test000001";
const NOW = "2026-11-04T06:00:00.000Z";
const THREAD = "books/book_notes00001/threads/thread_notes00001.json";
const CHECKPOINT = "books/book_notes00001/.studio/checkpoints/2026-11-04T06-00-00-000Z-turn_notes00001.json";
const CHAPTER = "books/book_notes00001/chapters/0001-one.md";
const encoder = new TextEncoder();

async function libraryWith(paths: string[]): Promise<InMemoryLibraryPort> {
  const port = new InMemoryLibraryPort();
  for (const path of paths) {
    await port.commitFile(toLibraryFilePath(path.split("/")), encoder.encode(`${path}\n`), { kind: "any" });
  }
  await writeSyncJournal(port, { schemaVersion: SYNC_SCHEMA_VERSION, deviceId: DEVICE, generation: 1, scannedAt: NOW, files: {} });
  return port;
}

describe("notes in the sync baseline", () => {
  test("two notes made at once both land", async () => {
    const port = await libraryWith([THREAD, CHECKPOINT]);
    await Promise.all([
      noteWrittenFiles({ storage: port, deviceId: DEVICE, paths: [THREAD], now: NOW }),
      noteWrittenFiles({ storage: port, deviceId: DEVICE, paths: [CHECKPOINT], now: NOW })
    ]);
    const journal = await readSyncJournal(port, DEVICE);
    expect(Object.keys(journal?.files ?? {}).sort()).toEqual([CHECKPOINT, THREAD].sort());
  });

  test("a removal noted while another store writes keeps both", async () => {
    const port = await libraryWith([CHAPTER, CHECKPOINT]);
    await noteWrittenFiles({ storage: port, deviceId: DEVICE, paths: [CHECKPOINT], now: NOW });
    await port.removeFile(toLibraryFilePath(CHECKPOINT.split("/")));
    await Promise.all([
      noteRemovedFiles({ storage: port, deviceId: DEVICE, paths: [CHECKPOINT], now: NOW }),
      noteWrittenFiles({ storage: port, deviceId: DEVICE, paths: [CHAPTER], now: NOW })
    ]);
    const files = (await readSyncJournal(port, DEVICE))?.files ?? {};
    expect(files[CHECKPOINT]?.deleted).toBe(true);
    expect(files[CHAPTER]?.writtenSha256).toBe(files[CHAPTER]?.sha256);
  });
});
