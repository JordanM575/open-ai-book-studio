import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackendClient, BackendError, locatorPath, resolveBackend } from "../src/backend-client";

/**
 * The toolkit's client, against a real loopback server.
 *
 * Every other test in this package fakes the client, which is right for the CLI: it checks what
 * the command *says*. This one checks what goes over the wire — the path, the method, the body and
 * the bearer token — because those are the parts a fake client cannot get wrong and the studio
 * would never notice until an outside agent used it.
 */

interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
  body: string | null;
}

const recorded: Recorded[] = [];
const cleanups: string[] = [];

let server: ReturnType<typeof Bun.serve>;
let base = "";

const BOOK = "book_wire0001";
const CHAPTER = "ch_wire0001";
const TOKEN = "t".repeat(32);

/** Answers each path the way the studio does, with one deliberate failure per kind. */
function answer(path: string, body: string | null): { status: number; payload: unknown } {
  if (path === "/v1/health") return { status: 200, payload: { ok: true, version: 1, library: null } };
  if (path === "/v1/library") return { status: 200, payload: { library: { root: "/library", deviceId: "dev", deviceName: "Mac" } } };
  if (path === "/v1/books") return { status: 200, payload: { books: [{ id: BOOK, title: "The Salt Road" }] } };
  // A book detail is the book *and* its chapters, which is what the studio returns.
  if (path === `/v1/books/${BOOK}`) return { status: 200, payload: { book: { book: { id: BOOK }, chapters: [] } } };
  if (path === `/v1/books/${BOOK}/chapters/${CHAPTER}`) {
    if (body) return { status: 200, payload: { result: { status: "saved", chapter: { id: CHAPTER } } } };
    return { status: 200, payload: { chapter: { id: CHAPTER, content: "Prose.\n" } } };
  }
  if (path.startsWith(`/v1/books/${BOOK}/search`)) return { status: 200, payload: { hits: [{ line: 1, text: "storm" }] } };
  if (path === `/v1/books/${BOOK}/conflicts`) return { status: 200, payload: { conflicts: [] } };
  if (path === `/v1/books/${BOOK}/chapters` && body) return { status: 201, payload: { chapter: { id: CHAPTER } } };
  if (path === `/v1/books/${BOOK}/tools`) return { status: 200, payload: { tools: [{ name: "read_chapter", tier: "read" }] } };
  if (path === "/v1/tools") return { status: 200, payload: { tools: [{ name: "read_chapter", tier: "read" }] } };
  if (path === `/v1/books/${BOOK}/ambient`) return { status: 200, payload: { ambient: { say: "You're in Chapter One." } } };
  if (path === `/v1/books/${BOOK}/turn`) return { status: 200, payload: { result: { text: "Done.", changed: 1 } } };
  if (path === `/v1/books/${BOOK}/undo`) return { status: 200, payload: { result: { restored: 2, skipped: 0 } } };
  if (path === `/v1/books/${BOOK}/stop`) return { status: 200, payload: { result: { stopped: 1 } } };
  if (path === `/v1/books/${BOOK}/tools/read_chapter`) return { status: 200, payload: { result: { ok: true, message: "Read it." } } };
  // The two failures a client must classify rather than print.
  if (path === "/v1/books/bad_refusal") {
    return { status: 409, payload: { error: { code: "conflict", message: "That chapter changed on disk." } } };
  }
  if (path === "/v1/books/bad_anonymous") return { status: 500, payload: null };
  return { status: 404, payload: { error: { message: `Nothing at ${path}` } } };
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.text() : null;
      recorded.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get("authorization"),
        body
      });
      const { status, payload } = answer(url.pathname, body);
      return new Response(payload === null ? "" : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
      });
    }
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function client(): BackendClient {
  return new BackendClient({ url: base, token: TOKEN });
}

/** The last request the server saw. */
function last(): Recorded {
  const entry = recorded.at(-1);
  if (!entry) throw new Error("nothing was requested");
  return entry;
}

