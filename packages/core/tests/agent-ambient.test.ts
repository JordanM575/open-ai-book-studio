import { describe, expect, test } from "bun:test";
import {
  ambientLine,
  ambientStatus,
  ordinal,
  relativeTime,
  spokenNumber,
  type AmbientChapter
} from "../src/agent/ambient";

const chapters: AmbientChapter[] = [
  { id: "ch_one000001", title: "The Light", order: 1, wordCount: 640 },
  { id: "ch_two000002", title: "The Door", order: 2, wordCount: 480 }
];

const now = new Date("2026-10-26T12:00:00.000Z");

function status(overrides: Partial<Parameters<typeof ambientStatus>[0]> = {}) {
  return ambientStatus({
    book: { id: "book_test0001", title: "The Salt Road", stage: "drafting" },
    chapters,
    now,
    ...overrides
  });
}

describe("the ambient status", () => {
  test("knows where the author is without being asked", () => {
    const result = status({ activeChapterId: "ch_two000002" });
    expect(result.chapter?.title).toBe("The Door");
    expect(result.progress.chapters).toBe(2);
    expect(result.progress.words).toBe(1120);
  });

  test("falls back to the last chapter when none is open", () => {
    expect(status().chapter?.title).toBe("The Door");
  });

  test("offers the actions the studio can actually do", () => {
    const result = status({ canUndo: false, canKeepGoing: true });
    const byId = new Map(result.actions.map((action) => [action.id, action]));
    expect(byId.get("read_aloud")?.available).toBe(true);
    expect(byId.get("keep_going")?.available).toBe(true);
    expect(byId.get("stop")?.available).toBe(false);
    expect(byId.get("undo")?.available).toBe(false);
    expect(byId.get("undo")?.why).toMatch(/nothing to undo/i);
    expect(byId.get("where_am_i")?.available).toBe(true);
  });

  test("says why an action is not available", () => {
    const result = status({ canKeepGoing: false });
    const keepGoing = result.actions.find((action) => action.id === "keep_going");
    expect(keepGoing?.available).toBe(false);
    expect(keepGoing?.why).toMatch(/model/i);
  });

  test("knows it is working", () => {
    const result = status({ working: true });
    expect(result.working).toBe(true);
    expect(result.say).toMatch(/working on/i);
  });

  test("reports the last change", () => {
    const result = status({
      lastChange: { what: "I changed The Door", at: "2026-10-26T11:48:00.000Z" }
    });
    expect(result.lastChange?.what).toBe("I changed The Door");
    expect(result.say).toContain("twelve minutes ago");
  });
});

describe("the line the agent says", () => {
  test("is short enough to be heard in one breath", () => {
    const line = ambientLine(status());
    expect(line.length).toBeLessThan(320);
  });

  test("says where the author is and how far along the book is", () => {
    const line = ambientLine(status({ activeChapterId: "ch_one000001" }));
    expect(line).toContain("The Salt Road");
    expect(line).toContain("Chapter One");
    expect(line).toContain("1,120 words");
  });

  test("offers to read the prose", () => {
    expect(ambientLine(status())).toMatch(/shall I read it to you/i);
  });

  test("does not offer to read an empty book", () => {
    const empty = ambientStatus({
      book: { id: "book_test0001", title: "The Salt Road", stage: "onboarding" },
      chapters: [],
      now
    });
    expect(empty.say).not.toMatch(/shall I read/i);
  });

  test("does not offer to read a chapter with no words in it", () => {
    const blank = ambientStatus({
      book: { id: "book_test0001", title: "The Salt Road", stage: "drafting" },
      chapters: [{ id: "ch_one000001", title: "The Light", order: 1, wordCount: 0 }],
      now
    });
    expect(blank.say).not.toMatch(/shall I read/i);
  });
});

describe("the words", () => {
  test("numbers chapters the way they are said", () => {
    expect(ordinal(0)).toBe("Chapter Zero");
    expect(ordinal(1)).toBe("Chapter One");
    expect(ordinal(2)).toBe("Chapter Two");
    expect(ordinal(13)).toBe("Chapter 13");
  });

  test("says small numbers", () => {
    expect(spokenNumber(0)).toBe("zero");
    expect(spokenNumber(12)).toBe("twelve");
    expect(spokenNumber(19)).toBe("nineteen");
    expect(spokenNumber(21)).toBe("twenty-one");
    expect(spokenNumber(34)).toBe("thirty-four");
  });

  test("says how long ago it was", () => {
    const at = (iso: string) => relativeTime(iso, now);
    expect(at("2026-10-26T11:59:40.000Z")).toBe("just now");
    expect(at("2026-10-26T11:48:00.000Z")).toBe("twelve minutes ago");
    expect(at("2026-10-26T11:00:00.000Z")).toBe("one hour ago");
    expect(at("2026-10-25T12:00:00.000Z")).toBe("yesterday");
    expect(at("2026-10-20T12:00:00.000Z")).toBe("six days ago");
  });

  test("does not claim a time it does not have", () => {
    expect(relativeTime("not a date", now)).toBe("a moment ago");
  });
});
