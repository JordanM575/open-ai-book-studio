import { z } from "zod";
import { normalizeBody } from "../markdown";
import {
  assertReviewData, bookIdSchema, canonicalJson, digestJson, freeze, hashSchema, idSchema, integerSchema,
  requireContract, ReviewContractError, REVIEW_LIMITS, spanSchema, textSchema, utf8Bytes, versionSchema,
  type Immutable, type Span
} from "./contract";
import {
  buildReviewEnvelope, envelopeContentSchema, serializeProviderRequest,
  type ReviewEnvelope
} from "./envelope";
import { categorySchema, profileSchema, validateReaderProfile } from "./profiles";
import {
  buildCampaignRecord, campaignBytes, recordIdSchema, recordTimestampSchema, REVIEW_RECORD_LIMITS
} from "./record-format";
import { captureChapterSource, savedBodySchema, type ChapterSource, type SavedIdentity } from "./sources";

const selectionSchema = z.strictObject({ sourceId: idSchema, ranges: z.array(spanSchema).min(1) });
const inputSchema = z.strictObject({
  operation: z.literal("plan-full-book-review"), campaignId: recordIdSchema.max(160),
  ownerBookId: bookIdSchema, plannedAt: recordTimestampSchema,
  taxonomyVersion: z.literal(1), categories: z.array(categorySchema).min(1).max(categorySchema.options.length),
  profile: profileSchema,
  request: envelopeContentSchema.pick({ destination: true, environment: true, books: true, prompt: true, priorFeedback: true }),
  sources: z.array(z.strictObject({
    sourceId: idSchema, saved: savedBodySchema,
    bookTitle: textSchema, title: textSchema, position: versionSchema,
    ranges: z.array(spanSchema).min(1)
  })).min(1),
  policy: z.strictObject({
    maxPrimaryScalars: versionSchema.max(REVIEW_LIMITS.sourceBytes),
    boundaryScalars: integerSchema.max(REVIEW_LIMITS.sourceBytes),
    synthesis: z.strictObject({
      fanIn: versionSchema.min(2).max(REVIEW_LIMITS.items),
      summaryBytes: versionSchema.max(REVIEW_LIMITS.contentBytes),
      /** Explicit original-source windows, never inferred from generated summaries. */
      evidence: z.array(selectionSchema).min(1).max(REVIEW_LIMITS.items)
    }).nullable()
  })
});

export type CampaignPlanInput = z.infer<typeof inputSchema>;
export type CampaignOrigin = Immutable<{ sourceId: string; identity: SavedIdentity; primary: Span[] }>;
export type CampaignStage = Immutable<{
  stageId: string; kind: "range" | "synthesis"; dependencies: string[];
  origins: CampaignOrigin[];
  /** Primary coverage is empty for synthesis. Context never contributes coverage. */
  primary: Span[]; boundary: Span[];
  /** Range: exact request. Synthesis: worst-case reservation, NEVER a request to send. */
  admission: "exact" | "summary-reservation";
  envelope: ReviewEnvelope; serializedBytes: number;
}>;
export type CampaignPlan = Immutable<{
  operation: "full-book-review-plan"; campaignId: string; ownerBookId: string; digest: string;
  taxonomyVersion: 1; categories: CampaignPlanInput["categories"]; profile: CampaignPlanInput["profile"];
  sources: ChapterSource[]; stages: CampaignStage[]; policy: CampaignPlanInput["policy"];
  persistence: {
    status: "within-current-limits" | "non-persistable";
    reasons: string[]; projectedBytes: number | null;
  };
}>;
export type CampaignPlanningResult =
  | { readonly status: "planned" | "non-persistable"; readonly plan: CampaignPlan }
  | { readonly status: "refused"; readonly code: string };

const plans = new WeakSet<CampaignPlan>();

/** Plan identity is local validation provenance, not execution or persistence authority. */
export function requireCampaignPlan(plan: CampaignPlan): void {
  requireContract(plans.has(plan), "unvalidated-campaign-plan");
}

function refusalCode(error: unknown): string {
  return error instanceof ReviewContractError ? error.code : "invalid-campaign-input";
}

function overflow(error: unknown): boolean {
  return error instanceof ReviewContractError &&
    ["source-byte-limit", "content-byte-limit", "request-byte-limit"].includes(error.code);
}

/** Endpoints and line numbers are indexed once, avoiding full-body scans for each trial request. */
function indexText(text: string, start: number, startLine: number) {
  const offsets = [start];
  const lines = [startLine];
  let offset = start;
  let line = startLine;
  for (const scalar of text) {
    offset += scalar.length;
    if (scalar === "\n") line++;
    offsets.push(offset);
    lines.push(line);
  }
  return { offsets, lines };
}

