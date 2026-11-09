import {
  mapCampaignContinuationCheckin,
  type ContinuationCheckinInput
} from "@ai-book-studio/core/review/campaign-continuation-checkin";
import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { Library } from "./library/store";

/**
 * Host reading for the 039 T018 seam 6b check-in: load one checked
 * continuation campaign through the Library's existing store readers, map it
 * with the accepted 6a contract, and return only counted check-in inputs.
 *
 * The 037 run owner and current direction reference are supplied by the host
 * (the main process), never by the renderer and never invented here: this
 * build keeps no 037 coordinator session state in the main process (the
 * `Studio` holds only the open library, drafts and recovery, and no channel
 * registers a current workflow run), so a caller without a coordinator
 * identity gets a truthful `unsupported` refusal instead of a fabricated
 * owner. When a coordinator session exists, its owner/direction are passed
 * in exactly as sibling channels receive session identity from the host.
 *
 * Every 6a refusal surfaces as a typed `ContinuationCheckinError` carrying
 * the contract's own code, so the IPC boundary can answer with `fail()`
 * instead of an empty or successful result. Scalar/byte counters are
 * returned verbatim; no word count, cadence or task role is derived.
 */

/** The host-supplied 037 identity a check-in is mapped against. */
export type CoordinatorIdentity = ContinuationCheckinInput["coordinator"];

/** A truthful check-in refusal: the 6a code plus an author-readable message. */
export class ContinuationCheckinError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContinuationCheckinError";
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  conflict: "The saved continuation changed since it was read. Read it again before checking in.",
  uncertain: "This continuation is only partly present, so it cannot be checked in as complete. Inspect its retained files first.",
  "not-found": "That continuation is not saved for this book.",
  corrupt: "This continuation, its reports, or the coordinator identity belong to another book or do not agree. Nothing was changed.",
  unsupported: "This continuation uses something this build does not understand, so it cannot be checked in.",
  "replan-required": "This continuation was planned with an earlier planner and must be replanned before check-in.",
  "too-large": "This continuation is larger than one coordinator check-in can hold, so it was not split or shortened.",
  "foreign-reference": "The coordinator direction belongs to another run, so this check-in was refused."
};

function refusal(code: string): ContinuationCheckinError {
  return new ContinuationCheckinError(code, MESSAGES[code] ?? "This continuation cannot be checked in as saved.");
}

/**
 * Read the counted check-in inputs for one checked campaign. Read-only: the
 * store readers and the pure mapper never write, re-encode or recount prose.
 */
export async function readContinuationCheckin(
  library: Library,
  input: ReadContinuationCheckinInput,
  coordinator: CoordinatorIdentity | null
): Promise<ContinuationCheckinInput> {
  if (!coordinator) {
    throw new ContinuationCheckinError(
      "unsupported",
      "No 037 coordinator run is active in the studio, so there is no run owner or current direction to check this campaign in against. Nothing was changed."
    );
  }
  const store = library.campaignContinuations;
  const inspection = await store.inspectContinuation(input.bookId, input.campaignId);
  const reports = await store.resolveContinuationReports(input.bookId, input.campaignId);
  const group = await store.inspectContinuationGroup(input.bookId, input.campaignId);
  const fixedHistory = await store.inspectContinuationFixedHistory(input.bookId, input.campaignId);
  // A partial group never maps, whichever inspection carries the split.
  const inspectedGroup = fixedHistory.state === "partial" ? fixedHistory : group;
  const result = mapCampaignContinuationCheckin({
    inspection,
    reports,
    group: inspectedGroup,
    coordinatorOwner: coordinator.owner,
    direction: coordinator.direction,
    ...(input.expected ? { expected: input.expected } : {})
  });
  if (result.status === "refused") throw refusal(result.code);
  return result.checkin;
}
