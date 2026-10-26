import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { inspectSample, secretProblems } from "../../../scripts/submission-check";

const root = resolve(import.meta.dir, "../../..");

describe("submission packet", () => {
  test("the committed sample is complete and internally consistent", async () => {
    expect(await inspectSample(root)).toEqual([]);
  });

  test("detects obvious provider secrets without flagging ordinary prose", () => {
    // Build the fixtures at runtime so the committed test file does not itself contain a key-shaped
    // string that the submission scan would flag.
    const openRouter = ["sk-or-v1", "Q7mZ2vN8pR4sT6xY9aB3cD5eF7gH1jK2"].join("-");
    const github = ["ghp", "Q7mZ2vN8pR4sT6xY9aB3cD5eF7gH1jK2"].join("_");
    expect(secretProblems("fixture.txt", openRouter)).toHaveLength(1);
    expect(secretProblems("fixture.txt", github)).toHaveLength(1);
    expect(secretProblems("fixture.txt", "The lighthouse keeper counted the gulls.")).toEqual([]);
  });
});
