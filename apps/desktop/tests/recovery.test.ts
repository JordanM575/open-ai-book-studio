import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import type { Chapter } from "@ai-book-studio/core/schema";
import { DraftBuffer } from "../src/main/drafts";
import { ExitGuard, exitQuestion } from "../src/main/exit-guard";
import { Library } from "../src/main/library/store";
import { RecoveryStore, restoreKept } from "../src/main/recovery";
import { Studio, type UnsavedDraft } from "../src/main/studio";

/*
 * What happens to the words when a close or quit cannot save them (spec 002 FR-013). The library and
 * the profile are temporary folders side by side, as the app keeps them: the chapter file must stay
 * as it was, the words must land in the profile and never in the library, and they go back only
 * through the checked save.
 */

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Last in, first out: a folder made read-only gets its permissions back before it is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const KEPT_AT = new Date("2026-11-04T07:15:00.000Z");

async function setup() {
  const root = await temp("studio-recovery-library-");
  const profile = await temp("studio-recovery-profile-");
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const one = await library.createChapter(book.id, { title: "One", content: "The tide was out.\n" });
  const two = await library.createChapter(book.id, { title: "Two", content: "Mara walked on.\n" });
  const folder = join(profile, "recovery");
  const store = new RecoveryStore(folder, () => KEPT_AT);
  const drafts = new DraftBuffer();
  // Only the draft and recovery paths are under test; nothing here reads or writes settings.
  const studio = new Studio({} as never, drafts, store);
  studio.library = library;
  return { root, profile, folder, library, store, drafts, studio, bookId: book.id, one, two };
}

function draft(bookId: string, chapter: Chapter, content: string) {
  return { bookId, chapterId: chapter.id, content, baseVersion: chapter.version, baseHash: chapter.hash };
}

function chapterFile(root: string, bookId: string, chapter: Chapter): string {
  return join(root, "books", bookId, "chapters", chapter.path);
}

/** The audit's read-only book folder: files can be read, and nothing new can be written in it. */
async function readOnlyChapters(root: string, bookId: string): Promise<() => Promise<void>> {
  const dir = join(root, "books", bookId, "chapters");
  await chmod(dir, 0o555);
  const writable = () => chmod(dir, 0o755);
  cleanups.push(writable);
  return writable;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
}

/** Run with the expected warnings silenced; returns what was warned. */
async function quietly<T>(run: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const value = await run();
    return { value, warnings: warn.mock.calls.map((args) => args.map(String).join(" ")) };
  } finally {
    warn.mockRestore();
  }
}

