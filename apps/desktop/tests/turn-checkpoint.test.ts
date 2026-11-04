import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import type { BookMeta, Chapter } from "@ai-book-studio/core/schema";
import type { ProviderService } from "../src/main/providers";
import type { Studio } from "../src/main/studio";
import { AgentRuntime } from "../src/main/agent/runtime";
import { CheckpointStore, recordChange, type CheckpointEntry } from "../src/main/agent/checkpoints";
import { Library } from "../src/main/library/store";

/*
 * One turn is one checkpoint and one undo, however many approvals it pauses for. These tests drive
 * whole turns through a mock model: each step calls tools or answers, and the author approves or
 * denies the destructive calls in between.
 */

let root = "";
let library: Library;
let book: BookMeta;

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type Done = Extract<AgentEvent, { type: "done" }>;
type Approval = Extract<AgentEvent, { type: "approval" }>;
type Stopped = Extract<AgentEvent, { type: "stopped" }>;

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 12, text: 12, reasoning: undefined }
};

const credential: StoredCredential = {
  id: "conn_test0001",
  provider: "openrouter",
  label: "Test connection",
  kind: "api-key",
  createdAt: "2026-10-25T00:00:00.000Z",
  secret: "sk-test"
};

// Every wait races a deadline, and the deadlines are cleared after each test so none can fire into
// another file's test.
const deadlines = new Set<ReturnType<typeof setTimeout>>();

function deadline(reject: (error: Error) => void, message: string): void {
  deadlines.add(setTimeout(() => reject(new Error(message)), 5_000));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-turn-checkpoint-"));
  library = await Library.open(root);
  book = await library.createBook({ title: "The Salt Road" });
  await library.updateBook(book.id, {
    defaultProvider: "openrouter",
    defaultConnectionId: credential.id,
    defaultModelId: "test-model"
  });
});

afterEach(async () => {
  for (const timer of deadlines) clearTimeout(timer);
  deadlines.clear();
  await rm(root, { recursive: true, force: true });
});

function providers(): ProviderService {
  return {
    credential: async () => credential,
    models: async () => ({
      models: [
        {
          id: "test-model",
          name: "Test Model",
          contextLength: 1_000,
          supportsTools: true,
          supportsImages: false,
          inputPricePerMillion: null,
          outputPricePerMillion: null
        }
      ],
      fetchedAt: "2026-10-25T00:00:00.000Z"
    })
  } as unknown as ProviderService;
}

let calls = 0;

/** One model step: it calls these tools together, or, with none, answers in words. */
function step(tools: Array<[name: string, input: Record<string, unknown>]>, text = "Done."): StreamResult {
  const parts: StreamPart[] =
    tools.length > 0
      ? tools.map(([toolName, input]) => {
          calls += 1;
          return { type: "tool-call", toolCallId: `call-${calls}`, toolName, input: JSON.stringify(input) };
        })
      : [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" }
        ];
  return {
    stream: simulateReadableStream<StreamPart>({
      chunks: [
        { type: "stream-start", warnings: [] },
        ...parts,
        {
          type: "finish",
          finishReason: { unified: tools.length > 0 ? "tool-calls" : "stop", raw: undefined },
          usage: USAGE
        }
      ]
    })
  };
}

/** A step, or a step written when the model reaches it, for a call that names what an earlier one made. */
type Step = StreamResult | (() => Promise<StreamResult>);

/**
 * Run one turn of these steps, answering its approvals in order, and wait for it to finish.
 */
async function runTurn(
  steps: Step[],
  answers: boolean[] = []
): Promise<{ runtime: AgentRuntime; finished: Done }> {
  const script = [...steps];
  const model = new MockLanguageModelV4({
    doStream: (async () => {
      const next = script.shift();
      if (!next) throw new Error("The model has no step left.");
      return typeof next === "function" ? next() : next;
    }) as MockLanguageModelV4["doStream"]
  });
  const arrived: Approval[] = [];
  const waiting: Array<(event: Approval) => void> = [];
  let resolveDone!: (event: Done) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<Done>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
    deadline(reject, "The turn did not finish.");
  });
  const runtime = new AgentRuntime(
    { library, requireLibrary: () => library } as unknown as Studio,
    providers(),
    (event) => {
      if (event.type === "approval") {
        const next = waiting.shift();
        if (next) next(event);
        else arrived.push(event);
      }
      if (event.type === "done") resolveDone(event);
      if (event.type === "error") rejectDone(new Error(event.message));
    },
    () => model
  );
  const nextApproval = (): Promise<Approval> => {
    const ready = arrived.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      waiting.push(resolve);
      deadline(reject, "The approval request did not arrive.");
    });
  };

  const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Work on the book." });
  for (const approved of answers) {
    const request = await nextApproval();
    await runtime.approve(started.turnId, request.approvalId, approved);
  }
  return { runtime, finished: await done };
}

