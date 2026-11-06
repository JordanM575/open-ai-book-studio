import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type { ToolDescriptor } from "@ai-book-studio/core/agent/tools";
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

export interface BackendTarget {
  url: string;
  token: string;
}

export interface BackendOverrides {
  url?: string;
  token?: string;
  locatorPath?: string;
  env?: NodeJS.ProcessEnv;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export function locatorPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.STUDIO_BACKEND_FILE ?? join(homedir(), ".ai-book-studio", "backend.json");
}

/**
 * Resolve the running studio backend. Flags win over environment, which wins over the owner-only
 * locator the desktop app writes. A missing or stale locator becomes one actionable sentence.
 */
export async function resolveBackend(overrides: BackendOverrides = {}): Promise<BackendTarget> {
  const env = overrides.env ?? process.env;
  const url = overrides.url ?? env.BOOKWRITER_URL;
  const token = overrides.token ?? env.BOOKWRITER_TOKEN;
  if (url || token) {
    if (!url || !token) {
      throw new BackendError("Both a backend URL and token are required when either is supplied.");
    }
    return validateTarget({ url, token });
  }

  const path = overrides.locatorPath ?? locatorPath(env);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new BackendError(
      "No Open Book Studio backend found. Open the desktop app and a library, then try again."
    );
  }
  let parsed: { version?: unknown; url?: unknown; token?: unknown };
  try {
    parsed = JSON.parse(raw) as { version?: unknown; url?: unknown; token?: unknown };
  } catch {
    throw new BackendError(
      `The backend locator at ${path} is not valid JSON. Quit and reopen Open Book Studio.`
    );
  }
  if (parsed.version !== 1 || typeof parsed.url !== "string" || typeof parsed.token !== "string") {
    throw new BackendError(
      `The backend locator at ${path} has an unknown shape. Quit and reopen Open Book Studio.`
    );
  }
  return validateTarget({ url: parsed.url, token: parsed.token });
}

function validateTarget(target: BackendTarget): BackendTarget {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new BackendError("The studio backend URL is not valid. Quit and reopen Open Book Studio.");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback) {
    throw new BackendError("The studio backend must be a loopback http address.");
  }
  if (!target.token) throw new BackendError("The studio backend token is empty.");
  return { url: url.toString().replace(/\/+$/, ""), token: target.token };
}

export class BackendClient {
  constructor(private readonly target: BackendTarget) {}

  static async connect(overrides: BackendOverrides = {}): Promise<BackendClient> {
    return new BackendClient(await resolveBackend(overrides));
  }

  async health(): Promise<{ ok: boolean; version: number; library: LibraryInfo | null }> {
    return this.request("/v1/health");
  }

  async library(): Promise<LibraryInfo | null> {
    const result = await this.request<{ library: LibraryInfo | null }>("/v1/library");
    return result.library;
  }

  async books(): Promise<BookSummary[]> {
    const result = await this.request<{ books: BookSummary[] }>("/v1/books");
    return result.books;
  }

  async book(bookId: string): Promise<BookDetail> {
    const result = await this.request<{ book: BookDetail }>(`/v1/books/${encodeURIComponent(bookId)}`);
    return result.book;
  }

  async chapter(bookId: string, chapterId: string): Promise<Chapter> {
    const result = await this.request<{ chapter: Chapter }>(
      `/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`
    );
    return result.chapter;
  }

  async search(bookId: string, query: string, limit?: number): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", String(limit));
    const result = await this.request<{ hits: SearchHit[] }>(
      `/v1/books/${encodeURIComponent(bookId)}/search?${params.toString()}`
    );
    return result.hits;
  }

  async conflicts(bookId: string): Promise<ChapterConflict[]> {
    const result = await this.request<{ conflicts: ChapterConflict[] }>(
      `/v1/books/${encodeURIComponent(bookId)}/conflicts`
    );
    return result.conflicts;
  }

  async createChapter(bookId: string, input: { title?: string; content?: string }): Promise<Chapter> {
    const result = await this.request<{ chapter: Chapter }>(
      `/v1/books/${encodeURIComponent(bookId)}/chapters`,
      { method: "POST", body: JSON.stringify(input) }
    );
    return result.chapter;
  }

  async saveChapter(
    bookId: string,
    chapterId: string,
    input: { content: string; baseVersion: number; baseHash: string }
  ): Promise<SaveChapterResult> {
    const result = await this.request<{ result: SaveChapterResult }>(
      `/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`,
      { method: "POST", body: JSON.stringify(input) }
    );
    return result.result;
  }

  /** The studio's own writing tools, so the toolkit never invents a second dialect. */
  async tools(): Promise<ToolDescriptor[]> {
    const result = await this.request<{ tools: ToolDescriptor[] }>("/v1/tools");
    return result.tools;
  }

  /** The tools the studio will actually run for a book, with the withdrawn ones left out. */
  async bookTools(bookId: string): Promise<ToolDescriptor[]> {
    const result = await this.request<{ tools: ToolDescriptor[] }>(
      `/v1/books/${encodeURIComponent(bookId)}/tools`
    );
    return result.tools;
  }

  async ambient(bookId: string): Promise<AmbientStatus> {
    const result = await this.request<{ ambient: AmbientStatus }>(
      `/v1/books/${encodeURIComponent(bookId)}/ambient`
    );
    return result.ambient;
  }

  async turn(
    bookId: string,
    prompt: string,
    options: { chapterId?: string; threadId?: string } = {}
  ): Promise<AgentTurnResult> {
    const result = await this.request<{ result: AgentTurnResult }>(
      `/v1/books/${encodeURIComponent(bookId)}/turn`,
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          ...(options.chapterId ? { chapterId: options.chapterId } : {}),
          ...(options.threadId ? { threadId: options.threadId } : {})
        })
      }
    );
    return result.result;
  }

  async undoLast(bookId: string): Promise<AgentUndoResult> {
    const result = await this.request<{ result: AgentUndoResult }>(
      `/v1/books/${encodeURIComponent(bookId)}/undo`,
      { method: "POST", body: JSON.stringify({}) }
    );
    return result.result;
  }

  async stop(bookId: string): Promise<{ stopped: number }> {
    const result = await this.request<{ result: { stopped: number } }>(
      `/v1/books/${encodeURIComponent(bookId)}/stop`,
      { method: "POST", body: JSON.stringify({}) }
    );
    return result.result;
  }

  async callTool(
    bookId: string,
    name: string,
    args: Record<string, unknown>,
    options: { allowDestructive?: boolean } = {}
  ): Promise<unknown> {
    const result = await this.request<{ result: unknown }>(
      `/v1/books/${encodeURIComponent(bookId)}/tools/${encodeURIComponent(name)}`,
      {
        method: "POST",
        body: JSON.stringify({ args, ...(options.allowDestructive ? { allowDestructive: true } : {}) })
      }
    );
    return result.result;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.target.url}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.target.token}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {})
        },
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      throw new BackendError(
        "Could not reach the studio backend. Open Open Book Studio and keep it running.",
        undefined,
        "offline"
      );
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = body as { error?: { code?: unknown; message?: unknown } } | null;
      throw new BackendError(
        typeof failure?.error?.message === "string"
          ? failure.error.message
          : `The studio backend returned ${response.status}.`,
        response.status,
        typeof failure?.error?.code === "string" ? failure.error.code : undefined
      );
    }
    return body as T;
  }
}
