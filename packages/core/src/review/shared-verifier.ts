import { z } from "zod";
import { normalizeBody, parseChapterFile } from "../markdown";
import type { ChapterMeta } from "../schema";
import {
  bookIdSchema, canonicalJson, chapterIdSchema, freeze, hashSchema, integerSchema, isReviewData,
  ReviewContractError, REVIEW_LIMITS, scalarCount, spanSchema, textSchema, timestampSchema, validSpan,
  versionSchema, type Immutable, type Span
} from "./contract";
import { validateReviewEnvelope, type ReviewEnvelope } from "./envelope";
import { buildReaderRun, type ReaderFinding, type ReaderRun } from "./findings";
import { buildOverlapIndex, type InlineSpan } from "./inline/overlap";
import { sameSavedIdentity } from "./sources";

/**
 * A host-supplied saved-chapter fact set. The verifier never reads a Library, filesystem, provider,
 * IPC channel or clock: every fact below must already have been read by the host.
 */
export interface SharedReviewSourceFacts {
  readonly libraryId: string;
  readonly bookId: string;
  readonly chapterId: string;
  /** Unique per mounted visit, including A → B → A. */
  readonly viewGeneration: string;
  /** Monotonic host revision for source/availability/save-state transitions, including ABA. */
  readonly sourceEpoch: number;
  readonly version: number;
  /** SHA-256 of the exact saved chapter file, lowercase hexadecimal. */
  readonly rawHash: string;
  /** The canonical saved body the host read, never pasted or rendered text. */
  readonly savedBody: string;
  readonly clean: boolean;
  readonly pending: boolean;
  readonly available: boolean;
}

/** The live editor facts the inline leaf captures immediately before requesting evidence. */
export interface SharedReviewTarget extends SharedReviewSourceFacts {
  readonly body: string;
  readonly selection: { readonly anchor: number; readonly head: number };
  readonly selectedText: string;
  readonly composing: boolean;
  readonly held: boolean;
  readonly revision: number;
  readonly destroyed: boolean;
}

/** Exact raw chapter file as the host read it. Bytes are checked fatally when supplied. */
export interface SharedRawChapterFile {
  readonly text: string;
  readonly bytes?: Uint8Array;
}

/** Detached, host-neutral input. `unknown` is accepted by the port and checked here. */
export interface SharedReviewRequest {
  /** Untrusted envelope candidate. The verifier validates and re-registers it. */
  readonly envelope: unknown;
  readonly raw: SharedRawChapterFile;
  /** The host-selected saved-body ranges that the envelope must already reflect. */
  readonly scope: readonly Span[];
  /** Saved facts captured when the request was created; stale generations/epochs refuse. */
  readonly expected: SharedReviewSourceFacts;
  /** Untrusted completed model output (JSON text). A model boolean is never accepted. */
  readonly output: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Structural match for the inline editor's `ValidatedInlineLayer`; no app code is imported. */
export interface SharedVerifiedLayer {
  readonly source: Immutable<SharedReviewSourceFacts>;
  readonly spans: readonly InlineSpan[];
  readonly findings: readonly ReaderFinding[];
  readonly runId: string;
  readonly scopeDigest: string;
  /** Whether the raw file hash was proven from bytes or from the host-supplied text. */
  readonly rawProof: "bytes" | "text";
}

export type SharedRefusalCode =
  | "aborted" | "invalid-request" | "invalid-target" | "invalid-envelope" | "identity-mismatch"
  | "stale-target" | "target-dirty" | "target-pending" | "target-unavailable" | "target-composing"
  | "target-held" | "target-destroyed" | "invalid-unicode" | "invalid-utf8" | "raw-encoding-mismatch"
  | "raw-hash-mismatch" | "invalid-raw-format" | "version-mismatch" | "body-mismatch"
  | "invalid-selection" | "scope-mismatch" | "run-mismatch" | "output-invalid" | "duplicate-finding"
  | "duplicate-evidence" | "no-verified-evidence";

export interface SharedRefusal {
  readonly code: SharedRefusalCode;
  /** Bounded, verifier-owned contract code; never model or file content. */
  readonly contractCode?: string;
}

export type SharedVerification =
  | { readonly status: "verified"; readonly layer: SharedVerifiedLayer }
  | { readonly status: "refused"; readonly reasons: readonly SharedRefusal[] };

const sourceFactsSchema = z.strictObject({
  libraryId: textSchema.min(1).max(200), bookId: bookIdSchema,
  chapterId: chapterIdSchema, viewGeneration: textSchema.min(1).max(200),
  sourceEpoch: integerSchema, version: versionSchema, rawHash: hashSchema, savedBody: textSchema,
  clean: z.boolean(), pending: z.boolean(), available: z.boolean()
});
const targetSchema = sourceFactsSchema.extend({
  body: textSchema, selection: z.strictObject({ anchor: integerSchema, head: integerSchema }),
  selectedText: textSchema, composing: z.boolean(), held: z.boolean(),
  revision: integerSchema, destroyed: z.boolean()
});
const requestSchema = z.strictObject({
  envelope: z.unknown(),
  raw: z.strictObject({ text: textSchema, bytes: z.instanceof(Uint8Array).optional() }),
  scope: z.array(spanSchema).min(1).max(REVIEW_LIMITS.items),
  expected: sourceFactsSchema, output: textSchema,
  startedAt: timestampSchema, completedAt: timestampSchema
});

const requestKeys = ["envelope", "raw", "scope", "expected", "output", "startedAt", "completedAt"] as const;
const rawKeys = ["text"] as const;

/**
 * Read only own enumerable data properties from a plain/null-prototype record. Accessors, symbols,
 * hidden properties, foreign prototypes, sparse shapes and unknown keys refuse without a getter read.
 */
function plainRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const allowed = new Set([...required, ...optional]);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!(key in result)) return null;
  return result;
}

