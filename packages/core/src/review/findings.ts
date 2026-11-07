import type { z } from "zod";
import { canonicalJson, checkBytes, freeze, idSchema, requireContract, REVIEW_LIMITS, scalarCount, textSchema, timestampSchema, validSpan, type Immutable } from "./contract";
import { sourceComparisonKey, sourceCurrency, validateReviewEnvelope, type CurrentSource, type ReviewEnvelope } from "./envelope";
import { sameSavedIdentity, type ChapterSource, type SavedIdentity } from "./sources";
import { citationSchema, findingsOutputSchema } from "./wire-schema";

export type Citation = Immutable<z.infer<typeof citationSchema>>;
export type VerifiedCitation = { readonly citation: Citation; readonly label: string };
export type CitationResult = { status: "verified-captured"; evidence: VerifiedCitation } |
  { status: "invalid"; reason: "shape" | "source" | "revision" | "range" | "quote" };

function chapterLabel(source: ChapterSource, first: number, last: number): string {
  return `${source.bookTitle} · Chapter ${source.position}: ${source.title} · lines ${first}–${last} · saved version ${source.identity.version}, captured ${source.capturedAt}`;
}

/** Validity is against captured text only. A matching quote does not prove the interpretation. */
export function verifyReviewCitation(envelope: ReviewEnvelope, input: unknown): CitationResult {
  const parsed = citationSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", reason: "shape" };
  const citation = parsed.data;
  const matches = envelope.sources.filter((source) => source.sourceId === citation.sourceId);
  const source = matches[0];
  if (matches.length !== 1 || !source || source.kind !== citation.kind) return { status: "invalid", reason: "source" };
  if (source.kind === "chapter" && citation.kind === "chapter") {
    if (!sameSavedIdentity(source.identity, citation.identity)) return { status: "invalid", reason: "revision" };
    const segment = source.segments.find((item) => citation.start >= item.start && citation.end <= item.end);
    const start = citation.start - (segment?.start ?? 0);
    const end = citation.end - (segment?.start ?? 0);
    if (!segment || !validSpan(segment.text, { start, end })) return { status: "invalid", reason: "range" };
    if (segment.text.slice(start, end) !== citation.quote) return { status: "invalid", reason: "quote" };
    const first = segment.startLine + segment.text.slice(0, start).split("\n").length - 1;
    const last = segment.startLine + segment.text.slice(0, end - 1).split("\n").length - 1;
    return { status: "verified-captured", evidence: freeze({ citation, label: chapterLabel(source, first, last) }) };
  }
  if (source.kind === "story-bible" && citation.kind === "story-bible") {
    if (source.bookId !== citation.bookId || source.valueDigest !== citation.valueDigest ||
      source.containingFileHash !== citation.containingFileHash || canonicalJson(source.field) !== canonicalJson(citation.field)) {
      return { status: "invalid", reason: "revision" };
    }
    if (!validSpan(source.text, citation)) return { status: "invalid", reason: "range" };
    if (source.text.slice(citation.start, citation.end) !== citation.quote) return { status: "invalid", reason: "quote" };
    return { status: "verified-captured", evidence: freeze({ citation,
      label: `${source.bookTitle} · Story Bible · ${source.label} · captured ${source.capturedAt}` }) };
  }
  return { status: "invalid", reason: "source" };
}

export type ReaderFinding = Immutable<{
  findingId: string; category: z.infer<typeof findingsOutputSchema>["findings"][number]["category"];
  readerId: string; readerVersion: number; runId: string; interpretation: string; subjective: true;
  claim: "observation" | "question" | "contradiction";
  evidence: VerifiedCitation[]; invalidEvidence: { index: number; reason: string }[];
  evidenceState: "complete" | "incomplete-evidence" | "insufficient-evidence";
}>;
export type ReaderRun = Immutable<{
  kind: "reader-review"; runId: string; startedAt: string; completedAt: string;
  envelope: ReviewEnvelope; findings: ReaderFinding[];
}>;

