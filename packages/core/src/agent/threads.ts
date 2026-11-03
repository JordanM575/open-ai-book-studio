import { LibraryPortError } from "../library/errors";
import { libraryPathToArchivePath, toLibraryFilePath, type LibraryPath } from "../library/path";
import { threadsPath } from "../library/paths";
import type { LibraryPort, LibraryRuntime } from "../library/port";
import { noteRemovedFiles, noteWrittenFiles } from "../sync/journal";
import {
  agentThreadSchema,
  lastMessageText,
  serializeAgentThread,
  type AgentApprovalStatus,
  type AgentMessage,
  type AgentThread
} from "./messages";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ThreadStoreErrorCode = "invalid-id" | "not-found" | "exists" | "corrupt";

export class ThreadStoreError extends Error {
  constructor(
    readonly code: ThreadStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ThreadStoreError";
  }
}

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

/**
 * Conversations are files beside the manuscript, written through the library port so every target
 * gets the same atomic commit. The store owns the file layout and schema; the runtime decides when
 * a turn is appended.
 */
export class ThreadStore {
  private notedDeviceId: string | null = null;

  constructor(
    private readonly storage: LibraryPort,
    private readonly runtime: LibraryRuntime
  ) {}

  async create(bookId: string, title?: string, messages: AgentMessage[] = []): Promise<AgentThread> {
    assertBookId(bookId);
    const now = this.runtime.now();
    const thread: AgentThread = {
      schemaVersion: 1,
      id: this.runtime.newId("thread"),
      bookId,
      title: cleanTitle(title),
      createdAt: now,
      updatedAt: now,
      messages,
      checkpointTurns: []
    };
    return this.write(thread, "create");
  }

  async save(thread: AgentThread): Promise<AgentThread> {
    return this.write(thread, "save");
  }

  async read(bookId: string, threadId: string): Promise<AgentThread | null> {
    const path = this.filePath(bookId, threadId);
    const snapshot = await this.storage.readFile(path);
    if (!snapshot) return null;
    try {
      const thread = agentThreadSchema.parse(JSON.parse(decoder.decode(snapshot.bytes)));
      if (thread.bookId !== bookId || thread.id !== threadId) {
        throw new ThreadStoreError("corrupt", "That file belongs to a different conversation.");
      }
      return thread;
    } catch (error) {
      if (error instanceof ThreadStoreError) throw error;
      throw new ThreadStoreError("corrupt", "That conversation could not be read. The file was left untouched.");
    }
  }

