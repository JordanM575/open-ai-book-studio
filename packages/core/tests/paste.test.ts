import { describe, expect, test } from "bun:test";
import { normalizePasteText } from "../src/paste";

describe("normalizePasteText", () => {
  test("unifies Windows and old Mac line endings", () => {
    expect(normalizePasteText("One.\r\nTwo.\rThree.\n")).toBe("One.\nTwo.\nThree.\n");
  });

  test("turns non-breaking spaces into plain spaces", () => {
    expect(normalizePasteText("bread\u00a0and\u00a0circuses")).toBe("bread and circuses");
  });

  test("straightens curly quotes but leaves straight quotes alone", () => {
    expect(normalizePasteText("\u201cMara,\u201d she said, \u2018stay.\u2019")).toBe("\"Mara,\" she said, 'stay.'");
    expect(normalizePasteText("\"Plain\" and 'simple'.")).toBe("\"Plain\" and 'simple'.");
  });

  test("caps runaway blank lines at one", () => {
    expect(normalizePasteText("One.\n\n\n\nTwo.\n")).toBe("One.\n\nTwo.\n");
    expect(normalizePasteText("One.\n\n\nTwo.\n")).toBe("One.\n\nTwo.\n");
  });

  test("leaves verse alone: single breaks, stanza breaks and hard breaks survive", () => {
    const verse = "The tide comes in.\nThe tide goes out.\n\nGulls cry.\nGulls fall.  \n";
    expect(normalizePasteText(verse)).toBe(verse);
  });

  test("leaves tabs, dashes and trailing spaces alone", () => {
    const text = "\tIndented — with a dash.  \n";
    expect(normalizePasteText(text)).toBe(text);
  });
});
