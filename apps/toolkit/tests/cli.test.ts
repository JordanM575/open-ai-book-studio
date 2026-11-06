import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import type { Chapter } from "@ai-book-studio/core/schema";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import { BackendError, type BackendOverrides } from "../src/backend-client";
import { runCli } from "../src/cli";
import type { ToolkitClient } from "../src/mcp";

/**
 * `bookwriter`, command by command.
 *
 * The CLI is the surface an outside agent and a person both use, and it is the one place where a
 * wrong sentence costs an author work: `save` without a base version overwrites prose, and `call`
 * without `--allow-writes` would let a script change a book the author did not offer. So each
 * command's output and each refusal is checked here, against a fake client rather than a network.
 */

const BOOK = "book_cli00001";
const CHAPTER = "ch_cli000001";
const HASH = "b".repeat(64);

const chapter: Chapter = {
  id: CHAPTER,
  title: "The Light",
  order: 1,
  arc: "beginning",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 3,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  content: "The storm came in low.\n",
  path: "0001-the-light.md",
  wordCount: 5,
  hash: HASH
};

const ambient: AmbientStatus = {
  book: { id: BOOK, title: "The Salt Road", stage: "drafting" },
  chapter: { id: CHAPTER, title: "The Light", order: 1, wordCount: 5 },
  progress: { chapters: 1, words: 5, lastOrder: 1 },
  lastChange: null,
  lastSaid: null,
  working: false,
  actions: [
    { id: "read_aloud", label: "Read it aloud", spoken: "read it aloud", available: true },
    { id: "undo", label: "Undo that", spoken: "undo that", available: false }
  ],
  say: "You're in Chapter One, The Light, of The Salt Road. 5 words so far."
};

const tool = {
  name: "read_chapter",
  description: "Read a chapter.\nIt returns the prose.",
  inputSchema: { type: "object" as const, properties: {} },
  tier: "read" as const
};

/** What a command run produced: the exit code, both streams, and what the client was asked. */
interface Run {
  code: number;
  out: string;
  err: string;
  calls: Array<{ method: string; args: unknown[] }>;
  overrides: BackendOverrides | undefined;
}

function streams(input: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: new Writable({
        write(chunk, _encoding, done) {
          out.push(String(chunk));
          done();
        }
      }),
      stderr: new Writable({
        write(chunk, _encoding, done) {
          err.push(String(chunk));
          done();
        }
      }),
      stdin: Readable.from(input.map((line) => Buffer.from(line)))
    },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

async function run(
  argv: string[],
  options: {
    overrides?: Partial<ToolkitClient>;
    error?: Error;
    stdin?: string[];
  } = {}
): Promise<Run> {
  const calls: Run["calls"] = [];
  let overrides: BackendOverrides | undefined;
  const base: ToolkitClient = {
    library: async () => ({ root: "/library", deviceId: "dev_cli00001", deviceName: "Test Mac" }),
    books: async () => [
      {
        id: BOOK,
        title: "The Salt Road",
        description: "",
        stage: "drafting",
        chapterCount: 1,
        wordCount: 5,
        updatedAt: "2026-10-26T12:00:00.000Z"
      }
    ],
    book: async () => ({
      book: { id: BOOK, title: "The Salt Road", description: "A keeper." } as never,
      chapters: [chapter],
      chapterReadIssues: []
    }),
    chapter: async () => chapter,
    search: async () => [],
    conflicts: async () => [],
    createChapter: async () => chapter,
    saveChapter: async () => ({ status: "saved", chapter }),
    tools: async () => [tool],
    bookTools: async () => [tool],
    ambient: async () => ambient,
    undoLast: async () => ({ restored: 1, skipped: 0 }),
    stop: async () => ({ stopped: 0 }),
    turn: async () => ({ turnId: "turn_cli00001", threadId: "thread_cli00001", text: "Tightened it.", changed: 1 }),
    callTool: async () => ({ ok: true, message: "Ran it." })
  };
  const merged = { ...base, ...options.overrides };
  // Record every client call, so the test can tell which verb ran and with what.
  const client = new Proxy(merged, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ method: String(key), args });
        return value.apply(target, args);
      };
    }
  }) as ToolkitClient;

  const capture = streams(options.stdin ?? []);
  const code = await runCli(argv, capture.io, async (given) => {
    overrides = given;
    if (options.error) throw options.error;
    return client;
  });
  return { code, out: capture.out(), err: capture.err(), calls, overrides };
}

