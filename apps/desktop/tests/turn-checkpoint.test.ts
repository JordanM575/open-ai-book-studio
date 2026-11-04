import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
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
 * Run one turn of these steps, answering its approvals in order, and wait for it to finish. The
 * author can act while each approval waits, before it is answered.
 */
async function runTurn(
  steps: Step[],
  answers: boolean[] = [],
  duringPause: (index: number) => Promise<void> = async () => {}
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
  for (const [index, approved] of answers.entries()) {
    const request = await nextApproval();
    await duringPause(index);
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

/** The author saves a chapter from the editor, against the version on disk. */
async function authorSaves(chapterId: string, write: (content: string) => string): Promise<void> {
  const current = await library.readChapter(book.id, chapterId);
  const saved = await library.saveChapter(book.id, chapterId, write(current.content), {
    baseVersion: current.version,
    baseHash: current.hash
  });
  expect(saved.status).toBe("saved");
}

/** The author changes a chapter's details, against the version on disk. */
async function authorSetsDetails(chapterId: string, patch: Parameters<Library["updateChapterMeta"]>[2]): Promise<void> {
  const current = await library.readChapter(book.id, chapterId);
  const saved = await library.updateChapterMeta(book.id, chapterId, patch, {
    baseVersion: current.version,
    baseHash: current.hash
  });
  expect(saved.status).toBe("saved");
}

/** The raw bytes of a chapter's file, front matter and all. */
async function chapterFile(chapterId: string): Promise<string> {
  const current = await library.readChapter(book.id, chapterId);
  return readFile(join(root, "books", book.id, "chapters", current.path), "utf8");
}

async function trashFiles(): Promise<string[]> {
  return readdir(join(root, ".studio", "trash", book.id)).catch(() => []);
}

async function conflictFiles(): Promise<string[]> {
  return readdir(join(root, "books", book.id, "conflicts")).catch(() => []);
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
    // The result says one chapter was skipped, and which; the chat turns the count into its
    // "skipped 1" note.
    expect(undone).toEqual({
      restored: 1,
      skipped: 1,
      notes: ["“The Lamp” changed after the turn, so undo left it as it is."]
    });
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

  test("undo brings back the chapter the turn deleted, with its id, details and place", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");
    await authorSetsDetails(two.id, { synopsis: "The crossing.", purpose: "Raise the stakes.", notes: "Keep it short." });

    const { runtime, finished } = await runTurn(
      [step([["delete_chapter", { chapterId: two.id }]]), step([], "I moved Two to the trash.")],
      [true]
    );

    expect(finished.changed).toBe(1);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.title)).toEqual(["One", "Three"]);
    expect(await trashFiles()).toHaveLength(1);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    // The file itself comes back out of the trash: the same chapter, not a copy of its text.
    const after = (await library.readBook(book.id)).chapters;
    expect(after.map((entry) => entry.id)).toEqual([one.id, two.id, three.id]);
    const back = after[1];
    expect([back?.title, back?.synopsis, back?.purpose, back?.notes, back?.content]).toEqual([
      "Two",
      "The crossing.",
      "Raise the stakes.",
      "Keep it short.",
      "Two.\n"
    ]);
    expect(await trashFiles()).toEqual([]);
  });

  test("undo writes a deleted chapter again when its file has left the trash, and says so", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");

    const { runtime } = await runTurn(
      [step([["delete_chapter", { chapterId: two.id }]]), step([], "I moved Two to the trash.")],
      [true]
    );
    // The author empties the trash before undoing.
    for (const name of await trashFiles()) await rm(join(root, ".studio", "trash", book.id, name));

    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([1, 0]);
    expect(undone.notes).toEqual([expect.stringContaining("“Two”")]);
    // As before the trash was searched: the title and text return under a new id, in the old place.
    const after = (await library.readBook(book.id)).chapters;
    expect(after.map((entry) => [entry.title, entry.content])).toEqual([
      ["One", "One.\n"],
      ["Two", "Two.\n"],
      ["Three", "Three.\n"]
    ]);
    expect([after[0]?.id, after[2]?.id]).toEqual([one.id, three.id]);
    expect(after[1]?.id).not.toBe(two.id);
  });

  test("a checkpoint from before the trash was recorded still brings a deleted chapter back, and says how", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    await library.deleteChapter(book.id, two.id);
    // Written the way a checkpoint was before `trashedAt` existed.
    await new CheckpointStore(root).save({
      turnId: "turn_older",
      bookId: book.id,
      at: "2026-11-01T00:00:00.000Z",
      prompt: "Delete Two.",
      entries: [{ chapterId: two.id, title: "Two", before: "Two.\n", deleted: true, order: 2 }]
    });
    const runtime = new AgentRuntime(
      { library, requireLibrary: () => library } as unknown as Studio,
      providers(),
      () => {},
      () => new MockLanguageModelV4()
    );

    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([1, 0]);
    expect(undone.notes).toEqual([expect.stringContaining("“Two”")]);
    const after = (await library.readBook(book.id)).chapters;
    expect(after.map((entry) => [entry.title, entry.content])).toEqual([
      ["One", "One.\n"],
      ["Two", "Two.\n"]
    ]);
    expect(after[0]?.id).toBe(one.id);
  });

  test("undo leaves a deleted chapter the author already brought back, instead of writing it twice", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");

    const { runtime } = await runTurn(
      [step([["delete_chapter", { chapterId: two.id }]]), step([], "I moved Two to the trash.")],
      [true]
    );
    // The author moves the file back out of the trash by hand.
    const [trashed] = await trashFiles();
    await rename(join(root, ".studio", "trash", book.id, trashed ?? ""), join(root, "books", book.id, "chapters", two.path));

    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([0, 1]);
    expect(undone.notes).toEqual([expect.stringContaining("“Two”")]);
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.id)).toEqual([one.id, two.id, three.id]);
  });

  test("undo puts a merged chapter back in its place when the chapter numbers have a gap", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");
    const three = await chapter("Three", "Three.\n");
    const four = await chapter("Four", "Four.\n");
    const five = await chapter("Five", "Five.\n");
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
    // The merged-away chapter is the same chapter again, back from the trash.
    expect((await library.readBook(book.id)).chapters.map((entry) => entry.id)).toEqual([
      one.id,
      three.id,
      four.id,
      five.id
    ]);
    expect(await trashFiles()).toHaveLength(1);
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

describe("undo and words the turn did not write", () => {
  test("keeps the author's words from an approval pause as a conflict copy before restoring", async () => {
    const door = await chapter("The Door", "The door was shut.\nIt creaked.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
        step([["delete_lines_in_chapter", { chapterId: door.id, startLine: 2, endLine: 2 }]]),
        step([], "I added the wind and cut the creak.")
      ],
      [true],
      // While the approval waits, the author adds a line of their own.
      () => authorSaves(door.id, (content) => `${content}Mara bolted it.\n`)
    );

    expect(finished.changed).toBe(1);
    expect(await text(door.id)).toBe("The door was shut.\n\nWind came under it.\nMara bolted it.\n");
    const replaced = await chapterFile(door.id);

    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([1, 0]);
    expect(finished.changed).toBe(undone.restored + undone.skipped);
    expect(await text(door.id)).toBe(door.content);
    // The text undo replaced, with the author's line in it, is kept first, named like any conflict copy.
    expect(undone.kept).toHaveLength(1);
    const kept = undone.kept?.[0];
    expect([kept?.chapterId, kept?.title]).toEqual([door.id, "The Door"]);
    expect(kept?.savedAs).toMatch(
      new RegExp(`^books/${book.id}/conflicts/0001-the-door\\.conflict-undo\\.device_[a-f0-9]+\\.[0-9TZ-]+\\.md$`)
    );
    expect(await conflictFiles()).toHaveLength(1);
    expect(await readFile(join(root, kept?.savedAs ?? ""), "utf8")).toBe(replaced);
    expect(replaced).toContain("Mara bolted it.");
    // The result names the chapter and the copy.
    expect(undone.notes).toEqual([expect.stringContaining("“The Door”")]);
    expect(undone.notes?.[0]).toContain(kept?.savedAs ?? "missing");
  });

  test("keeps the author's words in a chapter the turn changed and then deleted", async () => {
    const one = await chapter("One", "One.\n");
    const two = await chapter("Two", "Two.\n");

    const { runtime, finished } = await runTurn(
      [
        step([["append_to_chapter", { chapterId: two.id, text: "The agent's line." }]]),
        step([["delete_chapter", { chapterId: two.id }]]),
        step([], "I added a line and then removed the chapter.")
      ],
      [true],
      () => authorSaves(two.id, (content) => `${content}The author's line.\n`)
    );

    expect(finished.changed).toBe(1);
    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([1, 0]);
    // The chapter is back with its id and the text it had before the turn...
    expect((await library.readBook(book.id)).chapters.map((entry) => [entry.id, entry.content])).toEqual([
      [one.id, "One.\n"],
      [two.id, "Two.\n"]
    ]);
    // ...and the text it was deleted with, the author's line included, is kept as a conflict copy.
    const kept = undone.kept?.[0];
    expect(kept?.chapterId).toBe(two.id);
    expect(await readFile(join(root, kept?.savedAs ?? ""), "utf8")).toContain(
      "Two.\n\nThe agent's line.\nThe author's line.\n"
    );
  });

  test("keeps no copy when nothing came between the turn's own writes", async () => {
    const door = await chapter("The Door", "The door was shut.\n");

    const { runtime, finished } = await runTurn([
      step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
      step([["replace_in_chapter", { chapterId: door.id, find: "Wind", replace: "Rain" }]]),
      step([], "I added the rain.")
    ]);

    expect(finished.changed).toBe(1);
    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    expect(await text(door.id)).toBe(door.content);
    expect(await conflictFiles()).toEqual([]);
  });
});

