import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "../src/main/agent/checkpoints";
import { atomicTempName, isAtomicTempName } from "../src/main/library/atomic";
import { ChangeBatcher } from "../src/main/library/changes";
import { asOtherWriter } from "../src/main/library/own-writes";
import { Library } from "../src/main/library/store";

/*
 * The library watcher announces another writer's changes and never the studio's own. These run the
 * real recursive watch over a temporary folder, so the events are the ones the operating system
 * sends, temp files and renames included.
 */

const QUIET_MS = 250;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, what: string, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await delay(25);
  }
}

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

async function watched() {
  const root = await mkdtemp(join(tmpdir(), "studio-own-writes-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  const one = await library.createChapter(book.id, { title: "One", content: "The tide was out.\n" });
  const two = await library.createChapter(book.id, { title: "Two", content: "Mara walked on.\n" });
  const batches: string[][] = [];
  const changes = new ChangeBatcher(library.root, (event) => batches.push(event.paths), QUIET_MS);
  const stop = library.watch((path) => changes.add(path));
  cleanups.push(() => {
    stop();
    changes.stop();
  });
  // fs.watch is armed asynchronously, and the first events can replay the setup writes above.
  await delay(400);
  return { root, library, bookId: book.id, one, two, batches };
}

describe("the library watcher", () => {
  test("stays quiet for the studio's own writes: a save, the Story Bible, a conversation, a checkpoint, an image, the trash and a deleted book", async () => {
    const { root, library, bookId, one, batches } = await watched();

    await library.saveChapter(bookId, one.id, "The tide was out, and the road showed.\n", {
      baseVersion: one.version,
      baseHash: one.hash
    });
    await library.updateBook(bookId, { genres: ["Literary"] });
    const thread = await library.threads.create(bookId, "A short conversation");
    await library.threads.rename(bookId, thread.id, "The gulls");
    const checkpoints = new CheckpointStore(root);
    const file = await checkpoints.save({ turnId: "turn_own000001", bookId, at: new Date().toISOString(), prompt: "Add gulls.", entries: [] });
    await checkpoints.remove(bookId, file);
    const image = await library.addImage(bookId, { bytes: TINY_PNG, kind: "chapter", prompt: "A lamp", provider: "fixture", model: "small" });
    await library.attachImage(bookId, image.id, one.id);
    const three = await library.createChapter(bookId, { title: "Three", content: "Short.\n" });
    await library.deleteChapter(bookId, three.id);
    const spare = await library.createBook({ title: "A spare book" });
    await library.createChapter(spare.id, { title: "Only", content: "Gone soon.\n" });
    await library.deleteBook(spare.id);

    await delay(QUIET_MS + 1200);
    expect(batches).toEqual([]);
  });

  test("announces another writer's edit 0.8 s after a local save, with that path alone", async () => {
    const { root, library, bookId, one, two, batches } = await watched();

    await library.saveChapter(bookId, one.id, "The tide was out, and the road showed.\n", {
      baseVersion: one.version,
      baseHash: one.hash
    });
    await delay(800);
    await writeFile(join(root, "books", bookId, "chapters", two.path), "Mara walked on.\n\nA paragraph from another writer.\n", "utf8");

    await until(() => batches.length > 0, "the outside edit");
    await delay(QUIET_MS + 400);
    expect(batches).toEqual([[`books/${bookId}/chapters/${two.path}`]]);
  });

  test("announces a file another writer deleted", async () => {
    const { root, bookId, two, batches } = await watched();

    await unlink(join(root, "books", bookId, "chapters", two.path));

    await until(() => batches.length > 0, "the outside deletion");
    expect(batches.flat()).toContain(`books/${bookId}/chapters/${two.path}`);
  });

  test("announces a save the studio made for the toolkit or the phone, which the window did not see", async () => {
    const { library, bookId, one, batches } = await watched();

    await asOtherWriter(() =>
      library.saveChapter(bookId, one.id, "The tide was out, said the toolkit.\n", {
        baseVersion: one.version,
        baseHash: one.hash
      })
    );

    await until(() => batches.length > 0, "the toolkit's save");
    await delay(QUIET_MS + 400);
    expect(batches).toEqual([[`books/${bookId}/chapters/${one.path}`]]);
  });

  test("never reports the studio's atomic temp files", async () => {
    const name = atomicTempName("0001-one.md", 4242, 1_762_300_000_000);
    expect(name).toBe(".0001-one.md.4242.mhl7x2ps.tmp");
    expect(isAtomicTempName(name)).toBe(true);
    expect(isAtomicTempName(atomicTempName("book.json"))).toBe(true);
    for (const other of ["0001-one.md", "notes.tmp", ".0001-one.md.tmp", ".0001-one.md.pid.mhl7x2ps.tmp", ".0001-one.md.4242.MHJN.tmp", "0001-one.md.4242.mhl7x2ps.tmp"]) {
      expect(isAtomicTempName(other)).toBe(false);
    }

    const root = await mkdtemp(join(tmpdir(), "studio-own-writes-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const batches: string[][] = [];
    const changes = new ChangeBatcher(root, (event) => batches.push(event.paths), QUIET_MS);
    cleanups.push(() => changes.stop());
    changes.add(`books/book_own000001/chapters/${name}`);
    await delay(QUIET_MS + 200);
    expect(batches).toEqual([]);
  });
});
