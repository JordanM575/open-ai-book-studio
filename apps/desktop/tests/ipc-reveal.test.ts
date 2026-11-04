import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC } from "@ai-book-studio/core/ipc";
import { Library } from "../src/main/library/store";
import { mockElectron } from "./support/mock-electron";

/**
 * FR-065: revealing a book folder must open the real folder in the file manager. Component
 * tests mock the preload bridge, so this file drives the real main-process handlers instead:
 * `registerIpc` with a real library, Electron's shell recorded rather than opened.
 */

const shown: string[] = [];
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

mockElectron(tmpdir(), {
  handle: (channel, handler) => {
    handlers.set(channel, handler);
  },
  showItemInFolder: (path) => {
    shown.push(path);
  }
});

const { registerIpc } = await import("../src/main/ipc");

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  shown.length = 0;
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "studio-reveal-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const stub = undefined as never;
  registerIpc({ requireLibrary: () => library } as never, () => null, stub, stub, stub, stub, stub, stub, stub);
  return { root, library };
}

async function invoke(channel: string, payload: unknown): Promise<{ ok: boolean; data?: unknown }> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}.`);
  return (await handler({}, payload)) as { ok: boolean; data?: unknown };
}

describe("reveal in file manager", () => {
  test("library reveal opens the open library folder", async () => {
    const { root } = await setup();
    const result = await invoke(IPC.library.reveal, {});
    expect(result).toEqual({ ok: true, data: null });
    expect(shown).toEqual([root]);
  });

  test("conflict reveal opens the saved conflict file, never an escaped path", async () => {
    const { root } = await setup();
    const savedAs = "books/book_test0001/conflicts/0001-one.conflict-external-edit.md";
    const result = await invoke(IPC.conflicts.reveal, { bookId: "book_test0001", savedAs });
    expect(result).toEqual({ ok: true, data: null });
    expect(shown).toEqual([join(root, "books/book_test0001/conflicts/0001-one.conflict-external-edit.md")]);

    const escaped = await invoke(IPC.conflicts.reveal, { bookId: "book_test0001", savedAs: "../evil.md" });
    expect(escaped.ok).toBe(false);
    expect(shown).toHaveLength(1);
  });

  test("book reveal opens a book folder by name, even one that cannot open, never an escaped path", async () => {
    const { root } = await setup();
    // A sync tool's copy of a folder does not carry a valid book id, and must still be shown.
    for (const folder of ["book_test0001", "book_test0001 2"]) {
      expect(await invoke(IPC.books.reveal, folder)).toEqual({ ok: true, data: null });
    }
    expect(shown).toEqual([join(root, "books", "book_test0001"), join(root, "books", "book_test0001 2")]);

    for (const folder of ["..", "../evil", "book_test0001/chapters", "..\\evil", ".studio", "", 7]) {
      expect((await invoke(IPC.books.reveal, folder)).ok).toBe(false);
    }
    expect(shown).toHaveLength(2);
  });
});
