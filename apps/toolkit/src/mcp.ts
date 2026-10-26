import { createInterface } from "node:readline";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type {
  BookDetail,
  BookSummary,
  Chapter,
  ChapterConflict,
  SearchHit,
  SaveChapterResult
} from "@ai-book-studio/core/schema";

export interface ToolkitClient {
  library(): Promise<LibraryInfo | null>;
  books(): Promise<BookSummary[]>;
  book(bookId: string): Promise<BookDetail>;
  chapter(bookId: string, chapterId: string): Promise<Chapter>;
  search(bookId: string, query: string, limit?: number): Promise<SearchHit[]>;
  conflicts(bookId: string): Promise<ChapterConflict[]>;
  createChapter(bookId: string, input: { title?: string; content?: string }): Promise<Chapter>;
  saveChapter(
    bookId: string,
    chapterId: string,
    input: { content: string; baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult>;
}

export interface McpOptions {
  allowWrites?: boolean;
  version?: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: JsonRpcError };

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const ID = /^(book|ch)_[A-Za-z0-9-]{6,}$/;
const HASH = /^[a-f0-9]{64}$/;

/**
 * A deliberately small MCP server over the studio backend. It is transport-only: tool calls become
 * HTTP requests, and the desktop library remains the single writer.
 */
export class McpServer {
  constructor(
    private readonly client: ToolkitClient,
    private readonly options: McpOptions = {}
  ) {}

  async handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isRequest(message)) {
      return errorResponse(null, -32600, "Invalid JSON-RPC request.");
    }
    const id = message.id ?? null;
    const notification = message.id === undefined;
    try {
      const result = await this.dispatch(message);
      return notification ? null : { jsonrpc: "2.0", id, result };
    } catch (failure) {
      if (notification) return null;
      if (failure instanceof McpFailure) {
        return errorResponse(id, failure.code, failure.message);
      }
      return errorResponse(id, -32603, failure instanceof Error ? failure.message : String(failure));
    }
  }

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize": {
        const params = asObject(request.params);
        const version = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
        return {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "ai-book-studio", version: this.options.version ?? "0.1.0" }
        };
      }
      case "notifications/initialized":
        return {};
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: this.tools().map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema
          }))
        };
      case "tools/call": {
        const params = asObject(request.params);
        const name = requiredString(params, "name");
        const args = asObject(params.arguments);
        const tool = this.tools().find((entry) => entry.name === name);
        if (!tool) throw new McpFailure(-32602, `Unknown tool: ${name}`);
        try {
          const value = await tool.run(args);
          return {
            content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
          };
        } catch (failure) {
          return {
            content: [
              {
                type: "text",
                text: failure instanceof Error ? failure.message : String(failure)
              }
            ],
            isError: true
          };
        }
      }
      default:
        throw new McpFailure(-32601, `Unknown method: ${request.method}`);
    }
  }

  private tools(): ToolDefinition[] {
    const read: ToolDefinition[] = [
      {
        name: "library_info",
        description: "Show the open AI Book Studio library and device.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        run: () => this.client.library()
      },
      {
        name: "list_books",
        description: "List the books in the open library.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        run: () => this.client.books()
      },
      {
        name: "read_book",
        description: "Read a book's metadata, cast, outline and chapter list.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string", description: "The book_… id." } },
          required: ["bookId"],
          additionalProperties: false
        },
        run: async (args) => {
          const detail = await this.client.book(bookId(args, "bookId"));
          return {
            book: detail.book,
            chapters: detail.chapters.map(({ content: _content, ...chapter }) => chapter)
          };
        }
      },
      {
        name: "read_chapter",
        description: "Read one chapter as Markdown, including its current version and hash.",
        inputSchema: {
          type: "object",
          properties: {
            bookId: { type: "string" },
            chapterId: { type: "string", description: "The ch_… id." }
          },
          required: ["bookId", "chapterId"],
          additionalProperties: false
        },
        run: (args) => this.client.chapter(bookId(args, "bookId"), chapterId(args, "chapterId"))
      },
      {
        name: "search_book",
        description: "Search one book for a phrase and return matching chapters and lines.",
        inputSchema: {
          type: "object",
          properties: {
            bookId: { type: "string" },
            query: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 500 }
          },
          required: ["bookId", "query"],
          additionalProperties: false
        },
        run: (args) =>
          this.client.search(
            bookId(args, "bookId"),
            requiredString(args, "query"),
            optionalNumber(args, "limit")
          )
      },
      {
        name: "list_conflicts",
        description: "List preserved conflict copies for a book.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false
        },
        run: (args) => this.client.conflicts(bookId(args, "bookId"))
      }
    ];
    if (!this.options.allowWrites) return read;

    return [
      ...read,
      {
        name: "create_chapter",
        description: "Create a chapter at the end of a book. Only available with --allow-writes.",
        write: true,
        inputSchema: {
          type: "object",
          properties: {
            bookId: { type: "string" },
            title: { type: "string" },
            content: { type: "string" }
          },
          required: ["bookId"],
          additionalProperties: false
        },
        run: (args) => {
          const title = optionalString(args, "title");
          const content = optionalContent(args, "content");
          return this.client.createChapter(bookId(args, "bookId"), {
            ...(title !== undefined ? { title } : {}),
            ...(content !== undefined ? { content } : {})
          });
        }
      },
      {
        name: "save_chapter",
        description:
          "Save a chapter with a compare-before-write check. Supply the version and hash from the read; a stale write becomes a conflict copy. Only available with --allow-writes.",
        write: true,
        inputSchema: {
          type: "object",
          properties: {
            bookId: { type: "string" },
            chapterId: { type: "string" },
            content: { type: "string" },
            baseVersion: { type: "number", minimum: 0 },
            baseHash: { type: "string", pattern: "^[a-f0-9]{64}$" }
          },
          required: ["bookId", "chapterId", "content", "baseVersion", "baseHash"],
          additionalProperties: false
        },
        run: (args) => {
          const hash = requiredString(args, "baseHash");
          if (!HASH.test(hash)) throw new Error("baseHash must be a 64-character lowercase SHA-256.");
          return this.client.saveChapter(bookId(args, "bookId"), chapterId(args, "chapterId"), {
            content: requiredContent(args, "content"),
            baseVersion: requiredNumber(args, "baseVersion"),
            baseHash: hash
          });
        }
      }
    ];
  }
}