describe("the recovery store", () => {
  test("keeps a draft in the profile, owner-only, with what it was typed against and when", async () => {
    const { root, folder, store, bookId, one } = await setup();
    const before = await filesUnder(root);

    const kept = await store.keep(draft(bookId, one, "The tide was out, and the road showed."), "The disk is full.", root);

    const file = join(folder, `${kept.id}.json`);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      id: kept.id,
      bookId,
      chapterId: one.id,
      content: "The tide was out, and the road showed.",
      baseVersion: one.version,
      baseHash: one.hash,
      keptAt: KEPT_AT.toISOString(),
      reason: "The disk is full.",
      libraryRoot: root
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    // Nothing was written into the library.
    expect(await filesUnder(root)).toEqual(before);
  });

  test("an identical draft is kept once, and a different one never replaces the first", async () => {
    const { root, folder, store, bookId, one } = await setup();
    const first = await store.keep(draft(bookId, one, "First words."), "The disk is full.", root);
    const again = await store.keep(draft(bookId, one, "First words."), "The disk is still full.", root);
    const later = await store.keep(draft(bookId, one, "First words, and more."), "The disk is full.", root);

    expect(again.id).toBe(first.id);
    expect(later.id).not.toBe(first.id);
    expect((await readdir(folder)).sort()).toEqual([`${first.id}.json`, `${later.id}.json`].sort());
    expect((await store.read(first.id))?.content).toBe("First words.");
    expect((await store.read(later.id))?.content).toBe("First words, and more.");
  });

  test("lists one book without the text, newest first, and leaves a file that does not read alone", async () => {
    const { root, folder, bookId, one, two } = await setup();
    let now = new Date("2026-11-04T07:00:00.000Z");
    const store = new RecoveryStore(folder, () => now);
    const older = await store.keep(draft(bookId, one, "Older words."), "The disk is full.", root);
    now = new Date("2026-11-04T07:30:00.000Z");
    const newer = await store.keep(draft(bookId, two, `${"Mara walked on. ".repeat(20)}And then the tide came in.`), "The disk is full.", root);
    await store.keep(draft("book_elsewhere01", one, "Another book's words."), "The disk is full.", root);
    await writeFile(join(folder, "rec_0000000000000000.json"), "{ not json");
    await writeFile(join(folder, "notes.txt"), "not a kept copy");

    const { value: listed, warnings } = await quietly(() => store.list(bookId));

    expect(listed.map((entry) => entry.id)).toEqual([newer.id, older.id]);
    expect(listed[1]).toEqual({
      id: older.id,
      bookId,
      chapterId: one.id,
      keptAt: "2026-11-04T07:00:00.000Z",
      reason: "The disk is full.",
      wordCount: 2,
      ending: "Older words."
    });
    expect(listed[0]?.ending.startsWith("…")).toBe(true);
    expect(listed[0]?.ending.endsWith("And then the tide came in.")).toBe(true);
    expect(warnings.join("\n")).toContain("Skipped rec_0000000000000000.json");
    expect(await readFile(join(folder, "rec_0000000000000000.json"), "utf8")).toBe("{ not json");
  });

  test("an id that is not a kept copy's is refused before any path is built", async () => {
    const { store } = await setup();
    await expect(store.read("../studio")).rejects.toThrow("invalid recovery id");
    await expect(store.remove("rec_../../x")).rejects.toThrow("invalid recovery id");
    expect(await store.read("rec_0123456789abcdef")).toBeNull();
    await store.remove("rec_0123456789abcdef");
    expect(await store.all()).toEqual([]);
  });
});

