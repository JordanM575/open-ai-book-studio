import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFT_FLUSH_CHANNEL } from "@ai-book-studio/core/ipc";
import type { Chapter } from "@ai-book-studio/core/schema";
import { DraftBuffer } from "../src/main/drafts";
import { Library } from "../src/main/library/store";
import { createFlushRequests } from "../src/preload/flush-requests";

/*
 * The draft buffer is the safety net for the last seconds of typing: closing the window or quitting
 * flushes it through the same checked save the editor uses. These tests read the result from disk.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "studio-drafts-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const one = await library.createChapter(book.id, { title: "One", content: "The tide was out.\n" });
  const two = await library.createChapter(book.id, { title: "Two", content: "Mara walked on.\n" });
  return { root, library, bookId: book.id, one, two };
}

function draft(bookId: string, chapter: Chapter, content: string) {
  return { bookId, chapterId: chapter.id, content, baseVersion: chapter.version, baseHash: chapter.hash };
}

async function onDisk(root: string, bookId: string, chapter: Chapter): Promise<string> {
  return readFile(join(root, "books", bookId, "chapters", chapter.path), "utf8");
}

describe("draft buffer", () => {
  test("holds the newest text per chapter and names the chapters with unsaved text", async () => {
    const { bookId, one, two } = await setup();
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "The tide was out"));
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    drafts.set(draft(bookId, two, "Mara walked on, salt in her boots."));
    expect(drafts.size).toBe(2);
    expect(drafts.dirtyChapterIds()).toEqual([one.id, two.id]);

    drafts.clear(bookId, one.id);
    expect(drafts.size).toBe(1);
    expect(drafts.dirtyChapterIds()).toEqual([two.id]);
  });

  test("flushing one chapter saves the newest text to its file and lets the draft go", async () => {
    const { root, library, bookId, one, two } = await setup();
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    drafts.set(draft(bookId, two, "Mara walked on."));

    const result = await drafts.flushOne(library, bookId, one.id);
    expect(result?.status).toBe("saved");
    expect(await onDisk(root, bookId, one)).toContain("The tide was out, and the road showed.");
    expect((await library.readChapter(bookId, one.id)).version).toBe(one.version + 1);
    // Only the chapter asked for is flushed; the other draft is still held.
    expect(drafts.dirtyChapterIds()).toEqual([two.id]);
    expect(await drafts.flushOne(library, bookId, one.id)).toBeNull();
  });

  test("a draft that already matches the file is let go without rewriting it", async () => {
    const { root, library, bookId, one } = await setup();
    const before = await onDisk(root, bookId, one);
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "The tide was out."));

    const result = await drafts.flushOne(library, bookId, one.id);
    expect(result).toEqual({ status: "saved", chapter: await library.readChapter(bookId, one.id) });
    expect(await onDisk(root, bookId, one)).toBe(before);
    expect(drafts.size).toBe(0);
  });

  test("a draft older than the file becomes a conflict copy, and the newer text stays", async () => {
    const { root, library, bookId, one } = await setup();
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "My version of the tide."));
    // Another writer saves first, from the same base.
    const other = await library.saveChapter(bookId, one.id, "Their version of the tide.", {
      baseVersion: one.version,
      baseHash: one.hash
    });
    expect(other.status).toBe("saved");

    const result = await drafts.flushOne(library, bookId, one.id);
    if (result?.status !== "conflict") throw new Error(`expected a conflict, got ${result?.status}`);
    expect(await onDisk(root, bookId, one)).toContain("Their version of the tide.");
    expect(await readFile(join(root, result.conflict.savedAs), "utf8")).toContain("My version of the tide.");
    expect(await library.listConflicts(bookId)).toHaveLength(1);
    expect(drafts.size).toBe(0);
  });

  test("on quit every draft is flushed, and one that cannot be saved is kept and reported", async () => {
    const { root, library, bookId, one, two } = await setup();
    const gone = await library.createChapter(bookId, { title: "Three", content: "Draft me.\n" });
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    drafts.set(draft(bookId, two, "Mara walked on."));
    drafts.set(draft(bookId, gone, "Text for a chapter that was deleted."));
    await library.deleteChapter(bookId, gone.id);
    const unchanged = await onDisk(root, bookId, two);

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await drafts.flush(library);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(`[drafts] Could not flush ${bookId}:${gone.id}`);
    } finally {
      warn.mockRestore();
    }

    expect(await onDisk(root, bookId, one)).toContain("The tide was out, and the road showed.");
    expect(await onDisk(root, bookId, two)).toBe(unchanged);
    // The text that could not be saved is still held rather than dropped.
    expect(drafts.dirtyChapterIds()).toEqual([gone.id]);
  });
});

describe("flush before a close or quit", () => {
  /** A window whose page answers through the preload bridge's flush requests. */
  function windowFor(drafts: DraftBuffer, handlers: Array<() => Promise<unknown>>, sent: string[] = []) {
    const requests = createFlushRequests((requestId) => drafts.answered(requestId));
    for (const handler of handlers) requests.subscribe(handler);
    return {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, request: { requestId: string }) => {
        sent.push(channel);
        void requests.handle(request.requestId);
      }
    };
  }

  test("asks the window for its newest text, waits for it, then saves every held draft", async () => {
    const { root, library, bookId, one, two } = await setup();
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, two, "Mara walked on, salt in her boots."));
    const sent: string[] = [];
    // The editor's answer: its newest words, saved through the normal checked path.
    const editor = async () =>
      library.saveChapter(bookId, one.id, "The tide was out, and the road showed.", { baseVersion: one.version, baseHash: one.hash });

    await drafts.flushBeforeExit(library, windowFor(drafts, [editor], sent));

    expect(sent).toEqual([DRAFT_FLUSH_CHANNEL]);
    expect(await onDisk(root, bookId, one)).toContain("The tide was out, and the road showed.");
    expect(await onDisk(root, bookId, two)).toContain("Mara walked on, salt in her boots.");
    expect(drafts.size).toBe(0);
  });

  test("a window that never answers costs the timeout, and the drafts already held are saved", async () => {
    const { root, library, bookId, one } = await setup();
    const drafts = new DraftBuffer();
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    const silent = { isDestroyed: () => false, isCrashed: () => false, send: () => {} };

    const started = Date.now();
    expect(await drafts.requestNewest(silent, 120)).toBe("timed-out");
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await drafts.flushBeforeExit(library, silent, 120);
    expect(await onDisk(root, bookId, one)).toContain("The tide was out, and the road showed.");
  });

  test("a closed or crashed window is not asked, and a page with nothing open answers at once", async () => {
    const drafts = new DraftBuffer();
    const sent: string[] = [];
    const gone = { isDestroyed: () => true, isCrashed: () => false, send: () => sent.push("gone") };
    const crashed = { isDestroyed: () => false, isCrashed: () => true, send: () => sent.push("crashed") };
    expect(await drafts.requestNewest(gone)).toBe("no-window");
    expect(await drafts.requestNewest(crashed)).toBe("no-window");
    expect(await drafts.requestNewest(null)).toBe("no-window");
    expect(sent).toEqual([]);

    const started = Date.now();
    expect(await drafts.requestNewest(windowFor(drafts, []))).toBe("answered");
    expect(Date.now() - started).toBeLessThan(100);
  });

  test("an editor whose save fails still lets the quit go on", async () => {
    const drafts = new DraftBuffer();
    const failing = async () => {
      throw new Error("The disk is full.");
    };
    const throwing = () => {
      throw new Error("Not even a promise.");
    };
    expect(await drafts.requestNewest(windowFor(drafts, [failing, throwing as () => Promise<unknown>]))).toBe("answered");
  });
});