function refusal(code: SharedRefusalCode, contractCode?: string): SharedVerification {
  const reason = freeze({ code, ...(contractCode ? { contractCode } : {}) });
  return freeze({ status: "refused" as const, reasons: [reason] });
}

function contractCode(error: unknown): string | undefined {
  if (error instanceof ReviewContractError && /^[a-z0-9-]{1,60}$/.test(error.code)) return error.code;
  return undefined;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const aborted = Symbol("shared-verifier-aborted");

/** Abort wins even while a pure hash/validation promise is still running; no layer is returned. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw aborted;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

function savedIdentityOf(facts: SharedReviewSourceFacts) {
  return { bookId: facts.bookId, chapterId: facts.chapterId, version: facts.version, hash: facts.rawHash };
}

function sameSourceFacts(a: SharedReviewSourceFacts, b: SharedReviewSourceFacts): boolean {
  return a.libraryId === b.libraryId && a.bookId === b.bookId && a.chapterId === b.chapterId &&
    a.viewGeneration === b.viewGeneration && a.sourceEpoch === b.sourceEpoch && a.version === b.version &&
    a.rawHash === b.rawHash && a.savedBody === b.savedBody;
}

function endpointIsScalarSafe(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function chapterFallback(_facts: SharedReviewSourceFacts): ChapterMeta {
  /*
   * Only non-identity presentation defaults. `id` and `version` are deliberately impossible values:
   * a chapter file that omits either key must fail schema parsing rather than inherit the host's
   * expected identity. A declared key replaces the sentinel and is compared with the host facts.
   */
  return {
    id: "", title: "", order: 1, arc: "middle", purpose: "", synopsis: "", notes: "",
    isPrologue: false, color: null, version: -1,
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z"
  };
}

/**
 * Verify one saved chapter snapshot and one completed reader run entirely from supplied facts.
 * Returns a detached frozen layer only when every requested clause holds. Invalid individual
 * evidence is withheld with its bounded reason in the retained finding; malformed runs refuse.
 */
