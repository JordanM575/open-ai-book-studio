import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type { ToolCallResult, ToolDescriptor } from "@ai-book-studio/core/agent/tools";
import type {
  BookDetail,
  BookSummary,
  Chapter,
  ChapterConflict,
  SearchHit,
  SaveChapterResult
} from "@ai-book-studio/core/schema";
import { idSchema } from "@ai-book-studio/core/schema";

const MAX_BODY_BYTES = 20 * 1024 * 1024 + 1024;
const LOCATOR_VERSION = 1;

export interface BackendLibrary {
  listBooks(): Promise<BookSummary[]>;
  readBook(bookId: string): Promise<BookDetail>;
  readChapter(bookId: string, chapterId: string): Promise<Chapter>;
  createChapter(bookId: string, input: { title?: string; content?: string }): Promise<Chapter>;
  saveChapter(
    bookId: string,
    chapterId: string,
    content: string,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult>;
  search(bookId: string, query: string, limit?: number): Promise<SearchHit[]>;
  listConflicts(bookId: string): Promise<ChapterConflict[]>;
}

export interface BackendSource {
  current(): LibraryInfo | null;
  requireLibrary(): BackendLibrary;
}

/**
 * The studio's own writing tools, reachable over the control plane.
 *
 * The backend does not implement a tool: it forwards to the definitions the built-in agent uses, so
 * a third-party agent gets the same verbs and the same safety rules.
 */
export interface BackendToolRunner {
  catalog(): Promise<ToolDescriptor[]>;
  run(request: {
    bookId: string;
    name: string;
    args: unknown;
    allowDestructive?: boolean;
  }): Promise<ToolCallResult>;
}

export interface LocalBackendOptions {
  /** Override for tests; production uses `~/.ai-book-studio/backend.json`. */
  locatorPath?: string;
  /** Tests use port 0; production also uses 0 so another process cannot guess it. */
  port?: number;
  token?: string;
  /** The studio's writing tools. Without them the tool routes report that they are unavailable. */
  tools?: BackendToolRunner;
}

export interface BackendLocator {
  version: number;
  url: string;
  token: string;
  pid: number;
  startedAt: string;
  libraryRoot: string | null;
}

/**
 * The studio's local control plane for the standalone CLI and MCP server.
 *
 * It listens on loopback only, requires a per-run bearer token, refuses browser origins and writes
 * the token to an owner-only file. It never listens on a LAN address and never holds a second copy
 * of the library: every call goes through the open `Studio` and its `Library`.
 */
export class LocalBackend {
  private server: Server | null = null;
  private url: string | null = null;
  private readonly token: string;
  private readonly locatorPath: string;
  private readonly tools: BackendToolRunner | null;

  constructor(
    private readonly source: BackendSource,
    options: LocalBackendOptions = {}
  ) {
    this.token = options.token ?? randomBytes(32).toString("hex");
    this.locatorPath = options.locatorPath ?? backendLocatorPath();
    this.port = options.port ?? 0;
    this.tools = options.tools ?? null;
  }

  private readonly port: number;

  async start(): Promise<BackendLocator> {
    if (this.server) throw new Error("The local backend is already running.");
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        const failure = asHttpError(error);
        this.send(response, failure.status, { error: { code: failure.code, message: failure.message } });
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("The local backend did not receive a loopback port.");
    }
    this.url = `http://127.0.0.1:${address.port}`;
    const locator: BackendLocator = {
      version: LOCATOR_VERSION,
      url: this.url,
      token: this.token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      libraryRoot: this.source.current()?.root ?? null
    };
    await this.writeLocator(locator);
    return locator;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.url = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await this.removeLocator();
  }

  get locator(): string {
    return this.locatorPath;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.origin) {
      throw new HttpError(403, "forbidden", "The local backend does not accept browser origins.");
    }
    if (!this.hostAllowed(request.headers.host)) {
      throw new HttpError(403, "forbidden", "The local backend only accepts loopback requests.");
    }
    if (!this.authorized(request.headers.authorization)) {
      throw new HttpError(401, "unauthorized", "A valid backend token is required.");
    }

    const url = new URL(request.url ?? "/", this.url ?? "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1") throw new HttpError(404, "not-found", "Unknown route.");

    if (request.method === "GET" && parts.length === 2 && parts[1] === "health") {
      this.send(response, 200, { ok: true, version: LOCATOR_VERSION, library: this.source.current() });
      return;
    }
    if (request.method === "GET" && parts.length === 2 && parts[1] === "library") {
      this.send(response, 200, { library: this.source.current() });
      return;
    }
    if (request.method === "GET" && parts.length === 2 && parts[1] === "books") {
      this.send(response, 200, { books: await this.library().listBooks() });
      return;
    }
    if (request.method === "GET" && parts.length === 2 && parts[1] === "tools") {
      this.send(response, 200, { tools: await this.toolRunner().catalog() });
      return;
    }

