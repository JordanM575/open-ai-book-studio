/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { mockElectron } from "./support/mock-electron";
import { IPC } from "@ai-book-studio/core/ipc";
import { bookSchema, type BookMeta } from "@ai-book-studio/core/schema";

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

let testing!: typeof import("@testing-library/react/pure");
// Loaded in beforeAll, once the DOM exists.
let StoryBibleDialog!: typeof import("@ai-book-studio/app/components/StoryBibleDialog").StoryBibleDialog;
let Library!: typeof import("../src/main/library/store").Library;
let DraftBuffer!: typeof import("../src/main/drafts").DraftBuffer;
let registerIpc!: typeof import("../src/main/ipc").registerIpc;
let createChapterTools!: typeof import("../src/main/agent/tools").createChapterTools;

const handlers = new Map<string, Handler>();
const shown: string[] = [];
const roots: string[] = [];

beforeAll(async () => {
  testing = await mountDom();
  mockElectron(tmpdir(), {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    showItemInFolder: (path) => {
      shown.push(path);
    }
  });
  ({ StoryBibleDialog } = await import("@ai-book-studio/app/components/StoryBibleDialog"));
  ({ Library } = await import("../src/main/library/store"));
  ({ DraftBuffer } = await import("../src/main/drafts"));
  ({ registerIpc } = await import("../src/main/ipc"));
  ({ createChapterTools } = await import("../src/main/agent/tools"));
});
afterAll(async () => {
  // Later files share the one Electron mock, so it goes back to its defaults.
  mockElectron(tmpdir());
  await unmountDom();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
afterEach(() => testing.cleanup());

const BOOK_ID = "book_bible000001";
const NOW = "2026-11-03T00:00:00.000Z";

function bibleBook(): BookMeta {
  return bookSchema.parse({
    id: BOOK_ID,
    title: "The Salt Road",
    description: "A crossing at low tide.",
    createdAt: NOW,
    updatedAt: NOW,
    characters: [
      { id: "char_bible000001", name: "Mara", role: "Keeper", description: "Keeps the light.", motivations: "", notes: "" }
    ],
    memories: [{ id: "mem_bible000001", text: "The lighthouse went dark once.", importance: "high", createdAt: NOW, updatedAt: NOW }]
  });
}

/** The dialog saves through `books.edit`; `update` is there to prove it is no longer used. */
function mockEdit(result: unknown) {
  const edit = mock((_bookId: string, _changes: unknown) => Promise.resolve(result));
  const update = mock(() => Promise.resolve({ ok: false, error: { code: "invalid", message: "Not this channel." } }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    books: { edit, update }
  };
  return edit;
}

function renderDialog(book: BookMeta, handlers: { onSaved?: () => void; onClose?: () => void; onNotice?: (error: unknown) => void } = {}) {
  const onSaved = mock(handlers.onSaved ?? (() => {}));
  const onClose = mock(handlers.onClose ?? (() => {}));
  const onNotice = mock(handlers.onNotice ?? ((_error: unknown) => {}));
  testing.render(
    React.createElement(StoryBibleDialog, { open: true, book, onClose, onSaved, onNotice })
  );
  return { onSaved, onClose, onNotice };
}

describe("StoryBibleDialog", () => {
  test("stages character and memory edits and sends only them, each with the value it started from", async () => {
    const saved = { ...bibleBook(), title: "The Salt Road" };
    const edit = mockEdit({ ok: true, data: { status: "saved", book: saved } });
    const { onSaved, onClose } = renderDialog(bibleBook());

    testing.fireEvent.change(testing.within(document.body).getByPlaceholderText("Name") as HTMLInputElement, {
      target: { value: "Mara Voss" }
    });
    testing.fireEvent.change(testing.within(document.body).getByDisplayValue("The lighthouse went dark once.") as HTMLTextAreaElement, {
      target: { value: "The lighthouse went dark twice." }
    });
    testing.fireEvent.change(testing.within(document.body).getByLabelText("Importance") as HTMLSelectElement, {
      target: { value: "low" }
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));

    await testing.waitFor(() => expect(edit).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [bookId, changes] = edit.mock.calls[0] as [string, Record<string, { from: unknown; to: unknown }>];
    expect(bookId).toBe(BOOK_ID);
    // The title, outline and the rest were not touched, so they are not sent and cannot be written.
    expect(Object.keys(changes).sort()).toEqual(["characters", "memories"]);
    expect(changes.characters).toEqual({
      from: bibleBook().characters,
      to: [{ id: "char_bible000001", name: "Mara Voss", role: "Keeper", description: "Keeps the light.", motivations: "", notes: "" }]
    });
    expect(changes.memories?.from).toEqual(bibleBook().memories);
    expect(changes.memories?.to).toEqual([expect.objectContaining({ text: "The lighthouse went dark twice.", importance: "low" })]);
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  test("cancel discards a staged removal without writing", () => {
    const edit = mockEdit({ ok: true, data: { status: "saved", book: bibleBook() } });
    const { onClose } = renderDialog(bibleBook());

    testing.fireEvent.click(testing.within(document.body).getByLabelText("Remove Mara"));
    expect(testing.within(document.body).queryByDisplayValue("Mara")).toBeNull();
    testing.fireEvent.click(testing.within(document.body).getByText("Cancel"));

    expect(edit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("a blank title disables saving", () => {
    const edit = mockEdit({ ok: true, data: { status: "saved", book: bibleBook() } });
    renderDialog(bibleBook());

    testing.fireEvent.change(testing.within(document.body).getByLabelText("Title") as HTMLInputElement, {
      target: { value: "   " }
    });
    expect((testing.within(document.body).getByTestId("save-story-bible") as HTMLButtonElement).disabled).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  test("a failed save keeps the dialog open and reports the error", async () => {
    const edit = mockEdit({ ok: false, error: { code: "io", message: "The disk gave up." } });
    const { onClose, onNotice } = renderDialog(bibleBook());

    testing.fireEvent.change(testing.within(document.body).getByLabelText("Title") as HTMLInputElement, {
      target: { value: "The Salt Crossing" }
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(testing.within(document.body).getByTestId("save-story-bible")).toBeTruthy();
  });
});

/*
 * The same dialog over a real library in a temporary folder, through the main process's real IPC
 * handlers, called the way the preload calls them. While the dialog is open another writer changes
 * `book.json`: another device through a sync folder, or the agent's book tools from the toolkit. The
 * author then saves, and the bytes on disk are read back.
 */
describe("StoryBibleDialog over a book another writer changes", () => {
  // biome-ignore lint/suspicious/noExplicitAny: these checks reshape raw book.json the way another writer would
  type Raw = Record<string, any>;

  const MARA = { id: "char_mara000001", name: "Mara", role: "Keeper", description: "Keeps the light.", motivations: "", notes: "" };
  const JONAH = { id: "char_jonah00001", name: "Jonah", role: "Ferryman", description: "Rows the crossing.", motivations: "", notes: "" };

  async function realStudio() {
    const root = await mkdtemp(join(tmpdir(), "studio-bible-"));
    roots.push(root);
    const library = await Library.open(root);
    const studio = {
      library,
      drafts: new DraftBuffer(),
      current: () => ({ root: library.root, deviceId: library.deviceId, deviceName: library.deviceName }),
      requireLibrary: () => library,
      openLibrary: async () => null
    };
    handlers.clear();
    shown.length = 0;
    registerIpc(
      studio as never,
      () => null,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: () => ({}), update: async () => {} } as never,
      {} as never
    );
    const invoke = (channel: string, payload: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}.`);
      return handler({}, payload);
    };
    // The preload's mapping from `window.studio` to channels.
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      books: {
        update: (bookId: string, patch: unknown) => invoke(IPC.books.update, { bookId, patch }),
        edit: (bookId: string, changes: unknown) => invoke(IPC.books.edit, { bookId, changes })
      },
      conflicts: { reveal: (bookId: string, savedAs: string) => invoke(IPC.conflicts.reveal, { bookId, savedAs }) }
    };

    const created = await library.createBook({ title: "The Salt Road", description: "A crossing at low tide.", outline: "Two sisters." });
    await library.updateBook(created.id, {
      characters: [MARA],
      memories: [{ id: "mem_tide0000001", text: "The tide comes in early.", importance: "high", createdAt: NOW, updatedAt: NOW }]
    });
    const path = join(root, "books", created.id, "book.json");
    const { book } = await library.readBook(created.id);
    return { root, library, book, path };
  }

  async function readRaw(path: string): Promise<Raw> {
    return JSON.parse(await readFile(path, "utf8")) as Raw;
  }

  /** Another device writes the file through the sync folder. */
  async function writtenElsewhere(path: string, change: (raw: Raw) => void): Promise<void> {
    const raw = await readRaw(path);
    change(raw);
    raw.updatedAt = "2026-11-04T09:30:00.000Z";
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  }

  function typeOutline(from: string, to: string): void {
    testing.fireEvent.change(testing.within(document.body).getByDisplayValue(from) as HTMLTextAreaElement, {
      target: { value: to }
    });
  }

  test("a character another device added while the dialog was open survives the author's outline edit", async () => {
    const { book, path } = await realStudio();
    const { onSaved } = renderDialog(book);

    await writtenElsewhere(path, (raw) => {
      raw.characters.push(JONAH);
      raw.characters[0].futureTrait = { addedBy: "a newer build" };
    });
    typeOutline("Two sisters.", "Two sisters and a letter.");
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));
    await testing.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1), { timeout: 4000 });

    const disk = await readRaw(path);
    expect(disk.outline).toBe("Two sisters and a letter.");
    expect(disk.characters.map((character: Raw) => character.name)).toEqual(["Mara", "Jonah"]);
    expect(disk.characters[0].futureTrait).toEqual({ addedBy: "a newer build" });
  });

  test("a memory the toolkit's add_memory saved while the dialog was open survives the author's save", async () => {
    const { library, book, path } = await realStudio();
    const { onSaved } = renderDialog(book);

    const tools = createChapterTools(library, book.id);
    const added = (await (tools.add_memory as unknown as { execute: (input: unknown, options: unknown) => Promise<{ ok: boolean }> }).execute(
      { text: "The lamp was lit at dusk.", importance: "high" },
      { toolCallId: "toolkit-call", messages: [] }
    )) as { ok: boolean };
    expect(added.ok).toBe(true);
    typeOutline("Two sisters.", "Two sisters and a letter.");
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));
    await testing.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1), { timeout: 4000 });

    const disk = await readRaw(path);
    expect(disk.outline).toBe("Two sisters and a letter.");
    expect(disk.memories.map((memory: Raw) => memory.text)).toEqual(["The tide comes in early.", "The lamp was lit at dusk."]);
  });

  test("when both sides change the outline, the other value stays, the author's goes to a conflict copy, and the author is told", async () => {
    const { root, library, book, path } = await realStudio();
    const { onClose, onNotice } = renderDialog(book);

    await writtenElsewhere(path, (raw) => {
      raw.outline = "Three sisters.";
    });
    typeOutline("Two sisters.", "Two sisters and a letter.");
    testing.fireEvent.change(testing.within(document.body).getByDisplayValue("A crossing at low tide.") as HTMLTextAreaElement, {
      target: { value: "A crossing at high tide." }
    });
    testing.fireEvent.click(testing.within(document.body).getByTestId("save-story-bible"));

    await testing.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const told = (onNotice.mock.calls[0]?.[0] as Error).message;
    expect(told).toContain("The Story Bible changed on disk while you were editing");
    expect(told).toContain("kept as a separate copy");
    expect(onClose).not.toHaveBeenCalled();

    const disk = await readRaw(path);
    expect(disk.outline).toBe("Three sisters.");
    // The part only the author changed is not an overlap, so it lands.
    expect(disk.description).toBe("A crossing at high tide.");

    const copies = await readdir(join(root, "books", book.id, "conflicts"));
    expect(copies).toHaveLength(1);
    const name = copies[0] ?? "";
    expect(name).toMatch(/^book\.conflict-external-edit\.device_[a-f0-9]+\..+\.json$/);
    const copy = await readRaw(join(root, "books", book.id, "conflicts", name));
    expect(copy.outline).toBe("Two sisters and a letter.");
    expect(copy.description).toBe("A crossing at high tide.");
    expect(copy.id).toBe(book.id);

    // The copy is listed with the book's other conflict copies.
    const listed = await library.listConflicts(book.id);
    expect(listed.map((entry) => entry.savedAs)).toContain(`books/${book.id}/conflicts/${name}`);
  });
});
