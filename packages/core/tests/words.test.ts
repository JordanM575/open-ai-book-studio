import { describe, expect, test } from "bun:test";
import { countWords } from "../src/words";
import { countWords as countWordsFromMarkdown } from "../src/markdown";

describe("studio word counter", () => {
  test("the format module re-exports the single implementation", () => {
    expect(countWordsFromMarkdown).toBe(countWords);
  });

  test("counts whitespace-separated tokens", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
    expect(countWords("one — two ...\n")).toBe(4);
    expect(countWords("Salt and stone.\n")).toBe(3);
    expect(countWords("a  b\n\nc\td")).toBe(4);
    expect(countWords("word ".repeat(1000).trimEnd())).toBe(1000);
  });

  test("counts across verse line and stanza breaks", () => {
    expect(countWords("Roses are red  \nViolets are blue\n\nSugar is sweet\nAnd so are you\n")).toBe(13);
  });
});
