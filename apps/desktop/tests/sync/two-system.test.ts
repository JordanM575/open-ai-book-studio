import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTwoSystem,
  dropPlaceholderMarker,
  injectConflictCopy,
  markPlaceholder,
  skewClock,
  type TwoSystems
} from "./transport";

const NOW = "2026-10-25T23:00:00.000Z";
const LATER = "2026-10-26T00:00:00.000Z";

let systems: TwoSystems;

beforeEach(async () => {
  systems = await createTwoSystem();
});

afterEach(async () => {
  await systems.cleanup();
});

interface Seed {
  bookId: string;
  chapterId: string;
  path: string;
  version: number;
  hash: string;
}

function chapterFile(bookId: string, fileName: string): string {
  return `books/${bookId}/chapters/${fileName}`;
}

/** A book and one chapter on both systems, each with a reviewed baseline. */
async function seedLibrary(): Promise<Seed> {
  const book = await systems.a.library.createBook({ title: "The Salt Road" });
  const chapter = await systems.a.library.createChapter(book.id, {
    title: "The Door",
    content: "Salt on the floor.\n"
  });
  const path = chapterFile(book.id, chapter.path);

  await systems.a.recordWrite([path]);
  await systems.transport.sync(systems.a, systems.b, { delayMs: 1 });
  await systems.b.accept(await systems.b.scan({ now: NOW }));

  return { bookId: book.id, chapterId: chapter.id, path, version: chapter.version, hash: chapter.hash };
}

