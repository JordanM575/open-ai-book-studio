import { z } from "zod";
import {
  bookIdSchema, canonicalJson, chapterIdSchema, hashSchema, idSchema, integerSchema, REVIEW_LIMITS,
  scalarCount, spanSchema, textSchema, timestampSchema, utf8Bytes, versionSchema, withinScalarLimit
} from "./contract";
import { reviewToolNameSchema, validateReviewEnvelope } from "./envelope";
import type { ReaderFinding, ReaderRun } from "./findings";
import { bibleIdentitySchema } from "./sources";
import { categorySchema, profileSchema, type ReaderProfile } from "./profiles";
import { citationSchema } from "./wire-schema";
import { ReviewRecordError } from "./record-error";
import {
  canonicalJsonText, decodeStrictJsonBytes, encodeCanonicalJson, REVIEW_RECORD_BYTES, REVIEW_RECORD_DEPTH
} from "./record-json";

/**
 * Field-level schema 1 for explicit saved review records (039 T014 / D-199 / ADR 0020).
 *
 * These are pure formats and builders: no storage, clock, provider or Library access. Unknown plain
 * fields survive at every depth; a record this build cannot read or honestly rewrite is refused
 * rather than repaired. See `docs/FORMAT.md` ("Saved review records") for the normative field list.
 */

export const REVIEW_RECORD_SCHEMA_VERSION = 1 as const;

export const REVIEW_RECORD_LIMITS = Object.freeze({
  bytes: REVIEW_RECORD_BYTES,
  depth: REVIEW_RECORD_DEPTH,
  books: REVIEW_LIMITS.books,
  sources: REVIEW_LIMITS.items,
  segmentsPerSource: 64,
  findings: REVIEW_LIMITS.findings,
  evidencePerFinding: REVIEW_LIMITS.evidence,
  quoteScalars: REVIEW_LIMITS.quoteScalars,
  interpretationScalars: REVIEW_LIMITS.interpretationScalars,
  dispositionEventsPerFinding: 200,
  campaignSources: 64,
  campaignStages: 64,
  campaignPlannedSpans: 64,
  campaignSynthesisStages: 64,
  listPageSize: 200
});

/**
 * File-stem identity. Host IDs are ordinary `idSchema` values; a record additionally has to be a
 * portable file name, so path separators, a trailing dot and `..` are refused instead of rewritten.
 */
export const recordIdSchema = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use letters, digits, dots, dashes and underscores.")
  .refine((value) => !value.includes("..") && !value.endsWith("."), "Not a portable file name.");

/** Record-level timestamps are UTC with exactly millisecond precision, like the workflow records. */
export const recordTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "Use a UTC ISO timestamp with milliseconds.")
  .refine((value) => Number.isFinite(Date.parse(value)), "Not a real timestamp.");

const ownerSchema = z.strictObject({ bookId: bookIdSchema });
const baseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent"), revision: z.literal(0) }),
  z.strictObject({ kind: z.literal("sha256"), value: hashSchema, revision: versionSchema })
]);

export type ReviewRecordOwner = z.infer<typeof ownerSchema>;
export type ReviewRecordBase = z.infer<typeof baseSchema>;

function issue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

