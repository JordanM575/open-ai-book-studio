import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  applyDispositionEvent, buildCampaignRecord, buildProfileRecord, buildReviewReport, canonicalRecordText,
  decodeReviewRecord, encodeReviewRecord, newDispositionsRecord, recordIdSchema,
  type CampaignDraft, type ReviewDispositions
} from "../../src/review/record-format";
import { REVIEW_RECORD_BYTES } from "../../src/review/record-json";
import { ReviewRecordError } from "../../src/review/record-error";
import { builtinReaderProfile } from "../../src/review/profiles";
import { afterRun, authorProfile, citationFor, item, readerRun, stamp } from "./record-fixtures";

const bookId = "book_123456";
const runId = "run_00000001";
const encoder = new TextEncoder();
const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
const bytesOf = (value: unknown) => encoder.encode(typeof value === "string" ? value : JSON.stringify(value));

async function report(ownerBookId = bookId, id = runId) {
  return buildReviewReport({
    ownerBookId,
    run: await readerRun(ownerBookId, id),
    savedAt: "2026-11-07T12:15:00.000Z",
    sha256
  });
}

function copy(value: unknown): Record<string, unknown> {
  return JSON.parse(canonicalRecordText(value)) as Record<string, unknown>;
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ReviewRecordError) return error.code;
    return `threw:${(error as Error).name}`;
  }
  return "accepted";
}

function decodeReport(bytes: Uint8Array, book = bookId) {
  return decodeReviewRecord(bytes, { kind: "review-report", bookId: book });
}

describe("saved report format 1", () => {
  test("round-trips canonical bytes and never stores a source body or adjacent sentinel", async () => {
    const value = await report();
    const text = canonicalRecordText(value);
    expect(text).not.toContain("ADJACENT_BEFORE");
    expect(text).not.toContain("ADJACENT_AFTER");
    expect(text).toContain(citationFor(bookId).quote);
    expect(text).toContain("Synthetic provider");
    expect(text).toContain("synthetic/model");
    expect(text).toContain("reader-alpha");
    expect(text).not.toContain("Review the selected passage.");
    const bytes = encodeReviewRecord("review-report", value);
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a);
    const decoded = decodeReport(bytes);
    expect(decoded.record).toEqual(value);
    expect(decoded.record.verification).toBe("verified-at-capture");
    expect(decoded.record.coverage.items).toBe(1);
    expect(decoded.record.coverage.sourceBytes).toBeGreaterThan(0);
    expect(decoded.record.disclosure.promptDigest).toBe(await sha256("Review the selected passage."));
    expect(decoded.record.disclosure.priorFeedback).toEqual({ count: 0, digest: await sha256("[]") });
    expect(encodeReviewRecord("review-report", decoded.record)).toEqual(bytes);
  });

  test("refuses malformed, duplicate-key, lone-surrogate, lossy-number and oversized bytes", async () => {
    const text = canonicalRecordText(await report());
    expect(refusal(() => decodeReport(bytesOf(text.slice(0, -1))))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf(text.replace('"id":"run_00000001"', '"id":"run_00000001","id":"run_00000001"'))))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf(text.replace('"Synthetic book"', '"\\ud800"'))))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf(text.replace(/\}$/, ',"future":1.0000000000000001}'))))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf(text.replace(/\}$/, ',"future":9007199254740993}'))))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf(text.replace(/\}$/, ',"future":-0}'))))).toBe("corrupt");
    expect(refusal(() => decodeReport(new Uint8Array(REVIEW_RECORD_BYTES + 1)))).toBe("too-large");
    expect(refusal(() => decodeReport(new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(text)])))).toBe("corrupt");
    expect(refusal(() => decodeReport(encoder.encode("[]")))).toBe("corrupt");
    expect(refusal(() => decodeReport(encoder.encode("")))).toBe("corrupt");
  });

  test("refuses a newer schema, a foreign kind/book/identity and a recovery copy", async () => {
    const raw = copy(await report());
    expect(refusal(() => decodeReport(bytesOf({ ...raw, schemaVersion: 2 })))).toBe("newer-schema");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, kind: "review-dispositions" })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, owner: { bookId: "book_999999" } })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, owner: { bookId: "book_123456", runId } })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, id: "run_00000002" })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, id: "../escape" })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, conflictMetadata: { reason: "external-edit" } })))).toBe("invalid");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, base: { kind: "absent", revision: 0 } })))).toBe("corrupt");
    expect(refusal(() => decodeReport(bytesOf({ ...raw, revision: 2 })))).toBe("corrupt");
  });

  test("refuses a report whose attribution, quotation range or coverage facts disagree", async () => {
    const raw = copy(await report());
    const mutate = (change: (candidate: Record<string, unknown>) => void) => {
      const candidate = copy(raw);
      change(candidate);
      return bytesOf(candidate);
    };
    const finding = (candidate: Record<string, unknown>) =>
      (candidate.findings as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const citation = (candidate: Record<string, unknown>) =>
      (finding(candidate).evidence as Array<Record<string, unknown>>)[0]?.citation as Record<string, unknown>;
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).runId = "run_other"; })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).readerId = "reader-beta"; })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).readerVersion = 2; })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      const quote = citation(candidate);
      quote.quote = `${String(quote.quote)}x`;
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      const quote = citation(candidate);
      quote.identity = { ...(quote.identity as object), version: 4 };
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).claim = "contradiction"; })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).evidenceState = "incomplete-evidence"; })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      (candidate.coverage as Record<string, unknown>).sourceBytes = 1;
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      ((candidate.sources as Array<Record<string, unknown>>)[0] as Record<string, unknown>).bodyLength = 1;
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      ((candidate.sources as Array<Record<string, unknown>>)[0] as Record<string, unknown>).segments = [];
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => {
      candidate.findings = Array.from({ length: 51 }, (_, index) => ({ ...finding(candidate), findingId: `finding-${index}` }));
    })))).toBe("corrupt");
    expect(refusal(() => decodeReport(mutate((candidate) => { finding(candidate).category = "voice-craft"; })))).toBe("unsupported");
    expect(refusal(() => decodeReport(bytesOf(raw), "book_999999"))).toBe("corrupt");
  });

  test("report identity must be a portable file name and the owner must be reviewed", async () => {
    expect(refusal(() => recordIdSchema.parse("a:b"))).toBe("threw:ZodError");
    expect(refusal(() => recordIdSchema.parse(".."))).toBe("threw:ZodError");
    await expect(
      buildReviewReport({
        ownerBookId: "book_999999",
        run: await readerRun(bookId),
        savedAt: "2026-11-07T12:15:00.000Z",
        sha256
      })
    ).rejects.toThrow("must live in one of the books");
    await expect(
      buildReviewReport({
        ownerBookId: bookId,
        run: await readerRun(bookId, "run_bad:id"),
        savedAt: "2026-11-07T12:15:00.000Z",
        sha256
      })
    ).rejects.toThrow("portable file name");
  });
});

