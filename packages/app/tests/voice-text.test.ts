import { describe, expect, test } from "bun:test";
import { insertTranscript } from "../src/lib/voice-text";

describe("transcript insertion", () => {
  test("adds spaces only where the surrounding text needs them", () => {
    expect(insertTranscript("One two.", "three four", 8, 8)).toEqual({
      text: "One two. three four",
      caret: 19
    });
  });

  test("does not double an existing space", () => {
    expect(insertTranscript("One two. ", "three", 9, 9)).toEqual({
      text: "One two. three",
      caret: 14
    });
  });

  test("inserts between words and before punctuation", () => {
    expect(insertTranscript("Hello world.", "there ", 6, 6)).toEqual({
      text: "Hello there world.",
      caret: 12
    });
    expect(insertTranscript("Wait.", "a moment", 4, 4)).toEqual({
      text: "Wait a moment.",
      caret: 13
    });
  });

  test("replaces a selection", () => {
    expect(insertTranscript("One old two", "new", 4, 7)).toEqual({
      text: "One new two",
      caret: 7
    });
  });

  test("leaves the chapter untouched for silence", () => {
    expect(insertTranscript("Text", "   ", 0, 0)).toBeNull();
  });
});