/** Checked records carry the exact previous raw hash; immutable reports carry none. */
function checkBase(revision: number, base: ReviewRecordBase | undefined): string | null {
  if (revision === 1) {
    if (base?.kind !== "absent" || base.revision !== 0) return "A new record must start absent.";
    return null;
  }
  if (base?.kind !== "sha256") return "A later revision needs the exact previous file hash.";
  if (base.revision !== revision - 1) return "The base revision must be exactly one behind.";
  return null;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/* ------------------------------------------------------------------ report */

const chapterCoverageSchema = z.looseObject({
  kind: z.literal("chapter"),
  sourceId: idSchema,
  bookId: bookIdSchema,
  chapterId: chapterIdSchema,
  bookTitle: textSchema,
  title: textSchema,
  position: versionSchema,
  version: versionSchema,
  hash: hashSchema,
  capturedAt: timestampSchema,
  bodyLength: integerSchema,
  segments: z.array(spanSchema).min(1).max(REVIEW_RECORD_LIMITS.segmentsPerSource),
  bytes: integerSchema.max(REVIEW_LIMITS.sourceBytes),
  selectedScalars: integerSchema.max(REVIEW_LIMITS.sourceBytes)
});

const bibleCoverageSchema = z.looseObject({
  kind: z.literal("story-bible"),
  sourceId: idSchema,
  bookId: bookIdSchema,
  bookTitle: textSchema,
  label: textSchema,
  field: bibleIdentitySchema,
  capturedAt: timestampSchema,
  containingFileHash: hashSchema,
  valueDigest: hashSchema,
  length: integerSchema,
  bytes: integerSchema.max(REVIEW_LIMITS.sourceBytes),
  selectedScalars: integerSchema.max(REVIEW_LIMITS.sourceBytes)
});

export const reportSourceSchema = z.discriminatedUnion("kind", [chapterCoverageSchema, bibleCoverageSchema]);
export type ReportSource = z.infer<typeof reportSourceSchema>;

const reportBookSchema = z.looseObject({
  bookId: bookIdSchema,
  title: textSchema,
  consentRevision: textSchema.min(1),
  termsRevision: textSchema.min(1),
  enabledTools: z.array(reviewToolNameSchema).max(6).refine(unique)
});

const evidenceSchema = z.looseObject({ citation: citationSchema, label: textSchema });
const invalidEvidenceSchema = z.looseObject({
  index: integerSchema.max(REVIEW_LIMITS.evidence - 1),
  reason: z.enum(["shape", "source", "revision", "range", "quote"])
});

export const reportFindingSchema = z.looseObject({
  findingId: idSchema,
  category: categorySchema,
  readerId: idSchema,
  readerVersion: versionSchema,
  runId: idSchema,
  interpretation: textSchema.refine((value) => withinScalarLimit(value, REVIEW_LIMITS.interpretationScalars)),
  subjective: z.literal(true),
  claim: z.enum(["observation", "question", "contradiction"]),
  evidence: z.array(evidenceSchema).max(REVIEW_RECORD_LIMITS.evidencePerFinding),
  invalidEvidence: z.array(invalidEvidenceSchema).max(REVIEW_RECORD_LIMITS.evidencePerFinding),
  evidenceState: z.enum(["complete", "incomplete-evidence", "insufficient-evidence"])
});

export const reviewReportSchema = z
  .looseObject({
    schemaVersion: z.literal(1),
    kind: z.literal("review-report"),
    owner: ownerSchema,
    id: recordIdSchema,
    revision: z.literal(1),
    reportKind: z.literal("reader-review"),
    run: z.strictObject({ startedAt: timestampSchema, completedAt: timestampSchema }),
    savedAt: recordTimestampSchema,
    analyzer: z.strictObject({
      provider: textSchema.min(1),
      model: textSchema.min(1),
      endpointIdentity: textSchema.min(1)
    }),
    profile: profileSchema,
    books: z.array(reportBookSchema).min(1).max(REVIEW_RECORD_LIMITS.books),
    disclosure: z.strictObject({
      contractVersion: z.literal(1),
      requestId: idSchema,
      scopeDigest: hashSchema,
      capturedAt: timestampSchema,
      promptDigest: hashSchema,
      priorFeedback: z.strictObject({ count: integerSchema, digest: hashSchema })
    }),
    sources: z.array(reportSourceSchema).min(1).max(REVIEW_RECORD_LIMITS.sources),
    coverage: z.strictObject({
      books: versionSchema,
      sources: versionSchema,
      items: versionSchema,
      sourceBytes: integerSchema.max(REVIEW_LIMITS.sourceBytes),
      contentBytes: integerSchema.max(REVIEW_LIMITS.contentBytes)
    }),
    findings: z.array(reportFindingSchema).max(REVIEW_RECORD_LIMITS.findings),
    verification: z.literal("verified-at-capture")
  })
  .superRefine((report, context) => {
    if (report.id !== report.disclosure.requestId) issue(context, ["id"], "The report is not its run.");
    if (!unique(report.books.map((book) => book.bookId))) issue(context, ["books"], "A book is named twice.");
    if (!unique(report.sources.map((source) => source.sourceId))) issue(context, ["sources"], "A source is named twice.");
    if (!unique(report.findings.map((finding) => finding.findingId))) {
      issue(context, ["findings"], "A finding ID is repeated.");
    }
    const books = new Set(report.books.map((book) => book.bookId));
    if (!books.has(report.owner.bookId)) {
      issue(context, ["owner", "bookId"], "A saved report must live in one of the books it reviewed.");
    }
    const sourceBooks = new Set(report.sources.map((source) => source.bookId));
    if (sourceBooks.size !== books.size || [...sourceBooks].some((bookId) => !books.has(bookId))) {
      issue(context, ["books"], "The disclosed books and selected sources disagree.");
    }
    const items = report.sources.reduce(
      (total, source) => total + (source.kind === "chapter" ? source.segments.length : 1),
      0
    );
    const sourceBytes = report.sources.reduce((total, source) => total + source.bytes, 0);
    if (report.coverage.books !== report.books.length) issue(context, ["coverage", "books"], "The book count is wrong.");
    if (report.coverage.sources !== report.sources.length) issue(context, ["coverage", "sources"], "The source count is wrong.");
    if (report.coverage.items !== items) issue(context, ["coverage", "items"], "The selected item count is wrong.");
    if (items > REVIEW_LIMITS.items) {
      issue(context, ["coverage", "items"], "The selected item count exceeds the review limit.");
    }
    if (report.coverage.sourceBytes !== sourceBytes) {
      issue(context, ["coverage", "sourceBytes"], "The selected byte count is wrong.");
    }
    if (report.coverage.contentBytes < sourceBytes) {
      issue(context, ["coverage", "contentBytes"], "Content bytes cannot be fewer than the selected source bytes.");
    }
    if (Date.parse(report.run.completedAt) < Date.parse(report.run.startedAt)) {
      issue(context, ["run"], "The run cannot finish before it starts.");
    }
    if (Date.parse(report.savedAt) < Date.parse(report.run.completedAt)) {
      issue(context, ["savedAt"], "A report cannot be saved before its run finished.");
    }
    const byId = new Map(report.sources.map((source) => [source.sourceId, source]));
    const identities = new Set<string>();
    for (const source of report.sources) {
      const identity = canonicalJson(
        source.kind === "chapter" ? [source.bookId, "chapter", source.chapterId] : [source.bookId, "story-bible", source.field]
      );
      if (identities.has(identity)) issue(context, ["sources"], "The same source content is selected twice.");
      identities.add(identity);
      if (source.kind === "chapter") {
        let previousEnd = -1;
        for (const segment of source.segments) {
          if (segment.start <= previousEnd || segment.end <= segment.start || segment.end > source.bodyLength) {
            issue(context, ["sources"], "A selected range is invalid or out of order.");
          }
          previousEnd = segment.end;
        }
      }
    }
    report.findings.forEach((finding, index) => {
      const path = ["findings", index];
      if (finding.runId !== report.id) issue(context, [...path, "runId"], "The finding belongs to another run.");
      if (finding.readerId !== report.profile.id) issue(context, [...path, "readerId"], "The finding names another lens.");
      if (finding.readerVersion !== report.profile.version) {
        issue(context, [...path, "readerVersion"], "The finding names another lens version.");
      }
      if (finding.claim === "contradiction" && finding.category !== "continuity") {
        issue(context, [...path, "claim"], "Only a continuity claim can be a contradiction.");
      }
      finding.evidence.forEach((item, evidenceIndex) => {
        const evidencePath = [...path, "evidence", evidenceIndex];
        const citation = item.citation;
        const source = byId.get(citation.sourceId);
        if (!source || source.kind !== citation.kind) {
          issue(context, evidencePath, "The quote names a source this report did not capture.");
          return;
        }
        if (citation.quote.length !== citation.end - citation.start || citation.quote.length === 0) {
          issue(context, [...evidencePath, "quote"], "The quote does not match its selected range.");
        }
        if (source.kind === "chapter" && citation.kind === "chapter") {
          if (
            citation.identity.bookId !== source.bookId ||
            citation.identity.chapterId !== source.chapterId ||
            citation.identity.version !== source.version ||
            citation.identity.hash !== source.hash
          ) {
            issue(context, [...evidencePath, "identity"], "The quote names another revision.");
          }
          if (citation.end > source.bodyLength) issue(context, evidencePath, "The quote is outside the saved body.");
          if (!source.segments.some((segment) => citation.start >= segment.start && citation.end <= segment.end)) {
            issue(context, evidencePath, "The quote is outside the selected range.");
          }
        }
        if (source.kind === "story-bible" && citation.kind === "story-bible") {
          if (
            citation.bookId !== source.bookId ||
            canonicalJson(citation.field) !== canonicalJson(source.field) ||
            citation.valueDigest !== source.valueDigest ||
            citation.containingFileHash !== source.containingFileHash
          ) {
            issue(context, [...evidencePath, "identity"], "The quote names another Story Bible value.");
          }
          if (citation.end > source.length) issue(context, evidencePath, "The quote is outside the selected value.");
        }
      });
      const distinct = new Set(finding.evidence.map((item) => canonicalJson(item.citation))).size;
      const insufficient = finding.evidence.length === 0 || (finding.claim === "contradiction" && distinct < 2);
      const expected = insufficient
        ? "insufficient-evidence"
        : finding.invalidEvidence.length > 0
          ? "incomplete-evidence"
          : "complete";
      if (finding.evidenceState !== expected) {
        issue(context, [...path, "evidenceState"], "The finding's evidence state is not what its evidence supports.");
      }
    });
  });

export type ReviewReport = z.infer<typeof reviewReportSchema>;

/* ------------------------------------------------------------- dispositions */

export const dispositionStateSchema = z.enum(["open", "ignored", "author-resolved", "reopened"]);
export type DispositionState = z.infer<typeof dispositionStateSchema>;

const dispositionEventSchema = z.looseObject({
  sequence: versionSchema,
  at: recordTimestampSchema,
  action: z.enum(["set", "ignore", "resolve", "reopen"]),
  from: dispositionStateSchema.nullable(),
  to: dispositionStateSchema,
  note: textSchema.refine((value) => withinScalarLimit(value, 2_000)).optional()
});

const dispositionEntrySchema = z.looseObject({
  findingId: idSchema,
  state: dispositionStateSchema,
  updatedAt: recordTimestampSchema,
  events: z.array(dispositionEventSchema).min(1).max(REVIEW_RECORD_LIMITS.dispositionEventsPerFinding)
});

export const reviewDispositionsSchema = z
  .looseObject({
    schemaVersion: z.literal(1),
    kind: z.literal("review-dispositions"),
    owner: ownerSchema,
    id: recordIdSchema,
    revision: versionSchema,
    base: baseSchema,
    report: z.strictObject({ runId: idSchema, hash: hashSchema, completedAt: timestampSchema }),
    dispositions: z.array(dispositionEntrySchema).min(1).max(REVIEW_RECORD_LIMITS.findings),
    createdAt: recordTimestampSchema,
    updatedAt: recordTimestampSchema
  })
  .superRefine((record, context) => {
    const baseProblem = checkBase(record.revision, record.base);
    if (baseProblem) issue(context, ["base"], baseProblem);
    if (record.report.runId !== record.id) issue(context, ["report", "runId"], "The dispositions belong to another run.");
    if (!unique(record.dispositions.map((entry) => entry.findingId))) {
      issue(context, ["dispositions"], "A finding ID is repeated.");
    }
    const ordered = record.dispositions.every((entry, index) => {
      const previous = record.dispositions[index - 1];
      return previous === undefined || previous.findingId < entry.findingId;
    });
    if (!ordered) issue(context, ["dispositions"], "Dispositions must be ordered by finding ID.");
    if (Date.parse(record.createdAt) > Date.parse(record.updatedAt)) {
      issue(context, ["updatedAt"], "A record cannot be updated before it was created.");
    }
    record.dispositions.forEach((entry, index) => {
      const path = ["dispositions", index];
      if (entry.events.length === 0) issue(context, [...path, "events"], "A disposition needs an event.");
      let previousTo: DispositionState | null = null;
      let previousAt = Number.NEGATIVE_INFINITY;
      entry.events.forEach((event, eventIndex) => {
        const eventPath = [...path, "events", eventIndex];
        if (event.sequence !== eventIndex + 1) issue(context, [...eventPath, "sequence"], "Event order is broken.");
        if (event.from !== previousTo) issue(context, [...eventPath, "from"], "An event does not continue the history.");
        if (Date.parse(event.at) < previousAt) issue(context, [...eventPath, "at"], "Events are out of order.");
        const expectedAction =
          event.to === "ignored" ? "ignore" : event.to === "author-resolved" ? "resolve" : event.to === "reopened" ? "reopen" : "set";
        if (event.action !== expectedAction) issue(context, [...eventPath, "action"], "The event action and state disagree.");
        previousTo = event.to;
        previousAt = Date.parse(event.at);
      });
      const last = entry.events[entry.events.length - 1];
      if (!last) return;
      if (last.to !== entry.state) issue(context, [...path, "state"], "The state is not the last event.");
      if (last.at !== entry.updatedAt) issue(context, [...path, "updatedAt"], "The update time is not the last event.");
    });
  });

export type ReviewDispositions = z.infer<typeof reviewDispositionsSchema>;

/* ----------------------------------------------------------------- profile */

export const readerProfileRecordSchema = z
  .looseObject({
    schemaVersion: z.literal(1),
    kind: z.literal("reader-profile-record"),
    owner: ownerSchema,
    id: recordIdSchema,
    revision: versionSchema,
    base: baseSchema,
    profile: profileSchema,
    createdAt: recordTimestampSchema,
    updatedAt: recordTimestampSchema
  })
  .superRefine((record, context) => {
    const baseProblem = checkBase(record.revision, record.base);
    if (baseProblem) issue(context, ["base"], baseProblem);
    if (record.profile.id !== record.id) issue(context, ["id"], "The record is not its lens.");
    if (record.profile.origin !== "author") issue(context, ["profile", "origin"], "Built-in lenses need no file.");
    if (Date.parse(record.createdAt) > Date.parse(record.updatedAt)) {
      issue(context, ["updatedAt"], "A record cannot be updated before it was created.");
    }
  });

export type ReaderProfileRecord = z.infer<typeof readerProfileRecordSchema>;

/* ---------------------------------------------------------------- campaign */

const campaignSourceSchema = z.looseObject({
  sourceId: idSchema,
  bookId: bookIdSchema,
  chapterId: chapterIdSchema,
  title: textSchema,
  position: versionSchema,
  version: versionSchema,
  hash: hashSchema,
  planned: z.array(spanSchema).min(1).max(REVIEW_RECORD_LIMITS.campaignPlannedSpans)
});

const campaignReportRefSchema = z.strictObject({ runId: idSchema, hash: hashSchema });

const campaignStageSchema = z.looseObject({
  stageId: idSchema,
  kind: z.enum(["range", "synthesis"]),
  sourceIds: z.array(idSchema).max(REVIEW_RECORD_LIMITS.campaignSources),
  planned: z.array(spanSchema).max(REVIEW_RECORD_LIMITS.campaignPlannedSpans),
  status: z.enum(["planned", "running", "completed", "incomplete", "failed", "stopped"]),
  report: campaignReportRefSchema.nullable(),
  at: recordTimestampSchema.nullable()
});

const campaignSynthesisSchema = z.looseObject({
  stageId: idSchema,
  sourceStageIds: z.array(idSchema).min(1).max(REVIEW_RECORD_LIMITS.campaignStages),
  // An unfinished synthesis has no saved report yet; a completed stage must name one.
  report: campaignReportRefSchema.nullable()
});

export const reviewCampaignSchema = z
  .looseObject({
    schemaVersion: z.literal(1),
    kind: z.literal("review-campaign"),
    owner: ownerSchema,
    id: recordIdSchema,
    revision: versionSchema,
    base: baseSchema,
    status: z.enum(["planned", "running", "incomplete", "complete"]),
    profile: z.strictObject({ id: idSchema, version: versionSchema, digest: hashSchema }),
    plan: z.strictObject({
      plannedAt: recordTimestampSchema,
      sources: versionSchema,
      items: versionSchema,
      sourceBytes: integerSchema.max(REVIEW_RECORD_BYTES)
    }),
    sources: z.array(campaignSourceSchema).min(1).max(REVIEW_RECORD_LIMITS.campaignSources),
    stages: z.array(campaignStageSchema).min(1).max(REVIEW_RECORD_LIMITS.campaignStages),
    synthesis: z.array(campaignSynthesisSchema).max(REVIEW_RECORD_LIMITS.campaignSynthesisStages),
    createdAt: recordTimestampSchema,
    updatedAt: recordTimestampSchema
  })
  .superRefine((record, context) => {
    const baseProblem = checkBase(record.revision, record.base);
    if (baseProblem) issue(context, ["base"], baseProblem);
    if (!unique(record.sources.map((source) => source.sourceId))) issue(context, ["sources"], "A source is repeated.");
    if (!unique(record.sources.map((source) => source.chapterId))) {
      issue(context, ["sources"], "A chapter is named twice.");
    }
    if (!unique(record.stages.map((stage) => stage.stageId))) issue(context, ["stages"], "A stage ID is repeated.");
    if (record.plan.sources !== record.sources.length) issue(context, ["plan", "sources"], "The source count is wrong.");
    const plannedItems = record.sources.reduce((total, source) => total + source.planned.length, 0);
    if (record.plan.items !== plannedItems) issue(context, ["plan", "items"], "The planned item count is wrong.");
    const sourceIds = new Set(record.sources.map((source) => source.sourceId));
    const stageIds = new Set(record.stages.map((stage) => stage.stageId));
    const reportRuns = new Set<string>();
    for (const [index, stage] of record.stages.entries()) {
      const path = ["stages", index];
      if (stage.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
        issue(context, [...path, "sourceIds"], "A stage names an unplanned source.");
      }
      if (stage.kind === "range" && stage.planned.length === 0) {
        issue(context, [...path, "planned"], "A range stage needs planned spans.");
      }
      if (stage.kind === "synthesis" && stage.planned.length > 0) {
        issue(context, [...path, "planned"], "A synthesis stage plans no source spans.");
      }
      if (stage.status === "completed" && !stage.report) {
        issue(context, [...path, "report"], "A completed stage needs its saved report.");
      }
      if (stage.at !== null && Date.parse(stage.at) < Date.parse(record.plan.plannedAt)) {
        issue(context, [...path, "at"], "A stage cannot complete before its plan.");
      }
      if (stage.report) {
        if (reportRuns.has(stage.report.runId)) issue(context, [...path, "report"], "A report is used twice.");
        reportRuns.add(stage.report.runId);
      }
    }
    if (!unique(record.synthesis.map((entry) => entry.stageId))) {
      issue(context, ["synthesis"], "A synthesis stage is described twice.");
    }
    for (const [index, entry] of record.synthesis.entries()) {
      const path = ["synthesis", index];
      const stage = record.stages.find((candidate) => candidate.stageId === entry.stageId);
      if (!stageIds.has(entry.stageId)) issue(context, [...path, "stageId"], "The synthesis stage does not exist.");
      else if (stage?.kind !== "synthesis") {
        issue(context, [...path, "stageId"], "A synthesis description must name a synthesis stage.");
      }
      if (!unique(entry.sourceStageIds)) issue(context, [...path, "sourceStageIds"], "A source stage is repeated.");
      if (entry.sourceStageIds.some((stageId) => !stageIds.has(stageId) || stageId === entry.stageId)) {
        issue(context, [...path, "sourceStageIds"], "A synthesis source stage does not exist.");
      }
      // The description and its stage must agree: one synthesis cannot persist two results.
      if (stage?.report) {
        if (!entry.report || entry.report.runId !== stage.report.runId || entry.report.hash !== stage.report.hash) {
          issue(context, [...path, "report"], "A synthesis description must name its stage's saved report.");
        }
      }
      if (stage?.status === "completed" && !entry.report) {
        issue(context, [...path, "report"], "A completed synthesis needs its saved report.");
      }
      if (entry.report) {
        if (entry.report.runId !== stage?.report?.runId && reportRuns.has(entry.report.runId)) {
          issue(context, [...path, "report"], "A report is used twice.");
        }
        reportRuns.add(entry.report.runId);
      }
    }
    const synthesisStages = record.stages.filter((stage) => stage.kind === "synthesis");
    if (synthesisStages.length !== record.synthesis.length) {
      issue(context, ["synthesis"], "Every synthesis stage needs one description.");
    }
    if (record.status === "complete") {
      if (record.stages.some((stage) => stage.status !== "completed" || !stage.report)) {
        issue(context, ["status"], "A complete campaign has no open stage.");
      }
      if (record.synthesis.some((entry) => !entry.report)) {
        issue(context, ["status"], "A complete campaign needs its synthesis reports.");
      }
    }
    if (Date.parse(record.createdAt) > Date.parse(record.updatedAt)) {
      issue(context, ["updatedAt"], "A record cannot be updated before it was created.");
    }
  });

export type ReviewCampaign = z.infer<typeof reviewCampaignSchema>;

/* ------------------------------------------------------------------- kinds */

export const REVIEW_RECORD_KINDS = [
  "review-report",
  "review-dispositions",
  "reader-profile-record",
  "review-campaign"
] as const;
export type ReviewRecordKind = (typeof REVIEW_RECORD_KINDS)[number];

const schemas = {
  "review-report": reviewReportSchema,
  "review-dispositions": reviewDispositionsSchema,
  "reader-profile-record": readerProfileRecordSchema,
  "review-campaign": reviewCampaignSchema
} as const;

export type ReviewRecordFor<K extends ReviewRecordKind> = z.infer<(typeof schemas)[K]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A closed semantic union that gained a member is readable but not rewritable by this build. Saying
 * "corrupt" would invite a rewrite; "unsupported" keeps the file untouched for a newer app.
 */
function assertSupportedSemantics(kind: ReviewRecordKind, raw: Record<string, unknown>): void {
  const unsupported = (field: string): never => {
    throw new ReviewRecordError(
      "unsupported",
      `This review record uses a ${field} this version of Open Book Studio does not understand. Update the app to open it. The file was left untouched.`
    );
  };
  const check = (value: unknown, allowed: readonly string[], field: string): void => {
    if (typeof value === "string" && !allowed.includes(value)) unsupported(field);
  };
  if (kind === "review-report") {
    check(raw.reportKind, ["reader-review"], "report kind");
    const findings = Array.isArray(raw.findings) ? raw.findings : [];
    for (const finding of findings) {
      if (!isRecord(finding)) continue;
      check(finding.claim, ["observation", "question", "contradiction"], "finding claim");
      check(finding.evidenceState, ["complete", "incomplete-evidence", "insufficient-evidence"], "evidence state");
      check(finding.category, categorySchema.options, "finding category");
    }
    const sources = Array.isArray(raw.sources) ? raw.sources : [];
    for (const source of sources) {
      if (isRecord(source)) check(source.kind, ["chapter", "story-bible"], "source kind");
    }
    const books = Array.isArray(raw.books) ? raw.books : [];
    for (const book of books) {
      if (!isRecord(book) || !Array.isArray(book.enabledTools)) continue;
      for (const tool of book.enabledTools) check(tool, reviewToolNameSchema.options, "review tool");
    }
  }
  if (kind === "review-dispositions") {
    const entries = Array.isArray(raw.dispositions) ? raw.dispositions : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      check(entry.state, dispositionStateSchema.options, "disposition state");
      const events = Array.isArray(entry.events) ? entry.events : [];
      for (const event of events) {
        if (isRecord(event)) check(event.action, ["set", "ignore", "resolve", "reopen"], "disposition action");
      }
    }
  }
  if (kind === "reader-profile-record" && isRecord(raw.profile)) {
    check(raw.profile.origin, ["builtin", "author"], "lens origin");
    const lensMembers = new Set(["name", "purpose", "focus", "guidance", "id", "origin", "version", "digest"]);
    if (Object.keys(raw.profile).some((member) => !lensMembers.has(member))) unsupported("lens member");
  }
  if (kind === "review-campaign") {
    check(raw.status, ["planned", "running", "incomplete", "complete"], "campaign status");
    const stages = Array.isArray(raw.stages) ? raw.stages : [];
    for (const stage of stages) {
      if (!isRecord(stage)) continue;
      check(stage.kind, ["range", "synthesis"], "campaign stage kind");
      check(stage.status, ["planned", "running", "completed", "incomplete", "failed", "stopped"], "campaign stage status");
    }
  }
}

