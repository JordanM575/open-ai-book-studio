import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Library } from "../src/main/library/store";
import { LocalBackend } from "../src/main/backend";
import { ToolBridge } from "../src/main/agent/tool-bridge";
import { createChapterTools } from "../src/main/agent/tools";
import { BackendClient } from "../../toolkit/src/backend-client";

/*
 * `book.json` holds the Story Bible, and other writers share it: another device through a sync
 * folder, the agent's book tools and the `bookwriter` toolkit. These checks write the file the way
 * those writers do, then read the bytes back, so what they prove is what lands on disk.
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const NOW = "2026-11-04T08:00:00.000Z";
// A 1×1 PNG, small enough to keep inline.
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

/** What a newer build adds: a field this build does not know, at every level it could appear. */
const FUTURE = { addedBy: "a newer build", weights: [1, 2] };

// biome-ignore lint/suspicious/noExplicitAny: these checks reshape raw book.json the way another writer would
type Raw = Record<string, any>;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-book-json-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road", outline: "Two sisters." });
  const path = join(root, "books", book.id, "book.json");
  return { root, library, bookId: book.id, path };
}

async function readRaw(path: string): Promise<Raw> {
  return JSON.parse(await readFile(path, "utf8")) as Raw;
}

/** Another writer edits the file directly, as a sync client or a text editor would. */
async function writeRaw(path: string, change: (raw: Raw) => void): Promise<void> {
  const raw = await readRaw(path);
  change(raw);
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
}

/** Every unknown field a newer build might have written inside the nested parts of the Story Bible. */
function withUnknownFields(raw: Raw): void {
  raw.futureTop = FUTURE;
  raw.chapterRange = { minimum: 10, maximum: 20, futureRange: FUTURE };
  raw.storyArc = {
    beginning: { overview: "The tide.", keyMoments: "", openQuestions: "", futureNote: FUTURE },
    middle: { overview: "", keyMoments: "", openQuestions: "" },
    end: { overview: "", keyMoments: "", openQuestions: "" },
    futureArc: FUTURE
  };
  raw.characters = [
    {
      id: "char_mara000001",
      name: "Mara",
      role: "Keeper",
      description: "Keeps the light.",
      motivations: "",
      notes: "",
      futureTrait: FUTURE
    }
  ];
  raw.memories = [
    {
      id: "mem_tide0000001",
      text: "The tide comes in early.",
      importance: "high",
      createdAt: NOW,
      updatedAt: NOW,
      futureSource: FUTURE
    }
  ];
  raw.settings = {
    manuscript: { bodyFont: "Georgia", futureLigatures: FUTURE },
    agent: { disabledTools: [], futureVoice: FUTURE },
    cache: { prefixMode: "auto", futureTtl: FUTURE },
    futureSection: FUTURE
  };
}

function expectUnknownFields(raw: Raw): void {
  expect(raw.futureTop).toEqual(FUTURE);
  expect(raw.chapterRange.futureRange).toEqual(FUTURE);
  expect(raw.storyArc.futureArc).toEqual(FUTURE);
  expect(raw.storyArc.beginning.futureNote).toEqual(FUTURE);
  expect(raw.characters.find((entry: Raw) => entry.id === "char_mara000001")?.futureTrait).toEqual(FUTURE);
  expect(raw.memories.find((entry: Raw) => entry.id === "mem_tide0000001")?.futureSource).toEqual(FUTURE);
  expect(raw.settings.futureSection).toEqual(FUTURE);
  expect(raw.settings.manuscript.futureLigatures).toEqual(FUTURE);
  expect(raw.settings.agent.futureVoice).toEqual(FUTURE);
  expect(raw.settings.cache.futureTtl).toEqual(FUTURE);
}

type Tools = ReturnType<typeof createChapterTools>;