function chapter(title: string, content: string): Promise<Chapter> {
  return library.createChapter(book.id, { title, content });
}

async function checkpointFiles(): Promise<string[]> {
  const names = await readdir(join(root, "books", book.id, ".studio", "checkpoints")).catch(() => []);
  return names.filter((name) => name.endsWith(".json"));
}

async function text(chapterId: string): Promise<string> {
  return (await library.readChapter(book.id, chapterId)).content;
}

describe("a turn's checkpoint", () => {
  test("holds a chapter changed after an approval, so one undo restores both", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\nIt smoked a little.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
        step([["overwrite_chapter", { chapterId: lamp.id, content: "The lamp was out.\n" }]]),
        step([], "I added a line to the door and replaced the lamp.")
      ],
      [true]
    );

    expect(finished.changed).toBe(2);
    expect(finished.undoAvailable).toBe(true);
    expect(await text(door.id)).toBe("The door was shut.\n\nWind came under it.\n");
    expect(await text(lamp.id)).toBe("The lamp was out.\n");
    // The turn wrote its checkpoint more than once, always to the same file.
    expect(await checkpointFiles()).toHaveLength(1);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    expect(await text(door.id)).toBe(door.content);
    expect(await text(lamp.id)).toBe(lamp.content);
    // One undo used the turn up, and left no partial checkpoint behind.
    expect(await checkpointFiles()).toHaveLength(0);
    expect(await new CheckpointStore(root).latest(book.id)).toBeNull();
  });

  test("holds every chapter across two approvals in one turn", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\nIt smoked a little.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["overwrite_chapter", { chapterId: door.id, content: "The door stood open.\n" }]]),
        step([["delete_lines_in_chapter", { chapterId: lamp.id, startLine: 2, endLine: 2 }]]),
        step([], "I opened the door and cut the smoke.")
      ],
      [true, true]
    );

    expect(finished.changed).toBe(2);
    expect(await text(door.id)).toBe("The door stood open.\n");
    expect(await text(lamp.id)).toBe("The lamp was lit.\n");

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    expect(await text(door.id)).toBe(door.content);
    expect(await text(lamp.id)).toBe(lamp.content);
  });

  test("a denied approval writes nothing, and undo still restores the earlier write", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
        step([["overwrite_chapter", { chapterId: lamp.id, content: "The lamp was out.\n" }]]),
        step([], "I left the lamp alone.")
      ],
      [false]
    );

    expect(finished.changed).toBe(1);
    const denied = await library.readChapter(book.id, lamp.id);
    expect([denied.content, denied.version, denied.hash]).toEqual([lamp.content, lamp.version, lamp.hash]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    expect(await text(door.id)).toBe(door.content);
    // Undo never touched the chapter the author kept.
    const kept = await library.readChapter(book.id, lamp.id);
    expect([kept.content, kept.version, kept.hash]).toEqual([lamp.content, lamp.version, lamp.hash]);
  });

  test("undo moves a chapter the turn created to the trash", async () => {
    const door = await chapter("The Door", "The door was shut.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["overwrite_chapter", { chapterId: door.id, content: "The door stood open.\n" }]]),
        step([["create_chapter", { title: "The Shore", content: "The tide was out.\n" }]]),
        step([], "I opened the door and began the shore.")
      ],
      [true]
    );

    expect(finished.changed).toBe(2);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual([
      "The Door",
      "The Shore"
    ]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    const after = await library.readBook(book.id);
    expect(after.chapters.map((entry) => [entry.id, entry.content])).toEqual([[door.id, door.content]]);
    // Not deleted for good: the new chapter's file is in the book's trash, text and all.
    const trash = join(root, ".studio", "trash", book.id);
    const trashed = await readdir(trash);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatch(/the-shore\.md$/);
    expect(await readFile(join(trash, trashed[0] ?? ""), "utf8")).toContain("The tide was out.");
  });

  test("undo skips a chapter the author changed after the turn and restores the rest", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
        step([["overwrite_chapter", { chapterId: lamp.id, content: "The lamp was out.\n" }]]),
        step([], "I added a line to the door and replaced the lamp.")
      ],
      [true]
    );
    expect(finished.changed).toBe(2);

    // The author goes on writing in the lamp chapter after the turn.
    const left = await library.readChapter(book.id, lamp.id);
    const typed = await library.saveChapter(book.id, lamp.id, "The lamp was out. Mara relit it.\n", {
      baseVersion: left.version,
      baseHash: left.hash
    });
    expect(typed.status).toBe("saved");

    const undone = await runtime.undoLast(book.id);
    // The result says one chapter was skipped; the chat turns that into its "skipped 1" note.
    expect(undone).toEqual({ restored: 1, skipped: 1 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    expect(await text(door.id)).toBe(door.content);
    expect(await text(lamp.id)).toBe("The lamp was out. Mara relit it.\n");
  });

  test("a split that renumbers a chapter changed earlier does not make undo skip it", async () => {
    const door = await chapter("The Door", "One.\nTwo.\nThree.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: lamp.id, text: "It smoked." }]]),
        step([["split_chapter", { chapterId: door.id, line: 2 }]]),
        step([], "I added a line to the lamp and split the door.")
      ],
      [true]
    );

    expect(finished.changed).toBe(3);
    const split = await library.readBook(book.id);
    expect(split.chapters.map((entry) => entry.title)).toEqual(["The Door", "The Door (continued)", "The Lamp"]);
    // The split pushed the lamp from second to third: its front matter changed, its text did not.
    // Version 1 when created, 2 after the append, 3 after the split renumbered it.
    const renumbered = split.chapters[2];
    expect(renumbered?.order).toBe(3);
    expect(renumbered?.version).toBe(3);
    expect(renumbered?.content).toBe("The lamp was lit.\n\nIt smoked.\n");

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 3, skipped: 0 });
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    const restored = await library.readBook(book.id);
    expect(restored.chapters.map((entry) => [entry.id, entry.content])).toEqual([
      [door.id, door.content],
      [lamp.id, lamp.content]
    ]);
  });

  test("two changes in one step both reach the one checkpoint", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");

    const { runtime, finished } = await runTurn([
      step([
        ["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }],
        ["append_to_chapter", { chapterId: lamp.id, text: "It smoked." }]
      ]),
      step([], "I added a line to each.")
    ]);

    expect(finished.changed).toBe(2);
    expect(await checkpointFiles()).toHaveLength(1);
    const saved = await new CheckpointStore(root).latest(book.id);
    expect(saved?.entries.map((entry) => entry.chapterId).sort()).toEqual([door.id, lamp.id].sort());

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect(await text(door.id)).toBe(door.content);
    expect(await text(lamp.id)).toBe(lamp.content);
  });

  test("undo brings back a chapter the turn deleted, where it stood", async () => {
    await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    await chapter("Three", "Three.\n");

    const { runtime, finished } = await runTurn(
      [step([["delete_chapter", { chapterId: two.id }]]), step([], "I moved Two to the trash.")],
      [true]
    );

    expect(finished.changed).toBe(1);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual(["One", "Three"]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    // The chapter comes back as a new file with the same title and text, in its old place.
    expect((await library.readBook(book.id)).chapters.map((entry) => [entry.title, entry.content])).toEqual([
      ["One", "One.\n"],
      ["Two", "Two.\n"],
      ["Three", "Three.\n"]
    ]);
  });

  test("undo puts a merged chapter back in its place when the chapter numbers have a gap", async () => {
    await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");
    const four = await chapter("Four", "Four.\n");
    await chapter("Five", "Five.\n");
    // An earlier deletion leaves the order numbers 1, 3, 4, 5: Four is number 4 but stands third.
    await library.deleteChapter(book.id, two.id);

    const { runtime, finished } = await runTurn(
      [
        step([["merge_chapters", { firstChapterId: three.id, secondChapterId: four.id }]]),
        step([], "I merged Four into Three.")
      ],
      [true]
    );

    expect(finished.changed).toBe(2);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual(["One", "Three", "Five"]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect((await library.readBook(book.id)).chapters.map((entry) => [entry.title, entry.content])).toEqual([
      ["One", "One.\n"],
      ["Three", "Three.\n"],
      ["Four", "Four.\n"],
      ["Five", "Five.\n"]
    ]);
  });

  test("undo puts a chapter the turn moved back in its place", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");

    const { runtime, finished } = await runTurn(
      [step([["move_chapter", { chapterId: one.id, position: 3 }]]), step([], "I moved One to the end.")],
      [true]
    );

    expect(finished.changed).toBe(1);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.id)).toEqual([two.id, three.id, one.id]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.id)).toEqual([one.id, two.id, three.id]);
  });

  test("a chapter created and deleted in the same turn leaves nothing to undo", async () => {
    const { runtime, finished } = await runTurn(
      [
        step([["create_chapter", { title: "The Shore", content: "The tide was out.\n" }]]),
        async () => {
          const { chapters } = await library.readBook(book.id);
          const shore = chapters.find((entry) => entry.title === "The Shore");
          return step([["delete_chapter", { chapterId: shore?.id ?? "missing" }]]);
        },
        step([], "I began the shore and thought better of it.")
      ],
      [true]
    );

    expect(finished.changed).toBe(0);
    expect((await library.readBook(book.id)).chapters).toHaveLength(0);
    // The checkpoint written for the new chapter went away with it.
    expect(await checkpointFiles()).toHaveLength(0);
    await expect(runtime.undoLast(book.id)).rejects.toThrow("no agent turn to undo");
  });

  test("stopping a turn while it waits keeps what it changed undoable", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");
    const model = new MockLanguageModelV4({
      doStream: [
        step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
        step([["overwrite_chapter", { chapterId: lamp.id, content: "The lamp was out.\n" }]])
      ]
    });
    let resolveApproval!: (event: Approval) => void;
    let resolveStopped!: (event: Stopped) => void;
    const approval = new Promise<Approval>((resolve, reject) => {
      resolveApproval = resolve;
      deadline(reject, "The approval request did not arrive.");
    });
    const stopped = new Promise<Stopped>((resolve, reject) => {
      resolveStopped = resolve;
      deadline(reject, "The turn did not stop.");
    });
    const runtime = new AgentRuntime(
      { library, requireLibrary: () => library } as unknown as Studio,
      providers(),
      (event) => {
        if (event.type === "approval") resolveApproval(event);
        if (event.type === "stopped") resolveStopped(event);
      },
      () => model
    );

    const started = await runtime.start({ mode: "edit", bookId: book.id, prompt: "Work on the book." });
    await approval;
    await runtime.stop(started.turnId);
    const event = await stopped;

    expect(event.changed).toBe(1);
    expect(event.undoAvailable).toBe(true);
    expect(await text(lamp.id)).toBe(lamp.content);
    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    expect(await text(door.id)).toBe(door.content);
  });
});