export interface DecodeReviewRecordOptions<K extends ReviewRecordKind> {
  kind: K;
  bookId: string;
  /** Test/recovery override; the record ceiling still applies. */
  maxBytes?: number;
  /** Only a `conflicts/` copy may carry `conflictMetadata`. */
  allowConflictMetadata?: boolean;
}

export interface DecodedReviewRecord<K extends ReviewRecordKind> {
  record: ReviewRecordFor<K>;
  raw: Record<string, unknown>;
  bytes: Uint8Array;
}

/** Parse exact bytes and prove they are this build's active schema-1 record for this kind and book. */
export function decodeReviewRecord<K extends ReviewRecordKind>(
  bytes: Uint8Array,
  options: DecodeReviewRecordOptions<K>
): DecodedReviewRecord<K> {
  if (!bookIdSchema.safeParse(options.bookId).success) {
    throw new ReviewRecordError("invalid", "The owning book ID is not valid.");
  }
  const raw = decodeStrictJsonBytes(bytes, {
    maxDepth: REVIEW_RECORD_DEPTH,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
  });
  if (!isRecord(raw)) {
    throw new ReviewRecordError("corrupt", "This review file is not one JSON object. The file was left untouched.");
  }
  const version = raw.schemaVersion;
  if (typeof version === "number" && Number.isSafeInteger(version) && version > REVIEW_RECORD_SCHEMA_VERSION) {
    throw new ReviewRecordError(
      "newer-schema",
      "This review record was written by a newer version of Open Book Studio. Update the app to open it. The file was left untouched."
    );
  }
  if (version !== REVIEW_RECORD_SCHEMA_VERSION) {
    throw new ReviewRecordError("corrupt", "This review record has no supported schema version. The file was left untouched.");
  }
  if (raw.kind !== options.kind) {
    throw new ReviewRecordError("corrupt", "This review file is not the record its location promises. The file was left untouched.");
  }
  if (Object.hasOwn(raw, "conflictMetadata") && !options.allowConflictMetadata) {
    throw new ReviewRecordError("invalid", "A recovery copy cannot be used as an active review record.");
  }
  const owner = raw.owner;
  if (!isRecord(owner) || Object.keys(owner).length !== 1 || owner.bookId !== options.bookId) {
    throw new ReviewRecordError("corrupt", "This review record belongs to another book. The file was left untouched.");
  }
  if (!recordIdSchema.safeParse(raw.id).success) {
    throw new ReviewRecordError("corrupt", "This review record's identity is not a safe file name. The file was left untouched.");
  }
  if (options.kind === "review-report") {
    if (Object.hasOwn(raw, "base") || raw.revision !== 1) {
      throw new ReviewRecordError("corrupt", "A saved report is immutable. The file was left untouched.");
    }
  }
  assertSupportedSemantics(options.kind, raw);
  const parsed = schemas[options.kind].safeParse(raw);
  if (!parsed.success) {
    throw new ReviewRecordError(
      "corrupt",
      "This review record has unsupported or invalid fields. The file was left untouched."
    );
  }
  return { record: raw as ReviewRecordFor<K>, raw, bytes };
}