async function run(tools: Tools, name: keyof Tools, input: unknown): Promise<{ ok: boolean; message: string }> {
  const definition = tools[name] as unknown as {
    execute: (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<{ ok: boolean; message: string }>;
  };
  return definition.execute(input, { toolCallId: "test-call", messages: [] });
}

describe("unknown fields inside book.json", () => {
  const saves: Array<[string, (library: Library, bookId: string) => Promise<unknown>]> = [
    ["a rename", (library, bookId) => library.updateBook(bookId, { title: "The Salt Crossing" })],
    [
      "the format settings",
      async (library, bookId) => {
        const { book } = await library.readBook(bookId);
        return library.updateBook(bookId, {
          settings: { ...book.settings, manuscript: { ...book.settings.manuscript, bodyFont: "Garamond" } }
        });
      }
    ],
    ["the agent's update_book_details", (library, bookId) => run(createChapterTools(library, bookId), "update_book_details", { outline: "Three sisters." })],
    ["the agent's update_character", (library, bookId) => run(createChapterTools(library, bookId), "update_character", { name: "Mara", role: "Lighthouse keeper" })],
    ["the agent's add_memory", (library, bookId) => run(createChapterTools(library, bookId), "add_memory", { text: "The lamp was lit at dusk." })],
    [
      "the agent's update_memory",
      (library, bookId) => run(createChapterTools(library, bookId), "update_memory", { memoryId: "mem_tide0000001", importance: "low" })
    ]
  ];

  for (const [kind, save] of saves) {
    test(`survive ${kind}`, async () => {
      const { library, bookId, path } = await fixture();
      await writeRaw(path, withUnknownFields);

      await save(library, bookId);

      expectUnknownFields(await readRaw(path));
    });
  }

  test("reach the reader, so a field a newer build added is still there to write back", async () => {
    const { library, bookId, path } = await fixture();
    await writeRaw(path, withUnknownFields);

    const { book } = await library.readBook(bookId);

    expect((book.characters[0] as Raw).futureTrait).toEqual(FUTURE);
    expect((book.memories[0] as Raw).futureSource).toEqual(FUTURE);
    expect((book.storyArc.beginning as Raw).futureNote).toEqual(FUTURE);
    expect((book.settings as Raw).futureSection).toEqual(FUTURE);
    expect((book.settings.agent as Raw).futureVoice).toEqual(FUTURE);
  });
});

describe("the shapes FORMAT.md documents", () => {
  /** `storyArc` once documented `keyMoments[]` and `openQuestions[]`: a file written to that page. */
  function withArcArrays(raw: Raw): void {
    raw.storyArc = {
      beginning: {
        overview: "The tide.",
        keyMoments: ["The storm arrives.", "The lamp will not turn."],
        openQuestions: ["Who is the ship for?"]
      },
      middle: { overview: "", keyMoments: [], openQuestions: [] },
      end: { overview: "The lamp turns.", keyMoments: ["The door closes."], openQuestions: [] }
    };
    raw.genres = ["Literary fiction"];
    raw.chapterRange = { minimum: 10, maximum: null };
  }

  test("a story arc written with arrays opens, one line per item", async () => {
    const { library, bookId, path } = await fixture();
    await writeRaw(path, withArcArrays);

    const { book } = await library.readBook(bookId);

    expect(book.storyArc.beginning.keyMoments).toBe("The storm arrives.\nThe lamp will not turn.");
    expect(book.storyArc.beginning.openQuestions).toBe("Who is the ship for?");
    expect(book.storyArc.middle.keyMoments).toBe("");
    expect(book.storyArc.end.keyMoments).toBe("The door closes.");
    expect(book.genres).toEqual(["Literary fiction"]);
    expect(book.chapterRange).toEqual({ minimum: 10, maximum: null });
    expect((await library.listBooks()).map((summary) => summary.id)).toContain(bookId);
  });

});

describe("a book upgraded to a newer schema by another device", () => {
  /** Every file in the library folder, byte for byte. */
  async function snapshot(root: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files.set(relative(root, path), (await readFile(path)).toString("base64"));
      }
    };
    await walk(root);
    return files;
  }

  async function upgraded() {
    const { root, library, bookId, path } = await fixture();
    const one = await library.createChapter(bookId, { title: "The Tide", content: "The salt road was under water.\n" });
    const two = await library.createChapter(bookId, { title: "The Crossing", content: "Mara waited for the ebb.\n\nThen she went.\n" });
    const gone = await library.createChapter(bookId, { title: "The Letter", content: "Nobody wrote back.\n" });
    const { trashedAt } = await library.deleteChapter(bookId, gone.id);
    const image = await library.addImage(bookId, { bytes: PNG, kind: "character", prompt: "Mara", provider: "meta", model: "muse-image" });
    const thread = await library.threads.create(bookId, "Planning");
    await library.updateBook(bookId, {
      characters: [{ id: "char_mara000001", name: "Mara", role: "Keeper", description: "", motivations: "", notes: "" }],
      memories: [{ id: "mem_tide0000001", text: "The tide comes in early.", importance: "high", createdAt: NOW, updatedAt: NOW }]
    });
    // The other device's newer build upgrades the book and adds what it knows about.
    await writeRaw(path, (raw) => {
      raw.schemaVersion = 2;
      raw.futureTop = FUTURE;
    });
    const before = await snapshot(root);
    return { root, library, bookId, one, two, gone, trashedAt, image, thread, before };
  }

  type Upgraded = Awaited<ReturnType<typeof upgraded>>;

  /** The write must fail with the plain newer-schema refusal; a tool may report it as a failed call. */
  async function refused(write: () => Promise<unknown>): Promise<void> {
    const copy = "was written by a newer version of Open Book Studio (schema 2)";
    let outcome: unknown;
    try {
      outcome = await write();
    } catch (error) {
      expect(error).toMatchObject({ code: "newer-schema" });
      expect((error as Error).message).toContain(copy);
      return;
    }
    const reported = outcome as { ok?: unknown; message?: unknown } | null;
    if (reported?.ok === false && typeof reported.message === "string" && reported.message.includes(copy)) return;
    throw new Error(`The write went ahead: ${JSON.stringify(outcome)}`);
  }

  const paths: Array<[string, (book: Upgraded) => Promise<unknown>]> = [
    ["a chapter save (autosave)", ({ library, bookId, one }) => library.saveChapter(bookId, one.id, "Typed after the upgrade.\n", { baseVersion: one.version, baseHash: one.hash })],
    ["Add chapter", ({ library, bookId }) => library.createChapter(bookId, { title: "After the upgrade" })],
    ["a chapter's details", ({ library, bookId, one }) => library.updateChapterMeta(bookId, one.id, { synopsis: "Water." }, { baseVersion: one.version, baseHash: one.hash })],
    ["a move up or down", ({ library, bookId, one }) => library.reorderChapter(bookId, one.id, "down")],
    ["a dragged move", ({ library, bookId, one }) => library.moveChapterTo(bookId, one.id, 1)],
    ["a chapter delete", ({ library, bookId, one }) => library.deleteChapter(bookId, one.id)],
    ["a restore from the trash", ({ library, bookId, gone, trashedAt }) => library.restoreChapter(bookId, gone.id, trashedAt)],
    ["a kept conflict copy", ({ library, bookId, one }) => library.keepConflictCopy(bookId, one.id, { baseVersion: one.version, baseHash: one.hash })],
    ["the book's details", ({ library, bookId }) => library.updateBook(bookId, { title: "Renamed" })],
    ["moving the book to the trash", ({ library, bookId }) => library.deleteBook(bookId)],
    ["a new image", ({ library, bookId }) => library.addImage(bookId, { bytes: PNG, kind: "other", prompt: "The lamp", provider: "meta", model: "muse-image" })],
    ["attaching an image", ({ library, bookId, image, one }) => library.attachImage(bookId, image.id, one.id)],
    ["attaching a character image", ({ library, bookId, image }) => library.attachCharacterImage(bookId, image.id, "char_mara000001")],
    ["removing an image", ({ library, bookId, image }) => library.removeImage(bookId, image.id)],
    ["a new conversation", ({ library, bookId }) => library.threads.create(bookId, "After the upgrade")],
    ["a conversation save", ({ library, thread }) => library.threads.save({ ...thread, title: "Renamed" })],
    ["the agent's split_chapter", ({ library, bookId, two }) => run(createChapterTools(library, bookId), "split_chapter", { chapterId: two.id, line: 3, title: "Then" })],
    ["the agent's merge_chapters", ({ library, bookId, one, two }) => run(createChapterTools(library, bookId), "merge_chapters", { firstChapterId: one.id, secondChapterId: two.id })],
    ["the agent's append_to_chapter", ({ library, bookId, one }) => run(createChapterTools(library, bookId), "append_to_chapter", { chapterId: one.id, text: "More." })],
    ["the agent's create_chapter", ({ library, bookId }) => run(createChapterTools(library, bookId), "create_chapter", { title: "New", content: "New text." })],
    ["the agent's set_chapter_meta", ({ library, bookId, one }) => run(createChapterTools(library, bookId), "set_chapter_meta", { chapterId: one.id, synopsis: "Water." })],
    ["the agent's add_memory", ({ library, bookId }) => run(createChapterTools(library, bookId), "add_memory", { text: "Typed after the upgrade." })],
    ["the agent's update_character", ({ library, bookId }) => run(createChapterTools(library, bookId), "update_character", { name: "Mara", role: "Lighthouse keeper" })],
    ["the agent's update_book_details", ({ library, bookId }) => run(createChapterTools(library, bookId), "update_book_details", { outline: "Three sisters." })]
  ];

  for (const [name, write] of paths) {
    test(`refuses ${name} and leaves every byte as it was`, async () => {
      const book = await upgraded();

      await refused(() => write(book));

      expect(await snapshot(book.root)).toEqual(book.before);
    });
  }

  test("refuses the toolkit's save, create and add_memory and leaves every byte as it was", async () => {
    const book = await upgraded();
    const backend = new LocalBackend(
      {
        current: () => ({ root: book.library.root, deviceId: book.library.deviceId, deviceName: book.library.deviceName }),
        requireLibrary: () => book.library
      },
      { locatorPath: join(tmpdir(), `studio-book-json-backend-${process.pid}-${Date.now()}.json`), token: "book-json-token", port: 0, tools: new ToolBridge(() => book.library) }
    );
    const started = await backend.start();
    cleanups.push(() => backend.stop());
    const client = new BackendClient({ url: started.url, token: started.token });
    const before = await snapshot(book.root);

    await expect(
      client.saveChapter(book.bookId, book.one.id, { content: "From the toolkit.\n", baseVersion: book.one.version, baseHash: book.one.hash })
    ).rejects.toThrow("newer version of Open Book Studio");
    await expect(client.createChapter(book.bookId, { title: "From the toolkit" })).rejects.toThrow("newer version of Open Book Studio");
    await expect(client.callTool(book.bookId, "add_memory", { text: "From the toolkit." })).rejects.toThrow(
      "newer version of Open Book Studio"
    );

    expect(await snapshot(book.root)).toEqual(before);
  });
});
