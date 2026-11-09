import type { ReadContinuationCheckinInput } from "@ai-book-studio/core/ipc";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";

/** A truthful check-in refusal: the host code plus its author-readable message. */
export class ContinuationCheckinRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ContinuationCheckinRefusal";
    this.code = code;
  }
}

/**
 * The counted check-in inputs for one checked continuation campaign, read
 * through the host's 037 coordinator seam. Hosts without the seam refuse
 * plainly instead of returning empty data. Refusals keep their typed code
 * so the presenter can show the state that actually happened.
 */
export async function readContinuationCheckin(input: ReadContinuationCheckinInput): Promise<ContinuationCheckinInput> {
  const continuation = window.studio.continuation;
  if (!continuation) {
    throw new ContinuationCheckinRefusal(
      "unsupported",
      "Continuation check-in is available in the desktop app. This build has no coordinator seam."
    );
  }
  const result = await continuation.checkin(input);
  if (!result.ok) throw new ContinuationCheckinRefusal(result.error.code, result.error.message);
  return result.data;
}
