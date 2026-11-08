import { z } from "zod";
import { bookIdSchema, chapterIdSchema, hashSchema, idSchema, integerSchema, REVIEW_LIMITS, spanSchema, textSchema, versionSchema, withinScalarLimit } from "./contract";
import { categorySchema } from "./profiles";
import { bibleIdentitySchema, savedIdentitySchema } from "./sources";

const chapterArgs = z.strictObject({ bookId: bookIdSchema, chapterId: chapterIdSchema });
const searchArgs = { query: textSchema.min(1), limit: integerSchema.min(1).max(100) };
export const reviewToolSchemas = {
  table_of_contents: z.strictObject({}),
  read_story_bible: z.strictObject({}),
  read_chapter: chapterArgs.extend({ range: spanSchema.optional() }),
  chapter_stats: chapterArgs,
  find_in_chapter: chapterArgs.extend(searchArgs),
  find_in_chapters: z.strictObject(searchArgs)
};

const quoteFields = { sourceId: idSchema, start: integerSchema, end: integerSchema,
  quote: textSchema.refine((text) => withinScalarLimit(text, REVIEW_LIMITS.quoteScalars)).describe("Literal exact quote; at most 500 Unicode scalar values.") };
export const citationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("chapter"), identity: savedIdentitySchema, ...quoteFields }),
  z.strictObject({ kind: z.literal("story-bible"), bookId: bookIdSchema, field: bibleIdentitySchema,
    valueDigest: hashSchema, containingFileHash: hashSchema, ...quoteFields })
]);
const findingFields = {
  findingId: idSchema, category: categorySchema, readerId: idSchema, readerVersion: versionSchema,
  runId: idSchema.describe("Must equal the disclosed requestId."), interpretation: textSchema.refine((text) => withinScalarLimit(text, REVIEW_LIMITS.interpretationScalars)).describe("Subjective interpretation; at most 2000 Unicode scalar values."),
  claim: z.enum(["observation", "question", "contradiction"])
};
/** Invalid individual citation shapes can be counted without discarding schema-valid prose. */
export const findingsOutputSchema = z.strictObject({
  runId: idSchema, readerId: idSchema, readerVersion: versionSchema,
  findings: z.array(z.strictObject({ ...findingFields, evidence: z.array(z.unknown()).max(REVIEW_LIMITS.evidence) })).max(REVIEW_LIMITS.findings)
});
export const requestedFindingsSchema = z.strictObject({
  runId: idSchema, readerId: idSchema, readerVersion: versionSchema,
  findings: z.array(z.strictObject({ ...findingFields, evidence: z.array(citationSchema).max(REVIEW_LIMITS.evidence) })).max(REVIEW_LIMITS.findings)
});