function at(values: readonly number[], index: number): number {
  const value = values[index];
  requireContract(value !== undefined, "invalid-campaign-index");
  return value;
}

function sliceSource(source: ChapterSource, ranges: readonly Span[]): ChapterSource {
  return freeze({ ...source, segments: ranges.map((range) => {
    const segment = source.segments.find((item) => range.start >= item.start && range.end <= item.end);
    requireContract(segment && range.end > range.start, "synthesis-outside-selection");
    const start = range.start - segment.start;
    const end = range.end - segment.start;
    // Reuse capture's scalar validation without trusting arbitrary selected endpoints.
    const captured = captureChapterSource({
      sourceId: source.sourceId, saved: { ...source.identity, body: segment.text },
      bookTitle: source.bookTitle, title: source.title, position: source.position,
      capturedAt: source.capturedAt, ranges: [{ start, end }]
    });
    const selected = captured.segments[0];
    requireContract(selected, "empty-synthesis-selection");
    return { ...range, text: selected.text,
      startLine: segment.startLine + selected.startLine - 1 };
  }) });
}

function stagePrompt(prompt: string, input: Pick<CampaignPlanInput, "campaignId" | "categories" | "taxonomyVersion">,
  stage: Pick<CampaignStage, "stageId" | "kind" | "dependencies" | "origins" | "primary" | "boundary">): string {
  return `${prompt}\n${canonicalJson({ campaignId: input.campaignId, taxonomyVersion: input.taxonomyVersion,
    categories: input.categories, stage, summaryEvidence: "derived-not-verified-citations" })}`;
}

function originsOf(stages: readonly CampaignStage[]): CampaignOrigin[] {
  const origins = new Map<string, { sourceId: string; identity: SavedIdentity; primary: Span[] }>();
  for (const stage of stages) for (const origin of stage.origins) {
    let entry = origins.get(origin.sourceId);
    if (!entry) {
      entry = { sourceId: origin.sourceId, identity: { ...origin.identity }, primary: [] };
      origins.set(origin.sourceId, entry);
    }
    for (const range of origin.primary) {
      const last = entry.primary.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else entry.primary.push({ ...range });
    }
  }
  return [...origins.values()];
}

function persistence(input: CampaignPlanInput, sources: readonly ChapterSource[], stages: readonly CampaignStage[]) {
  const reasons: string[] = [];
  if (sources.length > REVIEW_RECORD_LIMITS.campaignSources) reasons.push("campaign-source-limit");
  if (stages.length > REVIEW_RECORD_LIMITS.campaignStages) reasons.push("campaign-stage-limit");
  if (sources.some((source) => source.segments.length > REVIEW_RECORD_LIMITS.campaignPlannedSpans)) reasons.push("campaign-span-limit");
  const sourceBytes = sources.reduce((sum, source) => sum + source.segments.reduce((n, s) => n + utf8Bytes(s.text), 0), 0);
  if (sourceBytes > REVIEW_RECORD_LIMITS.bytes) reasons.push("campaign-source-byte-limit");
  let projectedBytes: number | null = null;
  if (!reasons.length) {
    try {
      // A schema-1 projection for bounds only. It does NOT encode all campaign semantics or grant a save.
      const record = buildCampaignRecord({ bookId: input.ownerBookId, id: input.campaignId, revision: 1,
        base: { kind: "absent", revision: 0 }, createdAt: input.plannedAt, updatedAt: input.plannedAt,
        draft: { status: "planned", profile: { id: input.profile.id, version: input.profile.version, digest: input.profile.digest },
          plannedAt: input.plannedAt, sourceBytes,
          sources: sources.map((source) => ({ sourceId: source.sourceId, ...source.identity,
            title: source.title, position: source.position, planned: source.segments.map(({ start, end }) => ({ start, end })) })),
          stages: stages.map((stage) => ({ stageId: stage.stageId, kind: stage.kind,
            sourceIds: stage.origins.map((origin) => origin.sourceId), planned: stage.primary.map((range) => ({ ...range })),
            status: "planned", report: null, at: null })),
          synthesis: stages.filter((stage) => stage.kind === "synthesis").map((stage) => ({
            stageId: stage.stageId, sourceStageIds: [...stage.dependencies], report: null
          })) }
      });
      projectedBytes = campaignBytes(record).byteLength;
    } catch { reasons.push("campaign-schema-or-serialized-limit"); }
  }
  return { status: reasons.length ? "non-persistable" as const : "within-current-limits" as const, reasons, projectedBytes };
}

