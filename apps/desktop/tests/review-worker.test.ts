/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { analyzeReviewCoverage, type ReviewSourceSnapshot } from "@ai-book-studio/core/review";
import { analyzeReviewInWorker } from "@ai-book-studio/app/lib/review-worker";
import type { ReviewWorkerReply, ReviewWorkerRequest } from "@ai-book-studio/app/lib/review-worker-protocol";

const NOW = "2026-11-08T12:00:00.000Z";
function snapshot(bodies: string[]): ReviewSourceSnapshot {
  return {
    scope: { kind: "book", bookId: "book_worker_fixture" }, capturedAt: NOW,
    chapters: bodies.map((body, index) => ({
      status: "saved", chapterId: `ch_worker${index}`, title: `Fixture ${index}`, order: index + 1,
      body, version: index + 2, hash: String(index).repeat(64)
    }))
  };
}

/** A protocol double for deterministic failure/late-delivery races, never performance evidence. */
class ControlledWorker extends EventTarget {
  terminate = mock(() => {});
  postMessage = mock((_message: ReviewWorkerRequest) => {});
  message(reply: ReviewWorkerReply) { this.dispatchEvent(new MessageEvent("message", { data: reply })); }
}

describe("owned review worker lifecycle", () => {
  test("pre-abort starts no worker; abort during startup terminates and removes listeners", async () => {
    const source = snapshot(["one two three"]);
    const before = new AbortController();
    before.abort();
    const factory = mock(() => new ControlledWorker());
    expect((await analyzeReviewInWorker(source, before.signal, { createWorker: factory })).status).toBe("cancelled");
    expect(factory).not.toHaveBeenCalled();

    const worker = new ControlledWorker();
    const remove = mock(worker.removeEventListener.bind(worker));
    worker.removeEventListener = remove;
    const controller = new AbortController();
    const result = analyzeReviewInWorker(source, controller.signal, { createWorker: () => worker });
    controller.abort();
    expect(await result).toEqual({ status: "cancelled", scope: source.scope, requestedAt: NOW });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(3);
    worker.message({ kind: "ready" });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  test("an aborted worker's queued output cannot settle a fresh run", async () => {
    const source = snapshot(["one two three one two three"]);
    const old = new ControlledWorker();
    let queued: EventListenerOrEventListenerObject | null = null;
    const add = old.addEventListener.bind(old);
    old.addEventListener = (type, listener, options) => {
      if (type === "message") queued = listener;
      add(type, listener, options);
    };
    const controller = new AbortController();
    const first = analyzeReviewInWorker(source, controller.signal, { createWorker: () => old });
    old.message({ kind: "ready" });
    expect(old.postMessage).toHaveBeenCalledWith({ kind: "analyze", source });
    controller.abort();
    expect((await first).status).toBe("cancelled");

    const freshSource = snapshot(["fresh saved words fresh saved words"]);
    const fresh = new ControlledWorker();
    let completed = false;
    const second = analyzeReviewInWorker(freshSource, new AbortController().signal, { createWorker: () => fresh });
    void second.then(() => { completed = true; });
    fresh.message({ kind: "ready" });
    const staleEvent = new MessageEvent("message", { data: { kind: "complete", analysis: analyzeReviewCoverage(source) } });
    // Call the removed listener itself to model a host that already queued the callback.
    const deliver = queued as EventListenerOrEventListenerObject | null;
    if (typeof deliver === "function") deliver(staleEvent);
    else deliver?.handleEvent(staleEvent);
    await Promise.resolve();
    expect(completed).toBe(false);
    fresh.message({ kind: "complete", analysis: analyzeReviewCoverage(freshSource) });
    expect(await second).toEqual({ status: "complete", value: analyzeReviewCoverage(freshSource) });
    expect(old.terminate).toHaveBeenCalledTimes(1);
    expect(fresh.terminate).toHaveBeenCalledTimes(1);
  });

  test("unavailable, blocked, crashed, undecodable and silent workers fail without inline analysis", async () => {
    // A getter would fail if the adapter tried to analyze/copy this body itself on fallback.
    const source = snapshot(["one two three"]);
    const forbidden = mock(() => { throw new Error("Must not run inline"); });
    Object.defineProperty(source.chapters[0], "body", { get: forbidden });
    const absent = await analyzeReviewInWorker(source, new AbortController().signal, {
      createWorker: () => { throw new Error("private raw startup failure"); }
    });
    expect(absent.status).toBe("failed");
    expect(JSON.stringify(absent)).not.toContain("private raw");
    for (const failure of ["error", "messageerror", "failed", "send", "silent"] as const) {
      const worker = new ControlledWorker();
      const result = analyzeReviewInWorker(source, new AbortController().signal, {
        createWorker: () => worker, startupTimeoutMs: 10
      });
      if (failure === "send") {
        worker.postMessage = mock(() => { throw new Error("private clone failure"); });
        worker.message({ kind: "ready" });
      } else if (failure === "failed") {
        worker.message({ kind: "ready" });
        worker.message({ kind: "failed" });
      } else if (failure !== "silent") worker.dispatchEvent(new Event(failure));
      const outcome = await result;
      expect(outcome.status).toBe("failed");
      expect(outcome).not.toHaveProperty("value");
      expect(JSON.stringify(outcome)).not.toContain("private");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    }
    expect(forbidden).not.toHaveBeenCalled();
    expect((await analyzeReviewInWorker(snapshot(["a b c a b c"]), new AbortController().signal)).status).toBe("complete");
  });

  test("invalid completion envelopes, coverage and finding metadata fail closed", async () => {
    const source = snapshot(["one two three one two three"]);
    const analysis = analyzeReviewCoverage(source);
    const bad: unknown[] = [
      undefined, {}, { ...analysis, status: "unknown" },
      { ...analysis, coverage: null },
      { ...analysis, coverage: { ...analysis.coverage, inScope: 2 } },
      { ...analysis, coverage: { ...analysis.coverage, included: 0 } },
      { ...analysis, wordCounts: { ...analysis.wordCounts, totalWordCount: -1 } },
      { ...analysis, wordCounts: { ...analysis.wordCounts, chapters: [] } },
      { ...analysis, findings: [{ ...analysis.findings[0], id: "invented" }] },
      { ...analysis, findings: [{ ...analysis.findings[0], metricId: "invented" }] },
      { ...analysis, findings: [{ ...analysis.findings[0], evidence: null }] },
      { ...analysis, findings: Array(1) }
    ];
    for (const value of bad) {
      const worker = new ControlledWorker();
      const result = analyzeReviewInWorker(source, new AbortController().signal, { createWorker: () => worker });
      worker.message({ kind: "ready" });
      worker.message({ kind: "complete", analysis: value } as ReviewWorkerReply);
      expect((await result).status).toBe("failed");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    }
  });

  test("metadata validation does not scan evidence and remains cancellable between slices", async () => {
    const source = snapshot(Array.from({ length: 600 }, () => "one two three one two three"));
    const analysis = analyzeReviewCoverage(source);
    const finding = analysis.findings[0];
    if (!finding) throw new Error("Expected a repetition fixture");
    const originalEvidence = finding.evidence;
    const guarded = new Proxy(originalEvidence, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/u.test(key)) throw new Error("Evidence scanned on host");
        return Reflect.get(target, key, receiver);
      }
    });
    const worker = new ControlledWorker();
    const result = analyzeReviewInWorker(source, new AbortController().signal, { createWorker: () => worker });
    worker.message({ kind: "ready" });
    worker.message({ kind: "complete", analysis: { ...analysis, findings: [{ ...finding, evidence: guarded }] } });
    expect((await result).status).toBe("complete");
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const cancelledWorker = new ControlledWorker();
    const controller = new AbortController();
    const cancelled = analyzeReviewInWorker(source, controller.signal, { createWorker: () => cancelledWorker });
    let settled = false;
    void cancelled.then(() => { settled = true; });
    cancelledWorker.message({ kind: "ready" });
    cancelledWorker.message({ kind: "complete", analysis });
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort();
    expect((await cancelled).status).toBe("cancelled");
    expect(cancelledWorker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("real in-process Bun workers (not browser/Electron evidence)", () => {
  test("main-loop heartbeat and cancellation reach non-cooperative native NFC, then a fresh run completes", async () => {
    const source = snapshot([`a${"\u0315".repeat(65_536)}${"\u0300".repeat(65_536)} two three`]);
    const controller = new AbortController();
    let entered = false;
    let nativeFinished = false;
    let ticks = 0;
    let lastTick = performance.now();
    let maxGap = 0;
    let abortAt = 0;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
      if (entered) ticks++;
    }, 5);
    let worker: Worker | undefined;
    let terminations = 0;
    const start = performance.now();
    try {
      const result = await analyzeReviewInWorker(source, controller.signal, { createWorker: () => {
        worker = new Worker(new URL("./support/review-normalization.worker.ts", import.meta.url), { type: "module" });
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => { terminations++; terminate(); };
        worker.addEventListener("message", (event: MessageEvent<{ kind: string; units: number }>) => {
          if (!event.data.kind.startsWith("test-native-")) return;
          // Instrumentation is private to this test; the adapter sees the unmodified production protocol.
          event.stopImmediatePropagation();
          if (event.data.kind === "test-native-enter" && event.data.units === 131_073) {
            entered = true;
            cancelTimer = setTimeout(() => { abortAt = performance.now(); controller.abort(); }, 100);
          } else if (event.data.kind === "test-native-exit") nativeFinished = true;
        });
        return worker;
      } });
      const settledAt = performance.now();
      clearInterval(heartbeat);
      maxGap = Math.max(maxGap, settledAt - lastTick);
      expect(entered).toBe(true);
      expect(nativeFinished).toBe(false);
      expect(ticks).toBeGreaterThanOrEqual(3);
      expect(result.status).toBe("cancelled");
      expect(result).not.toHaveProperty("value");
      expect(terminations).toBe(1);
      expect(abortAt).toBeGreaterThan(0);
      expect(settledAt - abortAt).toBeLessThan(500);
      expect(maxGap).toBeLessThan(500);
      const fresh = await analyzeReviewInWorker(snapshot(["fresh saved words fresh saved words"]), new AbortController().signal);
      expect(fresh.status).toBe("complete");
      if (fresh.status !== "complete") throw new Error("Fresh worker failed");
      expect(fresh.value.findings[0]?.label).toBe("fresh saved words");
      expect(fresh.value.findings[0]?.evidence).toHaveLength(2);
      console.info("review-worker adversarial cancellation", {
        units: 131_083, ticksDuringNative: ticks, maxMainGapMs: maxGap,
        abortToResultMs: settledAt - abortAt, elapsedMs: settledAt - start
      });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(cancelTimer);
      controller.abort();
      worker?.terminate();
    }
  }, 10_000);

  test("smaller descending-class tokens complete with exact native keys, every count and original UTF-16 span", async () => {
    const token = `A${"\u0315".repeat(2_048)}${"\u0300".repeat(2_048)}`;
    const phrase = `${token} TWO L’ÉTÉ`;
    const equivalent = `${token.normalize("NFC")} two l'e\u0301te\u0301`;
    const bodies = [`😀 ${phrase}. ${equivalent}!`, `${phrase}?`];
    const source = snapshot(bodies);
    const before = JSON.stringify(source);
    const result = await analyzeReviewInWorker(source, new AbortController().signal);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Adversarial completion failed");
    expect(result.value.status).toBe("complete");
    expect(result.value.coverage).toMatchObject({ inScope: 2, included: 2, empty: 0, skipped: 0 });
    expect(result.value.wordCounts.totalWordCount).toBe(10); // emoji is also a studio whitespace token
    expect(result.value.findings).toHaveLength(1);
    const finding = result.value.findings[0];
    expect(finding?.label).toBe(`${token.normalize("NFC").toLowerCase()} two l'été`);
    expect(finding?.evidence).toEqual([
      { chapterId: "ch_worker0", title: "Fixture 0", order: 1, sourceVersion: 2, sourceHash: "0".repeat(64), startOffset: 3, endOffset: 3 + phrase.length, excerpt: phrase },
      { chapterId: "ch_worker0", title: "Fixture 0", order: 1, sourceVersion: 2, sourceHash: "0".repeat(64), startOffset: 5 + phrase.length, endOffset: 5 + phrase.length + equivalent.length, excerpt: equivalent },
      { chapterId: "ch_worker1", title: "Fixture 1", order: 2, sourceVersion: 3, sourceHash: "1".repeat(64), startOffset: 0, endOffset: phrase.length, excerpt: phrase }
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });

  test("120 chapters / 250k words retain every overlap through the worker transport", async () => {
    const bodies = Array.from({ length: 120 }, (_, index) => Array(index < 40 ? 2084 : 2083).fill("word").join(" "));
    const source = snapshot(bodies);
    const start = performance.now();
    const result = await analyzeReviewInWorker(source, new AbortController().signal);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Large worker scan failed");
    expect(result.value.coverage).toMatchObject({ included: 120, skipped: 0 });
    expect(result.value.wordCounts.totalWordCount).toBe(250_000);
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.findings[0]?.evidence).toHaveLength(249_760);
    const last = result.value.findings[0]?.evidence.at(-1);
    expect(last?.chapterId).toBe("ch_worker119");
    expect(last?.endOffset).toBe(bodies[119]?.length);
    console.info("review-worker 250k transport", { elapsedMs: performance.now() - start, occurrences: 249_760 });
  }, 10_000);
});
