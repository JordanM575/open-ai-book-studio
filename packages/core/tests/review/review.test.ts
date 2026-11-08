import { describe, expect, test } from "bun:test";
import {
  analyzeReviewCoverage,
  analyzeReviewCoverageAsync,
  buildReviewReport,
  countReviewWords,
  revalidateReviewEvidence,
  reviewNoSourceResult,
  reviewReportFreshness,
  reviewSourceSnapshotFromBookDetail,
  runReviewWork,
  type ReviewReportResult,
  type ReviewRunRequest,
  type ReviewSourceSnapshot
} from "../../src/review";
import { bookSchema, chapterMetaSchema, type BookDetail } from "../../src/schema";

const source: ReviewSourceSnapshot = {
  scope: { kind: "book", bookId: "book-fixture" },
  capturedAt: "2026-11-02T12:00:00.000Z",
  chapters: [
    {
      status: "saved",
      chapterId: "chapter-empty",
      title: "Empty chapter",
      order: 1,
      body: " \n\t",
      version: 1,
      hash: "1".repeat(64)
    },
    {
      status: "saved",
      chapterId: "chapter-prose",
      title: "Punctuation stays",
      order: 2,
      body: "one — two ...",
      version: 4,
      hash: "2".repeat(64)
    },
    {
      status: "skipped",
      fileName: "0003-unreadable-fixture.md",
      order: 3,
      reason: "Synthetic fixture read failure"
    }
  ]
};

