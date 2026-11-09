import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";
import { must } from "./utils";

/**
 * The counted check-in inputs for one checked continuation campaign, read
 * through the host's 037 coordinator seam. Presentational mounting is a
 * later slice; this is only the typed client access. Hosts without the
 * seam refuse plainly instead of returning empty data.
 */
export function readContinuationCheckin(input: ReadContinuationCheckinInput): Promise<ContinuationCheckinInput> {
  const continuation = window.studio.continuation;
  if (!continuation) {
    return Promise.reject(
      new Error("Continuation check-in is available in the desktop app. This build has no coordinator seam.")
    );
  }
  return must(continuation.checkin(input));
}