describe("saved disposition format 1", () => {
  const at = "2026-11-07T12:11:00.000Z";
  const later = "2026-11-07T12:12:00.000Z";
  const laterStill = "2026-11-07T12:13:00.000Z";
  const reportHash = "b".repeat(64);

  function initial(record: ReviewDispositions = newDispositionsRecord({
    bookId,
    runId,
    reportHash,
    completedAt: afterRun,
    at
  })) {
    return applyDispositionEvent(record, { findingId: "finding-1", state: "ignored", at });
  }

  test("appends ordered author events, preserves unknown fields and keeps a stable no-op", async () => {
    const first = initial();
    expect(first.changed).toBe(true);
    const seeded = {
      ...first.record,
      future: { nested: [" literal ", { unknown: true }] },
      dispositions: [
        {
          ...first.record.dispositions[0],
          futureEntry: "keep",
          events: [{ ...first.record.dispositions[0]?.events[0], futureEvent: { keep: true } }]
        }
      ]
    };
    const bytes = encodeReviewRecord("review-dispositions", seeded);
    const decoded = decodeReviewRecord(bytes, { kind: "review-dispositions", bookId });
    expect(decoded.record.dispositions[0]?.state).toBe("ignored");
    expect(decoded.record.dispositions[0]?.events[0]?.from).toBeNull();
    expect(decoded.record.dispositions[0]?.events[0]?.action).toBe("ignore");
    expect((decoded.raw.future as { nested: unknown[] }).nested[0]).toBe(" literal ");
    const decodedEntries = decoded.raw.dispositions as Array<Record<string, unknown>>;
    expect(item(decodedEntries).futureEntry).toBe("keep");
    expect(item(item(decodedEntries).events as Array<Record<string, unknown>>).futureEvent).toEqual({ keep: true });
    const second = applyDispositionEvent(decoded.record, { findingId: "finding-1", state: "author-resolved", at: later });
    expect(second.changed).toBe(true);
    const next = {
      ...second.record,
      revision: 2,
      base: { kind: "sha256", value: reportHash, revision: 1 },
      updatedAt: later
    };
    const decodedNext = decodeReviewRecord(encodeReviewRecord("review-dispositions", next), {
      kind: "review-dispositions",
      bookId
    });
    expect(decodedNext.record.dispositions[0]?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(decodedNext.record.dispositions[0]?.events[1]?.action).toBe("resolve");
    expect(decodedNext.record.dispositions[0]?.events[1]?.from).toBe("ignored");
    expect((decodedNext.raw.future as { nested: unknown[] }).nested[0]).toBe(" literal ");
    const noop = applyDispositionEvent(decodedNext.record, {
      findingId: "finding-1",
      state: "author-resolved",
      at: laterStill
    });
    expect(noop.changed).toBe(false);
    expect(noop.record).toBe(decodedNext.record);
  });

  test("refuses broken history, a stale base, an unknown state and a foreign run", () => {
    const raw = copy(initial().record) as Record<string, unknown>;
    const entries = raw.dispositions as Array<Record<string, unknown>>;
    const events = (entries[0] as Record<string, unknown>).events as Array<Record<string, unknown>>;
    const decoded = (candidate: Record<string, unknown>) =>
      decodeReviewRecord(bytesOf(candidate), { kind: "review-dispositions", bookId });
    expect(refusal(() => decoded({ ...raw, report: { ...(raw.report as object), runId: "run_other" } }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, dispositions: [] }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, revision: 2 }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, revision: 2, base: { kind: "sha256", value: "a".repeat(64), revision: 2 } }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, dispositions: [{ ...entries[0], events: [{ ...events[0], sequence: 2 }] }] }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, dispositions: [{ ...entries[0], state: "reopened" }] }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, dispositions: [{ ...entries[0], events: [{ ...events[0], from: "ignored" }] }] }))).toBe("corrupt");
    expect(refusal(() => decoded({ ...raw, dispositions: [{ ...entries[0], events: [{ ...events[0], action: "resolve" }] }] }))).toBe("corrupt");
    const unsupported = copy(raw) as Record<string, unknown>;
    ((unsupported.dispositions as Array<Record<string, unknown>>)[0] as Record<string, unknown>).state = "deferred";
    expect(refusal(() => decoded(unsupported))).toBe("unsupported");
    expect(refusal(() => decodeReviewRecord(bytesOf(raw), { kind: "review-dispositions", bookId: "book_999999" }))).toBe("corrupt");
  });

  test("refuses dispositions that are not ordered by finding ID", () => {
    const first = initial();
    const second = applyDispositionEvent(first.record, { findingId: "finding-0", state: "ignored", at: later });
    const ordered = second.record.dispositions.map((entry) => entry.findingId);
    expect(ordered).toEqual([...ordered].sort());
    const raw = copy(second.record) as Record<string, unknown>;
    raw.dispositions = [...(raw.dispositions as unknown[])].reverse();
    expect(refusal(() => decodeReviewRecord(bytesOf(raw), { kind: "review-dispositions", bookId })))
      .toBe("corrupt");
  });
});