export async function buildReaderRun(input: {
  runId: string; startedAt: string; completedAt: string; envelope: ReviewEnvelope; output: string;
}): Promise<ReaderRun> {
  checkBytes(input.output, REVIEW_LIMITS.outputBytes, "output-byte-limit");
  const runId = idSchema.parse(input.runId);
  const startedAt = timestampSchema.parse(input.startedAt);
  const completedAt = timestampSchema.parse(input.completedAt);
  requireContract(Date.parse(completedAt) >= Date.parse(startedAt), "run-time-order");
  const output = findingsOutputSchema.parse(JSON.parse(input.output));
  const envelope = await validateReviewEnvelope(input.envelope);
  const profile = envelope.profile;
  requireContract(envelope.kind === "reader-review" && profile, "reader-profile-required");
  requireContract(runId === envelope.requestId, "run-request-identity");
  requireContract(output.runId === runId && output.readerId === profile.id && output.readerVersion === profile.version, "run-attribution");
  requireContract(new Set(output.findings.map((finding) => finding.findingId)).size === output.findings.length, "ambiguous-finding-id");
  const findings = output.findings.map((finding): ReaderFinding => {
    requireContract(finding.runId === runId && finding.readerId === profile.id && finding.readerVersion === profile.version, "finding-attribution");
    requireContract(finding.claim !== "contradiction" || finding.category === "continuity", "contradiction-category");
    const evidence: VerifiedCitation[] = [];
    const invalidEvidence: { index: number; reason: string }[] = [];
    finding.evidence.forEach((raw, index) => {
      // Resource overflow fails the run even when the remainder of a citation is malformed.
      if (raw && typeof raw === "object" && "quote" in raw && typeof raw.quote === "string" && textSchema.safeParse(raw.quote).success) {
        requireContract(scalarCount(raw.quote) <= REVIEW_LIMITS.quoteScalars, "quote-scalar-limit");
      }
      const result = verifyReviewCitation(envelope, raw);
      if (result.status === "verified-captured") evidence.push(result.evidence);
      else invalidEvidence.push({ index, reason: result.reason });
    });
    const distinctEvidence = new Set(evidence.map((item) => canonicalJson(item.citation))).size;
    const insufficient = evidence.length === 0 || (finding.claim === "contradiction" && distinctEvidence < 2);
    return freeze({ ...finding, subjective: true, evidence, invalidEvidence,
      evidenceState: insufficient ? "insufficient-evidence" : invalidEvidence.length ? "incomplete-evidence" : "complete" });
  });
  return freeze({ kind: "reader-review", runId, startedAt, completedAt, envelope, findings });
}

/** Recheck immediately before displaying current evidence and again before editor selection. */
export function reviewCitationNavigation(envelope: ReviewEnvelope, citation: unknown, current: readonly CurrentSource[], editor?: {
  clean: boolean; identity: SavedIdentity;
}): { status: "ready" | "stale" | "unavailable"; evidence?: VerifiedCitation } {
  const result = verifyReviewCitation(envelope, citation);
  if (result.status !== "verified-captured") return { status: "unavailable" };
  const source = envelope.sources.find((item) => item.sourceId === result.evidence.citation.sourceId);
  if (!source) return { status: "unavailable" };
  const currency = sourceCurrency(source, current);
  if (currency !== "current") return { status: currency === "stale" ? "stale" : "unavailable", evidence: result.evidence };
  if (source.kind !== "chapter") return { status: "unavailable", evidence: result.evidence };
  if (!editor?.clean || !sameSavedIdentity(source.identity, editor.identity)) return { status: "stale", evidence: result.evidence };
  return { status: "ready", evidence: result.evidence };
}

export function compareReaderRuns(before: ReaderRun, after: ReaderRun) {
  const sourceChanged = canonicalJson(before.envelope.sources.map(sourceComparisonKey)) !== canonicalJson(after.envelope.sources.map(sourceComparisonKey));
  const profileChanged = canonicalJson(before.envelope.profile) !== canonicalJson(after.envelope.profile);
  const destinationChanged = canonicalJson(before.envelope.destination) !== canonicalJson(after.envelope.destination);
  const promptOrFeedbackChanged = canonicalJson([before.envelope.prompt, before.envelope.priorFeedback]) !== canonicalJson([after.envelope.prompt, after.envelope.priorFeedback]);
  const interpretations = (run: ReaderRun) => run.findings.map((finding) => ({ category: finding.category, claim: finding.claim,
    interpretation: finding.interpretation }));
  const interpretationChanged = canonicalJson(interpretations(before)) !== canonicalJson(interpretations(after));
  return freeze({ sourceChanged, profileChanged, destinationChanged, promptOrFeedbackChanged, interpretationChanged,
    modelVariation: interpretationChanged && !sourceChanged && !profileChanged && !destinationChanged && !promptOrFeedbackChanged });
}
