import { expect, test } from "bun:test";
import { WORKFLOW_LIMITS } from "../../src/authoring/wire";
import { toLibraryPath } from "../../src/library/path";
import { effectiveReadLimit, moveReadLimit, workflowReadLimit, WORKFLOW_CONFLICT_BYTES } from "../../src/library/read-limits";

test("workflow limits cover checked-read paths, conflict copies and whole-book trash", () => {
  const roots = [
    ["books", "book_fixture", "workflows", "run_fixture"],
    [".studio", "trash", "books", "stamp-book_fixture", "workflows", "run_fixture"],
    [".studio", "trash", "book_fixture", "workflows", "run_fixture"]
  ];
  const cases: Array<[string[], number]> = [
    [["run.json"], WORKFLOW_LIMITS.runBytes],
    [["plans", "plan_fixture.json"], WORKFLOW_LIMITS.phasePlanBytes],
    [["tasks", "task_fixture.json"], WORKFLOW_LIMITS.recordBytes],
    [["contexts", "context_fixture.json"], WORKFLOW_LIMITS.recordBytes],
    [["artifacts", "artifact_fixture.meta.json"], WORKFLOW_LIMITS.recordBytes],
    [["artifacts", "artifact_fixture.md"], WORKFLOW_LIMITS.artifactBytes],
    [["artifacts", "artifact_fixture.json"], WORKFLOW_LIMITS.artifactBytes],
    [["conflicts", "artifact_fixture.body.md"], WORKFLOW_CONFLICT_BYTES]
  ];
  for (const root of roots) for (const [suffix, expected] of cases) {
    const path = toLibraryPath([...root, ...suffix]);
    expect(workflowReadLimit(path)).toBe(expected);
    expect(effectiveReadLimit(path, { maxBytes: expected + 1 })).toBe(expected);
    expect(effectiveReadLimit(path, { maxBytes: expected - 1 })).toBe(expected - 1);
  }
  expect(workflowReadLimit(toLibraryPath(["books", "book_fixture", "chapters", "one.md"]))).toBeUndefined();
  expect(effectiveReadLimit(toLibraryPath(["books", "book_fixture", "chapters", "one.md"]), { maxBytes: 5 })).toBe(5);
  expect(() => effectiveReadLimit(toLibraryPath(["file"]), { maxBytes: -1 })).toThrow();
  expect(() => effectiveReadLimit(toLibraryPath(["file"]), { maxBytes: Number.POSITIVE_INFINITY })).toThrow();
  const ordinary = toLibraryPath(["ordinary"]);
  const task = toLibraryPath(["books", "book_fixture", "workflows", "run_fixture", "tasks", "task_fixture.json"]);
  const artifact = toLibraryPath(["books", "book_fixture", "workflows", "run_fixture", "artifacts", "artifact_fixture.md"]);
  expect(moveReadLimit(ordinary, ordinary)).toBeUndefined();
  expect(moveReadLimit(ordinary, task)).toBe(WORKFLOW_LIMITS.recordBytes);
  expect(moveReadLimit(task, ordinary)).toBe(WORKFLOW_LIMITS.recordBytes);
  expect(moveReadLimit(task, artifact)).toBe(WORKFLOW_LIMITS.recordBytes);
  expect(moveReadLimit(artifact, task)).toBe(WORKFLOW_LIMITS.recordBytes);
});
