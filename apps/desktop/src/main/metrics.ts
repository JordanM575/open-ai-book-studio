import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  summarizeToolMetrics,
  type ToolCallRecord,
  type ToolMetricsSummary
} from "@ai-book-studio/core/agent/metrics";

/**
 * The per-book tool metrics log.
 *
 * It sits beside the usage log in the library's derived `.studio` folder and follows the same
 * append-only pattern: a damaged line is skipped, and losing the file loses the metrics, never
 * prose.
 */
export class MetricsStore {
  constructor(private readonly libraryRoot: string | (() => string | null)) {}

  async append(bookId: string, record: ToolCallRecord): Promise<void> {
    const path = this.pathFor(bookId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async read(bookId: string): Promise<ToolCallRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(bookId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: ToolCallRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ToolCallRecord;
        if (typeof parsed?.name === "string" && typeof parsed?.ok === "boolean") {
          records.push(parsed);
        }
      } catch {
        // A partial line from a crash is ignored; the next call appends a complete one.
      }
    }
    return records;
  }

  async summary(bookId: string): Promise<ToolMetricsSummary> {
    return summarizeToolMetrics(await this.read(bookId));
  }

  private pathFor(bookId: string): string {
    if (!/^book_[A-Za-z0-9-]{6,}$/.test(bookId)) {
      throw new Error("Invalid book id for the metrics log.");
    }
    const root = typeof this.libraryRoot === "function" ? this.libraryRoot() : this.libraryRoot;
    if (!root) throw new Error("No library is open.");
    return join(root, ".studio", "metrics", `${bookId}.jsonl`);
  }
}
