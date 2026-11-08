import { describe, expect, test } from "bun:test";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { buildReviewEnvelope, reviewToolNameSchema } from "../../src/review/envelope";
import { builtinReaderProfile } from "../../src/review/profiles";
import { captureChapterSource, type SavedBody } from "../../src/review/sources";
import {
  createSharedEvidencePort, verifySharedReview,
  type SharedReviewSourceFacts, type SharedReviewTarget
} from "../../src/review/shared-verifier";

const stamp = "2026-11-07T12:00:00Z";
const later = "2026-11-07T12:01:00Z";
const bookId = "book_123456";
const chapterId = "ch_123456";
const title = "Synthetic chapter";
const body = normalizeBody("ADJACENT_BEFORE\nA😀 café repeats. A😀 café repeats.\nADJACENT_AFTER");
const first = body.indexOf("A😀 café repeats.");
const passage = "A😀 café repeats.";
const second = body.indexOf(passage, first + 1);
const scope = { start: first, end: second + passage.length };

function chapterFile(version = 3, text = body, id = chapterId): string {
  return serializeChapter({
    id, title, order: 1, arc: "middle", purpose: "", synopsis: "", notes: "",
    isPrologue: false, color: null, version,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, text);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface Fixture {
  facts: SharedReviewSourceFacts;
  target: SharedReviewTarget;
  request: Record<string, unknown>;
  rawText: string;
  bytes: Uint8Array;
  hash: string;
}

async function fixture(options: {
  savedBody?: string; version?: number; rawVersion?: number; rawText?: string;
  ranges?: { start: number; end: number }[]; chapter?: string; book?: string; fileHash?: string;
  envelopeChapter?: string; envelopeBook?: string;
} = {}): Promise<Fixture> {
  const savedBody = options.savedBody ?? body;
  const version = options.version ?? 3;
  const rawVersion = options.rawVersion ?? version;
  const book = options.book ?? bookId;
  const chapter = options.chapter ?? chapterId;
  const envelopeChapter = options.envelopeChapter ?? chapter;
  const envelopeBook = options.envelopeBook ?? book;
  const rawText = options.rawText ?? chapterFile(rawVersion, savedBody, envelopeChapter);
  const bytes = new TextEncoder().encode(rawText);
  const hash = options.fileHash ?? await sha256(bytes);
  const saved: SavedBody = { bookId: envelopeBook, chapterId: envelopeChapter, version, hash, body: savedBody };
  const ranges = options.ranges ?? [scope];
  const source = captureChapterSource({
    sourceId: "source-1", saved, bookTitle: "Synthetic book", title, position: 1,
    capturedAt: stamp, ranges
  });
  const profile = await builtinReaderProfile("alpha");
  const envelope = await buildReviewEnvelope({
    contractVersion: 1, kind: "reader-review", requestId: "request-1", capturedAt: stamp,
    destination: {
      connectionId: "connection-1", provider: "Synthetic provider", model: "synthetic/model",
      endpointIdentity: "endpoint-revision-1"
    },
    environment: {
      hostId: "synthetic-host", hostSupported: true, connectionAvailable: true, modelSupported: true,
      capabilityRevision: "capability-1", estimatedCostUsd: null, priceAsOf: null,
      catalogContextTokens: null, catalogAsOf: null, contextFit: "unknown"
    },
    books: [{
      bookId: envelopeBook, title: "Synthetic book", consentSatisfied: true, consentRevision: "consent-1",
      termsRevision: "terms-1", enabledTools: [...reviewToolNameSchema.options]
    }],
    prompt: "Review the selected passage.", profile, priorFeedback: [], sources: [source]
  });
  const facts: SharedReviewSourceFacts = {
    libraryId: "library-1", bookId: book, chapterId: chapter, viewGeneration: "visit-1",
    sourceEpoch: 1, version, rawHash: hash, savedBody, clean: true, pending: false, available: true
  };
  const selection = ranges[0] ?? scope;
  const target: SharedReviewTarget = {
    ...facts, body: savedBody, selection: { anchor: selection.start, head: selection.end },
    selectedText: savedBody.slice(selection.start, selection.end), composing: false, held: false,
    revision: 0, destroyed: false
  };
  return {
    facts, target, rawText, bytes, hash,
    request: {
      envelope, raw: { text: rawText, bytes }, scope: ranges.map(({ start, end }) => ({ start, end })),
      expected: facts, output: output([]), startedAt: stamp, completedAt: later
    }
  };
}

function citation(start = second, end = second + passage.length, quote = body.slice(start, end)) {
  return {
    kind: "chapter" as const, sourceId: "source-1",
    identity: { bookId, chapterId, version: 3, hash: "PLACEHOLDER" },
    start, end, quote
  };
}

function withHash(hash: string) {
  return (value: ReturnType<typeof citation>) => ({
    ...value, identity: { ...value.identity, hash }
  });
}

function output(findings: unknown[], overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ runId: "request-1", readerId: "reader-alpha", readerVersion: 1, findings, ...overrides });
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "finding-1", category: "clarity", readerId: "reader-alpha", readerVersion: 1,
    runId: "request-1", interpretation: "A subjective observation.", claim: "observation",
    evidence: [], ...overrides
  };
}

