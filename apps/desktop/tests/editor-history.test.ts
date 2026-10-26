import { describe, expect, test } from "bun:test";
import {
  clearEditorHistory,
  historyFor,
  pushHistory,
  redoHistory,
  undoHistory
} from "@ai-book-studio/app/lib/editor-history";

describe("editor history", () => {
  test("coalesces a typing burst into one undo step", () => {
    const id = "ch_history00001";
    pushHistory(id, "A", 1000, false);
    pushHistory(id, "AB", 1200, false);
    pushHistory(id, "ABC", 1400, false);

    expect(historyFor(id).undo).toEqual(["A"]);
    expect(undoHistory(id, "ABCD")).toBe("A");
    expect(redoHistory(id, "A")).toBe("ABCD");
  });

  test("a paste or a pause starts a new step", () => {
    const id = "ch_history00002";
    pushHistory(id, "A", 1000, false);
    pushHistory(id, "AB", 1600, false);
    expect(historyFor(id).undo).toEqual(["A", "AB"]);

    pushHistory(id, "AB-pasted text", 1700, true);
    expect(historyFor(id).undo).toEqual(["A", "AB", "AB-pasted text"]);
  });

  test("a new edit clears the redo stack", () => {
    const id = "ch_history00003";
    pushHistory(id, "A", 1000, false);
    expect(undoHistory(id, "AB")).toBe("A");
    expect(historyFor(id).redo).toEqual(["AB"]);

    pushHistory(id, "A", 2000, false);
    expect(historyFor(id).redo).toEqual([]);
  });

  test("histories are isolated per chapter and can be cleared", () => {
    pushHistory("ch_one000001", "One", 1000, false);
    pushHistory("ch_two000002", "Two", 1000, false);

    expect(undoHistory("ch_one000001", "One!")).toBe("One");
    expect(undoHistory("ch_two000002", "Two!")).toBe("Two");

    clearEditorHistory("ch_one000001");
    expect(undoHistory("ch_one000001", "Again")).toBeNull();
  });
});