describe("usage", () => {
  test("prints the commands and exits zero when asked for help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("bookwriter");
    expect(result.out).toContain("where <bookId>");
    expect(result.out).toContain("undo <bookId>");
  });

  test("prints the commands when given nothing at all", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Commands:");
  });

  test("prints the version", async () => {
    expect((await run(["--version"])).out.trim()).toBe("0.1.0");
  });

  test("names the unknown command and prints the usage", async () => {
    const result = await run(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Unknown command: frobnicate");
    expect(result.err).toContain("Commands:");
  });

  test("refuses a flag with no value rather than treating the next flag as one", async () => {
    const result = await run(["books", "--url", "--json"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--url needs a value");
  });

  test("passes the connection overrides through", async () => {
    const result = await run(["books", "--url", "http://127.0.0.1:9999", "--token", "tok", "--locator", "/tmp/l.json"]);
    expect(result.code).toBe(0);
    expect(result.overrides).toEqual({ url: "http://127.0.0.1:9999", token: "tok", locatorPath: "/tmp/l.json" });
  });
});

describe("reading", () => {
  for (const chapters of [[chapter], []]) {
    test(`a partial ${chapters.length}-chapter text list names the unreadable files and returns nonzero without mutation`, async () => {
      const fileName = "0002-damaged\u001b[31m.md";
      const result = await run(["read", BOOK], { overrides: { book: async () => ({
        book: { id: BOOK, title: "Synthetic book", description: "" } as never,
        chapters, chapterReadIssues: [{ fileName, order: 2, reason: "invalid-format" as const }]
      }) } });
      expect(result.code).toBe(1);
      expect(result.out).toContain("Chapters (readable files only):");
      expect(result.err).toContain("Some chapter files could not be read");
      expect(result.err).toContain(JSON.stringify(fileName));
      expect(result.err).toContain("invalid-format");
      expect(result.err).not.toContain("\u001b");
      expect(result.calls).toEqual([{ method: "book", args: [BOOK] }]);
    });
  }

  test("JSON book reads keep the explicit unreadable-file report and the same payload", async () => {
    const detail = {
      book: { id: BOOK, title: "Synthetic book" } as never,
      chapters: [chapter],
      chapterReadIssues: [{ fileName: "damaged.md", order: null, reason: "unreadable" as const }]
    };
    const result = await run(["read", BOOK, "--json"], { overrides: { book: async () => detail } });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual(detail);
    expect(result.err).toBe("");
  });

  test("a backend that sends no read-issue list is read as a complete book", async () => {
    const result = await run(["read", BOOK], { overrides: { book: async () => ({ book: { id: BOOK, title: "Synthetic book", description: "" } as never, chapters: [chapter] }) as never } });
    expect(result.code).toBe(0);
    expect(result.out).toContain("Chapters:");
  });

  test("describes the open library", async () => {
    const result = await run(["info"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Test Mac · /library");
    expect(result.out).toContain("Device dev_cli00001");
  });

  test("says when no library is open, and fails", async () => {
    const result = await run(["info"], { overrides: { library: async () => null } });
    expect(result.code).toBe(1);
    expect(result.err).toContain("No library is open");
  });

  test("tabulates the books", async () => {
    const result = await run(["books"]);
    expect(result.out).toContain("ID");
    expect(result.out).toContain("The Salt Road");
    expect(result.out).toContain("1");
  });

  test("says a library is empty rather than printing an empty table", async () => {
    const result = await run(["books"], { overrides: { books: async () => [] } });
    expect(result.code).toBe(0);
    expect(result.out).toBe("No books in this library.\n");
  });

  test("reads a book as its title, description and chapter list", async () => {
    const result = await run(["read", BOOK]);
    expect(result.out).toContain("# The Salt Road");
    expect(result.out).toContain("A keeper.");
    expect(result.out).toContain(`${CHAPTER}  The Light (5 words)`);
  });

  test("reads a chapter as its prose, with the version on stderr so a pipe stays clean", async () => {
    const result = await run(["read", BOOK, CHAPTER]);
    expect(result.out).toBe("The storm came in low.\n");
    expect(result.err).toContain(`version 3 · hash ${HASH}`);
  });

  test("searches, and says so when nothing matches", async () => {
    const found = await run(["search", BOOK, "storm"], {
      overrides: {
        search: async () => [{ chapterId: CHAPTER, chapterTitle: "The Light", order: 1, line: 1, text: "The storm" }]
      }
    });
    expect(found.out).toContain("The Light:1");
    const empty = await run(["search", BOOK, "nothing"]);
    expect(empty.out).toBe("No matches.\n");
  });

  test("lists conflict copies, and says when there are none", async () => {
    const one = await run(["conflicts", BOOK], {
      overrides: {
        conflicts: async () => [
          { chapterId: CHAPTER, chapterTitle: "The Light", reason: "changed on disk", savedAs: "conflicts/x.md", createdAt: "" } as never
        ]
      }
    });
    expect(one.out).toContain("The Light · changed on disk · conflicts/x.md");
    const none = await run(["conflicts", BOOK]);
    expect(none.out).toBe("No conflict copies.\n");
  });

  test("prints the raw payload for a script with --json", async () => {
    const result = await run(["read", BOOK, CHAPTER, "--json"]);
    expect(JSON.parse(result.out).id).toBe(CHAPTER);
  });

  test("needs a book id, and says which command wanted one", async () => {
    const result = await run(["read"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("read needs a bookId");
  });
});

describe("writing", () => {
  test("refuses create-chapter and call without --allow-writes", async () => {
    expect((await run(["create-chapter", BOOK])).err).toContain("create-chapter requires --allow-writes");
    expect((await run(["call", BOOK, "read_chapter"])).err).toContain("call requires --allow-writes");
    expect((await run(["save", BOOK, CHAPTER])).err).toContain("save requires --allow-writes");
  });

  test("creates a chapter from a file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bookwriter-cli-"));
    const file = join(folder, "chapter.md");
    await writeFile(file, "A new first line.\n", "utf8");
    const result = await run(["create-chapter", BOOK, "--title", "Two", "--content-file", file, "--allow-writes"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Created ${CHAPTER}`);
    expect(result.calls.find((call) => call.method === "createChapter")?.args[1]).toEqual({
      title: "Two",
      content: "A new first line.\n"
    });
  });

  test("creates a chapter from stdin", async () => {
    const result = await run(["create-chapter", BOOK, "--stdin", "--allow-writes"], { stdin: ["From the pipe.\n"] });
    expect(result.code).toBe(0);
    expect(result.calls.find((call) => call.method === "createChapter")?.args[1]).toEqual({
      content: "From the pipe.\n"
    });
  });

  test("refuses both sources at once", async () => {
    const result = await run(["create-chapter", BOOK, "--stdin", "--content-file", "/tmp/x", "--allow-writes"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not both");
  });

  test("refuses a save with no content", async () => {
    const result = await run(["save", BOOK, CHAPTER, "--allow-writes"]);
    expect(result.err).toContain("save needs --content-file <path> or --stdin");
  });

  test("refuses a save without a base version, because guessing overwrites prose", async () => {
    const result = await run(["save", BOOK, CHAPTER, "--stdin", "--allow-writes"], { stdin: ["New.\n"] });
    expect(result.code).toBe(1);
    expect(result.err).toContain("--base-version and --base-hash");
    expect(result.calls.some((call) => call.method === "saveChapter")).toBe(false);
  });

  test("refuses a base version that is not a version", async () => {
    const result = await run(
      ["save", BOOK, CHAPTER, "--stdin", "--base-version", "v3", "--base-hash", HASH, "--allow-writes"],
      { stdin: ["New.\n"] }
    );
    expect(result.err).toContain("--base-version must be a non-negative integer");
  });

  test("saves with the version and hash it was given", async () => {
    const result = await run(
      ["save", BOOK, CHAPTER, "--stdin", "--base-version", "3", "--base-hash", HASH, "--allow-writes"],
      { stdin: ["New line.\n"] }
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("Saved");
    expect(result.calls.find((call) => call.method === "saveChapter")?.args[2]).toEqual({
      content: "New line.\n",
      baseVersion: 3,
      baseHash: HASH
    });
  });

  test("a conflict exits 2 and names where the author's text went", async () => {
    const result = await run(
      ["save", BOOK, CHAPTER, "--stdin", "--base-version", "3", "--base-hash", HASH, "--allow-writes"],
      {
        stdin: ["New.\n"],
        overrides: {
          saveChapter: async () => ({
            status: "conflict",
            conflict: { chapterTitle: "The Light", reason: "changed on disk", savedAs: "conflicts/one.md" } as never
          })
        }
      }
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain("Not saved: changed on disk");
    expect(result.err).toContain("conflicts/one.md");
  });
});

describe("the tools and the session", () => {
  test("tabulates the writing tools", async () => {
    const result = await run(["tools"]);
    expect(result.out).toContain("NAME");
    expect(result.out).toContain("read_chapter");
    expect(result.out).toContain("Read a chapter.");
  });

  test("renders the tools for a connector and for WebMCP", async () => {
    const connector = await run(["tools", "--format", "connector"]);
    expect(connector.code).toBe(0);
    expect(JSON.parse(connector.out)).toBeDefined();
    const webmcp = await run(["tools", "--format", "webmcp"]);
    expect(webmcp.code).toBe(0);
    expect(JSON.parse(webmcp.out)).toBeDefined();
  });

  test("refuses a format it does not have", async () => {
    const result = await run(["tools", "--format", "yaml"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--format must be json, webmcp or connector");
  });

  test("says a studio exposes no tools rather than printing an empty table", async () => {
    const result = await run(["tools"], { overrides: { tools: async () => [] } });
    expect(result.out).toBe("This studio exposes no writing tools.\n");
  });

  test("says where the author is, and only the actions that are available", async () => {
    const result = await run(["where", BOOK]);
    expect(result.out).toContain("You're in Chapter One");
    expect(result.out).toContain("Read it aloud");
    // Undo is listed but unavailable, so it is not offered as something to say.
    expect(result.out).not.toContain("Undo that");
  });

  test("asks the agent and prints its answer", async () => {
    const result = await run(["ask", BOOK, "carry", "on"]);
    expect(result.out).toBe("Tightened it.\n");
    expect(result.calls.find((call) => call.method === "turn")?.args[1]).toBe("carry on");
  });

  test("undoes, and pluralises what it restored", async () => {
    const one = await run(["undo", BOOK]);
    expect(one.out).toBe("Restored 1 chapter.\n");
    const many = await run(["undo", BOOK], { overrides: { undoLast: async () => ({ restored: 3, skipped: 1 }) } });
    expect(many.out).toBe("Restored 3 chapters, skipped 1.\n");
    const none = await run(["undo", BOOK], { overrides: { undoLast: async () => ({ restored: 0, skipped: 0 }) } });
    expect(none.out).toBe("There was nothing to restore.\n");
  });

  test("undo prints each note naming a chapter that did not simply go back", async () => {
    const noted = await run(["undo", BOOK], {
      overrides: {
        undoLast: async () => ({
          restored: 1,
          skipped: 1,
          notes: ["“The Gate” changed during or after the turn, so undo left it as it is."]
        })
      }
    });
    expect(noted.out).toBe(
      "Restored 1 chapter, skipped 1.\n“The Gate” changed during or after the turn, so undo left it as it is.\n"
    );
  });

  test("calls a tool with the arguments it was given, and only asks for destructive permission when told", async () => {
    const plain = await run(["call", BOOK, "read_chapter", "--args", '{"chapterId":"ch_cli000001"}', "--allow-writes"]);
    expect(plain.code).toBe(0);
    const call = plain.calls.find((entry) => entry.method === "callTool");
    expect(call?.args[1]).toBe("read_chapter");
    expect(call?.args[2]).toEqual({ chapterId: CHAPTER });
    expect(call?.args[3]).toEqual({});

    const destructive = (await run(["call", BOOK, "delete_chapter", "--allow-destructive"])).calls.find(
      (entry) => entry.method === "callTool"
    );
    expect(destructive?.args[3]).toEqual({ allowDestructive: true });
  });

  test("refuses arguments that are not a JSON object", async () => {
    expect((await run(["call", BOOK, "x", "--args", "nope", "--allow-writes"])).err).toContain(
      "--args must be a JSON object"
    );
    expect((await run(["call", BOOK, "x", "--args", "[1,2]", "--allow-writes"])).err).toContain(
      "--args must be a JSON object"
    );
  });

  test("starts the MCP server and says what it permits", async () => {
    const readOnly = await run(["mcp"]);
    expect(readOnly.err).toContain("(read-only)");
    const writes = await run(["mcp", "--allow-writes"]);
    expect(writes.err).toContain("(writes enabled)");
    const all = await run(["mcp", "--allow-destructive"]);
    expect(all.err).toContain("(destructive tools enabled)");
  });
});

describe("a backend that refuses", () => {
  test("prints the studio's sentence, not a stack trace", async () => {
    const result = await run(["books"], { error: new BackendError("The studio is not open.", 503) });
    expect(result.code).toBe(1);
    expect(result.err).toBe("The studio is not open.\n");
  });

  test("tells the author to reopen the app when the token has gone stale", async () => {
    const result = await run(["books"], { error: new BackendError("Unauthorized.", 401) });
    expect(result.err).toContain("Quit and reopen Open Book Studio");
  });

  test("does not print the token hint for an ordinary failure", async () => {
    const result = await run(["books"], { error: new BackendError("Bad request.", 400) });
    expect(result.err).not.toContain("reopen");
  });
});
