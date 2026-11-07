/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import type { LibraryPort } from "@ai-book-studio/core/library/port";
import { LibraryService } from "@ai-book-studio/core/library/service";
import { chapterFileName, serializeChapter } from "@ai-book-studio/core/markdown";
import { chapterMetaSchema, type Chapter } from "@ai-book-studio/core/schema";
import { createFileSystemEnvironment } from "../src/main/library/fs-port";

/*
 * Moving chapters in a long book (QA D10). A move rewrites `order` in the chapter files it shifts and
 * nothing else, so its cost follows the distance moved rather than the size of the book, and a move
 * cut short by a crash still reads back in one sensible order that the next move repairs. Every book
 * here is a real folder on disk behind the desktop filesystem port; the port only counts what the
 * library asks of it, and can stop answering the way a killed app does.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A paragraph of plain prose, so a long book has the weight of one. */
const PROSE = `${"The keeper climbed the stair and counted every step until the light turned. ".repeat(12).trim()}\n`;

const isChapterFile = (path: string): boolean => /^books\/[^/]+\/chapters\/[^/]+\.md$/.test(path);

/** What the library asked of the disk, and a switch that makes every later request fail. */
interface Watch {
  port: LibraryPort;
  /** Every committed path, in order. */
  commits: string[];
  /** How many times each path was read. */
  reads: Map<string, number>;
  /** Stop answering, like a killed app, once this many more chapter files have been committed. */
  dieAfterChapterFiles: (count: number) => void;
  reset: () => void;
}

const ASYNC_METHODS = new Set([
  "readFile",
  "listDirectory",
  "stat",
  "ensureDirectory",
  "commitFile",
  "moveFile",
  "moveDirectory",
  "removeFile",
  "removeDirectory",
  "deviceInfo"
]);

function watch(storage: LibraryPort): Watch {
  const commits: string[] = [];
  const reads = new Map<string, number>();
  let left = Number.POSITIVE_INFINITY;
  let dead = false;
  const port = new Proxy(storage, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (typeof key !== "string" || !ASYNC_METHODS.has(key)) return value.bind(target);
      return async (...args: unknown[]) => {
        if (dead) throw new LibraryPortError("io", "The app was closed.");
        const path = Array.isArray(args[0]) ? (args[0] as readonly string[]).join("/") : "";
        if (key === "readFile") reads.set(path, (reads.get(path) ?? 0) + 1);
        if (key === "commitFile") {
          if (isChapterFile(path)) {
            if (left <= 0) {
              dead = true;
              throw new LibraryPortError("io", "The app was closed.");
            }
            left -= 1;
          }
          commits.push(path);
        }
        return (value as (...input: unknown[]) => unknown).apply(target, args);
      };
    }
  });
  return {
    port,
    commits,
    reads,
    dieAfterChapterFiles: (count) => {
      left = count;
    },
    reset: () => {
      commits.splice(0);
      reads.clear();
    }
  };
}

/** Open the library in `root` through a fresh port, the way the app does after a restart. */
async function open(root: string): Promise<{ service: LibraryService; watched: Watch }> {
  const environment = createFileSystemEnvironment(root);
  const watched = watch(environment.storage);
  const service = await LibraryService.open({ storage: watched.port, runtime: environment.runtime });
  return { service, watched };
}

interface Naming {
  title: (order: number) => string;
  /** The number in the file name: the chapter's place when it was created. */
  prefix: (order: number) => number;
}

const IN_ORDER: Naming = { title: (order) => `Chapter ${order}`, prefix: (order) => order };

/**
 * A book of `count` chapters, written as the studio writes them: `NNNN-slug.md`, with `order` 1 to
 * `count` in the front matter.
 */
async function longBook(
  count: number,
  naming: Naming = IN_ORDER
): Promise<{ root: string; bookId: string; service: LibraryService; watched: Watch }> {
  const root = await mkdtemp(join(tmpdir(), "studio-chapter-move-"));
  roots.push(root);
  const setup = await open(root);
  const book = await setup.service.createBook({ title: "The Long Road" });
  const folder = join(root, "books", book.id, "chapters");
  await mkdir(folder, { recursive: true });
  for (let order = 1; order <= count; order += 1) {
    const meta = chapterMetaSchema.parse({
      id: `ch_move${String(order).padStart(8, "0")}`,
      title: naming.title(order),
      order,
      createdAt: "2026-11-04T00:00:00.000Z",
      updatedAt: "2026-11-04T00:00:00.000Z"
    });
    await writeFile(join(folder, chapterFileName(naming.prefix(order), meta.title)), serializeChapter(meta, PROSE), "utf8");
  }
  // The sync journal exists in every library the app has opened; each save notes itself in it.
  await setup.service.establishBaseline();
  const { service, watched } = await open(root);
  return { root, bookId: book.id, service, watched };
}