/** Read newline-delimited JSON-RPC from stdin and write one response per request to stdout. */
export async function serveMcp(
  server: McpServer,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(errorResponse(null, -32700, "Parse error."))}\n`);
      continue;
    }
    const response = await server.handle(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

class McpFailure extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.jsonrpc === "2.0" && typeof message.method === "string";
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new McpFailure(-32602, "Expected an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || !entry.trim()) {
    throw new McpFailure(-32602, `${key} must be a non-empty string.`);
  }
  return entry;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (typeof entry !== "string") throw new McpFailure(-32602, `${key} must be a string.`);
  return entry;
}

/** Content may be empty; an empty chapter is a valid author choice. */
function requiredContent(value: Record<string, unknown>, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string") throw new McpFailure(-32602, `${key} must be a string.`);
  return entry;
}

function optionalContent(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  return requiredContent(value, key);
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const entry = value[key];
  if (typeof entry !== "number" || !Number.isFinite(entry)) {
    throw new McpFailure(-32602, `${key} must be a number.`);
  }
  return entry;
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  return requiredNumber(value, key);
}

function bookId(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key);
  if (!ID.test(value) || !value.startsWith("book_")) {
    throw new McpFailure(-32602, `${key} must be a book_… id.`);
  }
  return value;
}

function chapterId(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key);
  if (!ID.test(value) || !value.startsWith("ch_")) {
    throw new McpFailure(-32602, `${key} must be a ch_… id.`);
  }
  return value;
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
