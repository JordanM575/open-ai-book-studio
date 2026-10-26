import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import type { AgentTurnResult } from "@ai-book-studio/core/agent";
import type { ToolCallResult } from "@ai-book-studio/core/agent/tools";
import { z } from "zod";

/**
 * The bridge to the phone.
 *
 * The studio's control plane listens on the loopback only, which is right for the command line
 * and wrong for a phone: the phone is on the local network and cannot reach `127.0.0.1` on the
 * author's machine. So there is a second, much smaller listener, and it is the only thing the
 * phone is allowed to reach.
 *
 * It serves five things and nothing else:
 *
 * - the ambient status, so the phone can show where the author is;
 * - a turn, so the author can talk to the agent from the glasses;
 * - a tool call, so a tap on the lenses can be an action in the book;
 * - an undo and a stop, because the status offers both and an offered action must work.
 *
 * It is off until the author turns it on, it needs the same per-run token as the rest of the
 * control plane, and it binds to one named local address rather than to every interface.
 */

/** What the bridge can ask the studio for. */
export interface BridgeStudio {
  /** The ambient status of a book. */
  ambient(bookId: string): Promise<AmbientStatus>;
  /** Run a turn and wait for the answer. */
  turn(input: { bookId: string; prompt: string }): Promise<AgentTurnResult>;
  /** Run one of the studio's own tools. */
  tool(input: {
    bookId: string;
    name: string;
    args: unknown;
    allowDestructive?: boolean;
  }): Promise<ToolCallResult>;
  /**
   * Undo the agent's last turn.
   *
   * The ambient status offers this action whenever a checkpoint exists, so the phone must be able
   * to perform it. An action the status offers and the bridge cannot do is a dead end in a pair of
   * glasses.
   */
  undo(bookId: string): Promise<{ restored: number; skipped: number }>;
  /**
   * Stop the agent if it is working on this book.
   *
   * The status reports whether it is working, so the phone must be able to act on that; a Stop
   * the wearer can see and press has to do something.
   */
  stop(bookId: string): Promise<{ stopped: number }>;
}

export interface LocalBridgeOptions {
  /** The address to listen on. It must be a local address, never `0.0.0.0`. */
  address: string;
  port?: number;
  token?: string;
  studio: BridgeStudio;
}

export interface BridgeLocator {
  version: number;
  url: string;
  token: string;
  address: string;
  port: number;
  pid: number;
  startedAt: string;
}

const BRIDGE_VERSION = 1;
const MAX_BODY_BYTES = 1_000_000;

export class LocalBridge {
  private server: Server | null = null;
  private readonly token: string;
  private readonly address: string;
  private readonly port: number;
  private url: string | null = null;

  constructor(private readonly options: LocalBridgeOptions) {
    this.token = options.token ?? randomBytes(32).toString("hex");
    this.address = options.address;
    this.port = options.port ?? 0;
  }

  async start(): Promise<BridgeLocator> {
    if (this.server) throw new Error("The bridge is already running.");
    if (this.address === "0.0.0.0" || this.address === "::") {
      throw new Error("The bridge binds to one named local address, never to every interface.");
    }
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        const failure = asHttpError(error);
        const payload = JSON.stringify({ error: { code: failure.code, message: failure.message } });
        response.writeHead(failure.status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
          "cache-control": "no-store"
        });
        response.end(payload);
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.address, () => resolve());
    });
    const bound = server.address();
    if (!bound || typeof bound === "string") {
      await this.stop();
      throw new Error("The bridge did not receive a port.");
    }
    this.url = `http://${this.address}:${bound.port}`;
    return {
      version: BRIDGE_VERSION,
      url: this.url,
      token: this.token,
      address: this.address,
      port: bound.port,
      pid: process.pid,
      startedAt: new Date().toISOString()
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.url = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The address a phone can reach, or null when the bridge is not running. */
  get address_url(): string | null {
    return this.url;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A browser origin is never welcome here. The phone is a native client and sends none.
    if (request.headers.origin) {
      throw new HttpError(403, "forbidden", "The bridge does not accept browser origins.");
    }
    if (!this.authorized(request.headers.authorization)) {
      throw new HttpError(401, "unauthorized", "A valid bridge token is required.");
    }

    const url = new URL(request.url ?? "/", this.url ?? "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1") throw new HttpError(404, "not-found", "Unknown route.");

    if (request.method === "GET" && parts.length === 2 && parts[1] === "health") {
      this.send(response, 200, { ok: true, version: BRIDGE_VERSION });
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[1] === "ambient") {
      const bookId = url.searchParams.get("book")?.trim();
      if (!bookId) throw new HttpError(400, "invalid", "A book id is required.");
      this.send(response, 200, { ambient: await this.options.studio.ambient(bookId) });
      return;
    }

    if (request.method === "POST" && parts.length === 2 && parts[1] === "turn") {
      const body = turnBody.parse(await readJson(request));
      const result = await this.options.studio.turn({ bookId: body.bookId, prompt: body.prompt });
      this.send(response, 200, { result });
      return;
    }

    if (request.method === "POST" && parts.length === 2 && parts[1] === "stop") {
      const body = undoBody.parse(await readJson(request));
      this.send(response, 200, { result: await this.options.studio.stop(body.bookId) });
      return;
    }

    if (request.method === "POST" && parts.length === 2 && parts[1] === "undo") {
      const body = undoBody.parse(await readJson(request));
      const result = await this.options.studio.undo(body.bookId);
      this.send(response, 200, { result });
      return;
    }

    if (request.method === "POST" && parts.length === 2 && parts[1] === "tool") {
      const body = toolBody.parse(await readJson(request));
      const result = await this.options.studio.tool({
        bookId: body.bookId,
        name: body.name,
        args: body.args ?? {},
        ...(body.allowDestructive ? { allowDestructive: true } : {})
      });
      this.send(response, 200, { result });
      return;
    }

    throw new HttpError(404, "not-found", "Unknown route.");
  }

  private authorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
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
}

/**
 * The local addresses a phone could reach.
 *
 * The loopback is left out: a phone is not on this machine. The first private address is the one
 * to offer, and the rest are listed so the author can pick if the first is the wrong network.
 */
export function localAddresses(): string[] {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push(entry.address);
    }
  }
  return found;
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
    return new HttpError(
      400,
      "invalid",
      error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|not-found/i.test(message)) return new HttpError(404, "not-found", message);
  if (/refused|turned off/i.test(message)) return new HttpError(403, "forbidden", message);
  return new HttpError(500, "internal", message);
}

const turnBody = z.object({
  bookId: z.string().min(1).max(80),
  prompt: z.string().min(1).max(20_000)
});

const undoBody = z.object({
  bookId: z.string().min(1).max(80)
});

const toolBody = z.object({
  bookId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  args: z.unknown().optional(),
  allowDestructive: z.boolean().optional()
});

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