describe("a close or quit that cannot save", () => {
  test("a read-only book folder leaves the chapter file intact and keeps the words in the profile", async () => {
    const { root, folder, library, drafts, studio, bookId, one } = await setup();
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    await readOnlyChapters(root, bookId);
    const before = await readFile(chapterFile(root, bookId, one));

    const { value: unsaved } = await quietly(() => studio.flushDrafts(null));

    expect(unsaved).toHaveLength(1);
    const entry = unsaved[0]!;
    expect(entry.keptId).not.toBeNull();
    expect(entry.reason.length).toBeGreaterThan(0);
    expect(await readFile(chapterFile(root, bookId, one))).toEqual(before);
    expect(await library.listConflicts(bookId)).toEqual([]);
    const kept = await new RecoveryStore(folder).read(entry.keptId!);
    expect(kept).toMatchObject({
      bookId,
      chapterId: one.id,
      content: "The tide was out, and the road showed.",
      baseVersion: one.version,
      baseHash: one.hash,
      reason: entry.reason,
      libraryRoot: root
    });
    // Until the author decides, the words are still held for another try.
    expect(drafts.dirtyChapterIds()).toEqual([one.id]);
  });

  test("a full disk, stubbed at the library, keeps the reason it gave with the words", async () => {
    const { library, drafts, studio, store, bookId, one } = await setup();
    drafts.set(draft(bookId, one, "Words for a full disk."));
    const save = spyOn(library, "saveChapter").mockRejectedValue(
      new LibraryPortError("storage-full", "The disk is full. Nothing was replaced.", true)
    );

    const { value: unsaved } = await quietly(() => studio.flushDrafts(null));

    expect(save).toHaveBeenCalledTimes(1);
    expect(unsaved.map((entry) => entry.reason)).toEqual(["The disk is full. Nothing was replaced."]);
    expect((await store.all()).map((entry) => [entry.content, entry.reason])).toEqual([
      ["Words for a full disk.", "The disk is full. Nothing was replaced."]
    ]);
  });

  test("words that cannot even be kept are reported as not kept, and stay held", async () => {
    const { root, profile, library, drafts, bookId, one } = await setup();
    // The profile has a file where the recovery folder should be, so nothing can be written there.
    await writeFile(join(profile, "blocked"), "a file, not a folder");
    const studio = new Studio({} as never, drafts, new RecoveryStore(join(profile, "blocked", "recovery")));
    studio.library = library;
    drafts.set(draft(bookId, one, "Words with nowhere to go."));
    await readOnlyChapters(root, bookId);

    const { value: unsaved, warnings } = await quietly(() => studio.flushDrafts(null));

    expect(unsaved.map((entry) => entry.keptId)).toEqual([null]);
    expect(warnings.join("\n")).toContain(`[recovery] Could not keep ${bookId}:${one.id}`);
    expect(drafts.dirtyChapterIds()).toEqual([one.id]);
  });

  test("after a relaunch the kept words go back through the checked save", async () => {
    const { root, folder, library, drafts, studio, bookId, one } = await setup();
    drafts.set(draft(bookId, one, "The tide was out, and the road showed."));
    const writable = await readOnlyChapters(root, bookId);
    const { value: unsaved } = await quietly(() => studio.flushDrafts(null));
    studio.letGo(unsaved);
    expect(drafts.size).toBe(0);

    // The next launch: the folder can be written again, and a new store reads the same profile.
    await writable();
    const reopened = await Library.open(root);
    const store = new RecoveryStore(folder);
    const [offered] = await store.list(bookId);
    const result = await restoreKept(store, reopened, offered!.id);

    expect(result.status).toBe("saved");
    expect(await readFile(chapterFile(root, bookId, one), "utf8")).toContain("The tide was out, and the road showed.");
    expect((await reopened.readChapter(bookId, one.id)).version).toBe(one.version + 1);
    expect(await library.listConflicts(bookId)).toEqual([]);
    expect(await store.all()).toEqual([]);
  });

  test("a chapter that changed since keeps the restored words as a conflict copy", async () => {
    const { root, library, store, bookId, two } = await setup();
    const kept = await store.keep(draft(bookId, two, "Mara walked on, salt in her boots."), "The disk is full.", root);
    await library.saveChapter(bookId, two.id, "Mara turned back.\n", { baseVersion: two.version, baseHash: two.hash });

    const result = await restoreKept(store, library, kept.id);

    if (result.status !== "conflict") throw new Error(`expected a conflict, got ${result.status}`);
    expect(await readFile(chapterFile(root, bookId, two), "utf8")).toContain("Mara turned back.");
    expect(await readFile(join(root, result.conflict.savedAs), "utf8")).toContain("Mara walked on, salt in her boots.");
    expect(await store.all()).toEqual([]);
  });

  test("a restore that still cannot write keeps the words where they were", async () => {
    const { root, library, store, bookId, one } = await setup();
    const kept = await store.keep(draft(bookId, one, "Still waiting for space."), "The disk is full.", root);
    await readOnlyChapters(root, bookId);
    const before = await readFile(chapterFile(root, bookId, one));

    await expect(restoreKept(store, library, kept.id)).rejects.toThrow();

    expect(await readFile(chapterFile(root, bookId, one))).toEqual(before);
    expect((await store.read(kept.id))?.content).toBe("Still waiting for space.");
    await expect(restoreKept(store, library, "rec_0123456789abcdef")).rejects.toThrow("already restored or discarded");
  });
});

