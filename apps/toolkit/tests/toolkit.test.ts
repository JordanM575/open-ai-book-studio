import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import type { Chapter } from "@ai-book-studio/core/schema";
import { BackendClient, BackendError, resolveBackend } from "../src/backend-client";
import { runCli } from "../src/cli";
import type { ToolkitClient } from "../src/mcp";

const BOOK = "book_test0001";
const CHAPTER = "ch_test00001";
const HASH = "a".repeat(64);

const chapter: Chapter = {
  id: CHAPTER,
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

function client(): ToolkitClient {
  return {
    library: async () => ({ root: "/library", deviceId: "dev_test0001", deviceName: "Test Mac" }),
    books: async () => [
      {
        id: BOOK,
        title: "The Salt Road",
        description: "",
        stage: "drafting",
        chapterCount: 1,
        wordCount: 2,
        updatedAt: "2026-10-26T12:00:00.000Z"
      }
    ],
    book: async () => ({ book: { id: BOOK } as never, chapters: [chapter] }),
    chapter: async () => chapter,
    search: async () => [],
    conflicts: async () => [],
    createChapter: async () => chapter,
    saveChapter: async () => ({ status: "saved", chapter }),
    tools: async () => [
      {
        name: "read_story_bible",
        description: "Read the full Story Bible.",
        inputSchema: { type: "object", properties: {} },
        tier: "read" as const
      }
    ],
    bookTools: async () => [
      {
        name: "read_story_bible",
        description: "Read the full Story Bible.",
        inputSchema: { type: "object", properties: {} },
        tier: "read" as const
      }
    ],
    callTool: async () => ({ ok: true, message: "ran the tool" })
  };
}

function streams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: new Writable({ write(chunk, _e, cb) { out.push(String(chunk)); cb(); } }),
      stderr: new Writable({ write(chunk, _e, cb) { err.push(String(chunk)); cb(); } }),
      stdin: Readable.from([])
    },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

describe("backend discovery", () => {
  test("takes flags and environment before the locator", async () => {
    expect(
      await resolveBackend({ url: "http://127.0.0.1:1234/", token: "abc", env: {} })
    ).toEqual({ url: "http://127.0.0.1:1234", token: "abc" });
    expect(
      await resolveBackend({ env: { BOOKWRITER_URL: "http://localhost:9", BOOKWRITER_TOKEN: "t" } })
    ).toEqual({ url: "http://localhost:9", token: "t" });
  });

  test("refuses a non-loopback URL", async () => {
    await expect(resolveBackend({ url: "https://example.com", token: "t", env: {} })).rejects.toBeInstanceOf(
      BackendError
    );
  });

  test("reads an owner-only locator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-toolkit-"));
    const path = join(directory, "backend.json");
    await writeFile(path, JSON.stringify({ version: 1, url: "http://127.0.0.1:4321", token: "secret" }));
    try {
      expect(await resolveBackend({ locatorPath: path, env: {} })).toEqual({
        url: "http://127.0.0.1:4321",
        token: "secret"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("explains a missing backend in one sentence", async () => {
    await expect(
      resolveBackend({ locatorPath: "/definitely/not/here/backend.json", env: {} })
    ).rejects.toThrow(/Open the desktop app/);
  });
});

describe("bookwriter CLI", () => {
  test("lists books and prints a chapter", async () => {
    const listing = streams();
    expect(await runCli(["books"], listing.io, async () => client())).toBe(0);
    expect(listing.out()).toContain("The Salt Road");

    const reading = streams();
    expect(await runCli(["read", BOOK, CHAPTER], reading.io, async () => client())).toBe(0);
    expect(reading.out()).toBe("Hello world.\n");
    expect(reading.err()).toContain("version 1");
  });

  test("prints raw JSON with --json", async () => {
    const json = streams();
    expect(await runCli(["books", "--json"], json.io, async () => client())).toBe(0);
    expect(JSON.parse(json.out())).toHaveLength(1);
  });

  test("refuses writes without --allow-writes and requires the checked version", async () => {
    const refused = streams();
    expect(await runCli(["save", BOOK, CHAPTER], refused.io, async () => client())).toBe(1);
    expect(refused.err()).toContain("--allow-writes");

    const noCheck = streams();
    expect(
      await runCli(["save", BOOK, CHAPTER, "--allow-writes", "--stdin"], noCheck.io, async () => client())
    ).toBe(1);
    expect(noCheck.err()).toContain("--base-version");
  });

  test("saves a checked write from stdin", async () => {
    const save = streams();
    save.io.stdin = Readable.from(["New text.\n"]);
    expect(
      await runCli(
        ["save", BOOK, CHAPTER, "--allow-writes", "--stdin", "--base-version", "1", "--base-hash", HASH],
        save.io,
        async () => client()
      )
    ).toBe(0);
    expect(save.out()).toContain("version 1");
  });

  test("turns a backend refusal into a non-zero exit", async () => {
    const refused = streams();
    expect(
      await runCli(["books"], refused.io, async () => {
        throw new BackendError("No AI Book Studio backend found.");
      })
    ).toBe(1);
    expect(refused.err()).toContain("No AI Book Studio backend");
  });
});
