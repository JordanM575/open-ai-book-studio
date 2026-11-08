import type { ReviewCoverageAnalysis, ReviewSourceSnapshot, ReviewWorkResult } from "@ai-book-studio/core/review";
import type { ReviewWorkerReply, ReviewWorkerRequest } from "./review-worker-protocol";
import { asReviewAnalysis, validReviewAnalysis } from "./review-worker-validation";

export type ReviewWorker = Pick<Worker, "addEventListener" | "removeEventListener" | "terminate"> & {
  postMessage: (message: ReviewWorkerRequest) => void;
};

const WORKER_FAILURE = "The local review worker could not complete the review. Try running it again. Your saved manuscript was not changed.";

/** Vite requires a literal URL directly inside the constructor to bundle the same-origin worker. */
function createReviewWorker(): ReviewWorker {
  return new Worker(new URL("./review-analysis.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Interactive analysis must run off-thread: even a short valid token can spend seconds in native
 * Unicode normalization. No heavy main-thread fallback. Own one worker until completion, failure
 * or abort; detach listeners and terminate it on every terminal path, ignoring already queued replies.
 */
export function analyzeReviewInWorker(
  source: ReviewSourceSnapshot,
  signal: AbortSignal,
  options: { createWorker?: () => ReviewWorker; startupTimeoutMs?: number } = {}
): Promise<ReviewWorkResult<ReviewCoverageAnalysis>> {
  return new Promise((resolve) => {
    let worker: ReviewWorker | undefined;
    let settled = false;
    let started = false;
    let validating = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ReviewWorkResult<ReviewCoverageAnalysis>) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      signal.removeEventListener("abort", onAbort);
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
        worker.terminate();
      }
      resolve(result);
    };
    const onAbort = () => finish({ status: "cancelled", scope: source.scope, requestedAt: source.capturedAt });
    const fail = () => finish({ status: "failed", scope: source.scope, requestedAt: source.capturedAt, message: WORKER_FAILURE });
    const onError = (event: Event) => { event.preventDefault(); fail(); };
    const onMessage = (event: MessageEvent<ReviewWorkerReply>) => {
      if (settled) return;
      if (signal.aborted) { onAbort(); return; }
      const reply = event.data;
      if (reply?.kind === "ready" && !started) {
        started = true;
        clearTimeout(startupTimer);
        try { worker?.postMessage({ kind: "analyze", source }); } catch { fail(); }
      } else if (reply?.kind === "complete" && started && !validating) {
        validating = true;
        // Traverse required metadata in bounded slices, never the potentially huge evidence arrays.
        void validReviewAnalysis(reply.analysis, source, signal).then((valid) => {
          if (settled) return;
          if (signal.aborted) onAbort();
          else if (valid) finish({ status: "complete", value: asReviewAnalysis(reply.analysis) });
          else fail();
        }).catch(fail);
      } else {
        fail();
      }
    };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      worker = (options.createWorker ?? createReviewWorker)();
      // Also cover an abort triggered while a host/test factory was starting the worker.
      if (settled) { worker.terminate(); return; }
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
      // Missing/blocked scripts must not leave the UI claiming to analyze indefinitely. This only
      // limits startup, not valid text, findings, occurrences or the time allowed for analysis.
      startupTimer = setTimeout(fail, options.startupTimeoutMs ?? 10_000);
    } catch {
      fail();
    }
  });
}
