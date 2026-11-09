import type { ReviewCoverageAnalysis, ReviewSourceSnapshot, ReviewWorkResult } from "@ai-book-studio/core/review";
import type { RepetitionEvidenceCheck } from "@ai-book-studio/core/review/repetition";
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
export async function analyzeReviewInWorker(
  source: ReviewSourceSnapshot,
  signal: AbortSignal,
  options: ReviewWorkerOptions = {}
): Promise<ReviewWorkResult<ReviewCoverageAnalysis>> {
  const result = await runReviewWorker({ kind: "analyze", source }, signal, async (reply) =>
    reply?.kind === "complete" && await validReviewAnalysis(reply.analysis, source, signal)
      ? asReviewAnalysis(reply.analysis) : undefined, options);
  return result.status === "complete" ? result : { ...result, scope: source.scope, requestedAt: source.capturedAt };
}

/** Verify only the selected claim off-thread; it grants no source freshness or editor authority. */
export function verifyRepetitionInWorker(evidence: RepetitionEvidenceCheck, signal: AbortSignal, options: ReviewWorkerOptions = {}): Promise<WorkerOutcome<boolean>> {
  return runReviewWorker({ kind: "verify-evidence", evidence }, signal, async (reply) =>
    reply?.kind === "verified-evidence" && typeof reply.matches === "boolean" ? reply.matches : undefined, options);
}

type ReviewWorkerOptions = { createWorker?: () => ReviewWorker; startupTimeoutMs?: number };
type WorkerOutcome<T> = { status: "complete"; value: T } | { status: "cancelled" } | { status: "failed"; message: string };

function runReviewWorker<T>(
  request: ReviewWorkerRequest,
  signal: AbortSignal,
  parseReply: (reply: ReviewWorkerReply) => Promise<T | undefined>,
  options: ReviewWorkerOptions
): Promise<WorkerOutcome<T>> {
  return new Promise((resolve) => {
    let worker: ReviewWorker | undefined;
    let settled = false;
    let started = false;
    let validating = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: WorkerOutcome<T>) => {
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
    const onAbort = () => finish({ status: "cancelled" });
    const fail = () => finish({ status: "failed", message: WORKER_FAILURE });
    const onError = (event: Event) => { event.preventDefault(); fail(); };
    const onMessage = (event: MessageEvent<ReviewWorkerReply>) => {
      if (settled) return;
      if (signal.aborted) { onAbort(); return; }
      const reply = event.data;
      if (reply?.kind === "ready" && !started) {
        started = true;
        clearTimeout(startupTimer);
        try { worker?.postMessage(request); } catch { fail(); }
      } else if (started && !validating) {
        validating = true;
        // Traverse required metadata in bounded slices, never the potentially huge evidence arrays.
        void parseReply(reply).then((value) => {
          if (settled) return;
          if (signal.aborted) onAbort();
          else if (value !== undefined) finish({ status: "complete", value });
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
