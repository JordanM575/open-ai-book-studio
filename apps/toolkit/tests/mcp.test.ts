import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import type { ToolDescriptor } from "@ai-book-studio/core/agent/tools";
import type { Chapter, SaveChapterResult } from "@ai-book-studio/core/schema";
import { bookSchema } from "@ai-book-studio/core/schema";
import { McpServer, serveMcp, type ToolkitClient } from "../src/mcp";

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

const catalog: ToolDescriptor[] = [
  {
    name: "read_story_bible",
    description: "Read the full Story Bible.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    tier: "read"
  },
  {
    name: "append_to_chapter",
    description: "Add a passage to the end of a chapter.",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "string" }, text: { type: "string" } },
      required: ["chapterId", "text"],
      additionalProperties: false
    },
    tier: "write"
  },
  {
    name: "overwrite_chapter",
    description: "Replace a chapter's entire text in one call.",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "string" }, content: { type: "string" } },
      required: ["chapterId", "content"],
      additionalProperties: false
    },
    tier: "destructive"
  }
];

const ambientStatus = {
  book: { id: BOOK, title: "The Salt Road", stage: "drafting" },
  chapter: { id: CHAPTER, title: "One", order: 1, wordCount: 2 },
  progress: { chapters: 1, words: 2, lastOrder: 1 },
  lastChange: null,
  lastSaid: null,
  working: false,
  actions: [],
  say: "You're in Chapter One of The Salt Road."
};

const turnResult = {
  turnId: "turn_test0001",
  threadId: "thread_test0001",
  text: "I tightened the opening.",
  changed: 0
};

function client(): ToolkitClient {
  return {
    library: async () => ({ root: "/library", deviceId: "dev_test0001", deviceName: "Test Mac" }),
    books: async () => [],
    book: async () => ({
      book: bookSchema.parse({
        id: BOOK,
        title: "The Salt Road",
        createdAt: "2026-10-26T12:00:00.000Z",
        updatedAt: "2026-10-26T12:00:00.000Z"
      }),
      chapters: [chapter]
    }),
    chapter: async () => chapter,
    search: async () => [],
    conflicts: async () => [],
    createChapter: async () => chapter,
    saveChapter: async () => ({ status: "saved", chapter }) satisfies SaveChapterResult,
    tools: async () => catalog,
    bookTools: async () => catalog,
    ambient: async () => ambientStatus,
    undoLast: async () => ({ restored: 1, skipped: 0 }),
    stop: async () => ({ stopped: 1 }),
    turn: async () => turnResult,
    callTool: async (_bookId, name, args) => ({ ok: true, message: `ran ${name}`, args })
  };
}

async function call(server: McpServer, method: string, params: unknown, id: number | string = 1) {
  const response = await server.handle({ jsonrpc: "2.0", id, method, params });
  return response as { result?: any; error?: { code: number; message: string } };
}

