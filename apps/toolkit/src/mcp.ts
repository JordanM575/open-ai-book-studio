import { createInterface } from "node:readline";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type { ToolDescriptor, ToolTier } from "@ai-book-studio/core/agent/tools";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import type { AgentTurnResult, AgentUndoResult } from "@ai-book-studio/core/agent";
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
  /** The studio's own writing tools, so the toolkit never invents a second dialect. */
  tools(): Promise<ToolDescriptor[]>;
  /** The tools the studio will run for one book, with the withdrawn ones left out. */
  bookTools(bookId: string): Promise<ToolDescriptor[]>;
  /** The ambient agent's status of a book: where the author is and what changed. */
  ambient(bookId: string): Promise<AmbientStatus>;
  /** Undo the agent's last turn. */
  undoLast(bookId: string): Promise<AgentUndoResult>;
  /** Stop the agent if it is working on a book. */
  stop(bookId: string): Promise<{ stopped: number }>;
  /** Run a turn and wait for the agent's answer. */
  turn(
    bookId: string,
    prompt: string,
    options?: { chapterId?: string; threadId?: string }
  ): Promise<AgentTurnResult>;
  callTool(
    bookId: string,
    name: string,
    args: Record<string, unknown>,
    options?: { allowDestructive?: boolean }
  ): Promise<unknown>;
}

export interface McpOptions {
  allowWrites?: boolean;
  /** Destructive tools need their own flag; it implies writes. */
  allowDestructive?: boolean;
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
  tier?: ToolTier;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const ID = /^(book|ch)_[A-Za-z0-9-]{6,}$/;

/**
 * A deliberately small MCP server over the studio backend. It is transport-only: tool calls become
 * HTTP requests, and the desktop library remains the single writer.
 */
export class McpServer {
  private catalogCache: Promise<ToolDescriptor[]> | null = null;

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
          tools: (await this.tools()).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema
          }))
        };
      case "tools/call": {
        const params = asObject(request.params);
        const name = requiredString(params, "name");
        const args = asObject(params.arguments);
        const tool = (await this.tools()).find((entry) => entry.name === name);
        if (!tool) throw new McpFailure(-32602, `Unknown tool: ${name}`);
        // A tool the author withdrew for this book is not reachable, whatever the catalog says
        // (FR-013). The studio's own per-book list is the authority; a book the server cannot
        // answer for is left to the tool's own call, which reports it as a tool failure.
        if (typeof args.bookId === "string" && args.bookId) {
          let allowed: ToolDescriptor[] | null = null;
          try {
            allowed = await this.client.bookTools(args.bookId);
          } catch {
            allowed = null;
          }
          if (allowed && !allowed.some((entry) => entry.name === name)) {
            throw new McpFailure(
              -32602,
              `${name} is turned off for this book. The author withdrew it.`
            );
          }
        }
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

  /**
   * The MCP tool list.
   *
   * It is the studio's own catalog, so a third-party agent gets the same verbs as the built-in
   * agent: read the Story Bible, find a passage, append, replace, split. Each mirrored tool takes
   * the `bookId` the studio binds its tools to, so one server can work on any book in the library.
   *
   * The library-level tools stay: they are how a client finds the `bookId` the others need.
   */
  private async tools(): Promise<ToolDefinition[]> {
    const libraryTools: ToolDefinition[] = [
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
        name: "list_conflicts",
        description: "List preserved conflict copies for a book.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false
        },
        run: (args) => this.client.conflicts(bookId(args, "bookId"))
      },
      /*
       * The studio's own session verbs, which are not writing tools but are how an assistant
       * knows what it is looking at. Without them a third-party agent can edit a book it cannot
       * describe, and cannot undo what it just did.
       */
      {
        name: "studio_status",
        description:
          "Where the author is in a book: the chapter, the progress, what the agent last changed, whether it is working, and which actions the studio offers. Read this first.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false
        },
        run: (args) => this.client.ambient(bookId(args, "bookId"))
      },
      {
        name: "studio_ask",
        description:
          "Ask the writing agent for something and wait for its answer. It can change the book, and leaves an undo checkpoint when it does.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" }, prompt: { type: "string" } },
          required: ["bookId", "prompt"],
          additionalProperties: false
        },
        tier: "write",
        run: (args) =>
          this.client.turn(bookId(args, "bookId"), requiredString(args, "prompt"))
      },
      {
        name: "studio_undo",
        description: "Undo the agent's last turn on a book, restoring what it changed.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false
        },
        tier: "write",
        run: (args) => this.client.undoLast(bookId(args, "bookId"))
      },
      {
        name: "studio_stop",
        description: "Stop the agent if it is working on a book.",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false
        },
        tier: "write",
        run: (args) => this.client.stop(bookId(args, "bookId"))
      }
    ];

    const mirrored: ToolDefinition[] = [];
    for (const descriptor of await this.catalog()) {
      if (!this.tierAllowed(descriptor.tier)) continue;
      mirrored.push(this.mirror(descriptor));
    }
    /*
     * The tier filter applies to everything, not only to the mirrored catalog. A tool with no
     * tier is a way to find or describe the library and is always available; a write is a write
     * wherever it is declared, and a read-only server must not offer one.
     */
    return [...libraryTools, ...mirrored].filter(
      (tool) => tool.tier === undefined || this.tierAllowed(tool.tier)
    );
  }

  /** One studio tool, with the book it works on as an argument. */
  private mirror(descriptor: ToolDescriptor): ToolDefinition {
    const properties = {
      ...((descriptor.inputSchema.properties as Record<string, unknown> | undefined) ?? {}),
      bookId: { type: "string", description: "The book_… id this call works on." }
    };
    const required = [
      ...(((descriptor.inputSchema.required as string[] | undefined) ?? [])),
      "bookId"
    ];
    return {
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: { ...descriptor.inputSchema, properties, required },
      tier: descriptor.tier,
      run: (args) => {
        const { bookId: target, ...rest } = args;
        return this.client.callTool(bookId(args, "bookId"), descriptor.name, rest, {
          allowDestructive: this.options.allowDestructive === true
        });
      }
    };
  }

  private tierAllowed(tier: ToolTier): boolean {
    if (tier === "read") return true;
    if (tier === "write") return this.options.allowWrites === true;
    return this.options.allowDestructive === true;
  }

  /** The studio's catalog, fetched once per server. */
  private async catalog(): Promise<ToolDescriptor[]> {
    if (!this.catalogCache) {
      this.catalogCache = this.client.tools().catch((error: unknown) => {
        throw new McpFailure(
          -32603,
          `The studio did not return its tool catalog: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
    return this.catalogCache;
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

function bookId(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key);
  if (!ID.test(value) || !value.startsWith("book_")) {
    throw new McpFailure(-32602, `${key} must be a book_… id.`);
  }
  return value;
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