  /** Newest first. A corrupt file is skipped here; `read` reports it when opened directly. */
  async list(bookId: string): Promise<ThreadSummary[]> {
    assertBookId(bookId);
    const directory = threadsPath(bookId);
    const summaries: ThreadSummary[] = [];
    for (const entry of await this.storage.listDirectory(directory)) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      try {
        const path = toLibraryFilePath([...directory, entry.name]);
        const snapshot = await this.storage.readFile(path);
        if (!snapshot) continue;
        const thread = agentThreadSchema.parse(JSON.parse(decoder.decode(snapshot.bytes)));
        if (thread.bookId !== bookId) continue;
        summaries.push(summarize(thread));
      } catch {
        // A half-written or foreign file is not a conversation. Do not hide it by deleting it.
      }
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async appendMessage(bookId: string, threadId: string, message: AgentMessage): Promise<AgentThread> {
    const thread = await this.read(bookId, threadId);
    if (!thread) throw new ThreadStoreError("not-found", "That conversation no longer exists.");
    return this.save({ ...thread, messages: [...thread.messages, message] });
  }

  /**
   * Write the assistant message for a turn, replacing it when the same id is already stored. A turn
   * that pauses for approval writes once at the pause and again when it finishes, so the conversation
   * keeps one message per turn rather than a partial copy beside the final one.
   */
  async upsertMessage(bookId: string, threadId: string, message: AgentMessage): Promise<AgentThread> {
    const thread = await this.read(bookId, threadId);
    if (!thread) throw new ThreadStoreError("not-found", "That conversation no longer exists.");
    const index = thread.messages.findIndex((entry) => entry.id === message.id);
    const messages =
      index >= 0
        ? thread.messages.map((entry, position) => (position === index ? message : entry))
        : [...thread.messages, message];
    return this.save({ ...thread, messages });
  }

  /** Record the author's answer on a stored approval. Returns null when the part is not there. */
  async updateApproval(
    bookId: string,
    threadId: string,
    messageId: string,
    approvalId: string,
    status: AgentApprovalStatus,
    resolvedAt: string = this.runtime.now()
  ): Promise<AgentThread | null> {
    const thread = await this.read(bookId, threadId);
    if (!thread) throw new ThreadStoreError("not-found", "That conversation no longer exists.");
    const message = thread.messages.find((entry) => entry.id === messageId);
    if (!message) return null;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.type !== "approval" || part.approvalId !== approvalId) return part;
      changed = true;
      return { ...part, status, resolvedAt };
    });
    if (!changed) return null;
    return this.save({
      ...thread,
      messages: thread.messages.map((entry) => (entry.id === messageId ? { ...message, parts } : entry))
    });
  }

  async rename(bookId: string, threadId: string, title: string): Promise<AgentThread> {
    const thread = await this.read(bookId, threadId);
    if (!thread) throw new ThreadStoreError("not-found", "That conversation no longer exists.");
    return this.save({ ...thread, title: cleanTitle(title) });
  }

  /** Copy a conversation up to and including one assistant turn into a new thread. */
  async fork(bookId: string, threadId: string, turnId: string): Promise<AgentThread> {
    const source = await this.read(bookId, threadId);
    if (!source) throw new ThreadStoreError("not-found", "That conversation no longer exists.");
    const index = source.messages.findIndex(
      (message) => message.role === "assistant" && message.turnId === turnId
    );
    if (index < 0) {
      throw new ThreadStoreError("not-found", "That turn is no longer in the conversation.");
    }
    const messages = source.messages.slice(0, index + 1);
    const branch = await this.create(bookId, `${source.title} (branch)`, messages);
    const keptTurns = new Set(messages.flatMap((message) => (message.turnId ? [message.turnId] : [])));
    return this.save({
      ...branch,
      checkpointTurns: source.checkpointTurns.filter((turn) => keptTurns.has(turn))
    });
  }

  async remove(bookId: string, threadId: string): Promise<void> {
    try {
      await this.storage.removeFile(this.filePath(bookId, threadId));
    } catch (error) {
      if (error instanceof LibraryPortError && error.code === "not-found") return;
      throw error;
    }
    await this.noteFiles({
      written: [],
      removed: [libraryPathToArchivePath(this.filePath(bookId, threadId))]
    });
  }

  private async write(thread: AgentThread, mode: "create" | "save"): Promise<AgentThread> {
    const parsed = agentThreadSchema.parse(thread);
    const path = this.filePath(parsed.bookId, parsed.id);
    const next: AgentThread = { ...parsed, updatedAt: this.runtime.now() };
    const result = await this.storage.commitFile(
      path,
      encoder.encode(serializeAgentThread(next)),
      mode === "create" ? { kind: "absent" } : { kind: "any" }
    );
    if (result.status === "changed") {
      throw new ThreadStoreError("exists", "That conversation already exists.");
    }
    await this.noteFiles({ written: [libraryPathToArchivePath(path)], removed: [] });
    return next;
  }

  /**
   * Fold this store's writes into the sync baseline so the next drift scan reads them as local.
   * Best-effort: the device id resolves lazily and a note failure never fails the write.
   */
  private async noteFiles(input: { written: string[]; removed: string[] }): Promise<void> {
    try {
      this.notedDeviceId ??= (await this.storage.deviceInfo()).id;
      const now = this.runtime.now();
      await noteWrittenFiles({ storage: this.storage, deviceId: this.notedDeviceId, paths: input.written, now });
      await noteRemovedFiles({ storage: this.storage, deviceId: this.notedDeviceId, paths: input.removed, now });
    } catch {
      // Detection degrades to a reviewable report.
    }
  }

  private filePath(bookId: string, threadId: string): LibraryPath {
    assertBookId(bookId);
    assertThreadId(threadId);
    return toLibraryFilePath([...threadsPath(bookId), `${threadId}.json`]);
  }
}

function summarize(thread: AgentThread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    preview: truncate(lastMessageText(thread).replace(/\s+/g, " ").trim(), 140)
  };
}

function cleanTitle(title: string | undefined): string {
  const clean = title?.trim().replace(/\s+/g, " ") ?? "";
  return clean ? clean.slice(0, 200) : "New conversation";
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function assertBookId(value: string): void {
  if (!/^book_[A-Za-z0-9-]{6,}$/.test(value)) {
    throw new ThreadStoreError("invalid-id", "That book id is not valid.");
  }
}

function assertThreadId(value: string): void {
  if (!/^thread_[A-Za-z0-9-]{6,}$/.test(value)) {
    throw new ThreadStoreError("invalid-id", "That conversation id is not valid.");
  }
}
