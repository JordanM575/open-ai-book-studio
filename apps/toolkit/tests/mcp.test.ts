import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
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
    saveChapter: async () => ({ status: "saved", chapter })
  };
}

async function call(server: McpServer, method: string, params: unknown, id: number | string = 1) {
  const response = await server.handle({ jsonrpc: "2.0", id, method, params });
  return response as { result?: any; error?: { code: number; message: string } };
}

describe("MCP server", () => {
  test("initializes, pings and lists read-only tools", async () => {
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
      "read_book",
      "read_chapter",
      "search_book",
      "list_conflicts"
    ]);
  });

  test("reads a chapter and strips content from read_book", async () => {
    const server = new McpServer(client());
    const response = await call(server, "tools/call", {
      name: "read_chapter",
      arguments: { bookId: BOOK, chapterId: CHAPTER }
    });
    expect(JSON.parse(response.result.content[0].text)).toMatchObject({ id: CHAPTER, content: "Hello world.\n" });

    const book = await call(server, "tools/call", { name: "read_book", arguments: { bookId: BOOK } });
    const parsed = JSON.parse(book.result.content[0].text) as { chapters: Array<Record<string, unknown>> };
    expect(parsed.chapters[0]).not.toHaveProperty("content");
  });

  test("hides write tools unless --allow-writes is set", async () => {
    const readOnly = new McpServer(client());
    const hidden = (await call(readOnly, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(hidden.some((tool) => tool.name === "save_chapter")).toBe(false);

    const writable = new McpServer(client(), { allowWrites: true });
    const tools = (await call(writable, "tools/list", {})).result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toContain("save_chapter");
    expect(tools.map((tool) => tool.name)).toContain("create_chapter");
  });

  test("saves through the client when writes are enabled", async () => {
    const captured: { value: { content: string; baseVersion: number; baseHash: string } | null } = { value: null };
    const base = client();
    const writable = new McpServer(
      {
        ...base,
        saveChapter: async (_book, _chapter, input) => {
          captured.value = input;
          return { status: "saved", chapter } satisfies SaveChapterResult;
        }
      },
      { allowWrites: true }
    );
    const response = await call(writable, "tools/call", {
      name: "save_chapter",
      arguments: { bookId: BOOK, chapterId: CHAPTER, content: "New.\n", baseVersion: 1, baseHash: HASH }
    });
    expect(captured.value).toEqual({ content: "New.\n", baseVersion: 1, baseHash: HASH });
    expect(JSON.parse(response.result.content[0].text).status).toBe("saved");
  });

  test("returns protocol errors for unknown methods and bad arguments, and isError for tool failures", async () => {
    const server = new McpServer(client());
    expect((await call(server, "not/a/method", {})).error?.code).toBe(-32601);
    const badId = await call(server, "tools/call", {
      name: "read_chapter",
      arguments: { bookId: "nope", chapterId: CHAPTER }
    });
    expect(badId.result.isError).toBe(true);
    const missing = await call(server, "tools/call", { name: "save_chapter", arguments: {} });
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
    expect(JSON.parse(lines[2]!).result.tools).toHaveLength(6);
  });
});