describe("the question before a close or quit", () => {
  async function failing() {
    const context = await setup();
    context.drafts.set(draft(context.bookId, context.one, "The tide was out, and the road showed."));
    spyOn(context.library, "saveChapter").mockRejectedValue(
      new LibraryPortError("storage-full", "The disk is full. Nothing was replaced.", true)
    );
    return context;
  }

  test("with everything saved, a close goes ahead without a question", async () => {
    const { drafts, studio, bookId, one, root } = await setup();
    drafts.set(draft(bookId, one, "Saved without trouble."));
    const ask = mock(async () => 0);

    expect(await new ExitGuard(studio, { headless: false, ask }).check(null, "close")).toBe("leave");
    expect(ask).not.toHaveBeenCalled();
    expect(await readFile(chapterFile(root, bookId, one), "utf8")).toContain("Saved without trouble.");
  });

  test("the author can keep the studio open, and the words stay held and kept", async () => {
    const { drafts, studio, store } = await failing();
    const ask = mock(async () => 0);

    const { value: choice } = await quietly(() => new ExitGuard(studio, { headless: false, ask }).check(null, "quit"));

    expect(choice).toBe("stay");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(drafts.size).toBe(1);
    expect(await store.all()).toHaveLength(1);
  });

  test("quitting with the words kept lets them go, so the next pass has nothing to ask", async () => {
    const { drafts, studio, store } = await failing();
    const ask = mock(async () => 1);
    const guard = new ExitGuard(studio, { headless: false, ask });

    const { value: choice } = await quietly(() => guard.check(null, "quit"));
    expect(choice).toBe("leave");
    expect(drafts.size).toBe(0);
    // Closing the last window quits on Windows and Linux; that pass finds nothing left.
    expect(await guard.check(null, "quit")).toBe("leave");
    expect(ask).toHaveBeenCalledTimes(1);
    expect((await store.all()).map((entry) => entry.content)).toEqual(["The tide was out, and the road showed."]);
  });

  test("a close and a quit at once ask one question and share its answer", async () => {
    const { studio, store } = await failing();
    let answer: (button: number) => void = () => {};
    const ask = mock(() => new Promise<number>((resolve) => (answer = resolve)));
    const flush = spyOn(studio, "flushDrafts");
    const guard = new ExitGuard(studio, { headless: false, ask });

    const { value: choices } = await quietly(async () => {
      // Cmd+Q while the close question is still open.
      const close = guard.check(null, "close");
      const quit = guard.check(null, "quit");
      while (ask.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      answer(1);
      return Promise.all([close, quit]);
    });

    expect(choices).toEqual(["leave", "leave"]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await store.all()).toHaveLength(1);
    // Once answered, the next close or quit is checked afresh, and finds nothing left to ask about.
    expect(await guard.check(null, "quit")).toBe("leave");
    expect(flush).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test("a hidden run logs the counts and the reason, never the words, and leaves", async () => {
    const { studio, drafts } = await failing();
    const ask = mock(async () => 0);
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { value: choice } = await quietly(() => new ExitGuard(studio, { headless: true, ask }).check(null, "quit"));
      expect(choice).toBe("leave");
      const lines = log.mock.calls.map((args) => args.map(String).join(" "));
      expect(lines).toEqual([
        `[recovery] would ask ${JSON.stringify({ kind: "quit", unsaved: 1, kept: 1, reason: "The disk is full. Nothing was replaced." })}`
      ]);
      expect(lines.join("\n")).not.toContain("the road showed");
    } finally {
      log.mockRestore();
    }
    expect(ask).not.toHaveBeenCalled();
    expect(drafts.size).toBe(0);
  });

  test("the question says what happens to the words, in plain words", () => {
    const draftInput = { bookId: "book_question01", chapterId: "ch_question001", content: "x", baseVersion: 1, baseHash: "a".repeat(64) };
    const kept: UnsavedDraft = { draft: draftInput, reason: "The disk is full. Nothing was replaced.", keptId: "rec_0123456789abcdef" };
    const lost: UnsavedDraft = { ...kept, keptId: null };
    const other: UnsavedDraft = { ...kept, draft: { ...draftInput, chapterId: "ch_question002" } };

    const quit = exitQuestion("quit", [kept]);
    expect(quit.message).toBe("Your latest words are not saved");
    expect(quit.buttons).toEqual(["Keep the studio open", "Quit and keep the words"]);
    expect(quit.detail).toContain("in 1 chapter to your library. The disk is full. Nothing was replaced.");
    expect(quit.detail).toContain("offers them again the next time you open the book");
    expect([quit.defaultId, quit.cancelId]).toEqual([0, 0]);

    const close = exitQuestion("close", [kept, lost, other]);
    expect(close.buttons).toEqual(["Keep the window open", "Close and lose the words"]);
    expect(close.detail).toContain("in 2 chapters to your library.");
    expect(close.detail).toContain("so closing the window now loses them.");

    // A chapter file that went missing, or a renamed library, is never named by the chapter's id.
    const missing = exitQuestion("quit", [{ ...kept, reason: "No chapter ch_question001 in this book." }]);
    expect(missing.detail).toContain(
      "to your library. This chapter's file is not in your library folder. It may have been moved, renamed or deleted."
    );
    expect(missing.detail).not.toContain("ch_question001");
  });
});
