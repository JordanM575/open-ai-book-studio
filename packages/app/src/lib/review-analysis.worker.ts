import { analyzeReviewCoverage } from "@ai-book-studio/core/review";
import { matchesRepetitionEvidence } from "@ai-book-studio/core/review/repetition";
import type { ReviewWorkerReply, ReviewWorkerRequest } from "./review-worker-protocol";

// Keep worker globals local rather than adding WebWorker's conflicting DOM declarations to the app.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ReviewWorkerRequest>) => void) | null;
  postMessage: (message: ReviewWorkerReply) => void;
};

scope.onmessage = (event) => {
  // A worker accepts exactly one job. Cancellation is terminate(), never a queued message
  // behind potentially expensive native NFC. The host also terminates on completion/failure.
  scope.onmessage = null;
  try {
    if (event.data.kind === "analyze") {
      scope.postMessage({ kind: "complete", analysis: analyzeReviewCoverage(event.data.source) });
    } else if (event.data.kind === "verify-evidence") {
      scope.postMessage({ kind: "verified-evidence", matches: matchesRepetitionEvidence(event.data.evidence) });
    } else throw new Error("Unexpected review request");
  } catch {
    // Never send exceptions or source text to error UI/logs.
    scope.postMessage({ kind: "failed" });
  }
};
scope.postMessage({ kind: "ready" });
