import { beforeAll, describe, expect, test } from "bun:test";

/*
 * The coverage ratchet reads bun's per-file table and averages only the repository's own files.
 * Tests write plugin fixtures into temporary folders, and bun lists those too, so the gate must
 * leave them out without leaving out anything of ours, and must fail loudly on a table it cannot
 * read rather than pass on what it could.
 */

interface Numbers {
  functions: number;
  lines: number;
}

interface Measured extends Numbers {
  files: number;
  outside: string[];
  bun: Numbers;
}

interface CoverageCheck {
  FLOOR: Numbers;
  parseCoverageTable(output: string): { summary: Numbers; files: Array<Numbers & { file: string }> };
  insideRoot(root: string, file: string): boolean;
  measure(output: string, root: string): Measured;
  belowFloor(measured: Numbers, floor?: Numbers): string[];
  judge(
    run: { status: number | null; stdout?: string; stderr?: string },
    root: string,
    options?: { raise?: boolean; floor?: Numbers }
  ): { code: number; messages: Array<["log" | "error", string]> };
}

// The script ships no declaration file, so it is loaded by path and typed by the interface above.
const SCRIPT: string = "../../../scripts/coverage-check.mjs";
let check!: CoverageCheck;

beforeAll(async () => {
  check = (await import(SCRIPT)) as CoverageCheck;
});

const ROOT = "/work/studio";
const RULE = "------------------------------------------------------|---------|---------|-------------------";
const HEADING = "File                                                  | % Funcs | % Lines | Uncovered Line #s";

type Row = [file: string, functions: string, lines: string, uncovered?: string];

/** A table in bun's shape, with the test output around it as bun prints it. */
function bunOutput(summary: [string, string], rows: Row[]): string {
  const pad = (text: string) => text.padEnd(54);
  return [
    "apps/desktop/tests/example.test.ts:",
    "(pass) example > works [0.20ms]",
    RULE,
    HEADING,
    RULE,
    `${pad("All files")}|  ${summary[0].padStart(6)} |  ${summary[1].padStart(6)} |`,
    ...rows.map(([file, functions, lines, uncovered = ""]) => `${pad(` ${file}`)}|  ${functions.padStart(6)} |  ${lines.padStart(6)} | ${uncovered}`),
    RULE,
    "",
    " 12 pass",
    " 0 fail",
    "Ran 12 tests across 3 files. [1.20s]"
  ].join("\n");
}

// Two of the repository's files, and the fixtures a plugin test leaves in the temporary folder,
// printed as bun prints them: relative to the repository, however far up that goes.
const OURS: Row[] = [
  ["apps/desktop/src/main/drafts.ts", "100.00", "100.00"],
  ["apps/desktop/src/main/ipc.ts", "50.00", "80.00", "104,107,110,113-115"]
];
const FIXTURES: Row[] = [
  ["../../../var/folders/kn/T/studio-capabilities-4V6sFy/demo.ts", "0.00", "88.24", "14-15"],
  ["../../../private/var/folders/kn/T/studio-plugins-GgKSmy/demo.ts", "0.00", "100.00"]
];
// Bun's summary is the plain mean of every row, fixtures included.
const WITH_FIXTURES = bunOutput(["37.50", "92.06"], [...OURS, ...FIXTURES]);