/**
 * Canonical bytes, proven readable by `decodeReviewRecord` before any caller can commit them. The
 * record's owner supplies the expected book; a malformed owner refuses rather than guessing.
 */
export function encodeReviewRecord<K extends ReviewRecordKind>(
  kind: K,
  value: unknown,
  options: { maxBytes?: number; copy?: boolean } = {}
): Uint8Array {
  if (!isRecord(value)) throw new ReviewRecordError("invalid", "A review record must be one JSON object. Nothing was written.");
  const owner = value.owner;
  if (!isRecord(owner) || typeof owner.bookId !== "string") {
    throw new ReviewRecordError("invalid", "A review record must name its owning book. Nothing was written.");
  }
  const bytes = encodeCanonicalJson(value, {
    maxDepth: REVIEW_RECORD_DEPTH,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
  });
  decodeReviewRecord(bytes, {
    kind,
    bookId: owner.bookId,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    allowConflictMetadata: options.copy === true
  });
  return bytes;
}

/** Deterministic bytes of an already-decoded active record (no semantic change). */
export function activeRecordBytes<K extends ReviewRecordKind>(decoded: DecodedReviewRecord<K>): Uint8Array {
  return encodeReviewRecord(decoded.record.kind as K, decoded.record);
}

export function reportRecordBytes(report: ReviewReport): Uint8Array {
  return encodeReviewRecord("review-report", report);
}

