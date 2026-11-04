/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;

beforeAll(async () => {
  testing = await mountDom();
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Rail keyboard reorder and the save-conflict banner (spec 012 T012). The real
 * workspace moves the selected chapter from the keyboard, ignores the shortcut
 * while a dialog is open, and shows both conflict actions when a save loses.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_rc000001";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `000${order}-${title.toLowerCase()}.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: "b".repeat(64)
  };
}

const CHAPTER_A = chapter("ch_rc000001", "First", 1, "First line.\n");
const CHAPTER_B = chapter("ch_rc000002", "Second", 2, "Second line.\n");

const CONFLICT = {
  bookId: BOOK,
  chapterId: CHAPTER_A.id,
  chapterTitle: "First",
  savedAs: "books/book_rc000001/chapters/0001-first.conflict-external-edit.device1.2026-11-03.md",
  reason: "external-edit",
  diskVersion: 2,
  localVersion: 2
};

interface WorkspaceMocks {
  reorder: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
  reveal: ReturnType<typeof mock>;
  open: ReturnType<typeof mock>;
  onNotice: ReturnType<typeof mock>;
}

const SYNC_COPY = {
  bookId: BOOK,
  chapterId: CHAPTER_A.id,
  chapterTitle: "First",
  savedAs: "books/book_rc000001/conflicts/0001-first.conflict-external-edit.device1.2026-11-03.md",
  reason: "provider-conflict-copy",
  diskVersion: 2,
  localVersion: 2
};

function mockWorkspace(saveBehavior: "saved" | "conflict", syncCopies: unknown[] = []): WorkspaceMocks {
  const detail = () => ({
    book: bookSchema.parse({ id: BOOK, title: "Reorder", createdAt: NOW, updatedAt: NOW }),
    chapters: [CHAPTER_A, CHAPTER_B],
    chapterReadIssues: []
  });
  const reorder = mock((_bookId: string, _chapterId: string, _direction: "up" | "down") =>
    Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_B, CHAPTER_A] } })
  );
  const save = mock((_input: unknown) =>
    saveBehavior === "conflict"
      ? Promise.resolve({ ok: true, data: { status: "conflict", conflict: CONFLICT } })
      : Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER_A } })
  );
  const reveal = mock((_bookId: string, _savedAs: string) => Promise.resolve({ ok: true, data: null }));
  const open = mock(() => Promise.resolve({ ok: true, data: detail() }));
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: { open },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER_A })),
      reorder,
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER_A, CHAPTER_B] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: syncCopies })), reveal },
    drafts: {
      set: mock(() => Promise.resolve({ ok: true, data: null })),
      clear: mock(() => Promise.resolve({ ok: true, data: null })),
      onFlushRequest: mock(() => () => {})
    },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: { onEvent: mock(() => () => {}) },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({
        ok: true,
        data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }
      }))
    }
  };
  testing.render(
    React.createElement(WorkspaceView, {
      bookId: BOOK,
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    })
  );
  return { reorder, save, reveal, open, onNotice };
}

function keydown(key: string, metaKey: boolean): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, metaKey, ctrlKey: !metaKey, altKey: true, bubbles: true })
  );
}

describe("rail keyboard reorder and the save-conflict banner", () => {
  test("Command+Alt+ArrowDown moves the selected chapter", async () => {
    const mocks = mockWorkspace("saved");
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getAllByTestId("chapter-row")).toHaveLength(2);
    });

    keydown("ArrowDown", true);
    await testing.waitFor(() => {
      expect(mocks.reorder).toHaveBeenCalledTimes(1);
    });
    expect(mocks.reorder.mock.calls[0]?.slice(0, 3)).toEqual([BOOK, "ch_rc000001", "down"]);
    await testing.waitFor(() => {
      expect(view.getAllByTestId("chapter-row")[0]?.textContent ?? "").toContain("Second");
    });
  });

  test("an open dialog suppresses the reorder shortcut", async () => {
    const mocks = mockWorkspace("saved");
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getAllByTestId("chapter-row")).toHaveLength(2);
    });

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    try {
      keydown("ArrowUp", true);
      await testing.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(mocks.reorder).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  test("earlier sync copies are explained with a folder action", async () => {
    const mocks = mockWorkspace("saved", [SYNC_COPY]);
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getAllByTestId("chapter-row")).toHaveLength(2);
    });
    // A sync copy saved earlier: the list call reports it after mount.
    expect(view.getByText("1 saved copy from earlier sync conflicts.")).toBeTruthy();
    testing.fireEvent.click(view.getByText("Show in folder"));
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(mocks.reveal.mock.calls[0]).toEqual([BOOK, "books/book_rc000001/conflicts/0001-first.conflict-external-edit.device1.2026-11-03.md"]);
  });

  test("a lost save shows both conflict actions with honest copy", async () => {
    const mocks = mockWorkspace("conflict");
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "First line edited.\n" } });
    // The autosave fires while the author stays on the chapter; the banner
    // belongs to this chapter, so the test does not switch away first.
    await testing.waitFor(
      () => {
        expect(view.getByText("This chapter was saved somewhere else")).toBeTruthy();
      },
      { timeout: 5000 }
    );
    expect(view.getByText("The file changed on disk while you were writing, so your text was kept as a separate copy instead of overwriting the change.")).toBeTruthy();
    expect(view.getByTitle(CONFLICT.savedAs).textContent ?? "").toContain("conflict-external-edit");

    testing.fireEvent.click(view.getByText("Show the saved copy"));
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(mocks.reveal.mock.calls[0]).toEqual([BOOK, CONFLICT.savedAs]);

    const opens = mocks.open.mock.calls.length;
    testing.fireEvent.click(view.getByText("Load the version on disk"));
    await testing.waitFor(() => {
      expect(mocks.open.mock.calls.length).toBeGreaterThan(opens);
    });
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });
});