export async function verifySharedReview(
  input: unknown,
  target: SharedReviewTarget,
  signal: AbortSignal
): Promise<SharedVerification> {
  if (!signal || signal.aborted) return refusal("aborted");

  const record = plainRecord(input, requestKeys);
  if (!record) return refusal("invalid-request");
  const raw = plainRecord(record.raw, rawKeys, ["bytes"]);
  if (!raw) return refusal("invalid-request");
  const jsonFacts = {
    envelope: record.envelope, scope: record.scope, expected: record.expected,
    output: record.output, startedAt: record.startedAt, completedAt: record.completedAt
  };
  if (!isReviewData(jsonFacts)) return refusal("invalid-request");
  const request = requestSchema.safeParse({
    ...jsonFacts,
    raw: { text: raw.text, ...(raw.bytes === undefined ? {} : { bytes: raw.bytes }) }
  });
  if (!request.success) return refusal("invalid-request");
  const parsedRequest = request.data;

  if (!isReviewData(target)) return refusal("invalid-target");
  const parsedTarget = targetSchema.safeParse(target);
  if (!parsedTarget.success) return refusal("invalid-target");
  const live = parsedTarget.data;

  if (!sameSourceFacts(parsedRequest.expected, live)) return refusal("stale-target");
  if (parsedRequest.expected.clean !== true) return refusal("target-dirty");
  if (parsedRequest.expected.pending !== false) return refusal("target-pending");
  if (parsedRequest.expected.available !== true) return refusal("target-unavailable");
  if (live.clean !== true) return refusal("target-dirty");
  if (live.pending !== false) return refusal("target-pending");
  if (live.available !== true) return refusal("target-unavailable");
  if (live.composing) return refusal("target-composing");
  if (live.held) return refusal("target-held");
  if (live.destroyed) return refusal("target-destroyed");
  if (live.body !== live.savedBody) return refusal("body-mismatch");
  const selectionStart = Math.min(live.selection.anchor, live.selection.head);
  const selectionEnd = Math.max(live.selection.anchor, live.selection.head);
  if (!endpointIsScalarSafe(live.savedBody, selectionStart) || !endpointIsScalarSafe(live.savedBody, selectionEnd) ||
    live.selectedText !== live.savedBody.slice(selectionStart, selectionEnd)) {
    return refusal("invalid-selection");
  }
  try { scalarCount(live.savedBody); } catch { return refusal("invalid-unicode"); }

  let rawBytes: Uint8Array;
  let rawProof: "bytes" | "text";
  if (parsedRequest.raw.bytes !== undefined) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(parsedRequest.raw.bytes);
      if (decoded !== parsedRequest.raw.text) return refusal("raw-encoding-mismatch");
    } catch { return refusal("invalid-utf8"); }
    rawBytes = parsedRequest.raw.bytes;
    rawProof = "bytes";
  } else {
    rawBytes = new TextEncoder().encode(parsedRequest.raw.text);
    rawProof = "text";
  }

  let rawHash: string;
  try { rawHash = await untilAborted(sha256Hex(rawBytes), signal); }
  catch (error) { return error === aborted ? refusal("aborted") : refusal("invalid-request"); }
  if (rawHash !== parsedRequest.expected.rawHash || rawHash !== live.rawHash) return refusal("raw-hash-mismatch");

  let body: string;
  try {
    const parsed = parseChapterFile(parsedRequest.raw.text, "chapter.md", chapterFallback(parsedRequest.expected));
    if (parsed.meta.id !== parsedRequest.expected.chapterId) return refusal("identity-mismatch", "raw-chapter-id");
    if (parsed.meta.version !== parsedRequest.expected.version) return refusal("version-mismatch", "raw-version");
    body = parsed.content;
  } catch (error) {
    const code = contractCode(error);
    return refusal(code === "invalid-unicode" ? "invalid-unicode" : "invalid-raw-format", code);
  }
  if (body !== parsedRequest.expected.savedBody || normalizeBody(body) !== body) return refusal("body-mismatch");
  try { scalarCount(body); } catch { return refusal("invalid-unicode"); }

  let envelope: ReviewEnvelope;
  try { envelope = await untilAborted(validateReviewEnvelope(parsedRequest.envelope), signal); }
  catch (error) {
    if (error === aborted) return refusal("aborted");
    return refusal("invalid-envelope", contractCode(error));
  }
  if (signal.aborted) return refusal("aborted");
  if (envelope.kind !== "reader-review" || !envelope.profile) return refusal("invalid-envelope", "review-kind-profile");
  const book = envelope.books[0];
  if (envelope.books.length !== 1 || !book || book.bookId !== parsedRequest.expected.bookId) {
    return refusal("identity-mismatch", "book-scope");
  }
  const source = envelope.sources[0];
  if (envelope.sources.length !== 1 || !source || source.kind !== "chapter") {
    return refusal("scope-mismatch", "chapter-scope");
  }
  if (!sameSavedIdentity(source.identity, savedIdentityOf(parsedRequest.expected))) {
    return refusal("identity-mismatch", "source-identity");
  }
  if (source.bookTitle !== book.title) return refusal("identity-mismatch", "book-title");
  if (source.bodyLength !== parsedRequest.expected.savedBody.length) return refusal("body-mismatch", "source-body-length");
  const scope = source.segments.map(({ start, end }) => ({ start, end }));
  if (canonicalJson(scope) !== canonicalJson(parsedRequest.scope)) return refusal("scope-mismatch");
  for (const segment of source.segments) {
    if (!validSpan(parsedRequest.expected.savedBody, segment) ||
      segment.text !== parsedRequest.expected.savedBody.slice(segment.start, segment.end) ||
      segment.startLine !== parsedRequest.expected.savedBody.slice(0, segment.start).split("\n").length) {
      return refusal("scope-mismatch");
    }
  }

  let run: ReaderRun;
  try {
    // Reuses the accepted envelope, attribution, limit and citation verifier; no second matcher.
    run = await untilAborted(buildReaderRun({
      runId: envelope.requestId, startedAt: parsedRequest.startedAt, completedAt: parsedRequest.completedAt,
      envelope, output: parsedRequest.output
    }), signal);
  } catch (error) {
    if (error === aborted) return refusal("aborted");
    const code = contractCode(error);
    const mapped: SharedRefusalCode = code === "ambiguous-finding-id" ? "duplicate-finding" :
      code === "run-attribution" || code === "finding-attribution" || code === "run-request-identity" ? "run-mismatch" :
        "output-invalid";
    return refusal(mapped, code);
  }
  if (signal.aborted) return refusal("aborted");

  const spans: InlineSpan[] = [];
  for (const finding of run.findings) {
    const seen = new Set<string>();
    for (const evidence of finding.evidence) {
      const identity = canonicalJson(evidence.citation);
      if (seen.has(identity)) return refusal("duplicate-evidence");
      seen.add(identity);
    }
    // A contradiction with fewer than two distinct references is insufficient evidence; a
    // zero-evidence observation is equally insufficient. Neither contributes a current mark.
    if (finding.evidenceState === "insufficient-evidence") continue;
    for (const [index, evidence] of finding.evidence.entries()) {
      const citation = evidence.citation;
      if (citation.kind !== "chapter" || !sameSavedIdentity(citation.identity, savedIdentityOf(parsedRequest.expected))) {
        return refusal("identity-mismatch", "evidence-identity");
      }
      spans.push(freeze({
        runId: run.runId, findingId: finding.findingId, evidenceId: String(index),
        spanId: `${citation.start}-${citation.end}`, category: finding.category,
        from: citation.start, to: citation.end, quote: citation.quote
      }));
    }
  }
  if (run.findings.length > 0 && spans.length === 0) return refusal("no-verified-evidence");
  try {
    // The same complete-overlap primitive the editor installs; duplicate tuple identities refuse.
    buildOverlapIndex(spans, parsedRequest.expected.savedBody.length);
  } catch { return refusal("duplicate-evidence", "overlap-identity"); }

  const detachedSource = freeze({
    libraryId: parsedRequest.expected.libraryId, bookId: parsedRequest.expected.bookId,
    chapterId: parsedRequest.expected.chapterId, viewGeneration: parsedRequest.expected.viewGeneration,
    sourceEpoch: parsedRequest.expected.sourceEpoch, version: parsedRequest.expected.version,
    rawHash: parsedRequest.expected.rawHash, savedBody: parsedRequest.expected.savedBody,
    clean: true as const, pending: false as const, available: true as const
  });
  const layer = freeze({
    source: detachedSource, spans, findings: run.findings, runId: run.runId,
    scopeDigest: run.envelope.scopeDigest, rawProof
  });
  return freeze({ status: "verified" as const, layer });
}

export interface SharedEvidencePortLike {
  validate(input: unknown, target: SharedReviewTarget, signal: AbortSignal): Promise<SharedVerifiedLayer | null>;
}

/**
 * The inline editor's trusted `ValidatedEvidencePort`, backed by this verifier. A refusal never
 * returns a partial layer or a model-supplied validation flag.
 */
export function createSharedEvidencePort(): SharedEvidencePortLike {
  return Object.freeze({
    validate: async (input: unknown, target: SharedReviewTarget, signal: AbortSignal) => {
      const result = await verifySharedReview(input, target, signal);
      return result.status === "verified" ? result.layer : null;
    }
  });
}
