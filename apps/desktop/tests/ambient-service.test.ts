import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { AmbientService, describeChange } from "../src/main/agent/ambient";
import { CheckpointStore } from "../src/main/agent/checkpoints";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-ambient-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  await library.createChapter(book.id, { title: "The Light", content: "The storm came in low.\n" });
  await library.createChapter(book.id, { title: "The Door", content: "The door opened.\n" });
  return { root, library, book };
}

describe("the ambient service", () => {
  test("knows the state of a book with no conversation at all", async () => {
    const { library, book } = await fixture();
    const status = await new AmbientService(() => library).status(book.id);
    expect(status.book.title).toBe("The Salt Road");
    expect(status.progress.chapters).toBe(2);
    expect(status.progress.words).toBeGreaterThan(0);
    expect(status.lastChange).toBeNull();
    expect(status.say).toMatch(/The Salt Road/);
  });

  test("reports what the agent last changed", async () => {
    const { root, library, book } = await fixture();
    const store = new CheckpointStore(root);
    await store.save({
      turnId: "turn_test00001",
      bookId: book.id,
      at: new Date().toISOString(),
      prompt: "Carry on.",
      entries: [{ chapterId: "ch_test00001", title: "The Light", before: "" }]
    });
    const status = await new AmbientService(() => library).status(book.id);
    expect(status.lastChange?.what).toBe("I changed The Light");
    expect(status.actions.find((action) => action.id === "undo")?.available).toBe(true);
  });

  test("knows the chapter the author is in", async () => {
    const { library, book } = await fixture();
    const { chapters } = await library.readBook(book.id);
    const status = await new AmbientService(() => library).status(book.id, chapters[0]!.id);
    expect(status.chapter?.title).toBe("The Light");
  });

  test("reports that the agent is working, so Stop can be offered", async () => {
    const { library, book } = await fixture();
    const idle = await new AmbientService(() => library).status(book.id);
    expect(idle.working).toBe(false);
    expect(idle.actions.find((action) => action.id === "stop")?.available).toBe(false);
    const busy = await new AmbientService(() => library, () => true).status(book.id);
    expect(busy.working).toBe(true);
    expect(busy.actions.find((action) => action.id === "stop")?.available).toBe(true);
    expect(busy.say).toMatch(/working on/i);
  });

  test("cannot keep going until a model is chosen", async () => {
    const { library, book } = await fixture();
    const without = await new AmbientService(() => library).status(book.id);
    expect(without.actions.find((action) => action.id === "keep_going")?.available).toBe(false);
    await library.updateBook(book.id, {
      defaultConnectionId: "conn_test0001",
      defaultModelId: "test-model"
    });
    const with_model = await new AmbientService(() => library).status(book.id);
    expect(with_model.actions.find((action) => action.id === "keep_going")?.available).toBe(true);
  });
});

describe("describing a change", () => {
  test("says what happened, in a phrase a person can hear", () => {
    expect(describeChange({ at: "2026-10-26T12:00:00.000Z", entries: [{ title: "The Light" }] }).what).toBe(
      "I changed The Light"
    );
    expect(
      describeChange({ at: "2026-10-26T12:00:00.000Z", entries: [{ title: "The Door", created: true }] }).what
    ).toBe("I wrote The Door");
    expect(
      describeChange({ at: "2026-10-26T12:00:00.000Z", entries: [{ title: "The Door", deleted: true }] }).what
    ).toBe("I removed The Door");
  });

  test("counts the rest when there was more than one chapter", () => {
    const what = describeChange({
      at: "2026-10-26T12:00:00.000Z",
      entries: [{ title: "One" }, { title: "Two" }, { title: "Three" }]
    }).what;
    expect(what).toBe("I changed One and 2 more");
  });
});