/** Pure, explicit campaign operation. Ordinary buildReviewEnvelope overflow behavior is unchanged. */
export async function planReviewCampaign(value: unknown): Promise<CampaignPlanningResult> {
  try {
    assertReviewData(value);
    const input = inputSchema.parse(value); // Detach before the first await.
    requireContract(new Set(input.categories).size === input.categories.length, "duplicate-campaign-category");
    requireContract(input.categories.every((category) => input.profile.focus.includes(category)), "category-outside-profile");
    await validateReaderProfile(input.profile);
    const sources: ChapterSource[] = [];
    const ids = new Set<string>();
    const identities = new Set<string>();
    const books = new Set(input.request.books.map((book) => book.bookId));
    requireContract(books.size === input.request.books.length && books.has(input.ownerBookId), "campaign-book-scope");
    for (const selected of input.sources) {
      requireContract(normalizeBody(selected.saved.body) === selected.saved.body, "noncanonical-campaign-body");
      requireContract(!ids.has(selected.sourceId), "duplicate-campaign-source");
      const identity = canonicalJson([selected.saved.bookId, selected.saved.chapterId]);
      requireContract(!identities.has(identity), "duplicate-campaign-identity");
      ids.add(selected.sourceId); identities.add(identity);
      const book = input.request.books.find((book) => book.bookId === selected.saved.bookId);
      requireContract(book && book.title === selected.bookTitle, "foreign-campaign-source");
      sources.push(captureChapterSource({ ...selected, capturedAt: input.plannedAt }));
    }
    requireContract(books.size === new Set(sources.map((source) => source.identity.bookId)).size, "unselected-campaign-book");
    const stages: CampaignStage[] = [];
    const stageId = () => `${input.campaignId}.${String(stages.length + 1).padStart(6, "0")}`;
    const envelopeFor = (id: string, prompt: string, selected: readonly ChapterSource[], feedback = input.request.priorFeedback) =>
      buildReviewEnvelope({ ...input.request, contractVersion: 1, kind: "reader-review", requestId: id,
        capturedAt: input.plannedAt, profile: input.profile, prompt, sources: selected,
        books: input.request.books.filter((book) => selected.some((source) => source.identity.bookId === book.bookId)),
        priorFeedback: feedback });

    for (const source of sources) for (const segment of source.segments) {
      const index = indexText(segment.text, segment.start, segment.startLine);
      const count = index.offsets.length - 1;
      let cursor = 0;
      while (cursor < count) {
        const id = stageId();
        const trial = async (size: number): Promise<CampaignStage> => {
          const endIndex = cursor + size;
          const left = Math.max(0, cursor - input.policy.boundaryScalars);
          const right = Math.min(count, endIndex + input.policy.boundaryScalars);
          const primary = [{ start: at(index.offsets, cursor), end: at(index.offsets, endIndex) }];
          const boundary: Span[] = [];
          if (left < cursor) boundary.push({ start: at(index.offsets, left), end: at(index.offsets, cursor) });
          if (right > endIndex) boundary.push({ start: at(index.offsets, endIndex), end: at(index.offsets, right) });
          const descriptor = { stageId: id, kind: "range" as const, dependencies: [],
            origins: [{ sourceId: source.sourceId, identity: source.identity, primary }], primary, boundary };
          const selected = freeze({ ...source, segments: [{ start: at(index.offsets, left), end: at(index.offsets, right),
            text: segment.text.slice(at(index.offsets, left) - segment.start, at(index.offsets, right) - segment.start),
            startLine: at(index.lines, left) }] });
          const envelope = await envelopeFor(id, stagePrompt(input.request.prompt, input, descriptor), [selected]);
          return freeze({ ...descriptor, envelope, admission: "exact" as const,
            serializedBytes: utf8Bytes(serializeProviderRequest(envelope)) });
        };
        // Largest policy window first; then bounded binary admission using the actual serializer.
        let low = 1;
        let high = Math.min(input.policy.maxPrimaryScalars, count - cursor);
        let accepted: CampaignStage | undefined;
        let acceptedSize = 0;
        try { accepted = await trial(high); acceptedSize = high; }
        catch (error) { if (!overflow(error)) throw error; high--; }
        if (acceptedSize) low = high + 1;
        while (low <= high) {
          const size = Math.floor((low + high) / 2);
          try { accepted = await trial(size); acceptedSize = size; low = size + 1; }
          catch (error) { if (!overflow(error)) throw error; high = size - 1; }
        }
        // Maximal packing is not promised; a fitting trial is sufficient, with every range retained.
        requireContract(accepted && acceptedSize > 0, "campaign-envelope-cannot-fit");
        stages.push(accepted);
        cursor += acceptedSize;
      }
    }

    const synthesis = input.policy.synthesis;
    if (synthesis) {
      requireContract(new Set(synthesis.evidence.map((entry) => entry.sourceId)).size === synthesis.evidence.length,
        "duplicate-synthesis-source");
      const evidence = synthesis.evidence.map((entry) => {
        const source = sources.find((source) => source.sourceId === entry.sourceId);
        requireContract(source, "foreign-synthesis-source");
        return sliceSource(source, entry.ranges);
      });
      let layer = [...stages];
      // Even a single range receives the explicitly requested synthesis operation.
      do {
        const next: CampaignStage[] = [];
        for (let offset = 0; offset < layer.length; offset += synthesis.fanIn) {
          const dependencies = layer.slice(offset, offset + synthesis.fanIn);
          const descriptor = { stageId: stageId(), kind: "synthesis" as const,
            dependencies: dependencies.map((stage) => stage.stageId), origins: originsOf(dependencies), primary: [], boundary: [] };
          const feedback = dependencies.map((stage) => ({ id: `derived-${stage.stageId}`, runId: stage.stageId,
            label: canonicalJson({ derived: true, stageId: stage.stageId, origins: stage.origins,
              profile: { id: input.profile.id, version: input.profile.version, digest: input.profile.digest }, categories: input.categories }),
            // U+0000 maximizes JSON escaping per UTF-8 byte, including nested provider serialization.
            text: "\u0000".repeat(synthesis.summaryBytes) }));
          const envelope = await envelopeFor(descriptor.stageId, stagePrompt(input.request.prompt, input, descriptor),
            evidence, [...input.request.priorFeedback, ...feedback]);
          const stage = freeze({ ...descriptor, envelope, admission: "summary-reservation" as const,
            serializedBytes: utf8Bytes(serializeProviderRequest(envelope)) });
          stages.push(stage); next.push(stage);
        }
        layer = next;
      } while (layer.length > 1);
    }
    const bounds = persistence(input, sources, stages);
    const content = { operation: "full-book-review-plan" as const, campaignId: input.campaignId, ownerBookId: input.ownerBookId,
      taxonomyVersion: input.taxonomyVersion, categories: input.categories, profile: input.profile,
      sources, stages, policy: input.policy, persistence: bounds };
    const plan = freeze({ ...content, digest: await digestJson(content) });
    plans.add(plan);
    return freeze({ status: bounds.status === "non-persistable" ? "non-persistable" as const : "planned" as const, plan });
  } catch (error) { return freeze({ status: "refused" as const, code: refusalCode(error) }); }
}