export function dispositionsBytes(record: ReviewDispositions): Uint8Array {
  return encodeReviewRecord("review-dispositions", record);
}

export function profileRecordBytes(record: ReaderProfileRecord): Uint8Array {
  return encodeReviewRecord("reader-profile-record", record);
}

export function campaignBytes(record: ReviewCampaign): Uint8Array {
  return encodeReviewRecord("review-campaign", record);
}

/* ---------------------------------------------------------------- builders */

export interface ReportBuildInput {
  ownerBookId: string;
  run: ReaderRun;
  savedAt: string;
  sha256: (text: string) => Promise<string>;
}

/**
 * Project a validated volatile run into the immutable saved report: source revision/coverage facts
 * and bounded quotations, never a chapter body, prompt text or provider wire payload. Quote text is
 * not re-verifiable after save because bodies are deliberately absent; the report records that its
 * quotations were verified at capture and keeps identity/range facts a reader can still check.
 */
export async function buildReviewReport(input: ReportBuildInput): Promise<ReviewReport> {
  const envelope = await validateReviewEnvelope(input.run.envelope);
  const profile = envelope.profile;
  if (!profile) throw new ReviewRecordError("invalid", "A reader review needs its lens snapshot. Nothing was written.");
  if (!envelope.books.some((book) => book.bookId === input.ownerBookId)) {
    throw new ReviewRecordError("invalid", "A report must live in one of the books it reviewed. Nothing was written.");
  }
  if (input.run.runId !== envelope.requestId) {
    throw new ReviewRecordError("invalid", "The run and its disclosure disagree. Nothing was written.");
  }
  recordTimestampSchema.parse(input.savedAt);
  if (!recordIdSchema.safeParse(envelope.requestId).success) {
    throw new ReviewRecordError("invalid", "This run ID is not a portable file name. Nothing was written.");
  }

  const sources = envelope.sources.map((source) => {
    if (source.kind === "chapter") {
      const segments = source.segments.map((segment) => ({ start: segment.start, end: segment.end }));
      return {
        kind: "chapter" as const,
        sourceId: source.sourceId,
        bookId: source.identity.bookId,
        chapterId: source.identity.chapterId,
        bookTitle: source.bookTitle,
        title: source.title,
        position: source.position,
        version: source.identity.version,
        hash: source.identity.hash,
        capturedAt: source.capturedAt,
        bodyLength: source.bodyLength,
        segments,
        bytes: source.segments.reduce((total, segment) => total + utf8Bytes(segment.text), 0),
        selectedScalars: source.segments.reduce((total, segment) => total + scalarCount(segment.text), 0)
      };
    }
    return {
      kind: "story-bible" as const,
      sourceId: source.sourceId,
      bookId: source.bookId,
      bookTitle: source.bookTitle,
      label: source.label,
      field: structuredClone(source.field),
      capturedAt: source.capturedAt,
      containingFileHash: source.containingFileHash,
      valueDigest: source.valueDigest,
      length: source.text.length,
      bytes: utf8Bytes(source.text),
      selectedScalars: scalarCount(source.text)
    };
  });
  const items = sources.reduce(
    (total, source) => total + (source.kind === "chapter" ? source.segments.length : 1),
    0
  );
  const sourceBytes = sources.reduce((total, source) => total + source.bytes, 0);
  const profileBytes = utf8Bytes(profile.name + profile.purpose + profile.guidance + profile.focus.join(""));
  const feedbackBytes = envelope.priorFeedback.reduce((total, feedback) => total + utf8Bytes(feedback.text), 0);
  const contentBytes = sourceBytes + utf8Bytes(envelope.prompt) + profileBytes + feedbackBytes;

  const findings = input.run.findings.map((finding: ReaderFinding) => ({
    findingId: finding.findingId,
    category: finding.category,
    readerId: finding.readerId,
    readerVersion: finding.readerVersion,
    runId: finding.runId,
    interpretation: finding.interpretation,
    subjective: true as const,
    claim: finding.claim,
    evidence: finding.evidence.map((entry) => structuredClone({ citation: entry.citation, label: entry.label })),
    invalidEvidence: finding.invalidEvidence.map((entry) => ({ index: entry.index, reason: entry.reason })),
    evidenceState: finding.evidenceState
  }));

  const report = {
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    kind: "review-report" as const,
    owner: { bookId: input.ownerBookId },
    id: envelope.requestId,
    revision: 1 as const,
    reportKind: "reader-review" as const,
    run: { startedAt: input.run.startedAt, completedAt: input.run.completedAt },
    savedAt: input.savedAt,
    analyzer: {
      provider: envelope.destination.provider,
      model: envelope.destination.model,
      endpointIdentity: envelope.destination.endpointIdentity
    },
    profile: structuredClone(profile),
    books: envelope.books.map((book) => ({
      bookId: book.bookId,
      title: book.title,
      consentRevision: book.consentRevision,
      termsRevision: book.termsRevision,
      enabledTools: [...book.enabledTools]
    })),
    disclosure: {
      contractVersion: 1 as const,
      requestId: envelope.requestId,
      scopeDigest: envelope.scopeDigest,
      capturedAt: envelope.capturedAt,
      promptDigest: await input.sha256(envelope.prompt),
      priorFeedback: {
        count: envelope.priorFeedback.length,
        digest: await input.sha256(canonicalJson(envelope.priorFeedback))
      }
    },
    sources,
    coverage: { books: envelope.books.length, sources: sources.length, items, sourceBytes, contentBytes },
    findings,
    verification: "verified-at-capture" as const
  };
  const parsed = reviewReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new ReviewRecordError("invalid", "The saved report disagrees with the run it came from. Nothing was written.");
  }
  return report as ReviewReport;
}

