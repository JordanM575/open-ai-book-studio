import {
  mapCampaignContinuationCheckin,
  type ContinuationCheckinInput
} from "@ai-book-studio/core/review/campaign-continuation-checkin";
import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import { countWords } from "@ai-book-studio/core/words";
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
 * returned verbatim; no task role is derived.
 *
 * Cadence supply (caller-counted, host-owned): when the campaign maps, this
 * host would count the authoring cadence progress from checked state it
 * already loads for this request, but adoption is not countable from
 * recorded state in this build. No adoption receipts or provenance are
 * recorded that distinguish a coordinator-adopted chapter from any other
 * saved chapter, so chapters present cannot be named adopted chapters.
 * Cadence is therefore withheld (no `cadence` key) in all cases until
 * adoption is countable from recorded receipts/provenance. Saved words are
 * counted only with the canonical `countWords` over chapter bodies loaded
 * through the existing `Library.readBook` reader; that counting is the
 * honest subset that resumes when adoption becomes countable, but it is
 * not emitted today. The supply remains scoped to the pre-checkpoint
 * window: while the mapped campaign has no checkpoint record, totals
 * would be exactly the since-check-in counters; once a checkpoint record
 * exists, or any chapter cannot be read, the since window is ambiguous
 * and cadence is withheld (the counted check-in inputs still succeed
 * without a cadence section). Withheld cadence (no `cadence` key) is
 * therefore distinguishable from an evaluated cadence with `due: false`.
 * When adoption becomes countable, supply must not resume on adoption
 * receipts alone: `irreversibleChoicePending` must also be read from
 * recorded question state or supply stays withheld (see
 * `recordedIrreversibleChoicePending`).
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
 * Whether recorded state holds a pending irreversible choice. The 037
 * question store primitive exists (`WorkflowRecordStore.readQuestion` /
 * `saveQuestion` over `questions/<questionId>.json`, validated by
 * `validateQuestion`), but in this build there is no durable question
 * inbox, no irreversible classification on the question record, and no
 * host-readable pending-irreversible source: the record carries `keys`,
 * `affected`, `characterId`, `evidence`, `options`, `state` and `answer`
 * with no irreversible marker, the store offers no listing API, the
 * desktop `Library` face does not expose workflow records, and no
 * production path creates question records. The campaign checkpoint
 * carries stage receipts only and book/chapter records carry no such
 * field, so no recorded source can carry a pending irreversible choice
 * as such that the host could read. The honest report of that recorded
 * absence is `false`; it fabricates no positive trigger. When adoption
 * becomes countable, this must be read from recorded question state or
 * cadence supply stays withheld — supply must not resume on adoption
 * receipts alone.
 */
function recordedIrreversibleChoicePending(): boolean {
  return false;
}

/**
 * Count cadence progress honestly from checked Library state, or return
 * `null` when any input cannot be counted truthfully for this request.
 * Read-only; prose is counted only from bodies the existing `readBook`
 * reader already loads, with the canonical `countWords`.
 *
 * Adoption is not countable from recorded state in this build: no
 * adoption receipts or provenance are recorded that distinguish a
 * coordinator-adopted chapter from any other saved chapter, so cadence
 * is withheld (return `null`, hence no `cadence` key) in all cases until
 * adoption is countable from recorded receipts/provenance. Do not
 * substitute chapters present for adopted chapters, and do not substitute
 * `0` — zero recorded adoptions is also unverified without reading
 * publication/effect receipts. The saved-word counting below is the
 * honest subset that resumes when adoption becomes countable, but it
 * must not emit a cadence section today. When adoption becomes
 * countable, supply must not resume on adoption receipts alone:
 * `irreversibleChoicePending` must also be read from recorded question
 * state (see `recordedIrreversibleChoicePending`) or supply stays
 * withheld.
 */
async function countCadenceProgress(
  library: Library,
  bookId: string,
  checkin: ContinuationCheckinInput
): Promise<{
  adoptedChaptersSinceCheckin: number;
  savedWordsSinceCheckin: number;
  firstAdoptedChapterOccurred: boolean;
  irreversibleChoicePending: boolean;
} | null> {
  // A checkpoint record means a since window may already have closed:
  // without stored check-in state the totals can no longer be named
  // since-check-in counters, so cadence is withheld rather than guessed.
  if (checkin.checkpoint !== null) return null;
  const detail = await library.readBook(bookId).catch(() => null);
  if (!detail) return null;
  // An unreadable chapter makes the saved-word total incomplete.
  if (detail.chapterReadIssues.length > 0) return null;
  let savedWords = 0;
  for (const chapter of detail.chapters) {
    savedWords += countWords(chapter.content);
    if (!Number.isSafeInteger(savedWords)) return null;
  }
  // Adoption is not countable from recorded adoption receipts/provenance
  // in this build, so the counted saved-word total cannot be combined
  // into a truthful cadence progress. Withhold cadence in all cases
  // until adoption is countable; the savedWords total above is retained
  // as the honest subset that resumes then, but it is not emitted today.
  // Resuming also requires reading irreversibleChoicePending from
  // recorded question state, not the current constant, or supply stays
  // withheld.
  void savedWords;
  void recordedIrreversibleChoicePending();
  return null;
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
  const mapped = mapCampaignContinuationCheckin({
    inspection,
    reports,
    group: inspectedGroup,
    coordinatorOwner: coordinator.owner,
    direction: coordinator.direction,
    ...(input.expected ? { expected: input.expected } : {})
  });
  if (mapped.status === "refused") throw refusal(mapped.code);
  const progress = await countCadenceProgress(library, input.bookId, mapped.checkin);
  if (!progress) return mapped.checkin;
  const withCadence = mapCampaignContinuationCheckin({
    inspection,
    reports,
    group: inspectedGroup,
    coordinatorOwner: coordinator.owner,
    direction: coordinator.direction,
    ...(input.expected ? { expected: input.expected } : {}),
    cadence: {
      ...(input.cadence?.policy ? { policy: input.cadence.policy } : {}),
      callerCountedProgress: progress
    }
  });
  if (withCadence.status === "refused") throw refusal(withCadence.code);
  return withCadence.checkin;
}
