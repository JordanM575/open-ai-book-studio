import { WORKFLOW_LIMITS } from "../authoring/wire";
import { LibraryPortError } from "./errors";
import type { LibraryPath } from "./path";

export const WORKFLOW_CONFLICT_BYTES = 5_000_000;

/** Bounds also apply to whole-book trash; a scan or adapter readback must not bypass them. */
export function workflowReadLimit(path: LibraryPath): number | undefined {
  let workflow = -1;
  if (path[0] === "books" && path[1] && path[2] === "workflows") workflow = 2;
  if (path[0] === ".studio" && path[1] === "trash") {
    if (path[2] === "books" && path[3] && path[4] === "workflows") workflow = 4;
    else if (path[2] && path[3] === "workflows") workflow = 3;
  }
  if (workflow < 0 || !path[workflow + 1]) return undefined;
  const parts = path.slice(workflow + 2);
  if (parts.length === 0) return undefined;
  if (parts[0] === "conflicts") return WORKFLOW_CONFLICT_BYTES;
  if (parts.length === 1 && parts[0] === "run.json") return WORKFLOW_LIMITS.runBytes;
  if (parts[0] === "plans") return WORKFLOW_LIMITS.phasePlanBytes;
  if (parts[0] === "artifacts" && parts.length === 2 && !parts[1]?.endsWith(".meta.json")) {
    return WORKFLOW_LIMITS.artifactBytes;
  }
  return WORKFLOW_LIMITS.recordBytes;
}

/** Caller limits can only tighten the mandatory workflow ceiling. */
export function effectiveReadLimit(path: LibraryPath, options?: { maxBytes: number }): number | undefined {
  const requested = options?.maxBytes;
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 0)) {
    throw new LibraryPortError("invalid-path", "The requested read limit is invalid.");
  }
  const workflow = workflowReadLimit(path);
  if (requested === undefined) return workflow;
  return workflow === undefined ? requested : Math.min(requested, workflow);
}

/** A copied/moved file must satisfy the ceiling at both its source and its destination. */
export function moveReadLimit(from: LibraryPath, to: LibraryPath): number | undefined {
  const source = workflowReadLimit(from);
  const destination = workflowReadLimit(to);
  if (source === undefined) return destination;
  return destination === undefined ? source : Math.min(source, destination);
}

export function readTooLarge(): LibraryPortError {
  return new LibraryPortError("too-large", "The file exceeds the allowed read size. It was left untouched.");
}
