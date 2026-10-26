import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
import { CheckpointStore } from "../src/main/agent/checkpoints";
import { createChapterTools } from "../src/main/agent/tools";
import { Library } from "../src/main/library/store";

let root = "";
let library: Library;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-checkpoints-"));
  library = await Library.open(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function runtimeFor(target: Library): AgentRuntime {
  const studio = { library: target, requireLibrary: () => target } as unknown as Studio;
  return new AgentRuntime(studio, {} as ProviderService, () => {});
}

describe("checkpoint store", () => {
  test("saves the newest checkpoint and removes it", async () => {
    const store = new CheckpointStore(root);
    const book = await library.createBook({ title: "The Salt Road" });
    const chapter = await library.createChapter(book.id, { title: "The Door", content: "Before.\n" });
    const saved = await store.save({
      turnId: "turn_test000001",
      bookId: book.id,
      at: new Date().toISOString(),
      prompt: "Tighten the opening.",
      entries: [{ chapterId: chapter.id, title: chapter.title, before: chapter.content }]
    });
    expect(saved.endsWith(".json")).toBe(true);

    const latest = await store.latest(book.id);
    expect(latest?.turnId).toBe("turn_test000001");
    expect(latest?.entries[0]?.before).toBe("Before.\n");

    await store.remove(book.id, latest!.file);
    expect(await store.latest(book.id)).toBeNull();
  });

  test("ignores damaged checkpoint files", async () => {
    const store = new CheckpointStore(root);
    const book = await library.createBook({ title: "The Salt Road" });
    await store.save({
      turnId: "turn_test000002",
      bookId: book.id,
      at: new Date().toISOString(),
      prompt: "Cut a line.",
      entries: []
    });
    await Bun.write(join(root, "books", book.id, ".studio", "checkpoints", "0000-bad.json"), "{not json");

    const latest = await store.latest(book.id);
    expect(latest?.turnId).toBe("turn_test000002");
  });
});

describe("agent turn undo", () => {
  test("restores the text a turn replaced", async () => {
    const runtime = runtimeFor(library);
    const book = await library.createBook({ title: "The Salt Road" });
    const chapter = await library.createChapter(book.id, {
      title: "The Door",
      content: "The door was open.\n\nThe hall was cold.\n"
    });

    const store = new CheckpointStore(root);
    await store.save({
      turnId: "turn_test000003",
      bookId: book.id,
      at: new Date().toISOString(),
      prompt: "Make it warmer.",
      entries: [{ chapterId: chapter.id, title: chapter.title, before: chapter.content }]
    });
    await library.saveChapter(book.id, chapter.id, "The door was open.\n\nThe hall was warm.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    const result = await runtime.undoLast(book.id);
    expect(result).toEqual({ restored: 1, skipped: 0 });
    const disk = await library.readChapter(book.id, chapter.id);
    expect(disk.content).toBe("The door was open.\n\nThe hall was cold.\n");
    expect(await store.latest(book.id)).toBeNull();
  });

  test("reports when there is nothing to undo", async () => {
    const runtime = runtimeFor(library);
    const book = await library.createBook({ title: "The Salt Road" });
    await expect(runtime.undoLast(book.id)).rejects.toThrow("There is no agent turn to undo in this book.");
  });
});

describe("tool change capture", () => {
  test("reports the text before a replacement", async () => {
    const book = await library.createBook({ title: "The Salt Road" });
    const chapter = await library.createChapter(book.id, { title: "The Door", content: "The hall was cold.\n" });
    const seen: { chapterId: string; before: string }[] = [];
    const tools = createChapterTools(library, book.id, (change) => {
      seen.push({ chapterId: change.chapterId, before: change.before });
    });
    const replace = tools.replace_in_chapter as unknown as {
      execute: (input: { chapterId: string; find: string; replace: string }, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
    };
    const result = (await replace.execute(
      { chapterId: chapter.id, find: "cold", replace: "warm" },
      { toolCallId: "call_1", messages: [] }
    )) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(seen).toEqual([{ chapterId: chapter.id, before: "The hall was cold.\n" }]);
  });
});