describe("MCP server", () => {
  test("initializes, pings and lists the studio's read tools", async () => {
    const server = new McpServer(client());
    const initialized = await call(server, "initialize", { protocolVersion: "2025-06-18" });
    expect(initialized.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "ai-book-studio" }
    });
    expect((await call(server, "ping", {})).result).toEqual({});
    const tools = (await call(server, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual([
      "library_info",
      "list_books",
      "list_conflicts",
      "studio_status",
      "read_story_bible"
    ]);
  });

  test("mirrors a studio tool with the book it works on as an argument", async () => {
    const server = new McpServer(client());
    const tools = (await call(server, "tools/list", {})).result.tools as Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown>; required?: string[] };
    }>;
    const read = tools.find((tool) => tool.name === "read_story_bible")!;
    expect(read.inputSchema.properties?.bookId).toBeDefined();
    expect(read.inputSchema.required).toContain("bookId");
  });

  test("hides the session write verbs too, and keeps the status readable", async () => {
    const readOnly = new McpServer(client());
    const names = ((await call(readOnly, "tools/list", {})).result.tools as Array<{ name: string }>).map(
      (tool) => tool.name
    );
    // Asking where the author is must work without permission; asking the agent to write must not.
    expect(names).toContain("studio_status");
    expect(names).not.toContain("studio_ask");
    expect(names).not.toContain("studio_undo");
    expect(names).not.toContain("studio_stop");

    const writable = new McpServer(client(), { allowWrites: true });
    const withWrites = ((await call(writable, "tools/list", {})).result.tools as Array<{ name: string }>).map(
      (tool) => tool.name
    );
    expect(withWrites).toContain("studio_ask");
    expect(withWrites).toContain("studio_undo");
    expect(withWrites).toContain("studio_stop");
  });

  test("hides write and destructive tools unless the matching flag is set", async () => {
    const readOnly = new McpServer(client());
    const hidden = (await call(readOnly, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(hidden.some((tool) => tool.name === "append_to_chapter")).toBe(false);
    expect(hidden.some((tool) => tool.name === "overwrite_chapter")).toBe(false);

    const writable = new McpServer(client(), { allowWrites: true });
    const writeTools = (await call(writable, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(writeTools.map((tool) => tool.name)).toContain("append_to_chapter");
    expect(writeTools.map((tool) => tool.name)).not.toContain("overwrite_chapter");

    const destructive = new McpServer(client(), { allowDestructive: true });
    const all = (await call(destructive, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(all.map((tool) => tool.name)).toContain("overwrite_chapter");
  });

  test("calls a studio tool through the backend with the book id", async () => {
    const seen: Array<{ bookId: string; name: string; args: Record<string, unknown> }> = [];
    const base = client();
    const writable = new McpServer(
      {
        ...base,
        callTool: async (bookId, name, args) => {
          seen.push({ bookId, name, args });
          return { ok: true, message: "Added the passage." };
        }
      },
      { allowWrites: true }
    );
    const response = await call(writable, "tools/call", {
      name: "append_to_chapter",
      arguments: { bookId: BOOK, chapterId: CHAPTER, text: "A new line." }
    });
    expect(seen).toEqual([
      { bookId: BOOK, name: "append_to_chapter", args: { chapterId: CHAPTER, text: "A new line." } }
    ]);
    expect(JSON.parse(response.result.content[0].text).ok).toBe(true);
  });

  test("marks a destructive call with the explicit opt-in", async () => {
    const seen: Array<{ allowDestructive?: boolean }> = [];
    const base = client();
    const server = new McpServer(
      {
        ...base,
        callTool: async (_bookId, _name, _args, options) => {
          seen.push(options ?? {});
          return { ok: true, message: "Replaced." };
        }
      },
      { allowDestructive: true }
    );
    await call(server, "tools/call", {
      name: "overwrite_chapter",
      arguments: { bookId: BOOK, chapterId: CHAPTER, content: "New." }
    });
    expect(seen[0]?.allowDestructive).toBe(true);
  });

  test("refuses a tool the author withdrew for that book", async () => {
    const base = client();
    const server = new McpServer(
      {
        ...base,
        // The book has `append_to_chapter` withdrawn, so the studio's per-book list leaves it out.
        bookTools: async () => catalog.filter((tool) => tool.name !== "append_to_chapter")
      },
      { allowWrites: true }
    );
    const response = await call(server, "tools/call", {
      name: "append_to_chapter",
      arguments: { bookId: BOOK, chapterId: CHAPTER, text: "A new line." }
    });
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toMatch(/turned off for this book/i);
  });

  test("returns protocol errors for unknown methods and bad arguments, and isError for tool failures", async () => {
    const server = new McpServer(client());
    expect((await call(server, "not/a/method", {})).error?.code).toBe(-32601);
    const badId = await call(server, "tools/call", {
      name: "read_story_bible",
      arguments: { bookId: "nope" }
    });
    expect(badId.result.isError).toBe(true);
    const missing = await call(server, "tools/call", { name: "append_to_chapter", arguments: {} });
    expect(missing.error?.code).toBe(-32602);
  });

  test("speaks newline-delimited JSON-RPC on stdio and keeps errors off stdout", async () => {
    const lines: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      }
    });
    await serveMcp(
      new McpServer(client()),
      Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
        "{bad json}\n",
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
      ]),
      output
    );
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 1, result: { serverInfo: { name: "ai-book-studio" } } });
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: null, error: { code: -32700 } });
    expect(JSON.parse(lines[2]!).result.tools).toHaveLength(5);
  });
});
