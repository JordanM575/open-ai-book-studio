import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UsageStore } from "../src/main/usage";

const roots: string[] = [];

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "abs-usage-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const first = {
  at: "2026-10-24T12:00:00.000Z",
  bookId: "book_usage00001",
  provider: "openrouter" as const,
  connectionId: "conn_usage00001",
  modelId: "openai/gpt-5-mini",
  inputTokens: 1000,
  outputTokens: 200,
  cachedInputTokens: 100,
  costUsd: 0.0042,
  costBasis: "reported" as const,
  steps: 3
};

describe("usage store", () => {
  test("appends one line per turn and summarizes them", async () => {
    const dir = await root();
    const store = new UsageStore(dir);
    await store.append(first);
    await store.append({ ...first, inputTokens: 500, outputTokens: 100, costUsd: null, costBasis: "unknown" });

    const path = join(dir, ".studio", "usage", `${first.bookId}.jsonl`);
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);

    const summary = await store.summary(first.bookId);
    expect(summary.turns).toBe(2);
    expect(summary.inputTokens).toBe(1500);
    expect(summary.unknownCostTurns).toBe(1);
  });

  test("returns an empty history for a book that has never run", async () => {
    const store = new UsageStore(await root());
    expect(await store.read("book_never000001")).toEqual([]);
  });

  test("skips a damaged line instead of failing the history", async () => {
    const dir = await root();
    const store = new UsageStore(dir);
    await store.append(first);
    const path = join(dir, ".studio", "usage", `${first.bookId}.jsonl`);
    await writeFile(path, `${JSON.stringify(first)}\n{"broken":\n`, "utf8");
    const records = await store.read(first.bookId);
    expect(records).toHaveLength(1);
  });

  test("refuses an invalid book id", async () => {
    const store = new UsageStore(await root());
    await expect(store.append({ ...first, bookId: "../escape" })).rejects.toThrow("Invalid book id");
  });

  test("refuses to write without an open library", async () => {
    const store = new UsageStore(() => null);
    await expect(store.append(first)).rejects.toThrow("No library is open");
  });
});