describe("manuscript review core contracts", () => {
  test("a request carries book scope and the saved source snapshot", () => {
    const request = {
      requestedAt: "2026-11-02T12:01:00.000Z",
      source
    } satisfies ReviewRunRequest;

    expect(request.source.scope).toEqual({ kind: "book", bookId: "book-fixture" });
    expect(request.source.chapters[1]).toMatchObject({
      chapterId: "chapter-prose",
      title: "Punctuation stays",
      order: 2,
      status: "saved",
      version: 4,
      hash: "2".repeat(64)
    });
  });

  test("reuses the shared count semantics and sums only readable saved bodies", () => {
    const counts = countReviewWords(source);

    expect(counts.chapters.map((chapter) => [
      chapter.status === "skipped" ? chapter.fileName : chapter.chapterId,
      chapter.wordCount
    ])).toEqual([
      ["chapter-empty", 0],
      ["chapter-prose", 4],
      ["0003-unreadable-fixture.md", null]
    ]);
    expect(counts.totalWordCount).toBe(4);
  });

  test("empty, whitespace-only, punctuation and the public one-em-dash-two example match countWords", () => {
    const fixture: ReviewSourceSnapshot = {
      scope: { kind: "book", bookId: "count-fixture" },
      capturedAt: "2026-11-02T12:00:00.000Z",
      chapters: [
        { status: "saved", chapterId: "empty", title: "Empty", order: 1, body: "", version: 1, hash: "a".repeat(64) },
        { status: "saved", chapterId: "whitespace", title: "Whitespace", order: 2, body: "\n \t", version: 1, hash: "b".repeat(64) },
        { status: "saved", chapterId: "punctuation", title: "Punctuation", order: 3, body: "... —", version: 1, hash: "c".repeat(64) },
        { status: "saved", chapterId: "shared-example", title: "Shared example", order: 4, body: "one — two", version: 1, hash: "d".repeat(64) }
      ]
    };

    const counts = countReviewWords(fixture);
    expect(counts.chapters.map(({ wordCount }) => wordCount)).toEqual([0, 0, 2, 3]);
    expect(counts.totalWordCount).toBe(5);
  });

  test("reports complete, partial, insufficient-evidence and failed source coverage distinctly", () => {
    const complete = analyzeReviewCoverage({
      ...source,
      chapters: source.chapters.slice(0, 2)
    });
    expect(complete.status).toBe("complete");
    expect(complete.coverage).toMatchObject({ inScope: 2, included: 1, empty: 1, skipped: 0 });

    const partial = analyzeReviewCoverage(source);
    expect(partial.status).toBe("partial");
    expect(partial.coverage).toMatchObject({ inScope: 3, included: 1, empty: 1, skipped: 1 });
    expect(partial.coverage.chapters[2]).toMatchObject({
      status: "skipped",
      fileName: "0003-unreadable-fixture.md",
      reason: "Synthetic fixture read failure"
    });

    const noProse = analyzeReviewCoverage({ ...source, chapters: [source.chapters[0]!] });
    expect(noProse.status).toBe("insufficient-evidence");
    expect(noProse.coverage.empty).toBe(1);

    const noVerifiedSources = analyzeReviewCoverage({ ...source, chapters: [source.chapters[2]!] });
    expect(noVerifiedSources.status).toBe("failed");
    expect(noVerifiedSources.coverage.skipped).toBe(1);

    const emptyBook = analyzeReviewCoverage({ ...source, chapters: [] });
    expect(emptyBook.status).toBe("insufficient-evidence");
    expect(emptyBook.coverage.inScope).toBe(0);
  });

  test("maps public book reads to saved and safely described skipped sources", () => {
    const now = "2026-11-02T12:00:00.000Z";
    const detail: BookDetail = {
      book: bookSchema.parse({ id: "book_mapping1", title: "Fixture book", createdAt: now, updatedAt: now }),
      chapters: [
        {
          ...chapterMetaSchema.parse({
            id: "ch_mapping1",
            title: "Saved chapter",
            order: 1,
            createdAt: now,
            updatedAt: now
          }),
          content: "Saved fixture.\n",
          path: "0001-saved-chapter.md",
          wordCount: 2,
          hash: "e".repeat(64)
        }
      ],
      chapterReadIssues: [{ fileName: "0002-broken-chapter.md", order: 2, reason: "invalid-format" }]
    };

    const snapshot = reviewSourceSnapshotFromBookDetail(detail, now);
    expect(snapshot.scope).toEqual({ kind: "book", bookId: "book_mapping1" });
    expect(snapshot.chapters).toMatchObject([
      { status: "saved", chapterId: "ch_mapping1", body: "Saved fixture.\n", version: 1, hash: "e".repeat(64) },
      {
        status: "skipped",
        fileName: "0002-broken-chapter.md",
        order: 2,
        reason: "The chapter file could not be read as a valid chapter."
      }
    ]);
  });

  test("cancellation before or during analysis returns no partial value", async () => {
    const request: ReviewRunRequest = { requestedAt: "2026-11-02T12:02:00.000Z", source };
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    let startedBeforeCancellation = false;
    expect(
      await runReviewWork(request, alreadyCancelled.signal, async () => {
        startedBeforeCancellation = true;
        return ["partial"];
      })
    ).toMatchObject({ status: "cancelled", scope: source.scope });
    expect(startedBeforeCancellation).toBe(false);

    const cancelledBeforeStart = new AbortController();
    let startedAfterRequestCancellation = false;
    const queued = runReviewWork(request, cancelledBeforeStart.signal, async () => {
      startedAfterRequestCancellation = true;
      return ["must not start"];
    });
    cancelledBeforeStart.abort();
    expect(await queued).toMatchObject({ status: "cancelled" });
    expect(startedAfterRequestCancellation).toBe(false);

    const controller = new AbortController();
    let releaseWork!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pendingWork = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    const internalPartial: string[] = [];
    const run = runReviewWork(request, controller.signal, async (_request, signal) => {
      internalPartial.push("computed but private");
      markStarted();
      await pendingWork;
      if (!signal.aborted) internalPartial.push("must not continue");
      return internalPartial;
    });

    await started;
    controller.abort();
    const result = await run;
    releaseWork();

    expect(result).toMatchObject({ status: "cancelled", requestedAt: request.requestedAt });
    expect(result).not.toHaveProperty("value");
    expect(internalPartial).toEqual(["computed but private"]);
  });

  test("post-run source revalidation allows current evidence and blocks changed evidence", () => {
    const report = completedReport();
    const unchanged: ReviewSourceSnapshot = { ...source, capturedAt: "2026-11-02T12:03:00.000Z" };

    expect(reviewReportFreshness(report, unchanged)).toEqual({ status: "current" });
    expect(revalidateReviewEvidence(report, unchanged, "finding-fixture", 0)).toMatchObject({
      status: "ready",
      evidence: {
        chapterId: "chapter-prose",
        sourceVersion: 4,
        sourceHash: "2".repeat(64)
      }
    });

    const edited: ReviewSourceSnapshot = {
      ...source,
      chapters: source.chapters.map((chapter) =>
        chapter.status === "saved" && chapter.chapterId === "chapter-prose"
          ? { ...chapter, version: chapter.version + 1, hash: "f".repeat(64) }
          : chapter
      )
    };
    const freshness = reviewReportFreshness(report, edited);
    expect(freshness).toEqual({ status: "stale", changes: [{ kind: "changed", chapterId: "chapter-prose" }] });
    if (freshness.status !== "stale") throw new Error("Expected the changed fixture source to be stale.");
    const navigation = revalidateReviewEvidence(report, edited, "finding-fixture", 0);
    expect(navigation).toEqual(freshness);
    expect(navigation).not.toHaveProperty("evidence");
  });

  test("chunked cancellable analysis matches the sync word counts exactly", async () => {
    const bodies = [
      "",
      "   \n\t  ",
      "one — two ...",
      "word ".repeat(20_000) + "tail"
    ];
    const chunked: ReviewSourceSnapshot = {
      scope: { kind: "book", bookId: "book-chunked" },
      capturedAt: "2026-11-02T12:04:00.000Z",
      chapters: bodies.map((body, index) => ({
        status: "saved" as const,
        chapterId: `chapter-${index}`,
        title: `Chapter ${index}`,
        order: index + 1,
        body,
        version: 1,
        hash: `${index}`.repeat(64)
      }))
    };

    const controller = new AbortController();
    const outcome = await analyzeReviewCoverageAsync(chunked, controller.signal);
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") throw new Error("The uncancelled chunked analysis must complete.");
    const expected = analyzeReviewCoverage(chunked);
    expect(outcome.value).toEqual(expected);
  });

  test("aborting mid-analysis discards partial counts and never completes", async () => {
    const chunked: ReviewSourceSnapshot = {
      scope: { kind: "book", bookId: "book-aborted" },
      capturedAt: "2026-11-02T12:05:00.000Z",
      chapters: [
        {
          status: "saved",
          chapterId: "chapter-long",
          title: "Long",
          order: 1,
          body: `${"word ".repeat(200_000)}\n`,
          version: 1,
          hash: "a".repeat(64)
        }
      ]
    };

    const controller = new AbortController();
    const run = analyzeReviewCoverageAsync(chunked, controller.signal);
    // The first yield budget is counted synchronously, so a microtask abort always lands
    // mid-analysis: after work started, before any macrotask yield resolves.
    await Promise.resolve();
    controller.abort();
    const outcome = await run;
    expect(outcome).toMatchObject({ status: "cancelled", scope: chunked.scope });
    expect(outcome).not.toHaveProperty("value");
  });
});