describe("saved reader lens and campaign formats", () => {
  const at = "2026-11-07T12:11:00.000Z";

  test("an author lens record is immutable identity plus a checked revision", async () => {
    const profile = await authorProfile();
    const record = buildProfileRecord({
      bookId,
      profile,
      revision: 1,
      base: { kind: "absent", revision: 0 },
      createdAt: at,
      updatedAt: at
    });
    const decoded = decodeReviewRecord(encodeReviewRecord("reader-profile-record", record), {
      kind: "reader-profile-record",
      bookId
    });
    expect(decoded.record.profile.digest).toBe(profile.digest);
    expect(decoded.record.profile.version).toBe(profile.version);
    expect(decoded.record.profile.focus).toEqual([...profile.focus]);
    expect(decoded.record.profile.origin).toBe("author");
    const raw = copy(record) as Record<string, unknown>;
    expect(refusal(() => decodeReviewRecord(bytesOf({ ...raw, id: "author-lens-2" }), { kind: "reader-profile-record", bookId }))).toBe("corrupt");
    expect(refusal(() => decodeReviewRecord(bytesOf(raw), { kind: "reader-profile-record", bookId: "book_999999" }))).toBe("corrupt");
    const unknownMember = copy(record) as Record<string, unknown>;
    (unknownMember.profile as Record<string, unknown>).style = "future";
    expect(refusal(() => decodeReviewRecord(bytesOf(unknownMember), { kind: "reader-profile-record", bookId })))
      .toBe("unsupported");
    const builtin = await builtinReaderProfile("alpha");
    expect(() =>
      buildProfileRecord({
        bookId,
        profile: builtin,
        revision: 1,
        base: { kind: "absent", revision: 0 },
        createdAt: at,
        updatedAt: at
      })
    ).toThrow();
  });

  test("a campaign manifest references reports but embeds neither them nor execution permission", async () => {
    const value = await report();
    const hash = createHash("sha256").update(encodeReviewRecord("review-report", value)).digest("hex");
    const alpha = await builtinReaderProfile("alpha");
    const planned = [{ start: citationFor(bookId).start, end: citationFor(bookId).end }];
    const draft: CampaignDraft = {
      status: "incomplete",
      profile: { id: alpha.id, version: alpha.version, digest: alpha.digest },
      sources: [
        {
          sourceId: "source-1",
          bookId,
          chapterId: "ch_123456",
          title: "Synthetic chapter",
          position: 1,
          version: 3,
          hash: "a".repeat(64),
          planned
        }
      ],
      stages: [
        {
          stageId: "stage-1",
          kind: "range",
          sourceIds: ["source-1"],
          planned,
          status: "completed",
          report: { runId, hash },
          at: afterRun
        }
      ],
      synthesis: [],
      plannedAt: stamp,
      sourceBytes: 40
    };
    const record = buildCampaignRecord({
      bookId,
      id: "campaign-1",
      revision: 1,
      base: { kind: "absent", revision: 0 },
      draft,
      createdAt: at,
      updatedAt: at
    });
    const decoded = decodeReviewRecord(encodeReviewRecord("review-campaign", record), {
      kind: "review-campaign",
      bookId
    });
    expect(decoded.record.stages[0]?.report).toEqual({ runId, hash });
    expect(decoded.record.plan).toMatchObject({ sources: 1, items: 1 });
    expect(JSON.stringify(decoded.record)).not.toContain(citationFor(bookId).quote);
    const noReport = copy(decoded.record) as Record<string, unknown>;
    ((noReport.stages as Array<Record<string, unknown>>)[0] as Record<string, unknown>).report = null;
    expect(refusal(() => decodeReviewRecord(bytesOf(noReport), { kind: "review-campaign", bookId }))).toBe("corrupt");
    const complete = copy(decoded.record) as Record<string, unknown>;
    complete.status = "complete";
    ((complete.stages as Array<Record<string, unknown>>)[0] as Record<string, unknown>).status = "incomplete";
    expect(refusal(() => decodeReviewRecord(bytesOf(complete), { kind: "review-campaign", bookId }))).toBe("corrupt");
    const reused = copy(decoded.record) as Record<string, unknown>;
    (reused.stages as Array<Record<string, unknown>>).push({
      stageId: "stage-2",
      kind: "range",
      sourceIds: ["source-1"],
      planned,
      status: "completed",
      report: { runId, hash: "c".repeat(64) },
      at: afterRun
    });
    expect(refusal(() => decodeReviewRecord(bytesOf(reused), { kind: "review-campaign", bookId }))).toBe("corrupt");
    const unknownSource = copy(decoded.record) as Record<string, unknown>;
    (((unknownSource.stages as Array<Record<string, unknown>>)[0] as Record<string, unknown>).sourceIds as string[]).push("source-9");
    expect(refusal(() => decodeReviewRecord(bytesOf(unknownSource), { kind: "review-campaign", bookId }))).toBe("corrupt");
    expect(() =>
      buildCampaignRecord({
        bookId,
        id: "campaign-2",
        revision: 1,
        base: { kind: "absent", revision: 0 },
        draft: {
          ...draft,
          stages: [{ ...draft.stages[0]!, kind: "synthesis", planned, sourceIds: ["source-1"] }],
          synthesis: []
        },
        createdAt: at,
        updatedAt: at
      })
    ).toThrow();
  });
});

