import { z } from "zod";
import {
  assertReviewData, bookIdSchema, chapterIdSchema, digestJson, freeze, hashSchema, idSchema, integerSchema, isReviewData,
  requireContract, spanSchema, textSchema, timestampSchema, validSpan, versionSchema,
  type Immutable, type Span
} from "./contract";

export const savedIdentitySchema = z.strictObject({
  bookId: bookIdSchema, chapterId: chapterIdSchema, version: versionSchema, hash: hashSchema
});
export type SavedIdentity = z.infer<typeof savedIdentitySchema>;
export const savedBodySchema = savedIdentitySchema.extend({ body: textSchema });
export type SavedBody = z.infer<typeof savedBodySchema>;

const segmentSchema = spanSchema.extend({ text: textSchema, startLine: versionSchema });
export const chapterSourceSchema = z.strictObject({
  kind: z.literal("chapter"), sourceId: idSchema, identity: savedIdentitySchema,
  bookTitle: textSchema, title: textSchema, position: versionSchema, capturedAt: timestampSchema,
  bodyLength: integerSchema, segments: z.array(segmentSchema).min(1)
}).superRefine((source, context) => {
  let previousEnd = -1;
  for (const segment of source.segments) {
    if (segment.start <= previousEnd || segment.end <= segment.start ||
        segment.end > source.bodyLength || segment.text.length !== segment.end - segment.start) {
      context.addIssue({ code: "custom", message: "Invalid or unmerged selected range" });
    }
    previousEnd = segment.end;
  }
});

/** Existing Story Bible fields only; no arbitrary path, SKILLS or new planning record. */
export const bibleIdentitySchema = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("outline") }),
  z.strictObject({ section: z.literal("storyArc"), part: z.enum(["beginning", "middle", "end"]),
    field: z.enum(["overview", "keyMoments", "openQuestions"]) }),
  z.strictObject({ section: z.literal("character"), recordId: z.string().regex(/^char_[A-Za-z0-9-]{6,}$/),
    field: z.enum(["name", "role", "description", "motivations", "notes"]) }),
  z.strictObject({ section: z.literal("memory"), recordId: z.string().regex(/^mem_[A-Za-z0-9-]{6,}$/), field: z.literal("text") })
]);
export const bibleSourceSchema = z.strictObject({
  kind: z.literal("story-bible"), sourceId: idSchema, bookId: bookIdSchema, bookTitle: textSchema,
  field: bibleIdentitySchema, label: textSchema, capturedAt: timestampSchema,
  containingFileHash: hashSchema, valueDigest: hashSchema, text: textSchema
});
export const sourceSchema = z.discriminatedUnion("kind", [chapterSourceSchema, bibleSourceSchema]);
export type ChapterSource = Immutable<z.infer<typeof chapterSourceSchema>>;
export type BibleSource = Immutable<z.infer<typeof bibleSourceSchema>>;
export type ReviewSource = ChapterSource | BibleSource;

/** Caller supplies a uniquely resolved saved body and explicitly validated display metadata. */
export function captureChapterSource(input: {
  sourceId: string; saved: SavedBody; bookTitle: string; title: string; position: number;
  capturedAt: string; ranges: readonly Span[];
}): ChapterSource {
  assertReviewData(input);
  const saved = savedBodySchema.parse(input.saved);
  const ranges = z.array(spanSchema).min(1).parse(input.ranges).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const range of ranges) {
    requireContract(validSpan(saved.body, range), "invalid-selected-range");
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return freeze(chapterSourceSchema.parse({
    kind: "chapter", sourceId: input.sourceId,
    identity: { bookId: saved.bookId, chapterId: saved.chapterId, version: saved.version, hash: saved.hash },
    bookTitle: input.bookTitle, title: input.title, position: input.position, capturedAt: input.capturedAt,
    bodyLength: saved.body.length,
    segments: merged.map(({ start, end }) => ({ start, end, text: saved.body.slice(start, end),
      startLine: saved.body.slice(0, start).split("\n").length }))
  }));
}