const summarySchema = z.strictObject({
  stageId: idSchema, planDigest: hashSchema, status: z.literal("completed"), text: textSchema
});

/** Actual summaries are never clipped. Dependencies must be supplied exactly, in planned order.
 * This is admission only: the host must separately prove completion/authorization and verify citations.
 */
export async function admitCampaignSynthesis(plan: CampaignPlan, stageId: string, summaries: unknown): Promise<ReviewEnvelope> {
  requireCampaignPlan(plan);
  assertReviewData(summaries);
  const values = z.array(summarySchema).parse(summaries);
  const stage = plan.stages.find((candidate) => candidate.stageId === stageId);
  const policy = plan.policy.synthesis;
  requireContract(stage?.kind === "synthesis" && policy, "not-campaign-synthesis");
  requireContract(canonicalJson(values.map((value) => value.stageId)) === canonicalJson(stage.dependencies), "synthesis-dependencies");
  requireContract(values.every((value) => value.planDigest === plan.digest), "synthesis-plan-mismatch");
  requireContract(values.every((value) => utf8Bytes(value.text) <= policy.summaryBytes), "synthesis-summary-overflow");
  const { scopeDigest: _scopeDigest, ...content } = stage.envelope;
  const priorCount = content.priorFeedback.length - values.length;
  return buildReviewEnvelope({ ...content, priorFeedback: content.priorFeedback.map((feedback, index) => {
    if (index < priorCount) return feedback;
    const value = values[index - priorCount];
    requireContract(value, "synthesis-dependencies");
    return { ...feedback, text: value.text };
  }) });
}
