import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockElectron } from "./support/mock-electron";
import { DraftBuffer } from "../src/main/drafts";
import { Library } from "../src/main/library/store";
import type { SettingsStore } from "../src/main/settings";
import type { SyncService as SyncServiceType } from "../src/main/sync";

let SyncService!: typeof SyncServiceType;

beforeAll(async () => {
  const userData = await mkdtemp(join(tmpdir(), "studio-sync-userdata-"));
  cleanups.push(userData);
  mockElectron(userData);
  ({ SyncService } = await import("../src/main/sync"));
});

const NOW = "2026-11-03T12:00:00.000Z";
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fakeSettings(initial: { syncCheckIntervalMinutes?: number; lastSyncScanAt?: string | null } = {}) {
  let value = { ...initial };
  return {
    store: {
      get: () => ({ libraryRoot: null, ...value }),
      update: async (patch: typeof value) => {
        value = { ...value, ...patch };
      }
    } as unknown as SettingsStore,
    value: () => value
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-sync-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const chapter = await library.createChapter(book.id, { title: "The Light", content: "The storm came in low.\n" });
  return { root, library, book, chapter };
}

function serviceFor(
  library: Library | null,
  settings: SettingsStore,
  drafts = new DraftBuffer(),
  now: () => string = () => NOW
) {
  return { service: new SyncService({ library, drafts }, settings, now), drafts };
}

describe("the desktop sync service", () => {
  test("the first scan baselines a fresh library, so later opens can tell what changed", async () => {
    const { library } = await fixture();
    const settings = fakeSettings();
    const { service } = serviceFor(library, settings.store);

    const report = await service.check();
    expect(report?.clean).toBe(true);
    expect(report?.warning).toBeUndefined();
    expect(settings.value().lastSyncScanAt).toBe(report?.scannedAt);

    const again = await service.check();
    expect(again?.clean).toBe(true);
  });

  test("an outside file change reports until it is accepted", async () => {
    const { root, library, book, chapter } = await fixture();
    const settings = fakeSettings();
    const { service } = serviceFor(library, settings.store);
    await service.check();

    await appendFile(join(root, "books", book.id, "chapters", chapter.path), "An outside line.\n");
    const dirty = await service.check();
    expect(dirty?.clean).toBe(false);
    expect(dirty?.entries.map((entry) => entry.kind)).toContain("remote-changed");

    const accepted = await service.accept((dirty?.entries ?? []).map((entry) => entry.path));
    expect(accepted?.clean).toBe(true);
  });

  test("a focus scan is skipped while the last scan is fresh and runs when it is stale", async () => {
    const { library } = await fixture();
    const fresh = fakeSettings({ lastSyncScanAt: NOW });
    const stale = fakeSettings({ lastSyncScanAt: "2026-11-03T10:00:00.000Z" });

    const { service: freshService } = serviceFor(library, fresh.store);
    expect(await freshService.maybeCheckOnFocus()).toBeNull();

    const { service: staleService } = serviceFor(library, stale.store);
    const report = await staleService.maybeCheckOnFocus();
    expect(report?.clean).toBe(true);
    expect(stale.value().lastSyncScanAt).toBe(report?.scannedAt);
  });

  test("keep mine saves the draft through the checked path", async () => {
    const { library, book, chapter } = await fixture();
    const settings = fakeSettings();
    const { service, drafts } = serviceFor(library, settings.store);
    drafts.set({
      bookId: book.id,
      chapterId: chapter.id,
      content: "My unsent line.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    const result = await service.keepMine(book.id, chapter.id);
    expect(result?.status).toBe("saved");
    expect(drafts.size).toBe(0);
    const reread = await library.readChapter(book.id, chapter.id);
    expect(reread.content).toContain("My unsent line.");
  });

  test("keep mine reports a conflict instead of overwriting the disk", async () => {
    const { root, library, book, chapter } = await fixture();
    const settings = fakeSettings();
    const { service, drafts } = serviceFor(library, settings.store);
    drafts.set({
      bookId: book.id,
      chapterId: chapter.id,
      content: "My unsent line.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    await appendFile(join(root, "books", book.id, "chapters", chapter.path), "An outside line.\n");

    const result = await service.keepMine(book.id, chapter.id);
    expect(result?.status).toBe("conflict");
    if (result?.status === "conflict") expect(result.conflict.savedAs).toContain("conflicts");
  });

  test("without a library every run returns null", async () => {
    const settings = fakeSettings();
    const { service } = serviceFor(null, settings.store);
    expect(await service.check()).toBeNull();
    expect(await service.accept(["books/b/chapters/1.md"])).toBeNull();
    expect(await service.keepMine("book_x", "ch_x")).toBeNull();
  });
});