export async function captureBibleSource(input: Omit<z.infer<typeof bibleSourceSchema>, "kind" | "valueDigest">): Promise<BibleSource> {
  assertReviewData(input);
  const selected = bibleSourceSchema.omit({ valueDigest: true }).parse({ ...input, kind: "story-bible" });
  return freeze({ ...selected, valueDigest: await digestJson(selected.text) });
}

export function sourceBookId(source: ReviewSource): string {
  return source.kind === "chapter" ? source.identity.bookId : source.bookId;
}

export function sameSavedIdentity(a: SavedIdentity, b: SavedIdentity): boolean {
  return a.bookId === b.bookId && a.chapterId === b.chapterId && a.version === b.version && a.hash === b.hash;
}

export const savedQuoteSchema = savedIdentitySchema.extend({ start: integerSchema, end: integerSchema, quote: textSchema });
export type SavedQuote = z.infer<typeof savedQuoteSchema>;
export type QuoteCheck = { status: "verified"; firstLine: number; lastLine: number } |
  { status: "invalid"; reason: "shape" | "identity" | "range" | "outside-selection" | "quote" };

/** Generic exact verifier for saved-body anchors, including future annotations. No review quote cap. */
export function verifySavedBodyQuote(savedInput: unknown, quoteInput: unknown, selected?: readonly Span[]): QuoteCheck {
  if (!isReviewData(savedInput) || !isReviewData(quoteInput)) return { status: "invalid", reason: "shape" };
  if (selected !== undefined && (!isReviewData(selected) || !z.array(spanSchema).safeParse(selected).success)) {
    return { status: "invalid", reason: "outside-selection" };
  }
  const saved = savedBodySchema.safeParse(savedInput);
  const quote = savedQuoteSchema.safeParse(quoteInput);
  if (!saved.success || !quote.success) return { status: "invalid", reason: "shape" };
  const body = saved.data.body;
  const anchor = quote.data;
  if (!sameSavedIdentity(saved.data, anchor)) return { status: "invalid", reason: "identity" };
  if (!validSpan(body, anchor)) return { status: "invalid", reason: "range" };
  if (selected && (!selected.every((span) => validSpan(body, span)) ||
    !selected.some((span) => anchor.start >= span.start && anchor.end <= span.end))) {
    return { status: "invalid", reason: "outside-selection" };
  }
  if (body.slice(anchor.start, anchor.end) !== anchor.quote) return { status: "invalid", reason: "quote" };
  return { status: "verified", firstLine: body.slice(0, anchor.start).split("\n").length,
    lastLine: body.slice(0, anchor.end - 1).split("\n").length };
}

/** Host must supply fresh, uniquely resolved candidates and the actual editor's saved identity. */
export const savedEditorSchema = z.strictObject({ clean: z.boolean(), identity: z.union([savedIdentitySchema, savedBodySchema]) });
export function checkSavedQuoteNavigation(anchor: SavedQuote, candidates: readonly SavedBody[], editor: {
  clean: boolean; identity: SavedIdentity;
}): "ready" | "stale" | "unavailable" {
  if (!isReviewData(anchor) || !isReviewData(candidates)) return "unavailable";
  const quote = savedQuoteSchema.safeParse(anchor);
  const bodies = z.array(savedBodySchema).safeParse(candidates);
  if (!quote.success || !bodies.success) return "unavailable";
  if (!isReviewData(editor)) return "stale";
  const destination = savedEditorSchema.safeParse(editor);
  if (!destination.success || destination.data.clean !== true) return "stale";
  const matches = bodies.data.filter((body) => body.bookId === quote.data.bookId && body.chapterId === quote.data.chapterId);
  const source = matches[0];
  if (matches.length !== 1 || !source) return "unavailable";
  if (!sameSavedIdentity(quote.data, destination.data.identity) || verifySavedBodyQuote(source, quote.data).status !== "verified") return "stale";
  return "ready";
}
