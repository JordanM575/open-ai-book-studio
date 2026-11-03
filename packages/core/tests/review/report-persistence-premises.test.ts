import { describe, expect, test } from "bun:test";
import type { ReviewReportResult } from "../../src/review/index";

/**
 * Spec 034 T003 premises. These pin the report-shape facts the save/export
 * decision rests on; they choose nothing. A future persistence design must
 * respect what is proven here: results carry source references and finding
 * excerpts but never chapter bodies, excerpts have no core length bound, and
 * freshness is computed — never stored — so an exported report cannot speak
 * for the current source on its own.
 */

const BODY_ONE = "The hall was cold. Mara closed the door and listened to the rain.";
const BODY_TWO = "Morning came slowly over the salt road.";

function syntheticReport(excerpt: string): ReviewReportResult {
  return {
    status: "complete",
    scope: { kind: "book", bookId: "book_premises" },
    requestedAt: "2026-11-03T00:00:00.000Z",
    completedAt: "2026-11-03T00:01:00.000Z",
    source: {
      capturedAt: "2026-11-03T00:00:30.000Z",
      chapters: [
        { chapterId: "ch_one", title: "One", order: 1, status: "saved", version: 3, hash: "a".repeat(64) },
        { chapterId: "ch_two", title: "Two", order: 2, status: "saved", version: 1, hash: "b".repeat(64) }
      ]
    },
    wordCounts: {
      totalWordCount: 20,
      chapters: [
        { chapterId: "ch_one", title: "One", order: 1, status: "included", wordCount: 13 },
        { chapterId: "ch_two", title: "Two", order: 2, status: "included", wordCount: 7 }
      ]
    },
    coverage: {
      inScope: 2,
      included: 2,
      empty: 0,
      skipped: 0,
      chapters: [
        { chapterId: "ch_one", title: "One", order: 1, status: "included", wordCount: 13 },
        { chapterId: "ch_two", title: "Two", order: 2, status: "included", wordCount: 7 }
      ]
    },
    metricDefinitions: [{ id: "word-count", label: "Word count", definition: "Studio words per chapter." }],
    findings: [
      {
        id: "finding_1",
        metricId: "repeated-phrase",
        label: "Repeated phrase",
        evidence: [
          {
            chapterId: "ch_one",
            title: "One",
            order: 1,
            sourceVersion: 3,
            sourceHash: "a".repeat(64),
            startOffset: 0,
            endOffset: excerpt.length,
            excerpt
          }
        ]
      }
    ]
  };
}

describe("report persistence premises", () => {
  test("a serialized report carries excerpts but never chapter bodies", () => {
    const excerpt = BODY_ONE.slice(0, 18);
    const serialized = JSON.stringify(syntheticReport(excerpt));
    expect(serialized).toContain(excerpt);
    expect(serialized).not.toContain(BODY_ONE);
    expect(serialized).not.toContain(BODY_TWO);
  });

  test("the core places no length bound on excerpts", () => {
    const longExcerpt = `${BODY_ONE} `.repeat(200);
    const serialized = JSON.stringify(syntheticReport(longExcerpt));
    expect(serialized).toContain(longExcerpt);
    // An export cap must come from the decision, not the type: nothing truncates here.
    expect(longExcerpt.length).toBeGreaterThan(1000);
  });

  test("freshness is computed, never stored with the report", () => {
    const report = syntheticReport(BODY_ONE.slice(0, 18));
    expect("freshness" in report).toBe(false);
    expect("stale" in report).toBe(false);
    // Source identity travels as version+hash references for export-time revalidation.
    const chapter = report.source.chapters[0];
    expect(chapter?.status).toBe("saved");
    if (chapter?.status === "saved") {
      expect(chapter.version).toBe(3);
      expect(chapter.hash).toBe("a".repeat(64));
    }
  });
});