export interface NewDispositionsInput {
  bookId: string;
  runId: string;
  reportHash: string;
  completedAt: string;
  at: string;
}

/** Revision-1 empty disposition document; the store adds the first event before saving. */
export function newDispositionsRecord(input: NewDispositionsInput): ReviewDispositions {
  const record = {
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    kind: "review-dispositions" as const,
    owner: { bookId: input.bookId },
    id: input.runId,
    revision: 1,
    base: { kind: "absent" as const, revision: 0 as const },
    report: { runId: input.runId, hash: input.reportHash, completedAt: input.completedAt },
    dispositions: [],
    createdAt: input.at,
    updatedAt: input.at
  };
  // The schema requires at least one entry; the store only encodes after applying the first change.
  return record;
}

export interface DispositionChange {
  findingId: string;
  state: DispositionState;
  at: string;
  note?: string;
}

function actionFor(state: DispositionState): "set" | "ignore" | "resolve" | "reopen" {
  return state === "ignored" ? "ignore" : state === "author-resolved" ? "resolve" : state === "reopened" ? "reopen" : "set";
}

/**
 * Append-only author event history. Root, entry and event unknown fields are carried through by
 * spreading the records this build read; no field is dropped to normalize the document.
 */
export function applyDispositionEvent(
  record: ReviewDispositions,
  change: DispositionChange
): { record: ReviewDispositions; changed: boolean } {
  idSchema.parse(change.findingId);
  dispositionStateSchema.parse(change.state);
  recordTimestampSchema.parse(change.at);
  if (change.note !== undefined && !withinScalarLimit(change.note, 2_000)) {
    throw new ReviewRecordError("invalid", "The disposition note is too long. Nothing was written.");
  }
  if (Date.parse(change.at) < Date.parse(record.updatedAt)) {
    throw new ReviewRecordError("invalid", "The clock moved backwards. Nothing was written.");
  }
  type Entry = ReviewDispositions["dispositions"][number];
  type Event = Entry["events"][number];
  const entries: Entry[] = record.dispositions;
  const index = entries.findIndex((entry) => entry.findingId === change.findingId);
  const existing = index >= 0 ? entries[index] : undefined;
  if (existing && existing.state === change.state && change.note === undefined) {
    return { record, changed: false };
  }
  if (existing && existing.events.length >= REVIEW_RECORD_LIMITS.dispositionEventsPerFinding) {
    throw new ReviewRecordError(
      "too-large",
      "This finding already has the maximum number of disposition events. Nothing was written."
    );
  }
  const previous: Event | undefined = existing?.events[existing.events.length - 1];
  const event: Event = {
    sequence: existing ? existing.events.length + 1 : 1,
    at: change.at,
    action: actionFor(change.state),
    from: previous ? previous.to : null,
    to: change.state,
    ...(change.note === undefined ? {} : { note: change.note })
  };
  const entry: Entry = existing
    ? { ...existing, state: change.state, updatedAt: change.at, events: [...existing.events, event] }
    : { findingId: change.findingId, state: change.state, updatedAt: change.at, events: [event] };
  const nextEntries: Entry[] = existing
    ? entries.map((item, position) => (position === index ? entry : item))
    : [...entries, entry];
  nextEntries.sort((left, right) => (left.findingId < right.findingId ? -1 : left.findingId > right.findingId ? 1 : 0));
  return { record: { ...record, dispositions: nextEntries, updatedAt: change.at }, changed: true };
}

