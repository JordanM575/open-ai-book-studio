import { describe, expect, test } from "bun:test";
import { contextBreakdown, estimateTokens } from "../src/agent/context";

describe("context estimate", () => {
  test("counts four characters as one estimated token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  test("keeps named sections and the conversation in one estimate", () => {
    const breakdown = contextBreakdown(
      [
        { id: "instructions", label: "Instructions", text: "abcd" },
        { id: "outline", label: "Outline", text: "" },
        { id: "chapters", label: "Chapters", text: "abcdefgh" }
      ],
      "abcdefghijkl"
    );
    expect(breakdown.estimated).toBe(true);
    expect(breakdown.sections.map((section) => section.id)).toEqual(["instructions", "chapters"]);
    expect(breakdown.sections[1]).toMatchObject({ characters: 8, estimatedTokens: 2 });
    expect(breakdown.conversationTokens).toBe(3);
    expect(breakdown.totalTokens).toBe(6);
  });
});