function reason(result: Awaited<ReturnType<typeof verifySharedReview>>): string {
  if (result.status !== "refused") throw new Error(`Expected refusal, received ${result.status}`);
  return result.reasons[0]?.code ?? "missing";
}

function layerOf(result: Awaited<ReturnType<typeof verifySharedReview>>) {
  if (result.status !== "verified") throw new Error(`Expected verified, received ${reason(result)}`);
  return result.layer;
}

describe("shared exact-source verifier", () => {
  test("verifies one exact span from raw bytes and returns a detached frozen layer", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    const result = await verifySharedReview(base.request, base.target, new AbortController().signal);
    const layer = layerOf(result);
    expect(layer.rawProof).toBe("bytes");
    expect(layer.source).toEqual({ ...base.facts });
    expect(layer.spans).toHaveLength(1);
    expect(layer.spans[0]).toEqual({
      runId: "request-1", findingId: "finding-1", evidenceId: "0", spanId: `${second}-${second + passage.length}`,
      category: "clarity", from: second, to: second + passage.length, quote: passage
    });
    expect(layer.findings[0]?.evidenceState).toBe("complete");
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.isFrozen(layer.spans)).toBe(true);
    expect(Object.isFrozen(layer.spans[0])).toBe(true);
    expect(Object.isFrozen(layer.findings)).toBe(true);

    base.request.expected = { ...base.facts, savedBody: "mutated after verification" };
    expect(layer.source.savedBody).toBe(body);
    expect(layer.spans[0]?.quote).toBe(passage);
  });

  test("keeps a repeated passage at the supplied occurrence and withholds a mismatched quote", async () => {
    const base = await fixture();
    base.request.output = output([
      finding({ findingId: "finding-second", evidence: [withHash(base.hash)(citation())] }),
      finding({
        findingId: "finding-first-wrong", evidence: [
          withHash(base.hash)(citation(first, first + passage.length, passage.replace(".", "!")))
        ]
      })
    ]);
    const layer = layerOf(await verifySharedReview(base.request, base.target, new AbortController().signal));
    expect(layer.spans).toHaveLength(1);
    expect(layer.spans[0]?.from).toBe(second);
    expect(layer.findings.find((item) => item.findingId === "finding-first-wrong")?.evidenceState)
      .toBe("insufficient-evidence");
    expect(layer.findings.find((item) => item.findingId === "finding-first-wrong")?.invalidEvidence)
      .toEqual([{ index: 0, reason: "quote" }]);
  });

  test("verifies raw text proof when bytes are absent and refuses a mismatched encoding", async () => {
    const base = await fixture();
    base.request.raw = { text: base.rawText };
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    expect(layerOf(await verifySharedReview(base.request, base.target, new AbortController().signal)).rawProof)
      .toBe("text");

    const encoded = await fixture();
    encoded.request.raw = { text: "different text", bytes: encoded.bytes };
    expect(reason(await verifySharedReview(encoded.request, encoded.target, new AbortController().signal)))
      .toBe("raw-encoding-mismatch");
  });

  test("refuses wrong book, chapter, version, body and raw hash", async () => {
    const wrongBook = await fixture({ envelopeBook: "book_654321" });
    wrongBook.request.output = output([finding({ evidence: [withHash(wrongBook.hash)(citation())] })]);
    expect(reason(await verifySharedReview(wrongBook.request, wrongBook.target, new AbortController().signal)))
      .toBe("identity-mismatch");

    const wrongChapter = await fixture({ envelopeChapter: "ch_654321" });
    wrongChapter.request.output = output([finding({ evidence: [withHash(wrongChapter.hash)(citation())] })]);
    expect(reason(await verifySharedReview(wrongChapter.request, wrongChapter.target, new AbortController().signal)))
      .toBe("identity-mismatch");

    const wrongVersion = await fixture({ rawVersion: 4 });
    wrongVersion.request.output = output([finding({ evidence: [withHash(wrongVersion.hash)(citation())] })]);
    expect(reason(await verifySharedReview(wrongVersion.request, wrongVersion.target, new AbortController().signal)))
      .toBe("version-mismatch");

    const wrongBody = await fixture({ rawText: chapterFile(3, normalizeBody("Different body.")) });
    wrongBody.request.output = output([finding({ evidence: [withHash(wrongBody.hash)(citation())] })]);
    expect(reason(await verifySharedReview(wrongBody.request, wrongBody.target, new AbortController().signal)))
      .toBe("body-mismatch");

    const wrongHash = await fixture({ fileHash: "b".repeat(64) });
    wrongHash.request.output = output([finding({ evidence: [withHash(wrongHash.hash)(citation())] })]);
    expect(reason(await verifySharedReview(wrongHash.request, wrongHash.target, new AbortController().signal)))
      .toBe("raw-hash-mismatch");
  });

  test("refuses dirty, pending, unavailable, held, composing and destroyed targets", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    for (const [field, value, code] of [
      ["clean", false, "target-dirty"], ["pending", true, "target-pending"],
      ["available", false, "target-unavailable"], ["held", true, "target-held"],
      ["composing", true, "target-composing"], ["destroyed", true, "target-destroyed"]
    ] as const) {
      expect(reason(await verifySharedReview(base.request, { ...base.target, [field]: value }, new AbortController().signal)))
        .toBe(code);
    }
  });

  test("refuses a stale view generation or source epoch and an out-of-date saved body", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    expect(reason(await verifySharedReview(base.request, { ...base.target, viewGeneration: "visit-2" }, new AbortController().signal)))
      .toBe("stale-target");
    expect(reason(await verifySharedReview(base.request, { ...base.target, sourceEpoch: 2 }, new AbortController().signal)))
      .toBe("stale-target");
    expect(reason(await verifySharedReview({
      ...base.request, expected: { ...base.facts, savedBody: "older body" }
    }, base.target, new AbortController().signal))).toBe("stale-target");
  });

  test("refuses invalid UTF-8 supplied as bytes", async () => {
    const base = await fixture();
    base.request.raw = { text: base.rawText, bytes: new Uint8Array([0xff, 0xfe, 0xfd]) };
    expect(reason(await verifySharedReview(base.request, base.target, new AbortController().signal)))
      .toBe("invalid-utf8");
  });

  test("withholds surrogate-split citation endpoints while retaining another verified span", async () => {
    const base = await fixture();
    const emoji = body.indexOf("😀");
    base.request.output = output([
      finding({ findingId: "finding-valid", evidence: [withHash(base.hash)(citation())] }),
      finding({
        findingId: "finding-split", evidence: [
          withHash(base.hash)(citation(emoji + 1, emoji + 3, "😀"))
        ]
      })
    ]);
    const layer = layerOf(await verifySharedReview(base.request, base.target, new AbortController().signal));
    expect(layer.spans).toHaveLength(1);
    expect(layer.findings.find((item) => item.findingId === "finding-split")?.invalidEvidence)
      .toEqual([{ index: 0, reason: "range" }]);
  });

  test("requires selected-segment membership, never the bounding box across a gap", async () => {
    const gapStart = second + passage.length + 1;
    const gapEnd = gapStart + 8;
    const selected = [{ start: first, end: second + passage.length }, { start: gapEnd, end: gapEnd + 5 }];
    const base = await fixture({ ranges: selected });
    base.request.output = output([
      finding({ findingId: "finding-in-gap", evidence: [withHash(base.hash)(citation(gapStart, gapStart + 5, body.slice(gapStart, gapStart + 5)))] }),
      finding({ findingId: "finding-inside", evidence: [withHash(base.hash)(citation(gapEnd, gapEnd + 5, body.slice(gapEnd, gapEnd + 5)))] })
    ]);
    const layer = layerOf(await verifySharedReview(base.request, base.target, new AbortController().signal));
    expect(layer.spans).toHaveLength(1);
    expect(layer.spans[0]?.from).toBe(gapEnd);
    expect(layer.findings.find((item) => item.findingId === "finding-in-gap")?.invalidEvidence)
      .toEqual([{ index: 0, reason: "range" }]);

    base.request.scope = [{ start: first, end: scope.end - 1 }];
    expect(reason(await verifySharedReview(base.request, base.target, new AbortController().signal)))
      .toBe("scope-mismatch");
  });

  test("refuses duplicate finding and evidence identity", async () => {
    const duplicateFinding = await fixture();
    duplicateFinding.request.output = output([
      finding({ findingId: "same", evidence: [withHash(duplicateFinding.hash)(citation())] }),
      finding({ findingId: "same", evidence: [withHash(duplicateFinding.hash)(citation())] })
    ]);
    expect(reason(await verifySharedReview(duplicateFinding.request, duplicateFinding.target, new AbortController().signal)))
      .toBe("duplicate-finding");

    const duplicateEvidence = await fixture();
    const repeated = withHash(duplicateEvidence.hash)(citation());
    duplicateEvidence.request.output = output([finding({ evidence: [repeated, repeated] })]);
    expect(reason(await verifySharedReview(duplicateEvidence.request, duplicateEvidence.target, new AbortController().signal)))
      .toBe("duplicate-evidence");
  });

  test("refuses foreign run and reader attribution", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })], { runId: "request-2" });
    expect(reason(await verifySharedReview(base.request, base.target, new AbortController().signal)))
      .toBe("run-mismatch");

    base.request.output = output([finding({ readerId: "reader-beta", evidence: [withHash(base.hash)(citation())] })]);
    expect(reason(await verifySharedReview(base.request, base.target, new AbortController().signal)))
      .toBe("run-mismatch");
  });

  test("accepts a digest-checked envelope copy and refuses a tampered one", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    const copy = JSON.parse(JSON.stringify(base.request.envelope));
    expect((await verifySharedReview({ ...base.request, envelope: copy }, base.target, new AbortController().signal)).status)
      .toBe("verified");

    copy.scopeDigest = "b".repeat(64);
    expect(reason(await verifySharedReview({ ...base.request, envelope: copy }, base.target, new AbortController().signal)))
      .toBe("invalid-envelope");

    const tampered = JSON.parse(JSON.stringify(base.request.envelope));
    tampered.sources[0].segments[0].text = "tampered";
    expect(reason(await verifySharedReview({ ...base.request, envelope: tampered }, base.target, new AbortController().signal)))
      .toBe("invalid-envelope");
  });

  test("applies the contradiction reference count and category rule", async () => {
    const one = await fixture();
    one.request.output = output([
      finding({
        findingId: "contradiction-one", category: "continuity", claim: "contradiction",
        evidence: [withHash(one.hash)(citation())]
      }),
      finding({ findingId: "observation", evidence: [withHash(one.hash)(citation(first, first + passage.length))] })
    ]);
    const single = layerOf(await verifySharedReview(one.request, one.target, new AbortController().signal));
    expect(single.spans).toHaveLength(1);
    expect(single.findings.find((item) => item.findingId === "contradiction-one")?.evidenceState)
      .toBe("insufficient-evidence");

    const two = await fixture();
    two.request.output = output([finding({
      findingId: "contradiction-two", category: "continuity", claim: "contradiction",
      evidence: [
        withHash(two.hash)(citation()),
        withHash(two.hash)(citation(first, first + passage.length))
      ]
    })]);
    const pair = layerOf(await verifySharedReview(two.request, two.target, new AbortController().signal));
    expect(pair.spans).toHaveLength(2);
    expect(pair.findings[0]?.evidenceState).toBe("complete");

    const wrongCategory = await fixture();
    wrongCategory.request.output = output([finding({
      category: "clarity", claim: "contradiction", evidence: [withHash(wrongCategory.hash)(citation())]
    })]);
    expect(reason(await verifySharedReview(wrongCategory.request, wrongCategory.target, new AbortController().signal)))
      .toBe("output-invalid");
  });

  test("refuses oversized output, quote and finding count", async () => {
    const oversized = await fixture();
    oversized.request.output = "x".repeat(262_145);
    const outputRefusal = await verifySharedReview(oversized.request, oversized.target, new AbortController().signal);
    expect(reason(outputRefusal)).toBe("output-invalid");
    if (outputRefusal.status === "refused") expect(outputRefusal.reasons[0]?.contractCode).toBe("output-byte-limit");

    const longBody = "y".repeat(501);
    const longFixture = await longBodyFixture(longBody);
    const quoteRefusal = await verifySharedReview(longFixture.request, longFixture.target, new AbortController().signal);
    expect(reason(quoteRefusal)).toBe("output-invalid");
    if (quoteRefusal.status === "refused") expect(quoteRefusal.reasons[0]?.contractCode).toBe("quote-scalar-limit");

    const many = await fixture();
    many.request.output = output(Array.from({ length: 51 }, (_, index) =>
      finding({ findingId: `finding-${index}`, evidence: [withHash(many.hash)(citation())] })));
    expect(reason(await verifySharedReview(many.request, many.target, new AbortController().signal)))
      .toBe("output-invalid");
  });

  test("returns no layer when every finding has no verifiable evidence", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation(0, 4, body.slice(0, 4)))] })]);
    expect(reason(await verifySharedReview(base.request, base.target, new AbortController().signal)))
      .toBe("no-verified-evidence");
  });

  test("honors abort before and during async hash/validation", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    const before = new AbortController();
    before.abort();
    expect(reason(await verifySharedReview(base.request, base.target, before.signal))).toBe("aborted");

    const during = new AbortController();
    const pending = verifySharedReview(base.request, base.target, during.signal);
    during.abort();
    expect(reason(await pending)).toBe("aborted");
  });

  test("the port returns only a layer or null and structurally matches the inline seam", async () => {
    const base = await fixture();
    base.request.output = output([finding({ evidence: [withHash(base.hash)(citation())] })]);
    const port = createSharedEvidencePort();
    const layer = await port.validate(base.request, base.target, new AbortController().signal);
    expect(layer?.spans).toHaveLength(1);
    expect(Object.isFrozen(port)).toBe(true);
    const invalid = await port.validate({ ...base.request, output: "not json" }, base.target, new AbortController().signal);
    expect(invalid).toBeNull();

    // Structural compatibility with the app contract, without importing app/editor code.
    interface InlineSourceLike {
      readonly libraryId: string; readonly bookId: string; readonly chapterId: string;
      readonly viewGeneration: string; readonly sourceEpoch: number; readonly version: number;
      readonly rawHash: string; readonly savedBody: string; readonly clean: boolean;
      readonly pending: boolean; readonly available: boolean;
    }
    interface InlineLayerLike {
      readonly source: InlineSourceLike;
      readonly spans: readonly { readonly runId: string; readonly findingId: string;
        readonly evidenceId: string; readonly spanId: string; readonly category: string;
        readonly from: number; readonly to: number; readonly quote: string }[];
    }
    const inline: InlineLayerLike | null = layer;
    expect(inline?.source.chapterId).toBe(chapterId);
  });

  test("imports no provider, Library, filesystem or app/editor module", async () => {
    const source = await Bun.file(new URL("../../src/review/shared-verifier.ts", import.meta.url)).text();
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "../markdown", "../schema", "./contract", "./envelope", "./findings",
      "./inline/overlap", "./sources", "zod"
    ]);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/node:fs|node:path|electron|ipcRenderer|window\.studio/);
  });
});