describe("recording a turn's changes", () => {
  test("keeps the text a chapter had before the turn first wrote it", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "First.\n", afterHash: "one" });
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Second.\n", afterHash: "two" });
    expect(entries).toEqual([{ chapterId: "ch_door", title: "The Door", before: "First.\n", afterHash: "two" }]);
  });

  test("a chapter changed and then deleted is recreated from its first text, after the later changes", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "First.\n", afterHash: "one" });
    recordChange(entries, { chapterId: "ch_lamp", title: "The Lamp", before: "Lit.\n", afterHash: "two" });
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Edited.\n", deleted: true, order: 1 });
    expect(entries.map((entry) => entry.chapterId)).toEqual(["ch_lamp", "ch_door"]);
    expect(entries[1]).toMatchObject({ before: "First.\n", deleted: true, order: 1 });
  });

  test("a moved chapter keeps the place it had before its first move", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Door.\n", order: 1, afterHash: "a" });
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Door.\n", order: 3, afterHash: "a" });
    expect(entries).toEqual([{ chapterId: "ch_door", title: "The Door", before: "Door.\n", order: 1, afterHash: "a" }]);
  });

  test("a chapter created and deleted in one turn leaves no entry", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_shore", title: "The Shore", before: "", created: true, afterHash: "a" });
    recordChange(entries, { chapterId: "ch_shore", title: "The Shore", before: "Tide.\n", deleted: true, order: 2 });
    expect(entries).toEqual([]);
  });
});
