/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import type { BookListing } from "@ai-book-studio/core/schema";
import type { StorageSummary } from "@ai-book-studio/core/library/storage";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let LibraryView!: typeof import("@ai-book-studio/app/views/LibraryView").LibraryView;

beforeAll(async () => {
  testing = await mountDom();
  ({ LibraryView } = await import("@ai-book-studio/app/views/LibraryView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * QA D9: a book whose book.json is newer, half-synced or unreadable keeps a card in the library
 * grid that says plainly why it cannot open and offers to show its folder, instead of vanishing.
 */

const HEALTHY = {
  id: "book_healthy000001",
  title: "The Salt Road",
  description: "A crossing.",
  stage: "drafting" as const,
  chapterCount: 3,
  wordCount: 1200,
  updatedAt: "2026-11-04T08:00:00.000Z"
};

const ISSUES: BookListing["bookReadIssues"] = [
  { folder: "book_future0000001", title: "Future", reason: "newer-schema" },
  { folder: "book_syncing000001", title: null, reason: "syncing" },
  { folder: "book_damaged000001", title: null, reason: "unreadable" }
];

function stubStudio(platform: string, listing: BookListing, revealResult: unknown = { ok: true, data: null }) {
  const reveal = mock((_folder: string) => Promise.resolve(revealResult));
  const onNotice = mock((_error: unknown) => {});
  const onOpenBook = mock((_bookId: string) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform,
    books: { listWithIssues: mock(() => Promise.resolve({ ok: true, data: listing })), reveal },
    library: {
      importLegacy: mock(() => Promise.resolve({ ok: true, data: null })),
      exportArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      importArchive: mock(() => Promise.resolve({ ok: true, data: null })),
      locationHealth: mock(() =>
        Promise.resolve({
          ok: true,
          data: {
            state: "ready",
            label: "Ready",
            count: 0,
            severity: "info",
            message: "This location is ready.",
            action: { id: "continue", label: "Continue working", safe: true }
          }
        })
      ),
      reveal: mock(() => Promise.resolve({ ok: true, data: null }))
    }
  };
  return { reveal, onNotice, onOpenBook };
}

function renderLibrary(
  mocks: { onNotice: ReturnType<typeof mock>; onOpenBook: ReturnType<typeof mock> },
  library: { root: string; storage?: StorageSummary } = { root: "/tmp/studio-library" }
) {
  testing.render(
    React.createElement(LibraryView, {
      library: { deviceId: "device_test000001", deviceName: "Test device", ...library },
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      onOpenBook: mocks.onOpenBook,
      onChooseLibrary: () => {},
      onLibraryImported: () => {},
      onNotice: mocks.onNotice
    })
  );
  return testing.within(document.body);
}

async function issueCards(view: ReturnType<typeof testing.within>, count: number): Promise<HTMLElement[]> {
  await testing.waitFor(() => expect(view.getAllByTestId("book-issue-card")).toHaveLength(count));
  return view.getAllByTestId("book-issue-card");
}

async function issueCard(view: ReturnType<typeof testing.within>, count: number, index: number): Promise<HTMLElement> {
  const card = (await issueCards(view, count))[index];
  if (!card) throw new Error(`No card ${index} for a book that cannot open.`);
  return card;
}

describe("a book that cannot open", () => {
  test("keeps a card that says why, beside the books that open", async () => {
    const mocks = stubStudio("darwin", { books: [HEALTHY], bookReadIssues: ISSUES });
    const view = renderLibrary(mocks);

    const [newer, syncing, unreadable] = (await issueCards(view, 3)).map((card) => card.textContent ?? "");
    expect(view.getAllByTestId("book-card")).toHaveLength(1);
    expect(newer).toContain("This book was saved by a newer version of the studio");
    expect(newer).toContain("Future");
    expect(newer).toContain("Update the studio to open it.");
    expect(syncing).toContain("This book is still syncing");
    expect(syncing).toContain("books/book_syncing000001");
    expect(unreadable).toContain("This book's details could not be read");
    expect(unreadable).toContain("Nothing in its folder was changed.");
    expect(view.queryByText("No books yet")).toBeNull();
  });

  test("shows the book's folder in Finder, and opens nothing", async () => {
    const mocks = stubStudio("darwin", { books: [], bookReadIssues: ISSUES });
    const view = renderLibrary(mocks);

    const syncing = await issueCard(view, 3, 1);
    testing.fireEvent.click(testing.within(syncing).getByRole("button", { name: "Show in Finder" }));
    await testing.waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith("book_syncing000001"));
    testing.fireEvent.click(syncing);
    expect(mocks.onOpenBook).not.toHaveBeenCalled();
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("replaces the empty library message when it is the only book", async () => {
    const mocks = stubStudio("linux", { books: [], bookReadIssues: ISSUES.slice(2) });
    const view = renderLibrary(mocks);

    const card = await issueCard(view, 1, 0);
    expect(view.queryByText("No books yet")).toBeNull();
    expect(testing.within(card).getByRole("button", { name: "Show in folder" })).toBeTruthy();
  });

  test("says so when the folder cannot be shown", async () => {
    const mocks = stubStudio(
      "darwin",
      { books: [], bookReadIssues: ISSUES.slice(0, 1) },
      { ok: false, error: { code: "io", message: "The folder could not be shown." } }
    );
    const view = renderLibrary(mocks);

    const card = await issueCard(view, 1, 0);
    testing.fireEvent.click(testing.within(card).getByRole("button", { name: "Show in Finder" }));
    await testing.waitFor(() => expect(mocks.onNotice).toHaveBeenCalled());
  });

  test("offers no folder window in the browser build", async () => {
    const mocks = stubStudio("web", { books: [], bookReadIssues: ISSUES });
    const view = renderLibrary(mocks);

    const cards = await issueCards(view, 3);
    for (const card of cards) expect(testing.within(card).queryByRole("button")).toBeNull();
  });

  test("browser storage is not described as a folder", async () => {
    const mocks = stubStudio("web", { books: [HEALTHY], bookReadIssues: ISSUES });
    const view = renderLibrary(mocks, {
      root: "browser://lib_test000001",
      storage: {
        tier: "browser",
        label: "This browser",
        permission: "granted",
        persistence: "granted",
        lastCommittedAt: null,
        warning: null
      }
    });

    const cards = await issueCards(view, 3);
    const text = document.body.textContent ?? "";
    expect(view.getByTestId("library-root").textContent).toBe("This browser");
    expect(text).not.toContain("browser://");
    expect(text).not.toContain("Nothing in its folder was changed.");
    expect(text).not.toContain("Each book is a folder");
    expect(text).toContain("this browser's storage");
    for (const card of cards) expect(card.textContent ?? "").not.toContain("folder was changed");
  });

  test("a folder chosen in the browser keeps the folder copy", async () => {
    const mocks = stubStudio("web", { books: [], bookReadIssues: ISSUES.slice(2) });
    const view = renderLibrary(mocks, {
      root: "folder://Field notes",
      storage: {
        tier: "folder",
        label: "Field notes",
        permission: "granted",
        persistence: "not-supported",
        lastCommittedAt: null,
        warning: null
      }
    });

    const card = await issueCard(view, 1, 0);
    expect(card.textContent ?? "").toContain("Nothing in its folder was changed.");
    expect(document.body.textContent ?? "").toContain("Each book is a folder");
  });
});