function completedReport(): ReviewReportResult {
  const reportSource = source;
  const analysis = analyzeReviewCoverage(reportSource);
  const prose = reportSource.chapters[1]!;
  if (prose.status !== "saved") throw new Error("Synthetic report fixture must contain a saved prose chapter.");

  return {
    status: "partial",
    scope: reportSource.scope,
    requestedAt: "2026-11-02T12:01:00.000Z",
    completedAt: "2026-11-02T12:01:01.000Z",
    source: {
      capturedAt: reportSource.capturedAt,
      chapters: reportSource.chapters.map((chapter) =>
        chapter.status === "saved"
          ? {
              status: chapter.status,
              chapterId: chapter.chapterId,
              title: chapter.title,
              order: chapter.order,
              version: chapter.version,
              hash: chapter.hash
            }
          : {
              status: chapter.status,
              fileName: chapter.fileName,
              order: chapter.order,
              reason: chapter.reason
            }
      )
    },
    wordCounts: analysis.wordCounts,
    coverage: analysis.coverage,
    metricDefinitions: [],
    findings: [
      {
        id: "finding-fixture",
        metricId: "metric-fixture",
        label: "Synthetic fixture finding",
        evidence: [
          {
            chapterId: prose.chapterId,
            title: prose.title,
            order: prose.order,
            sourceVersion: prose.version,
            sourceHash: prose.hash,
            startOffset: 0,
            endOffset: 3,
            excerpt: "one"
          }
        ]
      }
    ]
  };
}

describe("review report composition", () => {
  test("builds a disposable report with counts, coverage and the studio word-count definition", () => {
    const stamps = { requestedAt: "2026-11-03T12:00:00.000Z", completedAt: "2026-11-03T12:00:01.000Z" };
    const analysis = analyzeReviewCoverage(source);
    if (analysis.status === "failed") throw new Error("Synthetic fixture must verify at least one source.");

    const report = buildReviewReport(source, analysis, stamps);

    expect(report.status).toBe("partial");
    expect(report.scope).toEqual({ kind: "book", bookId: "book-fixture" });
    expect(report.requestedAt).toBe(stamps.requestedAt);
    expect(report.completedAt).toBe(stamps.completedAt);
    expect(report.wordCounts.totalWordCount).toBe(4);
    expect(report.coverage).toMatchObject({ inScope: 3, included: 1, empty: 1, skipped: 1 });
    expect(report.metricDefinitions).toEqual([
      {
        id: "studio-word-count",
        label: "Studio word count",
        definition: expect.stringContaining("whitespace-separated token")
      },
      expect.objectContaining({ id: "repetition-v1", definition: expect.stringContaining("overlapping three-token") })
    ]);
    // This fixture has fewer than three repetition tokens, distinct from its studio word count.
    expect(report.findings).toEqual([]);
    expect(report.source.chapters).toHaveLength(3);
    expect(report.source.chapters[1]).toMatchObject({
      status: "saved",
      chapterId: "chapter-prose",
      version: 4,
      hash: "2".repeat(64)
    });
  });

  test("identical saved snapshots produce identical reports", () => {
    const stamps = { requestedAt: "2026-11-03T12:00:00.000Z", completedAt: "2026-11-03T12:00:01.000Z" };
    const first = analyzeReviewCoverage(source);
    const second = analyzeReviewCoverage({ ...source, capturedAt: source.capturedAt });
    if (first.status === "failed" || second.status === "failed") {
      throw new Error("Synthetic fixture must verify at least one source.");
    }

    expect(buildReviewReport(source, second, stamps)).toEqual(buildReviewReport(source, first, stamps));
  });

  test("no verifiable source becomes a failure, never an empty success", () => {
    const failed = analyzeReviewCoverage({ ...source, chapters: [source.chapters[2]!] });
    expect(failed.status).toBe("failed");

    const result = reviewNoSourceResult(source.scope, "2026-11-03T12:00:00.000Z", failed.coverage);

    expect(result).toMatchObject({
      status: "failed",
      scope: source.scope,
      message: expect.stringContaining("No saved chapter text could be verified")
    });
    expect(result.coverage).toMatchObject({ skipped: 1 });
  });
});