describe("the requests it makes", () => {
  test("sends the token as a bearer header on every call", async () => {
    await client().library();
    expect(last().authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("reads the library, the books and one book", async () => {
    const api = client();
    expect((await api.library())?.deviceName).toBe("Mac");
    expect(await api.books()).toHaveLength(1);
    expect((await api.book(BOOK)).book.id).toBe(BOOK);
    expect(last().path).toBe(`/v1/books/${BOOK}`);
  });

  test("reads a chapter, and saves one with the guard it was given", async () => {
    const api = client();
    expect((await api.chapter(BOOK, CHAPTER)).id).toBe(CHAPTER);
    await api.saveChapter(BOOK, CHAPTER, { content: "New.\n", baseVersion: 4, baseHash: "h" });
    expect(last().method).toBe("POST");
    expect(JSON.parse(last().body ?? "{}")).toEqual({ content: "New.\n", baseVersion: 4, baseHash: "h" });
  });

  test("creates a chapter with what it was given and nothing else", async () => {
    await client().createChapter(BOOK, { title: "Two" });
    expect(JSON.parse(last().body ?? "{}")).toEqual({ title: "Two" });
  });

  test("searches with the query escaped, and adds the limit only when asked", async () => {
    const api = client();
    await api.search(BOOK, "the storm & the light");
    expect(last().path).toContain("q=the+storm+%26+the+light");
    expect(last().path).not.toContain("limit");
    await api.search(BOOK, "storm", 5);
    expect(last().path).toContain("limit=5");
  });

  test("escapes ids rather than pasting them into a path", async () => {
    // The fake server does not serve this book, which is the point: what matters is the path it
    // was asked for, not whether it exists.
    await client()
      .book("../../etc/passwd")
      .catch(() => undefined);
    expect(last().path).toBe("/v1/books/..%2F..%2Fetc%2Fpasswd");
  });

  test("asks for the ambient status and runs a turn", async () => {
    const api = client();
    expect((await api.ambient(BOOK)).say).toContain("Chapter One");
    const turn = await api.turn(BOOK, "carry on");
    expect(turn.text).toBe("Done.");
    expect(JSON.parse(last().body ?? "{}")).toEqual({ prompt: "carry on" });
  });

  test("carries the chapter and the thread when a turn names them", async () => {
    await client().turn(BOOK, "go on", { chapterId: CHAPTER, threadId: "thread_wire0001" });
    expect(JSON.parse(last().body ?? "{}")).toEqual({
      prompt: "go on",
      chapterId: CHAPTER,
      threadId: "thread_wire0001"
    });
  });

  test("undoes and stops", async () => {
    const api = client();
    expect(await api.undoLast(BOOK)).toEqual({ restored: 2, skipped: 0 });
    expect(await api.stop(BOOK)).toEqual({ stopped: 1 });
  });

  test("calls a tool, and sends the destructive permission only when it was given", async () => {
    const api = client();
    await api.callTool(BOOK, "read_chapter", { chapterId: CHAPTER });
    expect(JSON.parse(last().body ?? "{}")).toEqual({ args: { chapterId: CHAPTER } });
    await api.callTool(BOOK, "read_chapter", {}, { allowDestructive: true });
    expect(JSON.parse(last().body ?? "{}")).toEqual({ args: {}, allowDestructive: true });
  });

  test("lists the catalog and the per-book catalogue", async () => {
    const api = client();
    expect((await api.tools())[0]?.name).toBe("read_chapter");
    expect((await api.bookTools(BOOK))[0]?.name).toBe("read_chapter");
    expect(last().path).toBe(`/v1/books/${BOOK}/tools`);
  });

  test("lists conflict copies", async () => {
    expect(await client().conflicts(BOOK)).toEqual([]);
    expect(last().path).toBe(`/v1/books/${BOOK}/conflicts`);
  });

  test("connects the way the CLI asks it to", async () => {
    const connected = await BackendClient.connect({ env: { BOOKWRITER_URL: base, BOOKWRITER_TOKEN: TOKEN } });
    expect((await connected.books())[0]?.id).toBe(BOOK);
  });

  test("reports health without inventing a library", async () => {
    expect(await client().health()).toEqual({ ok: true, version: 1, library: null });
  });
});

describe("what it does when the studio says no", () => {
  test("keeps the studio's own sentence and its code", async () => {
    const failure = (await client()
      .health()
      .catch((error: unknown) => error)) as BackendError;
    void failure;
    const error = await client()
      .book("bad_refusal")
      .then(() => null)
      .catch((caught: unknown) => caught as BackendError);
    expect(error).toBeInstanceOf(BackendError);
    expect(error?.message).toBe("That chapter changed on disk.");
    expect(error?.status).toBe(409);
    expect(error?.code).toBe("conflict");
  });

  test("explains a status with no message in it", async () => {
    const error = await client()
      .book("bad_anonymous")
      .then(() => null)
      .catch((caught: unknown) => caught as BackendError);
    expect(error?.message).toBe("The studio backend returned 500.");
    expect(error?.status).toBe(500);
    expect(error?.code).toBeUndefined();
  });

  test("says the studio is not running rather than leaking a fetch error", async () => {
    const offline = new BackendClient({ url: "http://127.0.0.1:1", token: TOKEN });
    const error = await offline
      .health()
      .then(() => null)
      .catch((caught: unknown) => caught as BackendError);
    expect(error?.message).toContain("Could not reach the studio backend");
    expect(error?.code).toBe("offline");
  });
});

describe("finding the studio", () => {
  test("takes the environment before the locator", async () => {
    const target = await resolveBackend({
      env: { BOOKWRITER_URL: `${base}/`, BOOKWRITER_TOKEN: TOKEN }
    });
    // The trailing slash is dropped, so a path is never doubled.
    expect(target).toEqual({ url: base, token: TOKEN });
  });

  test("refuses half a pair, because half a pair is a mistake", async () => {
    await expect(resolveBackend({ env: { BOOKWRITER_URL: base } })).rejects.toThrow(
      "Both a backend URL and token are required"
    );
  });

  test("reads the owner-only locator the desktop writes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bookwriter-locator-"));
    cleanups.push(folder);
    const path = join(folder, "backend.json");
    await writeFile(path, JSON.stringify({ version: 1, url: base, token: TOKEN }), "utf8");
    expect(await resolveBackend({ env: {}, locatorPath: path })).toEqual({ url: base, token: TOKEN });
  });

  test("says which file is broken when the locator is not JSON", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bookwriter-locator-"));
    cleanups.push(folder);
    const path = join(folder, "backend.json");
    await writeFile(path, "not json", "utf8");
    await expect(resolveBackend({ env: {}, locatorPath: path })).rejects.toThrow(`The backend locator at ${path}`);
  });

  test("refuses a locator from a version it does not know", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bookwriter-locator-"));
    cleanups.push(folder);
    const path = join(folder, "backend.json");
    await writeFile(path, JSON.stringify({ version: 99, url: base, token: TOKEN }), "utf8");
    await expect(resolveBackend({ env: {}, locatorPath: path })).rejects.toThrow("unknown shape");
  });

  test("honours STUDIO_BACKEND_FILE for where to look", async () => {
    expect(locatorPath({ STUDIO_BACKEND_FILE: "/tmp/locator.json" })).toBe("/tmp/locator.json");
    expect(locatorPath({})).toContain(join(".ai-book-studio", "backend.json"));
  });

  test("refuses a URL that is not a loopback http address", async () => {
    await expect(resolveBackend({ env: { BOOKWRITER_URL: "https://studio.example", BOOKWRITER_TOKEN: TOKEN } })).rejects.toThrow(
      "loopback http"
    );
    await expect(resolveBackend({ env: { BOOKWRITER_URL: "http://192.168.1.5:7777", BOOKWRITER_TOKEN: TOKEN } })).rejects.toThrow(
      "loopback http"
    );
    await expect(resolveBackend({ env: { BOOKWRITER_URL: "nonsense", BOOKWRITER_TOKEN: TOKEN } })).rejects.toThrow(
      "not valid"
    );
  });

  test("refuses an empty token", async () => {
    await expect(resolveBackend({ env: { BOOKWRITER_URL: base, BOOKWRITER_TOKEN: "" } })).rejects.toThrow();
  });
});