describe("saved record review corrections", () => {
  test("an unknown __proto__ extension survives a campaign update as own data", async () => {
    const alpha = await builtinReaderProfile("alpha");
    const planned = [{ start: citationFor(bookId).start, end: citationFor(bookId).end }];
    const saved = await report();
    const hash = createHash("sha256").update(encodeReviewRecord("review-report", saved)).digest("hex");
    const draft: CampaignDraft = {
      status: "running",
      profile: { id: alpha.id, version: alpha.version, digest: alpha.digest },
      sources: [{
        sourceId: "source-1", bookId, chapterId: "ch_123456", title: "Synthetic chapter",
        position: 1, version: 3, hash: "a".repeat(64), planned
      }],
      stages: [{
        stageId: "stage-1", kind: "range", sourceIds: ["source-1"], planned,
        status: "completed", report: { runId, hash }, at: afterRun
      }],
      synthesis: [],
      plannedAt: stamp,
      sourceBytes: 40
    };
    const first = buildCampaignRecord({
      bookId, id: "campaign-1", revision: 1, base: { kind: "absent", revision: 0 }, draft,
      createdAt: afterRun, updatedAt: afterRun
    });
    const raw = copy(first);
    const source = (raw.sources as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    Object.defineProperty(source, "__proto__", {
      value: { keep: true }, enumerable: true, writable: true, configurable: true
    });
    const updated = buildCampaignRecord({
      bookId, id: "campaign-1", revision: 2,
      base: { kind: "sha256", value: "a".repeat(64), revision: 1 },
      draft, createdAt: afterRun, updatedAt: afterRun, previous: raw
    });
    const updatedSource = (copy(updated).sources as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(Object.hasOwn(updatedSource, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(updatedSource, "__proto__")?.value).toEqual({ keep: true });
    expect(Object.getPrototypeOf(updatedSource)).toBe(Object.prototype);
    expect(() => encodeReviewRecord("review-campaign", updated)).not.toThrow();
  });

  test("a report must live in one of the books it reviewed", async () => {
    const raw = copy(await report());
    (raw.owner as Record<string, unknown>).bookId = "book_999999";
    expect(refusal(() => decodeReviewRecord(bytesOf(raw), { kind: "review-report", bookId: "book_999999" })))
      .toBe("corrupt");
  });

  test("content bytes cannot be fewer than the selected source bytes", async () => {
    const raw = copy(await report());
    (raw.coverage as Record<string, unknown>).contentBytes = 0;
    expect(refusal(() => decodeReviewRecord(bytesOf(raw), { kind: "review-report", bookId })))
      .toBe("corrupt");
  });

  test("a completed synthesis repeats its own stage report and must name a synthesis stage", async () => {
    const first = await report();
    const second = await report(bookId, "run_00000002");
    const hashOf = (value: unknown) => createHash("sha256").update(encodeReviewRecord("review-report", value)).digest("hex");
    const alpha = await builtinReaderProfile("alpha");
    const planned = [{ start: citationFor(bookId).start, end: citationFor(bookId).end }];
    const draft: CampaignDraft = {
      status: "complete",
      profile: { id: alpha.id, version: alpha.version, digest: alpha.digest },
      sources: [{
        sourceId: "source-1", bookId, chapterId: "ch_123456", title: "Synthetic chapter",
        position: 1, version: 3, hash: "a".repeat(64), planned
      }],
      stages: [
        { stageId: "stage-1", kind: "range", sourceIds: ["source-1"], planned,
          status: "completed", report: { runId, hash: hashOf(first) }, at: afterRun },
        { stageId: "stage-2", kind: "synthesis", sourceIds: ["source-1"], planned: [],
          status: "completed", report: { runId: "run_00000002", hash: hashOf(second) }, at: afterRun }
      ],
      synthesis: [{ stageId: "stage-2", sourceStageIds: ["stage-1"],
        report: { runId: "run_00000002", hash: hashOf(second) } }],
      plannedAt: stamp,
      sourceBytes: 40
    };
    const record = buildCampaignRecord({
      bookId, id: "campaign-1", revision: 1, base: { kind: "absent", revision: 0 }, draft,
      createdAt: afterRun, updatedAt: afterRun
    });
    expect(() => decodeReviewRecord(encodeReviewRecord("review-campaign", record),
      { kind: "review-campaign", bookId })).not.toThrow();

    // Naming a range stage as the synthesis stage is refused.
    const wrong = copy(record) as Record<string, unknown>;
    const wrongSynthesis = (wrong.synthesis as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    wrongSynthesis.stageId = "stage-1";
    expect(refusal(() => decodeReviewRecord(bytesOf(wrong), { kind: "review-campaign", bookId })))
      .toBe("corrupt");
  });
});