async function chapters(service: LibraryService, bookId: string): Promise<Chapter[]> {
  return (await service.readBook(bookId)).chapters;
}

/** The ids in `ids` with the one at `from` moved to `to`. */
function moved(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id ?? "");
  return next;
}

function chapterCommits(watched: Watch): string[] {
  return watched.commits.filter(isChapterFile);
}

function catalogCommits(watched: Watch): string[] {
  return watched.commits.filter((path) => path === "library.json");
}

function hashes(list: readonly Chapter[]): Map<string, string> {
  return new Map(list.map((chapter) => [chapter.id, chapter.hash]));
}

describe("a move in a 300-chapter book rewrites only the chapters it shifts (QA D10)", () => {
  test("a drag from 120 to 118 rewrites the three chapters it shifts, and the catalog once", async () => {
    const { bookId, service, watched } = await longBook(300);
    const before = await chapters(service, bookId);
    const ids = before.map((chapter) => chapter.id);
    watched.reset();

    const result = await service.moveChapterTo(bookId, ids[119] ?? "", 117);

    expect(result.status).toBe("saved");
    const after = await chapters(service, bookId);
    expect(after.map((chapter) => chapter.id)).toEqual(moved(ids, 119, 117));
    expect(chapterCommits(watched).sort()).toEqual(
      [117, 118, 119].map((index) => `books/${bookId}/chapters/${before[index]?.path}`).sort()
    );
    expect(catalogCommits(watched)).toHaveLength(1);
    // The other 297 files are byte for byte what they were.
    const old = hashes(before);
    const shifted = new Set([117, 118, 119].map((index) => ids[index]));
    const untouched = after.filter((chapter) => !shifted.has(chapter.id));
    expect(untouched).toHaveLength(297);
    for (const chapter of untouched) expect(chapter.hash).toBe(old.get(chapter.id) ?? "");
  }, 60_000);

  test("after a chapter is deleted, the same drag still rewrites only those three", async () => {
    const { bookId, service, watched } = await longBook(301);
    const all = await chapters(service, bookId);
    // Deleting chapter 4 leaves a gap in the numbers: orders 1, 2, 3, 5, 6 and on.
    await service.deleteChapter(bookId, all[3]?.id ?? "");
    const before = await chapters(service, bookId);
    expect(before.map((chapter) => chapter.order).slice(0, 4)).toEqual([1, 2, 3, 5]);
    const ids = before.map((chapter) => chapter.id);
    watched.reset();

    const result = await service.moveChapterTo(bookId, ids[119] ?? "", 117);

    expect(result.status).toBe("saved");
    const after = await chapters(service, bookId);
    expect(after.map((chapter) => chapter.id)).toEqual(moved(ids, 119, 117));
    expect(chapterCommits(watched)).toHaveLength(3);
    expect(catalogCommits(watched)).toHaveLength(1);
    // The chapters it shifted share out the numbers they had among themselves.
    expect(after.slice(117, 120).map((chapter) => chapter.order)).toEqual(before.slice(117, 120).map((chapter) => chapter.order));
  }, 60_000);

  test("the rail's one-step move rewrites two chapters, and the catalog once", async () => {
    const { bookId, service, watched } = await longBook(300);
    const ids = (await chapters(service, bookId)).map((chapter) => chapter.id);
    watched.reset();

    const result = await service.reorderChapter(bookId, ids[200] ?? "", "up");

    expect(result.status).toBe("saved");
    expect((await chapters(service, bookId)).map((chapter) => chapter.id)).toEqual(moved(ids, 200, 199));
    expect(chapterCommits(watched)).toHaveLength(2);
    expect(catalogCommits(watched)).toHaveLength(1);
  }, 60_000);

  test("a drag from first to last rewrites every chapter once and reads each file only a few times", async () => {
    const { bookId, service, watched } = await longBook(300);
    const ids = (await chapters(service, bookId)).map((chapter) => chapter.id);
    watched.reset();

    const result = await service.moveChapterTo(bookId, ids[0] ?? "", 299);

    expect(result.status).toBe("saved");
    expect((await chapters(service, bookId)).map((chapter) => chapter.id)).toEqual(moved(ids, 0, 299));
    expect(chapterCommits(watched)).toHaveLength(300);
    expect(new Set(chapterCommits(watched)).size).toBe(300);
    expect(catalogCommits(watched)).toHaveLength(1);
    // Each written file is found from the one listing the move started with, not by searching the
    // folder again for every file it writes.
    const chapterReads = [...watched.reads].filter(([path]) => isChapterFile(path)).map(([, count]) => count);
    expect(Math.max(...chapterReads)).toBeLessThanOrEqual(8);
  }, 120_000);
});

