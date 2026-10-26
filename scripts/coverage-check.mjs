#!/usr/bin/env node
/**
 * The coverage ratchet.
 *
 * Coverage was never measured, which means nobody could tell whether a change made it worse. It
 * is measured now, and the floor only moves up: a change that drops it below the floor fails, and
 * a change that raises it is expected to raise the floor in the same commit.
 *
 *   bun run coverage            check against the floor
 *   bun run coverage --raise    print what the floor should become
 *
 * Bun's coverage does not fail a run by itself, so this reads the summary it prints and decides.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The floor, kept a little under the current numbers so a refactor does not fail for noise. */
const FLOOR = { functions: 80, lines: 87 };

const raise = process.argv.includes("--raise");

// Bun prints the coverage table on stderr, and a failing suite still prints it, so both streams
// are read and the exit code is judged separately.
const run = spawnSync("bun", ["test", "--coverage"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8"
});
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

if (run.status !== 0) {
  if (!output.includes("All files")) {
    console.error("[coverage] the test run did not complete");
    process.exit(1);
  }
  console.error("[coverage] the test suite failed, which matters more than the number");
  process.exit(1);
}

const line = output.split("\n").find((entry) => entry.trimStart().startsWith("All files"));
if (!line) {
  console.error("[coverage] no summary line in the output");
  process.exit(1);
}

// The summary is a table: name, then the percentages.
const numbers = [...line.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
const [functions, lines] = numbers;
if (functions === undefined || lines === undefined) {
  console.error(`[coverage] could not read the summary: ${line.trim()}`);
  process.exit(1);
}

console.log(`[coverage] functions ${functions}% (floor ${FLOOR.functions}%), lines ${lines}% (floor ${FLOOR.lines}%)`);

if (raise) {
  console.log(`[coverage] the floor could be { functions: ${Math.floor(functions)}, lines: ${Math.floor(lines)} }`);
  process.exit(0);
}

const below = [];
if (functions < FLOOR.functions) below.push(`functions ${functions}% < ${FLOOR.functions}%`);
if (lines < FLOOR.lines) below.push(`lines ${lines}% < ${FLOOR.lines}%`);

if (below.length > 0) {
  console.error(`[coverage] below the floor: ${below.join(", ")}`);
  console.error("[coverage] add a test, or explain in the commit why the floor should drop");
  process.exit(1);
}
console.log("[coverage] at or above the floor");
