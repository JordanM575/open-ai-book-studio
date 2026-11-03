/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
let ChapterRail!: typeof import("@ai-book-studio/app/components/ChapterRail").ChapterRail;

beforeAll(async () => {
  testing = await mountDom();
  ({ ChapterRail } = await import("@ai-book-studio/app/components/ChapterRail"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Chapter rail behavior (spec 012 T012): the author sees every chapter with its
 * position and length, selects, adds, reorders and deletes through labelled
 * controls, and every row is reachable by keyboard.
 */

const NOW = "2026-11-03T00:00:00.000Z";

function chapter(id: string, title: string, order: number, wordCount: number): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content: `${title} line.\n`,
    path: `000${order}-${title.toLowerCase()}.md`,
    wordCount,
    hash: "a".repeat(64)
  };
}

const CHAPTERS = [
  chapter("ch_rail000001", "The Light", 1, 120),
  chapter("ch_rail000002", "The Door", 2, 90),
  chapter("ch_rail000003", "The Road", 3, 1)
];

interface RailMocks {
  onSelect: ReturnType<typeof mock>;
  onAdd: ReturnType<typeof mock>;
  onMove: ReturnType<typeof mock>;
  onMoveTo: ReturnType<typeof mock>;
  onDelete: ReturnType<typeof mock>;
}

function renderRail(chapters: Chapter[] = CHAPTERS, selectedId: string | null = "ch_rail000001", busy = false): RailMocks {
  const mocks: RailMocks = {
    onSelect: mock((_id: string) => {}),
    onAdd: mock(() => {}),
    onMove: mock((_chapter: Chapter, _direction: "up" | "down") => {}),
    onMoveTo: mock((_chapter: Chapter, _index: number) => {}),
    onDelete: mock((_chapter: Chapter) => {})
  };
  testing.render(
    React.createElement(ChapterRail, {
      chapters,
      selectedId,
      busy,
      onSelect: mocks.onSelect,
      onAdd: mocks.onAdd,
      onMove: mocks.onMove,
      onMoveTo: mocks.onMoveTo,
      onDelete: mocks.onDelete
    })
  );
  return mocks;
}

describe("chapter rail", () => {
  test("lists every chapter with position, title and length", () => {
    renderRail();
    const view = testing.within(document.body);
    const rows = view.getAllByTestId("chapter-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent ?? "").toContain("The Light");
    expect(rows[0]?.textContent ?? "").toContain("120 words");
    expect(rows[2]?.textContent ?? "").toContain("1 word");
    expect(view.getByTestId("chapter-rail").textContent ?? "").toContain("Chapters");
  });

  test("an empty book invites the first chapter", () => {
    renderRail([], null);
    const view = testing.within(document.body);
    expect(view.getByTestId("chapter-rail").textContent ?? "").toContain("No chapters yet");
    expect(view.queryAllByTestId("chapter-row")).toHaveLength(0);
  });

  test("clicking a row selects it and marks it current", () => {
    const mocks = renderRail(CHAPTERS, "ch_rail000001");
    const view = testing.within(document.body);
    const rows = view.getAllByTestId("chapter-row");
    expect(rows[0]?.getAttribute("aria-current")).toBe("page");
    expect(rows[1]?.getAttribute("aria-current")).toBeNull();
    testing.fireEvent.click(rows[1]!);
    expect(mocks.onSelect).toHaveBeenCalledTimes(1);
    expect(mocks.onSelect.mock.calls[0]?.[0]).toBe("ch_rail000002");
  });

  test("the add button adds a chapter", () => {
    const mocks = renderRail();
    testing.fireEvent.click(testing.within(document.body).getByTitle("Add chapter"));
    expect(mocks.onAdd).toHaveBeenCalledTimes(1);
  });

  test("move buttons reorder with the edge buttons disabled", () => {
    const mocks = renderRail();
    const view = testing.within(document.body);
    const ups = view.getAllByTestId("move-chapter-up");
    const downs = view.getAllByTestId("move-chapter-down");
    expect(ups[0]).toHaveProperty("disabled", true);
    expect(downs[2]).toHaveProperty("disabled", true);
    expect(ups[1]).toHaveProperty("disabled", false);

    testing.fireEvent.click(downs[0]!);
    expect(mocks.onMove).toHaveBeenCalledTimes(1);
    expect(mocks.onMove.mock.calls[0]?.[0]).toMatchObject({ id: "ch_rail000001" });
    expect(mocks.onMove.mock.calls[0]?.[1]).toBe("down");

    testing.fireEvent.click(ups[2]!);
    expect(mocks.onMove).toHaveBeenCalledTimes(2);
    expect(mocks.onMove.mock.calls[1]?.[1]).toBe("up");
  });

  test("a busy rail disables every move", () => {
    renderRail(CHAPTERS, "ch_rail000001", true);
    const view = testing.within(document.body);
    for (const button of [...view.getAllByTestId("move-chapter-up"), ...view.getAllByTestId("move-chapter-down")]) {
      expect(button).toHaveProperty("disabled", true);
    }
  });

  test("delete asks for the chapter", () => {
    const mocks = renderRail();
    const view = testing.within(document.body);
    testing.fireEvent.click(view.getAllByTestId("delete-chapter")[1]!);
    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toMatchObject({ id: "ch_rail000002" });
  });

  test("rows are natively keyboard-focusable", () => {
    renderRail();
    const view = testing.within(document.body);
    for (const row of view.getAllByTestId("chapter-row")) {
      expect(row.tagName).toBe("BUTTON");
      (row as HTMLElement).focus();
      expect(document.activeElement).toBe(row);
    }
  });
});
