import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BookDetail, BookSummary, Chapter, SearchHit } from "@ai-book-studio/core/schema";
import { bookSchema } from "@ai-book-studio/core/schema";
import { LocalBackend, type BackendLibrary, type BackendSource } from "../src/main/backend";

const ROOT = "/tmp/ai-book-studio-backend-test";
const BOOK_ID = "book_test0001";
const CHAPTER_ID = "ch_test00001";
const HASH = "a".repeat(64);

const book: BookSummary = {
  id: BOOK_ID,
  title: "The Salt Road",
  description: "",
  stage: "drafting",
  chapterCount: 1,
  wordCount: 2,
  updatedAt: "2026-10-26T12:00:00.000Z"
};

const chapter: Chapter = {
  id: CHAPTER_ID,
  title: "One",
  order: 1,
  arc: "beginning",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 1,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  content: "Hello world.\n",
  path: "0001-one.md",
  wordCount: 2,
  hash: HASH
};

const detail: BookDetail = {
  book: bookSchema.parse({
    id: BOOK_ID,
    title: "The Salt Road",
    description: "",
    stage: "drafting",
    createdAt: "2026-10-26T12:00:00.000Z",
    updatedAt: "2026-10-26T12:00:00.000Z"
  }),
  chapters: [chapter],
  chapterReadIssues: []
};

const hit: SearchHit = {
  chapterId: CHAPTER_ID,
  chapterTitle: "One",
  order: 1,
  line: 1,
  text: "Hello world."
};

let directory = "";
let locator = "";
let backend: LocalBackend;
let url = "";
let token = "";
let saves: Array<{ bookId: string; chapterId: string; content: string; baseVersion: number; baseHash: string }> = [];
let creates: Array<{
  bookId: string;
  input: { title?: string | undefined; content?: string | undefined };
}> = [];

const library: BackendLibrary = {
  listBooks: async () => [book],
  readBook: async () => detail,
  readChapter: async () => chapter,
  createChapter: async (bookId, input) => {
    creates.push({ bookId, input });
    return { ...chapter, id: "ch_test00002", title: input.title ?? "Two", content: input.content ?? "" };
  },
  saveChapter: async (bookId, chapterId, content, expected) => {
    saves.push({ bookId, chapterId, content, ...expected });
    if (content === "conflict") {
      return {
        status: "conflict",
        conflict: {
          bookId,
          chapterId,
          chapterTitle: "One",
          savedAs: "books/book_test0001/conflicts/0001-one.conflict-external-edit.md",
          reason: "external-edit",
          diskVersion: 2,
          localVersion: 2
        }
      };
    }
    return { status: "saved", chapter: { ...chapter, version: 2, content, hash: "b".repeat(64) } };
  },
  search: async () => [hit],
  listConflicts: async () => []
};

const source: BackendSource = {
  current: () => ({ root: ROOT, deviceId: "dev_test0001", deviceName: "Test Mac" }),
  requireLibrary: () => library
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-backend-"));
  locator = join(directory, "backend.json");
  backend = new LocalBackend(source, { locatorPath: locator, token: "test-token", port: 0 });
  const started = await backend.start();
  url = started.url;
  token = started.token;
});

afterAll(async () => {
  await backend.stop();
  await rm(directory, { recursive: true, force: true });
});

async function call(path: string, init: RequestInit = {}, auth = `Bearer ${token}`) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
}

describe("local backend", () => {
  test("writes an owner-only locator and removes it on stop", async () => {
    const contents = JSON.parse(await readFile(locator, "utf8")) as { url: string; token: string; libraryRoot: string };
    expect(contents).toMatchObject({ url, token, libraryRoot: ROOT });
    const mode = (await stat(locator)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("refuses a missing or wrong token", async () => {
    expect((await fetch(`${url}/v1/health`)).status).toBe(401);
    expect((await call("/v1/health", {}, "Bearer wrong")).status).toBe(401);
  });

  test("refuses browser origins", async () => {
    const response = await call("/v1/books", { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("lists books and reads a chapter", async () => {
    const books = await call("/v1/books");
    expect(books.status).toBe(200);
    expect(await books.json()).toEqual({ books: [book] });
    const read = await call(`/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}`);
    expect(await read.json()).toEqual({ chapter });
  });

  test("searches and creates a chapter", async () => {
    const search = await call(`/v1/books/${BOOK_ID}/search?q=hello`);
    expect(await search.json()).toEqual({ hits: [hit] });
    const created = await call(`/v1/books/${BOOK_ID}/chapters`, {
      method: "POST",
      body: JSON.stringify({ title: "Two" })
    });
    expect(created.status).toBe(201);
    expect(creates.at(-1)).toEqual({ bookId: BOOK_ID, input: { title: "Two" } });
  });

  test("forwards a checked save and returns a conflict unchanged", async () => {
    const saved = await call(`/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}`, {
      method: "POST",
      body: JSON.stringify({ content: "New text.\n", baseVersion: 1, baseHash: HASH })
    });
    expect(saved.status).toBe(200);
    expect(saves.at(-1)).toEqual({
      bookId: BOOK_ID,
      chapterId: CHAPTER_ID,
      content: "New text.\n",
      baseVersion: 1,
      baseHash: HASH
    });
    const conflict = await call(`/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}`, {
      method: "POST",
      body: JSON.stringify({ content: "conflict", baseVersion: 1, baseHash: HASH })
    });
    const conflictBody = (await conflict.json()) as { result: { status: string } };
    expect(conflictBody.result.status).toBe("conflict");
  });

  test("rejects malformed bodies, unknown routes and an oversized body", async () => {
    const malformed = await call(`/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}`, {
      method: "POST",
      body: "{not json"
    });
    expect(malformed.status).toBe(400);
    expect((await call("/v1/nope")).status).toBe(404);
    const oversized = await call(`/v1/books/${BOOK_ID}/chapters/${CHAPTER_ID}`, {
      method: "POST",
      body: JSON.stringify({ content: "x".repeat(20 * 1024 * 1024 + 2048), baseVersion: 1, baseHash: HASH })
    });
    expect(oversized.status).toBe(413);
  });

  test("reports no library as a conflict with the studio", async () => {
    const closed = new LocalBackend(
      { current: () => null, requireLibrary: () => { throw new Error("No library is open."); } },
      { locatorPath: join(directory, "other.json"), token: "other-token", port: 0 }
    );
    const started = await closed.start();
    try {
      const response = await fetch(`${started.url}/v1/books`, {
        headers: { authorization: `Bearer ${started.token}` }
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "no-library" } });
    } finally {
      await closed.stop();
    }
  });
});
