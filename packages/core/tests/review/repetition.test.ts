import { describe, expect, spyOn, test } from "bun:test";
import { analyzeReviewCoverage, analyzeReviewCoverageAsync, buildReviewReport, countReviewWords,
  revalidateReviewEvidence, type ReviewSourceSnapshot } from "../../src/review";
import { matchesRepetitionEvidence, scanRepetition, scanRepetitionSteps } from "../../src/review/repetition";

const NOW = "2026-11-08T12:00:00.000Z";
function snapshot(...bodies: string[]): ReviewSourceSnapshot {
  return {
    scope: { kind: "book", bookId: "synthetic-repetition" }, capturedAt: NOW,
    chapters: bodies.map((body, index) => ({ status: "saved", chapterId: `chapter-${index}`, title: `Chapter ${index + 1}`,
      order: index + 1, body, version: 1, hash: "a".repeat(64) }))
  };
}
function report(source: ReviewSourceSnapshot) {
  return buildReviewReport(source, analyzeReviewCoverage(source), { requestedAt: NOW, completedAt: NOW });
}

describe("repetition-v1 exact-source scanner", () => {
  test("selected claims must match the normalized label and complete Unicode/apostrophe tokens", () => {
    const phrase = "Agate, BIRCH—cloud";
    const label = "agate birch cloud";
    for (const prefix of ["x", "𐐀", "१२", "\u0301", "x'", "𐐀’"]) {
      const body = `${prefix}${phrase}`;
      expect(matchesRepetitionEvidence({ body, label, startOffset: prefix.length, endOffset: body.length })).toBe(false);
    }
    for (const suffix of ["x", "𐐀", "१२", "\u0301", "'x", "’𐐀"]) {
      const body = `${phrase}${suffix}`;
      expect(matchesRepetitionEvidence({ body, label, startOffset: 0, endOffset: phrase.length })).toBe(false);
    }
    for (const [prefix, suffix] of [["😀 '", "’!"], ["x''", "''x"], [".\n", "?\n"]] as const) {
      const body = `${prefix}${phrase}${suffix}`;
      expect(matchesRepetitionEvidence({ body, label, startOffset: prefix.length, endOffset: prefix.length + phrase.length })).toBe(true);
    }
    expect(matchesRepetitionEvidence({ body: phrase, label: "silver fir pine", startOffset: 0, endOffset: phrase.length })).toBe(false);
    expect(matchesRepetitionEvidence({ body: "birch cloud agate", label, startOffset: 0, endOffset: "birch cloud agate".length })).toBe(false);
    for (const body of [`\ud800${phrase}`, `${phrase}\udc00`]) {
      const startOffset = body.indexOf(phrase);
      expect(matchesRepetitionEvidence({ body, label, startOffset, endOffset: startOffset + phrase.length })).toBe(false);
    }
  });

  test("selected-window checks agree with an independent regex oracle for every UTF-16 endpoint", () => {
    for (const body of ["xagate birch cloud agate birch cloud", "😀 CAFÉ, L’ÉTÉ 42!", "'𐐀' १२ a\u0308;",
      "can''t go now can't go now", "x’𐐀 १२ a\u0308", "İ I ı. i\u0307 i ı", "one two three four", "  one two "]) {
      const tokens = [...body.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu)];
      const expected = new Map<string, string>();
      for (let index = 0; index + 2 < tokens.length; index++) {
        const first = tokens[index];
        const last = tokens[index + 2];
        if (!first || !last) throw new Error("Fixture needs a three-token window");
        expected.set(`${first.index}:${last.index + last[0].length}`,
          tokens.slice(index, index + 3).map((token) => token[0].normalize("NFC").toLowerCase().replaceAll("’", "'")).join(" "));
      }
      const labels = [...new Set(expected.values()), "one two three"];
      for (let startOffset = 0; startOffset < body.length; startOffset++) {
        for (let endOffset = startOffset + 1; endOffset <= body.length; endOffset++) {
          for (const label of labels) {
            expect(matchesRepetitionEvidence({ body, label, startOffset, endOffset })).toBe(expected.get(`${startOffset}:${endOffset}`) === label);
          }
        }
      }
    }
  });

  test("folds NFC, case and apostrophes without changing literal UTF-16 spans", () => {
    const text = "😀 CAFÉ, L’ÉTÉ 42. Cafe\u0301—l'e\u0301te\u0301;42!";
    const result = scanRepetition(snapshot(text));
    expect(result.rejectedChapterIds).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    if (!finding) throw new Error("Expected a real repeated phrase");
    expect(finding.label).toBe("café l'été 42");
    expect(finding.evidence.map(({ startOffset, endOffset, excerpt }) => ({ startOffset, endOffset, excerpt }))).toEqual([
      { startOffset: 3, endOffset: 17, excerpt: "CAFÉ, L’ÉTÉ 42" },
      { startOffset: 19, endOffset: text.length - 1, excerpt: "Cafe\u0301—l'e\u0301te\u0301;42" }
    ]);
    for (const span of finding.evidence) expect(text.slice(span.startOffset, span.endOffset)).toBe(span.excerpt);
  });

  test("counts every overlapping window, crosses sentence punctuation but never chapter boundaries", () => {
    const result = scanRepetition(snapshot("a a. a! a? a"));
    expect(result.findings.map((finding) => [finding.label, finding.evidence.length])).toEqual([["a a a", 3]]);
    expect(result.findings[0]?.evidence.map((span) => [span.startOffset, span.endOffset])).toEqual([[0, 6], [2, 9], [5, 12]]);
    expect(scanRepetition(snapshot("one two", "three one two three")).findings).toEqual([]);
    expect(scanRepetition(snapshot("One two three", "one TWO three")).findings[0]?.evidence.map((span) => span.chapterId))
      .toEqual(["chapter-0", "chapter-1"]);
  });

  test("retains Unicode numbers, marks and astral letters; apostrophes must be internal", () => {
    const source = snapshot("'𐐀' १२ a\u0308; ’𐐨’ १२ ä");
    expect(scanRepetition(source).findings[0]?.label).toBe("𐐨 १२ ä");
    expect(scanRepetition(source).findings[0]?.evidence[0]?.excerpt).toBe("𐐀' १२ a\u0308");
    expect(scanRepetition(snapshot("can't go now", "can’t go now")).findings[0]?.evidence).toHaveLength(2);
    expect(scanRepetition(snapshot("can''t go now", "can't go now")).findings).toEqual([]);
    expect(scanRepetition(snapshot("İ I ı. i\u0307 i ı")).findings[0]?.label).toBe("i\u0307 i ı");
  });

  test("has stable first-occurrence order and does not stem or discard common words", () => {
    const source = snapshot("the and of. THE AND OF. walk walks walking. walk walks walking");
    const first = scanRepetition(source);
    expect(first).toEqual(scanRepetition(source));
    expect(first.findings.map((finding) => finding.label)).toEqual(["the and of", "walk walks walking"]);
    expect(first.findings.map((finding) => finding.id)).toEqual(["repetition-v1-1", "repetition-v1-2"]);
  });

  test("rejects malformed chapters entirely, reports skips and preserves independent findings/counts", async () => {
    for (const malformed of ["\ud800", "\udc00", "ok ok ok ok\ud800", "\ud800x\udc00"]) {
      const source = snapshot(malformed, "good text stays. Good text stays", " \n\t");
      const analysis = analyzeReviewCoverage(source);
      expect(analysis.status).toBe("partial");
      expect(analysis.coverage).toMatchObject({ inScope: 3, included: 1, skipped: 1, empty: 1 });
      expect(analysis.coverage.chapters[0]).toMatchObject({ status: "skipped", reason: expect.stringContaining("malformed Unicode") });
      expect(analysis.wordCounts.totalWordCount).toBe(6);
      expect(analysis.findings[0]?.evidence.map((span) => span.chapterId)).toEqual(["chapter-1", "chapter-1"]);
      expect(await analyzeReviewCoverageAsync(source, new AbortController().signal)).toEqual({ status: "complete", value: analysis });
    }
    expect(analyzeReviewCoverage(snapshot("\ud800")).status).toBe("failed");
    expect(analyzeReviewCoverage(snapshot("\ud800", " ")).status).toBe("insufficient-evidence");
  });

  test("real reports navigate exact occurrences and reject stale or unverifiable spans", () => {
    const source = snapshot("😀 Blue—water waits. BLUE water waits.");
    const result = report(source);
    expect(result.metricDefinitions[1]?.id).toBe("repetition-v1");
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    if (!finding) throw new Error("Expected a real repeated phrase");
    const secondEvidence = finding.evidence[1];
    if (!secondEvidence) throw new Error("Expected the second occurrence");
    expect(revalidateReviewEvidence(result, source, finding.id, 1)).toEqual({ status: "ready", evidence: secondEvidence });
    const changed = { ...source, chapters: source.chapters.map((chapter) => ({ ...chapter, version: 2, hash: "b".repeat(64) })) };
    expect(revalidateReviewEvidence(result, changed, finding.id, 1).status).toBe("stale");
    const wrongBody = snapshot("unrelated saved text with same synthetic token");
    expect(revalidateReviewEvidence(result, wrongBody, finding.id, 1).status).toBe("unavailable");
    expect(revalidateReviewEvidence(result, source, finding.id, -1).status).toBe("unavailable");
    expect(revalidateReviewEvidence(result, source, finding.id, 1.5).status).toBe("unavailable");
  });

  test("sliced word counts retain the shared contract across long tokens and Unicode whitespace", async () => {
    const source = snapshot("x".repeat(300_000), `${"x ".repeat(32_767)}a\u00a0b\ufeffc`, "one — two", "😀".repeat(40_000));
    const outcome = await analyzeReviewCoverageAsync(source, new AbortController().signal);
    if (outcome.status !== "complete") throw new Error("Expected complete analysis");
    expect(outcome.value.wordCounts).toEqual(countReviewWords(source));
  });

  test("yields inside giant tokens, punctuation and grouping; abort discards all output", async () => {
    for (const body of ["a".repeat(500_000), ".".repeat(500_000), "one two three ".repeat(50_000)]) {
      const source = snapshot(body);
      const steps = scanRepetitionSteps(source);
      expect(steps.next().done).toBe(false);
      const controller = new AbortController();
      let timerRan = false;
      const cancellation = setTimeout(() => { timerRan = true; controller.abort(); }, 0);
      const result = await analyzeReviewCoverageAsync(source, controller.signal);
      clearTimeout(cancellation);
      expect(timerRan).toBe(true);
      expect(result.status).toBe("cancelled");
      expect(result).not.toHaveProperty("value");
    }
    // Entire input validation and token scan fit inside one budget: this yield is final grouping.
    const grouping = snapshot(Array.from({ length: 500 }, (_, index) => `w${index}`).join(" "));
    expect(scanRepetitionSteps(grouping).next().done).toBe(false);
    // Multiple short chapters have already contributed findings before the global budget yields.
    const shortChapters = snapshot(...Array(120).fill("one two three. ".repeat(20)));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    expect((await analyzeReviewCoverageAsync(shortChapters, controller.signal)).status).toBe("cancelled");
  });

  test("analysis consumes immutable input without network or provider access", async () => {
    const source = snapshot("local text only. LOCAL text only");
    for (const chapter of source.chapters) Object.freeze(chapter);
    Object.freeze(source.chapters);
    Object.freeze(source);
    const original = JSON.stringify(source);
    const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
      () => { throw new Error("No network in local review"); },
      { preconnect: globalThis.fetch.preconnect }
    ));
    try {
      const outcome = await analyzeReviewCoverageAsync(source, new AbortController().signal);
      expect(outcome.status).toBe("complete");
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(source)).toBe(original);
    } finally {
      fetch.mockRestore();
    }
  });

  test("120 chapters / 250k synthetic words retain complete overlap counts and yield to the host", async () => {
    const source = snapshot(...Array.from({ length: 120 }, (_, index) => Array(2083 + (index < 40 ? 1 : 0)).fill("word").join(" ")));
    const before = process.memoryUsage();
    const started = performance.now();
    let ticks = 0;
    let longestGap = 0;
    let lastTick = started;
    const heartbeat = setInterval(() => {
      const now = performance.now(); longestGap = Math.max(longestGap, now - lastTick); lastTick = now; ticks += 1;
    }, 0);
    const outcome = await analyzeReviewCoverageAsync(source, new AbortController().signal);
    clearInterval(heartbeat);
    const elapsed = performance.now() - started;
    const after = process.memoryUsage();
    if (outcome.status !== "complete") throw new Error("Expected complete synthetic long book");
    expect(outcome.value.coverage).toMatchObject({ inScope: 120, included: 120, skipped: 0, empty: 0 });
    expect(outcome.value.wordCounts.totalWordCount).toBe(250_000);
    expect(outcome.value.findings).toHaveLength(1);
    expect(outcome.value.findings[0]?.evidence).toHaveLength(249_760);
    expect(outcome.value.findings[0]?.evidence.at(-1)?.chapterId).toBe("chapter-119");
    expect(ticks).toBeGreaterThan(10);
    console.log(JSON.stringify({ fixture: "120 chapters / 250000 words", runtime: Bun.version, platform: process.platform,
      arch: process.arch, elapsedMs: Math.round(elapsed), heartbeatTicks: ticks, longestGapMs: Math.round(longestGap),
      rssBefore: before.rss, rssAfter: after.rss, heapBefore: before.heapUsed, heapAfter: after.heapUsed }));
  }, 20_000);

  test("a 250k-word high-diversity book finishes every window without retaining singleton findings", async () => {
    let nextWord = 0;
    const source = snapshot(...Array.from({ length: 120 }, (_, index) =>
      Array.from({ length: 2083 + (index < 40 ? 1 : 0) }, () => `word${nextWord++}`).join(" ")));
    const before = process.memoryUsage();
    const started = performance.now();
    let peakRss = before.rss;
    let peakHeap = before.heapUsed;
    let longestGap = 0;
    let lastTick = started;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - lastTick);
      lastTick = now;
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
    }, 0);
    const outcome = await analyzeReviewCoverageAsync(source, new AbortController().signal);
    clearInterval(heartbeat);
    if (outcome.status !== "complete") throw new Error("Expected complete high-diversity book");
    expect(outcome.value.wordCounts.totalWordCount).toBe(250_000);
    expect(outcome.value.coverage).toMatchObject({ inScope: 120, included: 120, skipped: 0 });
    expect(outcome.value.findings).toEqual([]);
    console.log(JSON.stringify({ fixture: "120 chapters / 250000 unique words", elapsedMs: Math.round(performance.now() - started),
      longestGapMs: Math.round(longestGap), sampledPeakRss: peakRss, sampledPeakHeap: peakHeap, rssBefore: before.rss, heapBefore: before.heapUsed }));
  }, 20_000);
});
