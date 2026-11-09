import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";

/** Reads the counted check-in inputs for one checked campaign, or refuses with a typed code. */
export type ContinuationCheckinReader = (input: ReadContinuationCheckinInput) => Promise<ContinuationCheckinInput>;

export interface ContinuationCheckinRefusalInfo {
  readonly code: string;
  readonly message: string;
}

/** Extract the typed refusal a reader rejected with; anything else stays a plain failure. */
export function refusalInfo(error: unknown): ContinuationCheckinRefusalInfo {
  if (error !== null && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && candidate.code.length > 0) {
      return {
        code: candidate.code,
        message: typeof candidate.message === "string" ? candidate.message : "",
      };
    }
  }
  return { code: "", message: error instanceof Error ? error.message : "" };
}

/**
 * Whether this refusal is the production state with no coordinator run to
 * check in against, as opposed to a saved record this build cannot read.
 * The host message is only inspected for this distinction; the shown text
 * below stays owned by the presenter.
 */
export function isNoCoordinatorRefusal(info: ContinuationCheckinRefusalInfo): boolean {
  return info.code === "unsupported" && /coordinator|desktop app/i.test(info.message);
}

export interface RefusalPresentation {
  readonly testId: string;
  readonly copy: string;
}

const refusalCopy: Readonly<Record<string, string>> = {
  conflict: "The saved continuation changed since it was read. Read it again before checking in.",
  uncertain: "This continuation is only partly present, so it cannot be checked in as complete. Inspect its retained files first.",
  "not-found": "That continuation is not saved for this book.",
  corrupt: "This continuation, its reports, or the coordinator identity belong to another book or do not agree. Nothing was changed.",
  unsupported: "This saved continuation uses something this build does not understand, so it cannot be checked in. Your saved campaign was not changed.",
  "replan-required": "This continuation was planned with an earlier planner and must be replanned before check-in.",
  "too-large": "This continuation is larger than one coordinator check-in can hold, so it was not split or shortened.",
  "foreign-reference": "The coordinator direction belongs to another run, so this check-in was refused.",
  invalid: "That campaign identity is not valid. Check it and try again.",
};

export const noCoordinatorCopy =
  "You need an active coordinator run to check in, and none is active in this studio. Your saved campaign was not changed.";
export const fallbackRefusalCopy =
  "This continuation cannot be checked in as saved. Your saved continuation was not changed.";

/** The truthful presentation for one typed refusal; partial is never shown as complete. */
export function refusalPresentation(info: ContinuationCheckinRefusalInfo): RefusalPresentation {
  if (isNoCoordinatorRefusal(info)) {
    return { testId: "continuation-checkin-no-coordinator", copy: noCoordinatorCopy };
  }
  const copy = refusalCopy[info.code];
  if (copy !== undefined) {
    return { testId: `continuation-checkin-refusal-${info.code}`, copy };
  }
  return { testId: "continuation-checkin-refusal", copy: fallbackRefusalCopy };
}
