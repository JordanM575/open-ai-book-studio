import { describe, expect, test } from "bun:test";
import { toSpeechText } from "../src/speech-text";

describe("words for the voice", () => {
  test("plain prose passes through unchanged", () => {
    expect(toSpeechText("The storm came in low. Mara lit the lamp.")).toBe(
      "The storm came in low. Mara lit the lamp."
    );
  });

  test("emphasis markers go and the words stay", () => {
    expect(toSpeechText("She **meant** it, *truly*, and __swore__ it _twice_.")).toBe(
      "She meant it, truly, and swore it twice."
    );
    expect(toSpeechText("A ***very*** long night and ~~never~~ again.")).toBe(
      "A very long night and never again."
    );
  });

  test("underscores and asterisks inside words are kept", () => {
    expect(toSpeechText("Call snake_case_name and 2 * 3 * 4 is 24.")).toBe(
      "Call snake_case_name and 2 * 3 * 4 is 24."
    );
  });

  test("links are said as their text and images as their alt text", () => {
    expect(toSpeechText("See [the lighthouse](https://example.test/x) and ![A lantern](lamp.png).")).toBe(
      "See the lighthouse and A lantern."
    );
    expect(toSpeechText("Read [the note][1] and [^2] carefully.")).toBe("Read the note and carefully.");
  });

  test("headings are said as a sentence, so the voice pauses after them", () => {
    expect(toSpeechText("## The Light\n\nThe storm came.")).toBe("The Light.\n\nThe storm came.");
    expect(toSpeechText("# Chapter One?")).toBe("Chapter One?");
    expect(toSpeechText("### Closing hashes ###")).toBe("Closing hashes.");
  });

  test("list markers and blockquote markers go", () => {
    expect(toSpeechText("- one\n* two\n3. three\n> quoted words")).toBe("one\ntwo\nthree\nquoted words");
    expect(toSpeechText("- [x] done\n- [ ] open")).toBe("done\nopen");
  });

  test("code spans keep their words, even when they look like markup", () => {
    expect(toSpeechText("Type `grep *.md` then `**not bold**`.")).toBe(
      "Type grep *.md then **not bold**."
    );
  });

  test("fenced code is not read aloud", () => {
    expect(toSpeechText("Run this:\n```bash\nrm -rf build\n```\nThen stop.")).toBe("Run this:\nThen stop.");
    expect(toSpeechText("~~~\nhidden\n~~~\nShown.")).toBe("Shown.");
  });

  test("front matter is not read aloud", () => {
    expect(toSpeechText("---\ntitle: The Salt Road\n---\nIt begins here.")).toBe("It begins here.");
  });

  test("tables are said as cells, and their delimiter row goes", () => {
    expect(toSpeechText("| Name | Role |\n|---|:---:|\n| Mara | Keeper |")).toBe(
      "Name, Role\nMara, Keeper"
    );
  });

  test("horizontal rules and html tags go, the words stay", () => {
    expect(toSpeechText("Before.\n\n---\n\nAfter <em>this</em>.<br>Next")).toBe(
      "Before.\n\nAfter this. Next"
    );
  });

  test("escaped characters are literal, not markup", () => {
    expect(toSpeechText("\\*not emphasis\\* and a \\# sign")).toBe("*not emphasis* and a # sign");
  });

  test("autolinks are dropped", () => {
    expect(toSpeechText("Visit <https://example.test> today.")).toBe("Visit today.");
  });

  test("the rule is idempotent: speaking spoken text changes nothing", () => {
    const once = toSpeechText("## Title\n\n**Bold** with [a link](x) and `code`.");
    expect(toSpeechText(once)).toBe(once);
  });

  test("empty and markup-only input says nothing", () => {
    expect(toSpeechText("")).toBe("");
    expect(toSpeechText("```\nonly code\n```")).toBe("");
    expect(toSpeechText("***")).toBe("");
  });
});
