import { countWords } from "../words";
import { assertReviewData, canonicalJson, freeze, requireContract, validSpan } from "./contract";
import { offeredReviewTools, validateReviewEnvelope, type ReviewEnvelope, type ReviewToolName } from "./envelope";
import type { ChapterSource } from "./sources";
import { reviewToolSchemas } from "./wire-schema";

/** A closed snapshot capability. No Library, callbacks, plugins, provider or filesystem is accepted. */
export async function createReviewReadFacade(input: ReviewEnvelope) {
  const envelope = await validateReviewEnvelope(input);
  const tools = Object.freeze([...offeredReviewTools(envelope)]);
  const chapters = envelope.sources.filter((source): source is ChapterSource => source.kind === "chapter");
  function chapter(bookId: string, chapterId: string): ChapterSource {
    const matches = chapters.filter((source) => source.identity.bookId === bookId && source.identity.chapterId === chapterId);
    const found = matches[0];
    requireContract(matches.length === 1 && found, "chapter-unavailable");
    return found;
  }
  function search(sources: readonly ChapterSource[], query: string, limit: number) {
    const matches: { sourceId: string; start: number; end: number; quote: string }[] = [];
    let total = 0;
    for (const source of sources) for (const segment of source.segments) {
      let from = 0;
      while (from <= segment.text.length - query.length) {
        const offset = segment.text.indexOf(query, from);
        if (offset < 0) break;
        if (validSpan(segment.text, { start: offset, end: offset + query.length })) {
          total++;
          if (matches.length < limit) matches.push({ sourceId: source.sourceId, start: segment.start + offset,
            end: segment.start + offset + query.length, quote: query });
        }
        from = offset + 1;
      }
    }
    return { matches, total, limit, capped: total > limit, coverage: "selected-ranges-only" };
  }
  function execute(name: string, args: unknown): unknown {
    requireContract(tools.includes(name as ReviewToolName), "tool-unavailable");
    assertReviewData(args);
    switch (name) {
      case "table_of_contents": {
        reviewToolSchemas.table_of_contents.parse(args);
        return chapters.map((source) => ({ sourceId: source.sourceId, bookId: source.identity.bookId,
          chapterId: source.identity.chapterId, bookTitle: source.bookTitle, title: source.title,
          position: source.position, coverage: "selected-ranges-only" }));
      }
      case "read_story_bible":
        reviewToolSchemas.read_story_bible.parse(args);
        return envelope.sources.filter((source) => source.kind === "story-bible");
      case "read_chapter": {
        const input = reviewToolSchemas.read_chapter.parse(args);
        const source = chapter(input.bookId, input.chapterId);
        const range = input.range;
        let segments = source.segments;
        if (range) {
          const segment = source.segments.find((item) => range.start >= item.start && range.end <= item.end);
          requireContract(segment && validSpan(segment.text, { start: range.start - segment.start, end: range.end - segment.start }), "range-unavailable");
          segments = [{ start: range.start, end: range.end, text: segment.text.slice(range.start - segment.start, range.end - segment.start),
            startLine: segment.startLine + segment.text.slice(0, range.start - segment.start).split("\n").length - 1 }];
        }
        return { sourceId: source.sourceId, identity: source.identity, segments,
          partial: !(segments.length === 1 && segments[0]?.start === 0 && segments[0]?.end === source.bodyLength) };
      }
      case "chapter_stats": {
        const input = reviewToolSchemas.chapter_stats.parse(args);
        const source = chapter(input.bookId, input.chapterId);
        return { sourceId: source.sourceId, coverage: "selected-ranges-only",
          wordCount: source.segments.reduce((total, segment) => total + countWords(segment.text), 0),
          utf16Units: source.segments.reduce((total, segment) => total + segment.text.length, 0) };
      }
      case "find_in_chapter": {
        const input = reviewToolSchemas.find_in_chapter.parse(args);
        return search([chapter(input.bookId, input.chapterId)], input.query, input.limit);
      }
      case "find_in_chapters": {
        const input = reviewToolSchemas.find_in_chapters.parse(args);
        return search(chapters, input.query, input.limit);
      }
      default: throw new Error("Unreachable review tool");
    }
  }
  return Object.freeze({ tools, execute: (name: string, args: unknown) => freeze(execute(name, args)),
    serializeResult: (name: string, args: unknown) => canonicalJson(execute(name, args)) });
}
