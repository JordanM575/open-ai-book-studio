import { captureChapterSource, type SavedBody } from "../../src/review/sources";
import { buildReviewEnvelope, reviewToolNameSchema, type CurrentReviewFacts, type EnvelopeInput, type ReviewEnvelope } from "../../src/review/envelope";

export const stamp = "2026-11-07T12:00:00Z";
export const hash = "a".repeat(64);
export const saved: SavedBody = {
  bookId: "book_123456", chapterId: "ch_123456", version: 3, hash,
  body: "ADJACENT_BEFORE\nSelected 😀 exact.\nADJACENT_AFTER"
};
export const selectedStart = saved.body.indexOf("Selected");
export const selectedEnd = saved.body.indexOf("\nADJACENT_AFTER");
export function item<T>(items: readonly T[], index = 0): T {
  const found = items[index];
  if (found === undefined) throw new Error("Missing synthetic fixture item");
  return found;
}
export function source(body = saved.body, start = selectedStart, end = selectedEnd) {
  return captureChapterSource({ sourceId: "source-1", saved: { ...saved, body }, bookTitle: "Synthetic book",
    title: "Synthetic chapter", position: 1, capturedAt: stamp, ranges: [{ start, end }] });
}
export function input(): EnvelopeInput {
  return {
    contractVersion: 1, kind: "guided-review", requestId: "request-1", capturedAt: stamp,
    destination: { connectionId: "connection-1", provider: "Synthetic provider", model: "synthetic/model", endpointIdentity: "endpoint-revision-1" },
    environment: { hostId: "synthetic-host", hostSupported: true, connectionAvailable: true, modelSupported: true,
      capabilityRevision: "capability-1", estimatedCostUsd: null, priceAsOf: null, catalogContextTokens: null,
      catalogAsOf: null, contextFit: "unknown" },
    books: [{ bookId: saved.bookId, title: "Synthetic book", consentSatisfied: true, consentRevision: "consent-1",
      termsRevision: "terms-1", enabledTools: [...reviewToolNameSchema.options] }],
    prompt: "Review the selected passage.", profile: null, priorFeedback: [], sources: [structuredClone(source())]
  };
}
export async function envelope() { return buildReviewEnvelope(input()); }
export function currentFacts(value: ReviewEnvelope): CurrentReviewFacts {
  return JSON.parse(JSON.stringify({ destination: value.destination, environment: value.environment, books: value.books, profile: value.profile }));
}
export function currentSources(value: ReviewEnvelope) {
  return value.sources.map((item) => ({ sourceId: item.sourceId, status: "available" as const, source: item }));
}
export function citation() {
  return { kind: "chapter" as const, sourceId: "source-1", identity: { bookId: saved.bookId, chapterId: saved.chapterId, version: saved.version, hash },
    start: selectedStart, end: selectedEnd, quote: saved.body.slice(selectedStart, selectedEnd) };
}
