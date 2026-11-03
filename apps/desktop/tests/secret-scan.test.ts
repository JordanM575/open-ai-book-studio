import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  enablesSourceMaps,
  proseProblems,
  scanArtifactDir,
  scanArtifacts,
  scanTrackedSecrets,
  secretProblems,
  sourceMapConfigProblems,
  trackedFiles
} from "../../../scripts/submission-check";

const root = resolve(import.meta.dir, "../../..");

// Every fixture below is assembled at runtime so this file never contains a key-shaped
// string or a pasted prose block that the scan itself would flag.
function fakeKey(): { prefix: string; body: string; value: string } {
  const prefix = ["sk", "or-v1"].join("-");
  const body = ["Q7mZ2vN8pR4sT6xY9aB3cD5eF7gH1jK2", ""].join("");
  return { prefix, body, value: [prefix, body].join("-") };
}

function storyLines(count: number): string[] {
  const sentences = [
    "The keeper climbed the winding stair with the brass lamp held high above his head",
    "Wind rattled the lantern room glass and threw his shadow across the whitewashed wall",
    "Below him the sea flattened itself against the rocks in long patient grey rollers",
    "He had kept this light for eleven winters and never once let the flame go out",
    "Tonight the oil smelled wrong, sweet and sharp, like varnish left too near a stove",
    "He lifted the reservoir cover and found the wick drowned in a slick of dark water",
    "Someone had climbed these stairs before him, and recently, and without a lamp",
    "The logbook lay open on the desk with the pen still wet across the midnight entry",
    "Nobody else held a key to the tower, and the spare hung undisturbed on its hook",
    "He read the entry twice, then a third time, because the handwriting was his own",
    "It described the storm now hammering the glass, down to the gull crying on the ledge",
    "It ended with a single line he had no memory of writing in any weather at all",
    "When the light goes out, do not go down the stairs until the bell stops ringing",
    "He set the pen down carefully and listened for the bell through the roar of the sea"
  ];
  return sentences.slice(0, count);
}

function chapterFile(): string {
  return [
    "---",
    "id: ch_fixture000000000001",
    "title: The Fixture",
    "order: 1",
    "isPrologue: false",
    "version: 1",
    "---",
    "",
    "Nothing to see here."
  ].join("\n");
}

describe("secret and manuscript scan", () => {
  test("names the pattern without printing the matched value", () => {
    const { body, value } = fakeKey();
    const problems = secretProblems("fixture.txt", `token=${value}`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("fixture.txt");
    expect(problems[0]).not.toContain(body);
  });

  test("finds a secret in a synthetic tracked tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-tree-"));
    const { body, value } = fakeKey();
    writeFileSync(join(dir, "ok.txt"), "The lighthouse keeper counted the gulls.\n");
    writeFileSync(join(dir, "leak.txt"), `token=${value}\n`);
    const problems = await scanTrackedSecrets(dir, ["leak.txt", "ok.txt"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("leak.txt");
    expect(problems[0]).not.toContain(body);
  });

  test("catches an emitted source map and a secret bundle in one artifact dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-artifacts-"));
    const { body, value } = fakeKey();
    writeFileSync(join(dir, "bundle.js"), `const token="${value}";\n`);
    writeFileSync(join(dir, "bundle.js.map"), '{"version":3}\n');
    const result = await scanArtifactDir(dir, "fixture");
    expect(result.scanned).toBe(1);
    expect(result.problems).toHaveLength(2);
    expect(result.problems.join("\n")).toContain("source map");
    for (const problem of result.problems) expect(problem).not.toContain(body);
  });

  test("reads the source-map switch in bundler config text", () => {
    expect(enablesSourceMaps("build: { sourcemap: true }")).toBe(true);
    expect(enablesSourceMaps('build: { sourcemap: "hidden" }')).toBe(true);
    expect(enablesSourceMaps("build: { sourcemap: false }")).toBe(false);
    expect(enablesSourceMaps("build: { outDir: 'dist' }")).toBe(false);
  });

  test("flags chapter-format and pasted prose, not ordinary docs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-prose-"));
    writeFileSync(join(dir, "note.md"), `${chapterFile()}\n`);
    writeFileSync(join(dir, "story.ts"), `${storyLines(14).join("\n")}\n`);
    writeFileSync(join(dir, "guide.md"), "# Guide\n\nShort project notes.\n");
    writeFileSync(join(dir, "short.ts"), `const lines = "x";\n${storyLines(5).join("\n")}\n`);
    const problems = await proseProblems(dir, ["guide.md", "note.md", "short.ts", "story.ts"]);
    expect(problems).toEqual([
      "note.md: chapter-format file outside the sample corpus",
      "story.ts: pasted prose block in a code file"
    ]);
  });

  test("the repository tree is clean", async () => {
    const tracked = trackedFiles(root);
    expect(await scanTrackedSecrets(root, tracked)).toEqual([]);
    expect(await proseProblems(root, tracked)).toEqual([]);
  });

  test("bundler configs stay source-map free", async () => {
    expect(await sourceMapConfigProblems(root)).toEqual([]);
  });

  test("present build artifacts hold no secrets or source maps", async () => {
    const result = await scanArtifacts(root);
    expect(result.problems).toEqual([]);
  });
});