export interface NewProfileRecordInput {
  bookId: string;
  profile: ReaderProfileLike;
  revision: number;
  base: ReviewRecordBase;
  createdAt: string;
  updatedAt: string;
  /** Raw fields of the record this save replaces, so unknown plain members survive. */
  previous?: Record<string, unknown>;
}

export type ReaderProfileLike = ReaderProfile;

export function buildProfileRecord(input: NewProfileRecordInput): ReaderProfileRecord {
  const record = {
    ...(input.previous ?? {}),
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    kind: "reader-profile-record" as const,
    owner: { bookId: input.bookId },
    id: input.profile.id,
    revision: input.revision,
    base: input.base,
    profile: structuredClone(input.profile),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
  if (!readerProfileRecordSchema.safeParse(record).success) {
    throw new ReviewRecordError("invalid", "The reader lens record is invalid. Nothing was written.");
  }
  return record as unknown as ReaderProfileRecord;
}

/** Deep carry for replacement: every field the new value does not name is kept from the previous one. */
export function carryUnknown(previous: unknown, next: unknown): unknown {
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const old =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : null;
  if (!old) return next;
  const merged: Record<string, unknown> = { ...(next as Record<string, unknown>) };
  for (const [key, value] of Object.entries(old)) {
    // Define rather than assign: a `__proto__` key must become an own data property, not the
    // inherited prototype setter, or the merged object stops being plain data.
    Object.defineProperty(merged, key, {
      value: Object.hasOwn(merged, key) ? carryUnknown(value, merged[key]) : value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return merged;
}

export interface CampaignDraft {
  status: ReviewCampaign["status"];
  profile: ReviewCampaign["profile"];
  sources: ReviewCampaign["sources"];
  stages: ReviewCampaign["stages"];
  synthesis: ReviewCampaign["synthesis"];
  plannedAt: string;
  sourceBytes: number;
}

export interface NewCampaignRecordInput {
  bookId: string;
  id: string;
  revision: number;
  base: ReviewRecordBase;
  draft: CampaignDraft;
  createdAt: string;
  updatedAt: string;
  previous?: Record<string, unknown>;
}

export function buildCampaignRecord(input: NewCampaignRecordInput): ReviewCampaign {
  const { draft } = input;
  const items = draft.sources.reduce((total, source) => total + source.planned.length, 0);
  const previousList = (key: string): Array<Record<string, unknown>> => {
    const value = input.previous?.[key];
    return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  };
  const carry = (previousItems: Array<Record<string, unknown>>, key: string, item: Record<string, unknown>) =>
    carryUnknown(previousItems.find((previous) => previous[key] === item[key]), structuredClone(item));
  const previousSources = previousList("sources");
  const previousStages = previousList("stages");
  const previousSynthesis = previousList("synthesis");
  const record = {
    ...(input.previous ?? {}),
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    kind: "review-campaign" as const,
    owner: { bookId: input.bookId },
    id: input.id,
    revision: input.revision,
    base: input.base,
    status: draft.status,
    profile: structuredClone(draft.profile),
    plan: {
      plannedAt: draft.plannedAt,
      sources: draft.sources.length,
      items,
      sourceBytes: draft.sourceBytes
    },
    sources: draft.sources.map((source) => carry(previousSources, "sourceId", source as unknown as Record<string, unknown>)),
    stages: draft.stages.map((stage) => carry(previousStages, "stageId", stage as unknown as Record<string, unknown>)),
    synthesis: draft.synthesis.map((entry) => carry(previousSynthesis, "stageId", entry as unknown as Record<string, unknown>)),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
  const parsedCampaign = reviewCampaignSchema.safeParse(record);
  if (!parsedCampaign.success) {
    throw new ReviewRecordError("invalid", "The campaign manifest is invalid or its coverage disagrees. Nothing was written.");
  }
  return record as ReviewCampaign;
}

/** Deterministic canonical text of a record value; used by tests and digest helpers. */
export function canonicalRecordText(value: unknown): string {
  return canonicalJsonText(value, { maxDepth: REVIEW_RECORD_DEPTH });
}
