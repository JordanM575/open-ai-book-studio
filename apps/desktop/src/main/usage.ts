import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  summarizeUsage,
  usageRecordSchema,
  type UsageRecord,
  type UsageSummary
} from "@ai-book-studio/core/providers/usage";

/**
 * Append-only usage log per book, inside the library's derived `.studio` folder. It is not part of
 * the manuscript: losing it loses spend history, never prose. A damaged line is skipped, not thrown.
 */
export class UsageStore {
  constructor(private readonly libraryRoot: string | (() => string | null)) {}

  async append(record: UsageRecord): Promise<void> {
    const parsed = usageRecordSchema.parse(record);
    const path = this.pathFor(parsed.bookId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(parsed)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async read(bookId: string): Promise<UsageRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(bookId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: UsageRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = usageRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success) records.push(parsed.data);
      } catch {
        // A partial line from a crash is ignored; the next turn appends a complete one.
      }
    }
    return records;
  }

  async summary(bookId: string): Promise<UsageSummary> {
    return summarizeUsage(await this.read(bookId));
  }

  private pathFor(bookId: string): string {
    if (!/^(book|ch|char|mem|thread|cp)_[A-Za-z0-9-]{6,}$/.test(bookId)) {
      throw new Error("Invalid book id for the usage log.");
    }
    const root = typeof this.libraryRoot === "function" ? this.libraryRoot() : this.libraryRoot;
    if (!root) throw new Error("No library is open.");
    return join(root, ".studio", "usage", `${bookId}.jsonl`);
  }
}
