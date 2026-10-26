import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Library } from "../src/main/library/store";
import { LocalBackend } from "../src/main/backend";
import { BackendClient } from "../../toolkit/src/backend-client";

let directory = "";
let library: Library;
let backend: LocalBackend;
let client: BackendClient;
let bookId = "";
let chapterId = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-toolkit-e2e-"));
  library = await Library.open(directory);
  const book = await library.createBook({ title: "Toolkit Book", description: "End-to-end" });
  const chapter = await library.createChapter(book.id, { title: "One", content: "First text.\n" });
  bookId = book.id;
  chapterId = chapter.id;

  backend = new LocalBackend(
    {
      current: () => ({ root: library.root, deviceId: library.deviceId, deviceName: library.deviceName }),
      requireLibrary: () => library
    },
    { locatorPath: join(directory, "backend.json"), token: "integration-token", port: 0 }
  );
  const started = await backend.start();
  client = new BackendClient({ url: started.url, token: started.token });
});

afterAll(async () => {
  await backend.stop();
  await rm(directory, { recursive: true, force: true });
});

describe("toolkit against a real library", () => {
  test("lists the book and reads the chapter", async () => {
    const books = await client.books();
    expect(books.map((book) => book.id)).toContain(bookId);
    const chapter = await client.chapter(bookId, chapterId);
    expect(chapter.content).toBe("First text.\n");
  });

  test("saves with the real version and hash, then reports a stale write as a conflict", async () => {
    const chapter = await client.chapter(bookId, chapterId);
    const saved = await client.saveChapter(bookId, chapterId, {
      content: "Revised text.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(saved.status).toBe("saved");
    expect((await client.chapter(bookId, chapterId)).content).toBe("Revised text.\n");

    const stale = await client.saveChapter(bookId, chapterId, {
      content: "Stale text.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(stale.status).toBe("conflict");
    if (stale.status === "conflict") expect(stale.conflict.reason).toBe("newer-version");
  });

  test("searches the real library through the backend", async () => {
    const hits = await client.search(bookId, "Revised");
    expect(hits.some((hit) => hit.chapterId === chapterId)).toBe(true);
  });
});
