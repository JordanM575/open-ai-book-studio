import { normalizeBody, slugify } from "../markdown";
import type { Chapter } from "../schema";
import { LibraryError, LibraryPortError } from "./errors";
import { chapterPath } from "./paths";
import type { CommitFileResult, LibraryEnvironment, LibraryPath } from "./port";
import {
  HistoryError,
  historyCaptureSchema,
  historyDirectory,
  historyFilePath,
  historyReadSchema,
  parseHistoryRecord,
  readHistoryEnvelope,
  serializeHistoryRecord,
  type HistoryCaptureInput,
  type HistoryComparison,
  type HistoryListing,
  type HistoryReadInput,
  type HistoryScope,
  type StoredHistoryRecord
} from "./history";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Internal policy module. LibraryService supplies its book lock and journaled atomic writer. */
export class ChapterHistoryStore {
  constructor(
    private readonly env: LibraryEnvironment,
    private readonly readChapter: (bookId: string, chapterId: string) => Promise<Chapter>,
    private readonly commit: (path: LibraryPath, text: string) => Promise<CommitFileResult>
  ) {}

  async capture(input: HistoryCaptureInput): Promise<StoredHistoryRecord> {
    const parsed = historyCaptureSchema.safeParse(input);
    if (!parsed.success) {
      throw new HistoryError("invalid", "Snapshot capture needs a valid label and confirmed saved version and hash. Resolve the save state and try again.");
    }
    const { bookId, chapterId, source } = parsed.data;
    const scope = { bookId, chapterId };
    const chapter = await this.savedChapter(scope);
    if (chapter.version !== source.version || chapter.hash !== source.hash) throw staleSource();
    const meta = {
      schemaVersion: 1 as const,
      kind: "snapshot" as const,
      id: this.env.runtime.newId("hist"),
      ...scope,
      label: parsed.data.label.trim(),
      capturedAt: this.env.runtime.now(),
      sourceVersion: chapter.version,
      sourceHash: chapter.hash,
      bodyHash: await this.env.runtime.sha256(encoder.encode(chapter.content))
    };
    const text = await serializeHistoryRecord({ meta, content: chapter.content }, this.env.runtime);
    const bytes = encoder.encode(text);
    const base = `${meta.capturedAt.replace(/[:.]/g, "-")}-${slugify(meta.label)}`;
    await this.env.storage.ensureDirectory(historyDirectory(scope));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // Re-resolve identity and raw hash, including after a collision with another writer.
      const current = await this.savedChapter(scope);
      if (current.version !== source.version || current.hash !== source.hash) throw staleSource();
      const fileName = `${base}${attempt === 0 ? "" : `-${attempt + 1}`}.md`;
      let committed: CommitFileResult;
      try {
        committed = await this.commit(historyFilePath({ ...scope, fileName }), text);
      } catch (error) {
        // A port can publish successfully and then fail to read back. Never retry that write
        // automatically or remove the possibly complete file. Policy preflight errors are definite.
        if (error instanceof LibraryError || error instanceof HistoryError) throw error;
        const message = "The snapshot write could not be confirmed. Review history before retrying: a complete snapshot may already exist. The chapter was not changed by history.";
        if (error instanceof LibraryPortError) throw new LibraryPortError(error.code, message, false);
        throw new HistoryError("io", message);
      }
      if (committed.status === "changed") continue;
      if (committed.snapshot.bytes.length !== bytes.length ||
          !bytes.every((byte, index) => committed.snapshot.bytes[index] === byte)) {
        throw new HistoryError("io", "The snapshot write could not be verified. Review history before trying again; the chapter was not changed.");
      }
      return { meta, content: chapter.content, fileName, hash: committed.snapshot.sha256 };
    }
    throw new HistoryError("io", "No free snapshot filename was found. Try a different label; existing history was kept.");
  }

  async read(input: HistoryReadInput): Promise<StoredHistoryRecord> {
    const path = historyFilePath(input);
    const snapshot = await this.env.storage.readFile(path);
    if (!snapshot) throw new HistoryError("not-found", "This history file is missing. Check that the library folder has finished syncing.");
    let raw: string;
    try {
      raw = decoder.decode(snapshot.bytes);
    } catch {
      throw new HistoryError("corrupt", "This history file is not valid UTF-8. Keep the file for recovery.");
    }
    const record = await parseHistoryRecord(raw, { bookId: input.bookId, chapterId: input.chapterId }, this.env.runtime);
    return { ...record, fileName: input.fileName, hash: snapshot.sha256 };
  }

  async list(scope: HistoryScope): Promise<HistoryListing> {
    const directory = historyDirectory(scope);
    const listing: HistoryListing = { records: [], issues: [] };
    const entries = this.env.storage.inspectDirectory
      ? await this.env.storage.inspectDirectory(directory) : await this.env.storage.listDirectory(directory);
    for (const entry of entries) {
      if (entry.kind === "unsupported" && entry.name.endsWith(".md")) {
        listing.issues.push({ fileName: entry.name, code: "io",
          message: "This history entry is not an ordinary file. It was left untouched and cannot be opened." });
        continue;
      }
      if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue;
      const input = { ...scope, fileName: entry.name };
      try {
        const record = await this.read(input);
        const stat = await this.env.storage.stat(historyFilePath(input));
        if (!stat) throw new HistoryError("not-found", "This history file disappeared while listing. Check the library folder and try again.");
        listing.records.push({ meta: record.meta, fileName: record.fileName, hash: record.hash, size: stat.size });
      } catch (error) {
        listing.issues.push({
          fileName: entry.name,
          code: error instanceof HistoryError ? error.code : "io",
          message: error instanceof HistoryError ? error.message : "This history file could not be read. Check access to the library folder and try again."
        });
      }
    }
    listing.records.sort((a, b) => compareText(b.meta.capturedAt, a.meta.capturedAt) || compareText(a.fileName, b.fileName));
    listing.issues.sort((a, b) => compareText(a.fileName, b.fileName));
    return listing;
  }

  async compare(input: HistoryReadInput): Promise<HistoryComparison> {
    if (!historyReadSchema.safeParse(input).success) throw new HistoryError("invalid", "The history record address is invalid.");
    const snapshot = await this.read(input);
    if (snapshot.meta.kind === "intent") throw new HistoryError("invalid", "A restore intent has no saved body to compare. Open its selected or safety snapshot instead.");
    const chapter = await this.savedChapter({ bookId: input.bookId, chapterId: input.chapterId });
    return {
      basis: "saved",
      snapshot,
      current: { bookId: input.bookId, chapterId: input.chapterId, content: chapter.content, version: chapter.version, hash: chapter.hash },
      equal: snapshot.content === chapter.content
    };
  }

  private async savedChapter(scope: HistoryScope): Promise<Chapter> {
    const chapter = await this.readChapter(scope.bookId, scope.chapterId);
    const snapshot = await this.env.storage.readFile(chapterPath(scope.bookId, chapter.path));
    if (!snapshot || snapshot.sha256 !== chapter.hash) throw staleSource();
    let envelope: ReturnType<typeof readHistoryEnvelope>;
    try {
      envelope = readHistoryEnvelope(decoder.decode(snapshot.bytes));
    } catch {
      throw new HistoryError("saved-source-required", "History needs a readable chapter with a saved identity. Save the chapter normally, then try again.");
    }
    const meta = envelope.metadata;
    if (!meta || typeof meta !== "object" || !("id" in meta) || meta.id !== scope.chapterId) {
      throw new HistoryError("saved-source-required", "Save this chapter normally to establish its stable identity before using history.");
    }
    if ("schemaVersion" in meta && meta.schemaVersion !== 1) {
      throw new HistoryError(typeof meta.schemaVersion === "number" && meta.schemaVersion > 1 ? "newer-schema" : "corrupt",
        "This chapter's schema is not supported by history. Keep the file and check for an app update.");
    }
    return { ...chapter, content: normalizeBody(chapter.content) };
  }
}

function staleSource(): HistoryError {
  return new HistoryError("stale-source", "The saved chapter changed. Read its current saved version and try again; no chapter text was changed by history.");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
