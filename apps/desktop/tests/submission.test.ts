import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { inspectSample, secretProblems } from "../../../scripts/submission-check";

const root = resolve(import.meta.dir, "../../..");

describe("submission packet", () => {
  test("the committed sample is complete and internally consistent", async () => {
    expect(await inspectSample(root)).toEqual([]);
  });

  test("detects obvious provider secrets without flagging ordinary prose", () => {
    expect(secretProblems("fixture.txt", "sk-or-v1-Q7mZ2vN8pR4sT6xY9aB3cD5eF7gH1jK2")).toHaveLength(1);
    expect(secretProblems("fixture.txt", "ghp_Q7mZ2vN8pR4sT6xY9aB3cD5eF7gH1jK2")).toHaveLength(1);
    expect(secretProblems("fixture.txt", "The lighthouse keeper counted the gulls.")).toEqual([]);
  });
});
