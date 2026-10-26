import { describe, expect, test } from "bun:test";
import type { DraftInput } from "@ai-book-studio/core/ipc";
import type { SaveChapterResult } from "@ai-book-studio/core/schema";
import { BrowserDraftBuffer, flushDraftsOnHide, type PageHideTarget } from "../../src/storage/drafts";

const FIXED_CLOCK = "2026-10-25T20:00:00.000Z";
const CONFIRMED: SaveChapterResult = {
  status: "saved",
  chapter: {
    id: "chapter_test000001",
    title: "One",
    order: 1,
    arc: "middle",
    purpose: "",
    synopsis: "",
    notes: "",
    isPrologue: false,
    color: null,
    version: 2,
    createdAt: FIXED_CLOCK,
    updatedAt: FIXED_CLOCK,
    content: "text",
    path: "one.md",
    wordCount: 1,
    hash: "a".repeat(64)
  }
};
const CONFLICT: SaveChapterResult = {
  status: "conflict",
  conflict: {
    bookId: "book_test000001",
    chapterId: "chapter_test000001",
    chapterTitle: "One",
    savedAs: "one.conflict-20261025T200000Z.md",
    reason: "external-edit",
    diskVersion: 1,
    localVersion: 2
  }
};

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    bookId: "book_test000001",
    chapterId: "chapter_test000001",
    content: "text",
    baseVersion: 1,
    baseHash: "b".repeat(64),
    ...overrides
  };
}

function buffer(): BrowserDraftBuffer {
  return new BrowserDraftBuffer(() => FIXED_CLOCK);
}

describe("BrowserDraftBuffer", () => {
  test("reports confirmed only after the adapter confirms every write", async () => {
    const drafts = buffer();
    const sent: DraftInput[] = [];
    drafts.set(draft());

    const report = await drafts.flush(async (input) => {
      sent.push(input);
      return CONFIRMED;
    });

    expect(sent).toEqual([draft()]);
    expect(report).toMatchObject({
      at: FIXED_CLOCK,
      attempted: 1,
      confirmed: 1,
      conflicts: 0,
      failed: 0,
      remaining: 0,
      status: "confirmed",
      failures: []
    });
    expect(drafts.size).toBe(0);
    expect(drafts.needsAttention).toBe(false);
  });

  test("an aborted flush stays unconfirmed and keeps the text", async () => {
    const drafts = buffer();
    drafts.set(draft());

    const report = await drafts.flush(async () => {
      throw new Error("The page was hidden before the write finished.");
    });

    expect(report.status).toBe("unconfirmed");
    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.remaining).toBe(1);
    expect(report.failures[0]?.message).toContain("before the write finished");
    expect(report.status).not.toBe("confirmed");
    expect(drafts.size).toBe(1);
    expect(drafts.needsAttention).toBe(true);
    expect(drafts.lastFlush).toBe(report);
  });

  test("a conflict is preserved but is never reported as a confirmed save", async () => {
    const drafts = buffer();
    drafts.set(draft());

    const report = await drafts.flush(async () => CONFLICT);

    expect(report.status).toBe("conflict");
    expect(report).toMatchObject({ attempted: 1, confirmed: 0, conflicts: 1, failed: 0, remaining: 0 });
    expect(drafts.needsAttention).toBe(true);
  });

  test("a failed draft does not stop the other drafts from being written", async () => {
    const drafts = buffer();
    drafts.set(draft());
    drafts.set(draft({ chapterId: "chapter_test000002", content: "second" }));

    const attempted: string[] = [];
    const report = await drafts.flush(async (input) => {
      attempted.push(input.chapterId);
      if (input.chapterId === "chapter_test000001") throw new Error("permission-required");
      return CONFIRMED;
    });

    expect(attempted).toHaveLength(2);
    expect(report).toMatchObject({ attempted: 2, confirmed: 1, failed: 1, remaining: 1, status: "unconfirmed" });
    expect(drafts.size).toBe(1);
    expect(drafts.get({ bookId: "book_test000001", chapterId: "chapter_test000001" })?.content).toBe("text");
  });

  test("text typed during a flush is not reported saved", async () => {
    const drafts = buffer();
    drafts.set(draft());
    let report: Awaited<ReturnType<BrowserDraftBuffer["flush"]>> | null = null;

    await drafts.flush(async () => {
      drafts.set(draft({ content: "typed while saving" }));
      return CONFIRMED;
    });

    report = drafts.lastFlush;
    expect(report).toMatchObject({ attempted: 1, confirmed: 1, remaining: 1, status: "unconfirmed" });
    expect(drafts.get({ bookId: "book_test000001", chapterId: "chapter_test000001" })?.content).toBe(
      "typed while saving"
    );
  });

  test("an empty flush says empty, not confirmed", async () => {
    const drafts = buffer();
    let calls = 0;
    const report = await drafts.flush(async () => {
      calls += 1;
      return CONFIRMED;
    });

    expect(calls).toBe(0);
    expect(report).toMatchObject({ attempted: 0, confirmed: 0, remaining: 0, status: "empty" });
    expect(drafts.needsAttention).toBe(false);
  });

  test("confirm drops the saved text only, never a newer draft", async () => {
    const drafts = buffer();
    drafts.set(draft({ content: "first" }));

    drafts.confirm("book_test000001", "chapter_test000001", "stale");
    expect(drafts.size).toBe(1);

    drafts.confirm("book_test000001", "chapter_test000001", "first");
    expect(drafts.size).toBe(0);

    drafts.set(draft({ content: "newer" }));
    drafts.confirm("book_test000001", "chapter_test000001", "older");
    expect(drafts.get({ bookId: "book_test000001", chapterId: "chapter_test000001" })?.content).toBe("newer");
  });

  test("page hide runs one best-effort flush and can be removed", async () => {
    const drafts = buffer();
    drafts.set(draft());

    const listeners = new Set<() => void>();
    const target: PageHideTarget = {
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener)
    };

    let attempts = 0;
    const detach = flushDraftsOnHide(drafts, async () => {
      attempts += 1;
      return CONFIRMED;
    }, target);

    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener();
    await Bun.sleep(0);
    expect(attempts).toBe(1);
    expect(drafts.lastFlush?.status).toBe("confirmed");

    detach();
    expect(listeners.size).toBe(0);
    expect(attempts).toBe(1);
  });

  test("a page hide that cannot finish leaves the not-confirmed state behind", async () => {
    const drafts = buffer();
    drafts.set(draft());

    const listeners: Array<() => void> = [];
    flushDraftsOnHide(
      drafts,
      async () => {
        throw new TypeError("The operation was aborted.");
      },
      {
        addEventListener: (_type, listener) => listeners.push(listener),
        removeEventListener: () => {}
      }
    );

    listeners[0]?.();
    await Bun.sleep(0);

    expect(drafts.lastFlush?.status).toBe("unconfirmed");
    expect(drafts.needsAttention).toBe(true);
    expect(drafts.size).toBe(1);
  });
});
