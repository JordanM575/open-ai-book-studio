import { expect, test } from "bun:test";
import { insertDictation } from "../../src/voice-session";

test("default dictation retains selected text and literal verse/Unicode", () => {
  const source = "Before SELECTED after.";
  const spoken = "詩 — café 🪶\n\n  next line\n";
  const result = insertDictation(source, spoken, 7, 15);
  expect(result.text).toBe(`Before ${spoken}SELECTED after.`);
  expect(result.caret).toBe(7 + spoken.length);
  expect(insertDictation(source, "", 7, 15).text).toBe(source);
});

test.each([[-1, 0], [2, 1], [0, 999], [NaN, 0], [0, Infinity], [0.5, 1]])(
  "invalid offsets %p/%p leave the original text untouched", (start, end) => {
    expect(() => insertDictation("Synthetic source", "spoken", start, end)).toThrow(RangeError);
  },
);

test("selection offsets cannot split a Unicode surrogate pair", () => {
  expect(() => insertDictation("A🪶B", "text", 2, 3)).toThrow(RangeError);
  expect(() => insertDictation("A🪶B", "text", 1, 2)).toThrow(RangeError);
  expect(insertDictation("A🪶B", "\n", 1, 3).text).toBe("A\n🪶B");
});