    const bookId = parts[2] ? idSchema.parse(parts[2]) : null;
    if (parts[1] !== "books" || !bookId) throw new HttpError(404, "not-found", "Unknown route.");

    if (request.method === "GET" && parts.length === 3) {
      this.send(response, 200, { book: await this.library().readBook(bookId) });
      return;
    }
    if (request.method === "GET" && parts.length === 4 && parts[3] === "tools") {
      this.send(response, 200, { tools: await this.toolRunner().catalog() });
      return;
    }
    if (request.method === "POST" && parts.length === 5 && parts[3] === "tools") {
      const body = toolCall.parse(await readJson(request));
      const result = await this.toolRunner().run({
        bookId,
        name: parts[4]!,
        args: body.args ?? {},
        ...(body.allowDestructive ? { allowDestructive: true } : {})
      });
      this.send(response, 200, { result });
      return;
    }
    if (request.method === "GET" && parts.length === 4 && parts[3] === "conflicts") {
      this.send(response, 200, { conflicts: await this.library().listConflicts(bookId) });
      return;
    }
    if (request.method === "GET" && parts.length === 4 && parts[3] === "search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) throw new HttpError(400, "invalid", "A search query is required.");
      const limit = limitFrom(url.searchParams.get("limit"));
      this.send(response, 200, { hits: await this.library().search(bookId, query, limit) });
      return;
    }
    if (request.method === "POST" && parts.length === 4 && parts[3] === "chapters") {
      const body = chapterBody.parse(await readJson(request));
      this.send(response, 201, { chapter: await this.library().createChapter(bookId, body) });
      return;
    }

    const chapterId = parts[4] ? idSchema.parse(parts[4]) : null;
    if (parts[3] !== "chapters" || !chapterId) throw new HttpError(404, "not-found", "Unknown route.");
    if (request.method === "GET" && parts.length === 5) {
      this.send(response, 200, { chapter: await this.library().readChapter(bookId, chapterId) });
      return;
    }
    if (request.method === "POST" && parts.length === 5) {
      const body = saveBody.parse(await readJson(request));
      const result = await this.library().saveChapter(bookId, chapterId, body.content, {
        baseVersion: body.baseVersion,
        baseHash: body.baseHash
      });
      this.send(response, 200, { result });
      return;
    }

    throw new HttpError(404, "not-found", "Unknown route.");
  }

  private library(): BackendLibrary {
    try {
      return this.source.requireLibrary();
    } catch {
      throw new HttpError(409, "no-library", "No library is open in the studio. Open a folder first.");
    }
  }

  private toolRunner(): BackendToolRunner {
    if (!this.tools) {
      throw new HttpError(404, "not-found", "This studio build does not expose its writing tools.");
    }
    return this.tools;
  }

  private authorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  private hostAllowed(host: string | undefined): boolean {
    if (!host) return false;
    return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    if (response.writableEnded) return;
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(payload);
  }

  private async writeLocator(locator: BackendLocator): Promise<void> {
    await mkdir(dirname(this.locatorPath), { recursive: true, mode: 0o700 });
    await writeFile(this.locatorPath, `${JSON.stringify(locator, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.locatorPath, 0o600);
  }

  private async removeLocator(): Promise<void> {
    try {
      const current = JSON.parse(await readFile(this.locatorPath, "utf8")) as Partial<BackendLocator>;
      if (current.token === this.token) await unlink(this.locatorPath);
    } catch {
      // A missing or foreign locator is not this process's file to remove.
    }
  }
}

export function backendLocatorPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.STUDIO_BACKEND_FILE ?? join(homedir(), ".ai-book-studio", "backend.json");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function asHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof z.ZodError) {
    return new HttpError(400, "invalid", error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  }
  if (isToolError(error)) {
    if (error.code === "unknown-tool") return new HttpError(404, "not-found", error.message);
    if (error.code === "invalid-arguments") return new HttpError(400, "invalid", error.message);
    if (error.code === "destructive-not-allowed") return new HttpError(403, "forbidden", error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|not-found|ENOENT/i.test(message)) return new HttpError(404, "not-found", message);
  if (/conflict/i.test(message)) return new HttpError(409, "conflict", message);
  return new HttpError(500, "internal", message);
}

/** The bridge's own failures, so the control plane can answer with the right status. */
function isToolError(error: unknown): error is { code: string; message: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^(unknown-tool|invalid-arguments|destructive-not-allowed|failed)$/.test(
      (error as { code?: unknown }).code as string
    )
  );
}

const saveBody = z.object({
  content: z.string().max(20_000_000),
  baseVersion: z.number().int().min(0),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/)
});

const toolCall = z.object({
  args: z.unknown().optional(),
  allowDestructive: z.boolean().optional()
});

const chapterBody = z.object({
  title: z.string().max(400).optional(),
  content: z.string().max(20_000_000).optional()
});

function limitFrom(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return undefined;
  return Math.min(Math.floor(numeric), 500);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "too-large", "The request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) throw new HttpError(400, "invalid", "A JSON body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid", "The request body is not valid JSON.");
  }
}
