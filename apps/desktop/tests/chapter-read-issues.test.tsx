/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";

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
 * Damaged-file explanation in the workspace (spec 012 T008). The real view
 * opens a book whose saved read skipped a malformed chapter file: the healthy
 * chapter stays usable and the affected file is named plainly.
 */

const NOW = "2026-11-03T00:00:00.000Z";

function fixtureBook() {
  return bookSchema.parse({ id: "book_iso000001", title: "Isolation", createdAt: NOW, updatedAt: NOW });
}

function fixtureChapter() {
  return {
    ...chapterMetaSchema.parse({
      id: "ch_iso000001",
      title: "Kept",
      order: 1,
      createdAt: NOW,
      updatedAt: NOW
    }),
    content: "Kept line.\n",
    path: "0001-kept.md",
    wordCount: 2,
    hash: "a".repeat(64)
  };
}

function mockStudio(chapterReadIssues: Array<{ fileName: string; order: number | null; reason: "invalid-format" }>) {
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open: mock(() =>
        Promise.resolve({
          ok: true,
          data: { book: fixtureBook(), chapters: [fixtureChapter()], chapterReadIssues }
        })
      )
    },
    chapters: {
      save: mock(() => Promise.resolve({ ok: true })),
      updateMeta: mock(() => Promise.resolve({ ok: true }))
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
    drafts: {
      set: mock(() => Promise.resolve({ ok: true, data: null })),
      clear: mock(() => Promise.resolve({ ok: true, data: null }))
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
  return { onNotice };
}

function renderWorkspace() {
  testing.render(
    React.createElement(WorkspaceView, {
      bookId: "book_iso000001",
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice: () => {},
      onSchemaRefusal: () => {}
    })
  );
  return testing.within(document.body);
}

describe("damaged chapter explanation", () => {
  test("a skipped file is named while the healthy chapter stays usable", async () => {
    mockStudio([{ fileName: "0002-broken.md", order: 2, reason: "invalid-format" }]);
    const view = renderWorkspace();

    await testing.waitFor(() => {
      expect(view.getByTestId("chapter-read-issues").textContent ?? "").toContain("0002-broken.md");
    });
    const notice = view.getByTestId("chapter-read-issues").textContent ?? "";
    expect(notice).toContain("invalid format");
    expect(notice).toContain("The rest of the book is unchanged.");
    // The healthy chapter is listed and opens in the editor.
    expect(view.getByText("Kept")).toBeTruthy();
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });

    testing.fireEvent.click(view.getByTestId("dismiss-read-issues"));
    expect(view.queryByTestId("chapter-read-issues")).toBeNull();
    expect(view.getByText("Kept")).toBeTruthy();
  });

  test("a clean book shows no explanation", async () => {
    mockStudio([]);
    const view = renderWorkspace();
    await testing.waitFor(() => {
      expect(view.getByTestId("workspace-view")).toBeTruthy();
    });
    await testing.waitFor(() => {
      expect(view.getByText("Kept")).toBeTruthy();
    });
    expect(view.queryByTestId("chapter-read-issues")).toBeNull();
  });
});
