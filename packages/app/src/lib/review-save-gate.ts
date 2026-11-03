import type { SaveStatus } from "../components/ManuscriptEditor";

export type ReviewSaveDecision = "save" | "cancel" | undefined;

export type ReviewSaveGateResult<T> =
  | { status: "ready"; value: T }
  | { status: "choice-required" }
  | { status: "cancelled" }
  | { status: "blocked"; saveStatus: Exclude<SaveStatus, { kind: "saved" }> };

/** Only run the supplied analysis after an explicit dirty-buffer save is confirmed. */
export async function runAfterReviewSave<T>(
  currentStatus: SaveStatus,
  decision: ReviewSaveDecision,
  flush: () => Promise<SaveStatus>,
  run: () => T | Promise<T>
): Promise<ReviewSaveGateResult<T>> {
  if (decision === "cancel") return { status: "cancelled" };
  if (currentStatus.kind === "saved") return { status: "ready", value: await run() };
  if (decision !== "save") return { status: "choice-required" };

  let saveStatus: SaveStatus;
  try {
    saveStatus = await flush();
  } catch {
    saveStatus = { kind: "error", message: "The chapter could not be saved." };
  }
  if (saveStatus.kind !== "saved") return { status: "blocked", saveStatus };
  return { status: "ready", value: await run() };
}