/** A fixture with one 501-scalar passage so the quote limit, not the body, refuses. */
async function longBodyFixture(longBody: string): Promise<Fixture> {
  const savedBody = normalizeBody(longBody);
  const base = await fixture({ savedBody, ranges: [{ start: 0, end: savedBody.length }] });
  base.request.output = output([finding({
    evidence: [withHash(base.hash)(citation(0, savedBody.length, savedBody))]
  })]);
  return base;
}

describe("saved chapter identity must be declared by the file", () => {
  test("a headerless chapter is refused instead of inheriting the host's expected identity", async () => {
    const base = await fixture({ rawText: body });
    const result = await verifySharedReview(base.request, base.target, new AbortController().signal);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(["invalid-raw-format", "identity-mismatch"]).toContain(result.reasons[0]?.code);
  });

  test("front matter that omits id or version is refused", async () => {
    for (const front of ["---\ntitle: Synthetic chapter\n---\n", "---\nid: ch_123456\n---\n",
      "---\ntitle: Synthetic chapter\nversion: 3\n---\n"]) {
      const base = await fixture({ rawText: `${front}${body}` });
      const result = await verifySharedReview(base.request, base.target, new AbortController().signal);
      expect(result.status).toBe("refused");
      if (result.status !== "refused") continue;
      expect(["invalid-raw-format", "identity-mismatch", "version-mismatch"]).toContain(result.reasons[0]?.code);
    }
  });

  test("declared matching identity still verifies", async () => {
    const base = await fixture();
    const result = await verifySharedReview(base.request, base.target, new AbortController().signal);
    expect(result.status).toBe("verified");
  });
});

describe("request status facts and body length", () => {
  test("an expected dirty, pending or unavailable flag refuses before verification", async () => {
    for (const [field, value, code] of [
      ["clean", false, "target-dirty"], ["pending", true, "target-pending"], ["available", false, "target-unavailable"]
    ] as const) {
      const base = await fixture();
      const request = { ...base.request, expected: { ...base.facts, [field]: value } };
      const result = await verifySharedReview(request, base.target, new AbortController().signal);
      expect(result.status).toBe("refused");
      if (result.status === "refused") expect(result.reasons[0]?.code).toBe(code);
    }
  });
});