describe("two-system sync", () => {
  test("propagates a clean library and leaves the next scan inert", async () => {
    const seed = await seedLibrary();

    expect(await systems.b.readText(seed.path)).toBe(await systems.a.readText(seed.path));
    expect(await systems.b.readText(seed.path)).toContain("Salt on the floor.");

    const first = await systems.b.scan({ now: NOW });
    expect(first.journal?.deviceId).toBe(systems.b.library.deviceId);
    expect(first.report.warning).toBeUndefined();
    expect(first.report.clean).toBe(true);
    expect(first.report.entries).toEqual([]);

    const second = await systems.b.scan({ now: NOW });
    expect(second.report).toEqual(first.report);
  });

  test("clock skew alone is not drift", async () => {
    const seed = await seedLibrary();
    await skewClock(systems.b, seed.path, "2001-01-01T00:00:00.000Z");

    const scan = await systems.b.scan({ now: LATER });

    expect(scan.report.clean).toBe(true);
    expect(scan.report.entries).toEqual([]);
    expect(await systems.b.readText(seed.path)).toContain("Salt on the floor.");
  });

  test("a concurrent edit is both-changed and keeps both versions", async () => {
    const seed = await seedLibrary();

    const written = await systems.a.library.saveChapter(
      seed.bookId,
      seed.chapterId,
      "A writes from the road.\n",
      { baseVersion: seed.version, baseHash: seed.hash }
    );
    expect(written.status).toBe("saved");
    await systems.a.recordWrite([seed.path]);
    await systems.transport.sync(systems.a, systems.b);

    // B still has its own text open and has not saved it.
    const conflict = await systems.b.library.saveChapter(
      seed.bookId,
      seed.chapterId,
      "B writes from the kitchen.\n",
      { baseVersion: seed.version, baseHash: seed.hash }
    );
    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") return;

    const scan = await systems.b.scan({ now: NOW, dirtyChapterIds: [seed.chapterId] });
    expect(scan.report.counts["both-changed"]).toBe(1);
    expect(scan.report.counts["remote-changed"]).toBe(0);
    expect(scan.report.counts["conflict-copy"]).toBe(1);
    expect(scan.report.clean).toBe(false);

    expect(await systems.b.readText(seed.path)).toContain("A writes from the road.");
    expect(await systems.b.readText(conflict.conflict.savedAs)).toContain("B writes from the kitchen.");

    await systems.b.accept(scan);
    const reviewed = await systems.b.scan({ now: LATER });
    expect(reviewed.report.counts["conflict-copy"]).toBe(0);
    expect(reviewed.report.clean).toBe(true);
  });

  test("offline edits on different chapters both survive a late delivery", async () => {
    const seed = await seedLibrary();
    const second = await systems.a.library.createChapter(seed.bookId, {
      title: "The Lighthouse",
      content: "The lamp turned.\n"
    });
    const secondPath = chapterFile(seed.bookId, second.path);
    await systems.a.recordWrite([secondPath]);
    await systems.transport.sync(systems.a, systems.b);
    await systems.b.accept(await systems.b.scan({ now: NOW }));

    // Both systems edit while offline.
    const aWrite = await systems.a.library.saveChapter(
      seed.bookId,
      seed.chapterId,
      "A edits chapter one.\n",
      { baseVersion: seed.version, baseHash: seed.hash }
    );
    expect(aWrite.status).toBe("saved");
    await systems.a.recordWrite([seed.path]);

    const bBase = await systems.b.library.readChapter(seed.bookId, second.id);
    const bWrite = await systems.b.library.saveChapter(seed.bookId, second.id, "B edits chapter two.\n", {
      baseVersion: bBase.version,
      baseHash: bBase.hash
    });
    expect(bWrite.status).toBe("saved");
    await systems.b.recordWrite([secondPath]);

    // Deliver only the file each system changed, in one late batch.
    const batch = systems.transport.offline();
    batch.sync(systems.b, systems.a, { only: [secondPath] });
    batch.sync(systems.a, systems.b, { only: [seed.path] });
    await batch.deliver();

    const aScan = await systems.a.scan({ now: NOW });
    const bScan = await systems.b.scan({ now: NOW });
    expect(aScan.report.counts["remote-changed"]).toBe(1);
    expect(bScan.report.counts["remote-changed"]).toBe(1);
    expect(aScan.report.clean).toBe(false);
    expect(bScan.report.clean).toBe(false);

    expect(await systems.a.readText(seed.path)).toContain("A edits chapter one.");
    expect(await systems.a.readText(secondPath)).toContain("B edits chapter two.");
    expect(await systems.b.readText(seed.path)).toContain("A edits chapter one.");
    expect(await systems.b.readText(secondPath)).toContain("B edits chapter two.");

    await systems.a.accept(aScan);
    await systems.b.accept(bScan);
    expect((await systems.a.scan({ now: LATER })).report.clean).toBe(true);
    expect((await systems.b.scan({ now: LATER })).report.clean).toBe(true);
  });

  test("a deletion becomes a tombstone and a stale copy is reported, not resurrected", async () => {
    const seed = await seedLibrary();

    const trashed = await systems.a.library.deleteChapter(seed.bookId, seed.chapterId);
    await systems.a.recordDeletion(seed.path);

    const own = await systems.a.scan({ now: NOW });
    expect(own.report.counts["remote-deleted"]).toBe(0);
    expect(own.report.clean).toBe(true);

    await systems.transport.sync(systems.a, systems.b);

    const scan = await systems.b.scan({ now: NOW });
    expect(scan.report.entries.find((entry) => entry.path === seed.path)?.kind).toBe("remote-deleted");
    expect(scan.report.counts["new-remote"]).toBe(1); // the trashed chapter
    await systems.b.accept(scan);
    expect((await systems.b.scan({ now: NOW })).report.clean).toBe(true);

    // A stale copy comes back from a provider that had not caught up.
    const text = await systems.a.readText(trashed.trashedAt);
    await systems.b.writeText(seed.path, text);
    const resurrected = await systems.b.scan({ now: LATER });
    expect(resurrected.report.entries.find((entry) => entry.path === seed.path)?.kind).toBe("local-deleted");
    expect(await systems.b.readText(seed.path)).toContain("Salt on the floor.");
  });

  test("an online-only placeholder is reported and never read as empty", async () => {
    const seed = await seedLibrary();
    await markPlaceholder(systems.b, seed.path);

    const scan = await systems.b.scan({ now: NOW });
    expect(scan.files.find((file) => file.path === seed.path)?.sha256).toBeNull();
    expect(scan.report.entries.find((entry) => entry.path === seed.path)?.kind).toBe("placeholder");
    expect(scan.report.counts["remote-changed"]).toBe(0);

    await dropPlaceholderMarker(systems.b, seed.path);
    await systems.transport.sync(systems.a, systems.b);

    const healed = await systems.b.scan({ now: LATER });
    expect(healed.report.counts["placeholder"]).toBe(0);
    expect(healed.report.clean).toBe(true);
    expect(await systems.b.readText(seed.path)).toContain("Salt on the floor.");
  });

  test("an interrupted copy is reported and healed by a complete copy", async () => {
    const seed = await seedLibrary();
    const written = await systems.a.library.saveChapter(
      seed.bookId,
      seed.chapterId,
      "A complete revision.\n",
      { baseVersion: seed.version, baseHash: seed.hash }
    );
    expect(written.status).toBe("saved");
    await systems.a.recordWrite([seed.path]);
    const full = await systems.a.readText(seed.path);

    // The provider delivers the metadata but stops before the chapter.
    const partial = await systems.transport.sync(systems.a, systems.b, { stopAfter: 1 });
    expect(partial.copied).toEqual([`books/${seed.bookId}/book.json`]);
    expect(partial.skipped).toContain(seed.path);
    expect(await systems.b.readText(seed.path)).not.toContain("A complete revision.");

    await systems.transport.sync(systems.a, systems.b, {
      truncate: { path: seed.path, fraction: 0.5 }
    });
    const torn = await systems.b.readText(seed.path);
    expect(torn.length).toBeLessThan(full.length);
    expect(full.startsWith(torn)).toBe(true);

    const scan = await systems.b.scan({ now: NOW });
    expect(scan.report.counts["remote-changed"]).toBe(1);
    expect(scan.report.clean).toBe(false);

    await systems.transport.sync(systems.a, systems.b);
    const healed = await systems.b.scan({ now: LATER });
    expect(healed.report.counts["remote-changed"]).toBe(1); // still against the old baseline
    await systems.b.accept(healed);
    expect((await systems.b.scan({ now: LATER })).report.clean).toBe(true);
    expect(await systems.b.readText(seed.path)).toBe(full);
  });

  test("a corrupt journal degrades to a warning and is rebuilt", async () => {
    const seed = await seedLibrary();
    const journalPath = `.studio/sync/${systems.b.library.deviceId}.json`;
    await systems.b.writeText(journalPath, "{ not json");

    const scan = await systems.b.scan({ now: NOW });
    expect(scan.report.warning).toContain("No sync baseline");
    expect(scan.report.entries).toEqual([]);
    expect(scan.report.clean).toBe(true);

    await systems.b.accept(scan);
    const rebuilt = await systems.b.scan({ now: LATER });
    expect(rebuilt.report.warning).toBeUndefined();
    expect(rebuilt.report.clean).toBe(true);
    expect(await systems.b.readText(seed.path)).toContain("Salt on the floor.");

    // A journal copied by the provider keeps the other device's name and is not adopted.
    const other = await systems.a.scan({ now: NOW });
    await systems.b.writeText(
      `.studio/sync/${systems.a.library.deviceId}.json`,
      JSON.stringify(other.journal)
    );
    const after = await systems.b.scan({ now: LATER });
    expect(after.journal?.deviceId).toBe(systems.b.library.deviceId);
    expect(after.report.clean).toBe(true);
  });

  test("a provider conflict copy is reported once and never duplicated", async () => {
    const seed = await seedLibrary();
    const conflict = await injectConflictCopy(systems.b, seed.path, "The door was open.\n");

    const first = await systems.b.scan({ now: NOW });
    expect(first.report.counts["conflict-copy"]).toBe(1);
    expect(first.report.entries.find((entry) => entry.path === conflict)?.kind).toBe("conflict-copy");
    expect(first.report.counts["new-remote"]).toBe(0);
    expect(await systems.b.readText(conflict)).toBe("The door was open.\n");

    const again = await systems.b.scan({ now: NOW });
    expect(again.report).toEqual(first.report);

    await systems.b.accept(first);
    const reviewed = await systems.b.scan({ now: LATER });
    expect(reviewed.report.counts["conflict-copy"]).toBe(0);
    expect(reviewed.report.clean).toBe(true);

    const chapterFiles = await readdir(join(systems.b.root, "books", seed.bookId, "chapters"));
    expect(chapterFiles.filter((name) => /conflicted copy/i.test(name))).toHaveLength(1);
  });

  test("a rename is paired by hash instead of a delete plus an add", async () => {
    const seed = await seedLibrary();
    const renamed = chapterFile(seed.bookId, "0002-the-door.md");

    await systems.transport.sync(systems.a, systems.b, {
      rename: { from: seed.path, to: renamed }
    });

    const scan = await systems.b.scan({ now: NOW });
    const entry = scan.report.entries.find((item) => item.path === renamed);
    expect(entry?.kind).toBe("renamed");
    expect(entry?.renamedFrom).toBe(seed.path);
    expect(scan.report.counts["remote-deleted"]).toBe(0);
    expect(scan.report.counts["new-remote"]).toBe(0);
    expect(await systems.b.readText(renamed)).toContain("Salt on the floor.");
  });
});
