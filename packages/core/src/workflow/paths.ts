import { toLibraryFilePath, toLibraryPath, type LibraryPath } from "../library/path";

/**
 * Exact schema-1 workflow paths under `books/<bookId>/workflows/<runId>/` (docs/FORMAT.md,
 * "Workflow records (schema 1)"). These are format constants, not preferences.
 *
 * Only the T023 record kinds, plus the absent-only direction epoch, are listed. Command/receipt
 * pages, policies, plans, reservations, observations and accounting keep their reserved FORMAT
 * paths but have no writer in this slice.
 */

export const WORKFLOW_DIR = "workflows";
export const WORKFLOW_CONFLICTS = "conflicts";
export const WORKFLOW_RUN_FILE = "run.json";

export const workflowsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId]);
export const runHeaderPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, WORKFLOW_RUN_FILE]);
export const tasksPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "tasks"]);
export const taskPath = (bookId: string, runId: string, taskId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "tasks", `${taskId}.json`]);
export const attemptsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "attempts"]);
export const attemptPath = (bookId: string, runId: string, attemptId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "attempts", `${attemptId}.json`]);
export const effectsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "effects"]);
export const effectPath = (bookId: string, runId: string, effectId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "effects", `${effectId}.json`]);
export const questionsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "questions"]);
export const questionPath = (bookId: string, runId: string, questionId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "questions", `${questionId}.json`]);
export const artifactsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "artifacts"]);
export const artifactMetaPath = (bookId: string, runId: string, artifactId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "artifacts", `${artifactId}.meta.json`]);
export const artifactBodyPath = (
  bookId: string,
  runId: string,
  artifactId: string,
  extension: "md" | "json"
): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "artifacts", `${artifactId}.${extension}`]);
export const directionsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "directions"]);
export const directionPath = (bookId: string, runId: string, directionId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "directions", `${directionId}.json`]);
export const contextsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "contexts"]);
export const contextPath = (bookId: string, runId: string, contextId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "contexts", `${contextId}.json`]);
export const workflowConflictsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, WORKFLOW_CONFLICTS]);
export const workflowConflictPath = (bookId: string, runId: string, fileName: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, WORKFLOW_CONFLICTS, fileName]);
export const adoptionReceiptsPath = (bookId: string, runId: string): LibraryPath =>
  toLibraryPath(["books", bookId, WORKFLOW_DIR, runId, "adoptions"]);
export const adoptionReceiptPath = (bookId: string, runId: string, receiptId: string): LibraryPath =>
  toLibraryFilePath(["books", bookId, WORKFLOW_DIR, runId, "adoptions", `${receiptId}.json`]);

/** A human-readable library path for messages. Never used as a host path. */
export function workflowDisplayPath(path: LibraryPath): string {
  return path.join("/");
}