describe("coverage ratchet", () => {
  test("the floor stays at 85% of functions and 92% of lines", () => {
    expect(check.FLOOR).toEqual({ functions: 85, lines: 92 });
  });

  test("reads every row, with or without uncovered lines listed", () => {
    const table = check.parseCoverageTable(WITH_FIXTURES);
    expect(table.summary).toEqual({ functions: 37.5, lines: 92.06 });
    expect(table.files).toEqual([
      { file: "apps/desktop/src/main/drafts.ts", functions: 100, lines: 100 },
      { file: "apps/desktop/src/main/ipc.ts", functions: 50, lines: 80 },
      { file: "../../../var/folders/kn/T/studio-capabilities-4V6sFy/demo.ts", functions: 0, lines: 88.24 },
      { file: "../../../private/var/folders/kn/T/studio-plugins-GgKSmy/demo.ts", functions: 0, lines: 100 }
    ]);
  });

  test("averages the repository's files the way bun does and names the ones it left out", () => {
    const measured = check.measure(WITH_FIXTURES, ROOT);
    // The unweighted mean of the two files of ours: (100 + 50) / 2 and (100 + 80) / 2.
    expect(measured.functions).toBe(75);
    expect(measured.lines).toBe(90);
    expect(measured.files).toBe(2);
    expect(measured.outside).toEqual([
      "../../../var/folders/kn/T/studio-capabilities-4V6sFy/demo.ts",
      "../../../private/var/folders/kn/T/studio-plugins-GgKSmy/demo.ts"
    ]);
    expect(measured.bun).toEqual({ functions: 37.5, lines: 92.06 });
  });

  test("counts a path as ours only when it is inside the root", () => {
    expect(check.insideRoot(ROOT, "apps/desktop/src/main/ipc.ts")).toBe(true);
    expect(check.insideRoot(ROOT, "/work/studio/scripts/coverage-check.mjs")).toBe(true);
    expect(check.insideRoot(ROOT, "../../var/folders/T/studio-plugins-x/demo.ts")).toBe(false);
    expect(check.insideRoot(ROOT, "/private/var/folders/T/studio-plugins-x/demo.ts")).toBe(false);
    // A sibling folder whose name starts with the root's is still outside it.
    expect(check.insideRoot(ROOT, "../studio-other/src/a.ts")).toBe(false);
    expect(check.insideRoot(ROOT, "/work/studio-other/src/a.ts")).toBe(false);
    expect(check.insideRoot(ROOT, ".")).toBe(false);
  });

  test("fails loudly on a table it cannot read in full", () => {
    expect(() => check.parseCoverageTable(" 12 pass\n 0 fail\n")).toThrow("there is no coverage table");
    expect(() => check.parseCoverageTable(bunOutput(["75.00", "90.00"], [["apps/a.ts", "n/a", "90.00"]]))).toThrow(
      "could not read the coverage row: apps/a.ts"
    );
    expect(() => check.parseCoverageTable(bunOutput(["75.00", "90.00"], [["apps/a.ts", "75.00", "190.00"]]))).toThrow(
      "could not read the coverage row"
    );
    // Cut off before the closing rule: the rows after the cut would be silently missing.
    const lines = WITH_FIXTURES.split("\n");
    const cut = lines.slice(0, lines.findIndex((line) => line.includes("ipc.ts"))).join("\n");
    expect(() => check.parseCoverageTable(cut)).toThrow("never closes");
    expect(() => check.parseCoverageTable(WITH_FIXTURES.replace(/All files.*\n/, ""))).toThrow("no All files row");
    expect(() => check.parseCoverageTable(bunOutput(["0.00", "0.00"], []))).toThrow("lists no files");
    expect(() => check.parseCoverageTable(WITH_FIXTURES.replace("% Lines", "% Stmts"))).toThrow(
      "no functions or lines column"
    );
  });

  test("refuses a summary that is not the mean of its rows, and a table with nothing of ours", () => {
    expect(() => check.measure(bunOutput(["90.00", "95.00"], OURS), ROOT)).toThrow("bun averages differently now");
    expect(() => check.measure(bunOutput(["0.00", "94.12"], FIXTURES), ROOT)).toThrow(
      "no file in the coverage table is inside the repository"
    );
  });

  test("judges the floor on the repository's numbers, and a number that is not one fails", () => {
    expect(check.belowFloor({ functions: 85, lines: 92 })).toEqual([]);
    expect(check.belowFloor({ functions: 84.999, lines: 91.996 })).toEqual(["functions 84.99% < 85%", "lines 91.99% < 92%"]);
    expect(check.belowFloor({ functions: Number.NaN, lines: 95 })).toEqual(["functions NaN% < 85%"]);
  });

  test("passes a run whose own files clear the floor, though the fixtures would have failed it", () => {
    const verdict = check.judge({ status: 0, stderr: WITH_FIXTURES }, ROOT, { floor: { functions: 70, lines: 90 } });
    expect(verdict.code).toBe(0);
    expect(verdict.messages).toEqual([
      ["log", "[coverage] functions 75.00% (floor 70%), lines 90.00% (floor 90%), over 2 files in the repository"],
      ["log", "[coverage] left out 2 files outside the repository; bun's summary with them is functions 37.5%, lines 92.06%"],
      ["log", "[coverage]   ../../../var/folders/kn/T/studio-capabilities-4V6sFy/demo.ts"],
      ["log", "[coverage]   ../../../private/var/folders/kn/T/studio-plugins-GgKSmy/demo.ts"],
      ["log", "[coverage] at or above the floor"]
    ]);
  });

  test("fails a run under the floor and says what to do", () => {
    const verdict = check.judge({ status: 0, stdout: bunOutput(["75.00", "90.00"], OURS) }, ROOT);
    expect(verdict.code).toBe(1);
    expect(verdict.messages).toEqual([
      ["log", "[coverage] functions 75.00% (floor 85%), lines 90.00% (floor 92%), over 2 files in the repository"],
      ["error", "[coverage] below the floor: functions 75.00% < 85%, lines 90.00% < 92%"],
      ["error", "[coverage] add a test, or explain in the commit why the floor should drop"]
    ]);
  });

  test("--raise reports the floor the numbers would support, without judging them", () => {
    const verdict = check.judge({ status: 0, stdout: bunOutput(["75.00", "90.00"], OURS) }, ROOT, { raise: true });
    expect(verdict.code).toBe(0);
    expect(verdict.messages.at(-1)).toEqual(["log", "[coverage] the floor could be { functions: 75, lines: 90 }"]);
  });

  test("a failed suite or an unreadable table fails the check, whatever the numbers", () => {
    expect(check.judge({ status: 1, stderr: WITH_FIXTURES }, ROOT)).toEqual({
      code: 1,
      messages: [["error", "[coverage] the test suite failed, which matters more than the number"]]
    });
    expect(check.judge({ status: null, stderr: "Segmentation fault" }, ROOT)).toEqual({
      code: 1,
      messages: [["error", "[coverage] the test run did not complete"]]
    });
    expect(check.judge({ status: 0, stdout: "All files | 100.00 | 100.00 |" }, ROOT)).toEqual({
      code: 1,
      messages: [["error", "[coverage] there is no coverage table in the output"]]
    });
  });
});