describe("undo and a chapter's details", () => {
  test("puts back the details the turn changed, with the text", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    await authorSetsDetails(door.id, { synopsis: "The keeper wakes.", purpose: "Open the book." });

    const { runtime, finished } = await runTurn([
      step([
        [
          "set_chapter_meta",
          { chapterId: door.id, title: "The Gate", synopsis: "The keeper sleeps.", purpose: "Close the book." }
        ]
      ]),
      step([["append_to_chapter", { chapterId: door.id, text: "Wind came under it." }]]),
      step([], "I renamed the door and added the wind.")
    ]);

    expect(finished.changed).toBe(1);
    const changed = await library.readChapter(book.id, door.id);
    expect([changed.title, changed.synopsis, changed.purpose]).toEqual(["The Gate", "The keeper sleeps.", "Close the book."]);

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    const back = await library.readChapter(book.id, door.id);
    expect([back.title, back.synopsis, back.purpose, back.content]).toEqual([
      "The Door",
      "The keeper wakes.",
      "Open the book.",
      door.content
    ]);
  });

  test("skips a chapter whose details changed after the turn, names it, and restores the rest", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    const lamp = await chapter("The Lamp", "The lamp was lit.\n");

    const { runtime, finished } = await runTurn([
      step([
        ["set_chapter_meta", { chapterId: door.id, synopsis: "The keeper sleeps." }],
        ["append_to_chapter", { chapterId: lamp.id, text: "It smoked." }]
      ]),
      step([], "I wrote a synopsis and added smoke.")
    ]);
    expect(finished.changed).toBe(2);

    // After the turn, the author writes a synopsis of their own.
    await authorSetsDetails(door.id, { synopsis: "Mara's synopsis." });

    const undone = await runtime.undoLast(book.id);
    expect([undone.restored, undone.skipped]).toEqual([1, 1]);
    expect(undone.notes).toEqual([expect.stringContaining("“The Door”")]);
    expect((await library.readChapter(book.id, door.id)).synopsis).toBe("Mara's synopsis.");
    expect(await text(lamp.id)).toBe(lamp.content);
  });

  test("restores every detail a checkpoint holds: notes, arc, colour and the prologue flag too", async () => {
    const door = await chapter("The Door", "The door was shut.\n");
    await authorSetsDetails(door.id, {
      title: "The Gate",
      synopsis: "S.",
      purpose: "P.",
      notes: "N.",
      arc: "end",
      color: "blue",
      isPrologue: true
    });
    // A checkpoint written by hand, because no tool changes the last four details yet.
    await new CheckpointStore(root).save({
      turnId: "turn_synthetic",
      bookId: book.id,
      at: "2026-11-04T00:00:00.000Z",
      prompt: "Change the details.",
      entries: [
        {
          chapterId: door.id,
          title: "The Door",
          before: door.content,
          meta: { title: "The Door", synopsis: "", purpose: "", notes: "", arc: "middle", color: null, isPrologue: false }
        } as CheckpointEntry
      ]
    });
    const runtime = new AgentRuntime(
      { library, requireLibrary: () => library } as unknown as Studio,
      providers(),
      () => {},
      () => new MockLanguageModelV4()
    );

    const undone = await runtime.undoLast(book.id);
    expect(undone).toEqual({ restored: 1, skipped: 0 });
    const back = await library.readChapter(book.id, door.id);
    expect([back.title, back.synopsis, back.purpose, back.notes, back.arc, back.color, back.isPrologue]).toEqual([
      "The Door",
      "",
      "",
      "",
      "middle",
      null,
      false
    ]);
  });
});

describe("recording a turn's changes", () => {
  test("a change that finds text the turn did not leave marks the chapter as edited outside it", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "First.\n", beforeHash: "zero", afterHash: "one" });
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Typed.\n", beforeHash: "typed", afterHash: "two" });
    expect(entries).toEqual([
      { chapterId: "ch_door", title: "The Door", before: "First.\n", afterHash: "two", outsideEdit: true }
    ]);
  });

  test("a change that finds the text the turn left marks nothing, and keeps no hash of it", () => {
    const entries: CheckpointEntry[] = [];
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "First.\n", beforeHash: "zero", afterHash: "one" });
    recordChange(entries, { chapterId: "ch_door", title: "The Door", before: "Second.\n", beforeHash: "one", afterHash: "two" });
    expect(entries).toEqual([{ chapterId: "ch_door", title: "The Door", before: "First.\n", afterHash: "two" }]);
  });

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