/** Positions of the moving chapter in the two moves cut short below: up from 7th to 3rd, and down from 2nd to 6th. */
const CUT_SHORT = [
  { name: "up", from: 6, to: 2 },
  { name: "down", from: 1, to: 5 }
] as const;

/*
 * The crash book has been reordered before: neither its titles nor its file names follow the reading
 * order, so a move that left two shifted chapters tied would show them swapped.
 */
const TITLES = ["Tide", "Gate", "Salt", "Lamp", "Road", "Bell", "Well", "Ash"];
const PREFIXES = [5, 2, 8, 1, 7, 3, 6, 4];
const REORDERED: Naming = {
  title: (order) => TITLES[order - 1] ?? `Chapter ${order}`,
  prefix: (order) => PREFIXES[order - 1] ?? order
};

/**
 * Start a move of the chapter at `from` to `to` in an eight-chapter book and close the app after it
 * has written `written` chapter files, then open the library again.
 */
async function cutShort(from: number, to: number, written: number) {
  const book = await longBook(8, REORDERED);
  const ids = (await chapters(book.service, book.bookId)).map((chapter) => chapter.id);
  book.watched.dieAfterChapterFiles(written);
  await expect(book.service.moveChapterTo(book.bookId, ids[from] ?? "", to)).rejects.toThrow();
  const reopened = await open(book.root);
  return { ...book, ids, movingId: ids[from] ?? "", service: reopened.service, watched: reopened.watched };
}

function strictlyRising(list: readonly Chapter[]): boolean {
  return list.every((chapter, index) => index === 0 || chapter.order > (list[index - 1]?.order ?? 0));
}

describe("a move cut short by a crash (QA D10)", () => {
  for (const { name, from, to } of CUT_SHORT) {
    for (const written of [1, 2, 3, 4]) {
      test(`a move ${name} stopped after ${written} of 5 files reads back in one order, with only the moved chapter out of place`, async () => {
        const { root, bookId, ids, movingId, service } = await cutShort(from, to, written);

        const first = (await chapters(service, bookId)).map((chapter) => chapter.id);
        const second = (await chapters(service, bookId)).map((chapter) => chapter.id);
        const third = (await chapters((await open(root)).service, bookId)).map((chapter) => chapter.id);
        expect(second).toEqual(first);
        expect(third).toEqual(first);

        // Every chapter but the moved one keeps its place relative to the others.
        const others = ids.filter((id) => id !== movingId);
        expect(first.filter((id) => id !== movingId)).toEqual(others);
        // The moved chapter stands somewhere between where it was and where it was going.
        const at = first.indexOf(movingId);
        expect(at).toBeGreaterThanOrEqual(Math.min(from, to));
        expect(at).toBeLessThanOrEqual(Math.max(from, to));
        // At most two chapters share a number.
        const orders = (await chapters(service, bookId)).map((chapter) => chapter.order);
        expect(orders.length - new Set(orders).size).toBeLessThanOrEqual(1);
      }, 30_000);

      test(`after a move ${name} stopped after ${written} files, the next button move and the next drag repair the order`, async () => {
        const { bookId, movingId, service } = await cutShort(from, to, written);
        const shown = (await chapters(service, bookId)).map((chapter) => chapter.id);

        // The author presses Move up (or down) on the chapter they were moving.
        const step = name === "up" ? "up" : "down";
        const at = shown.indexOf(movingId);
        const target = step === "up" ? Math.max(0, at - 1) : Math.min(shown.length - 1, at + 1);
        const pressed = await service.reorderChapter(bookId, movingId, step);
        expect(pressed.status).toBe("saved");
        const afterPress = await chapters(service, bookId);
        expect(afterPress.map((chapter) => chapter.id)).toEqual(moved(shown, at, target));
        expect(strictlyRising(afterPress)).toBe(true);

        // Then drags it the rest of the way.
        const dragged = await service.moveChapterTo(bookId, movingId, to);
        expect(dragged.status).toBe("saved");
        const afterDrag = await chapters(service, bookId);
        const pressedIds = afterPress.map((chapter) => chapter.id);
        expect(afterDrag.map((chapter) => chapter.id)).toEqual(moved(pressedIds, pressedIds.indexOf(movingId), to));
        expect(strictlyRising(afterDrag)).toBe(true);
      }, 30_000);
    }
  }
});
