import { describe, expect, test } from "bun:test";
import {
  createReviewRecordApi, reviewRecordHandler, type ReviewRecordResult
} from "../../src/library/review-record-api";
import { encodeReviewRecord } from "../../src/review/record-format";
import { ReviewRecordError } from "../../src/review/record-error";
import { dispositionPath, reportPath } from "../../src/review/record-store";
import { makeBook, readerRun } from "./record-fixtures";
import { toLibraryFilePath } from "../../src/library/path";

function value<T>(result: ReviewRecordResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
function required<T>(item: T | null | undefined): T {
  if (item == null) throw new Error("Missing synthetic fixture value");
  return item;
}
async function fixture() {
  const result = await makeBook();
  const handler = reviewRecordHandler(() => result.library);
  const api = createReviewRecordApi(async (payload) => structuredClone(await handler(structuredClone(payload))));
  const scope = value(await api.open(result.book.id, crypto.randomUUID()));
  const run = await readerRun(result.book.id);
  return { ...result, handler, api, scope, run };
}

describe("bound saved-review transport", () => {
  test("explicit save, immutable same-ID no-op, list/read and dispositions preserve manuscript hashes", async () => {
    const { library, book, port, api, scope, run } = await fixture();
    const chapter = await library.createChapter(book.id, { title: "Synthetic chapter", content: "Synthetic manuscript unchanged." });
    const path = toLibraryFilePath(["books", book.id, "chapters", chapter.path]);
    const before = await port.readFile(path);
    let commits = 0;
    const commit = port.commitFile.bind(port);
    port.commitFile = (...args) => { commits++; return commit(...args); };
    expect(value(await api.list(scope)).total).toBe(0);
    expect(commits).toBe(0);
    const first = value(await api.save(scope, run));
    expect(first.status).toBe("created");
    const afterSave = commits;
    expect(value(await api.save(scope, run))).toEqual({ ...first, status: "unchanged" });
    const list = value(await api.list(scope));
    expect(list.reports[0]?.hash).toBe(first.report.hash);
    expect(value(await api.read(scope, run.runId, first.report.hash))).toEqual(first.report);
    expect(value(await api.readDispositions(scope, run.runId, first.report.hash))).toBeNull();
    expect(commits).toBe(afterSave);
    expect(first.report.rawJson).not.toContain("ADJACENT_BEFORE");
    expect(first.report.rawJson).not.toContain("Review the selected passage.");
    expect(first.report.record.verification).toBe("verified-at-capture");
    await library.reviewRecords.recordDisposition(book.id, run.runId, { findingId: "finding-1", state: "ignored" });
    expect(value(await api.readDispositions(scope, run.runId, first.report.hash))?.record.dispositions[0]?.state).toBe("ignored");
    expect((await port.readFile(path))?.sha256).toBe(before?.sha256);
    expect(before).not.toBeNull();
  });

  test("different same-ID content preserves a bound conflict savedAs and leaves the original intact", async () => {
    const { api, scope, run, port, book } = await fixture();
    const first = value(await api.save(scope, run));
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Another subjective opinion." })) };
    const result = await api.save(scope, changed);
    expect(result).toMatchObject({ ok: false, error: { code: "conflict", outcome: "conflict" } });
    if (result.ok) throw new Error("Expected conflict");
    expect(result.error.savedAs).toStartWith(`books/${book.id}/conflicts/`);
    expect((await port.readFile(reportPath(book.id, run.runId)))?.sha256).toBe(first.report.hash);
  });

  test.each(["uncertain", "not-kept", "unsupported"] as const)("preserves %s without retry or fabricated success", async (code) => {
    const { api, library, scope, run } = await fixture();
    let calls = 0;
    library.reviewRecords.createReport = async () => { calls++; throw new ReviewRecordError(code, "Synthetic bounded storage refusal."); };
    expect(await api.save(scope, run)).toMatchObject({ ok: false, error: { code, outcome: code === "unsupported" ? "refused" : code } });
    expect(calls).toBe(1);
  });

  test("postpublication uncertainty is retained and inspectable without replay", async () => {
    const { api, scope, run, library } = await fixture();
    const create = library.reviewRecords.createReport.bind(library.reviewRecords);
    let calls = 0;
    library.reviewRecords.createReport = async (...args) => { calls++; await create(...args); throw new Error("Synthetic lost receipt"); };
    expect(await api.save(scope, run)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    const list = value(await api.list(scope));
    expect(value(await api.read(scope, run.runId, required(list.reports[0]).hash)).record.id).toBe(run.runId);
    expect(calls).toBe(1);
  });

  test("malformed host readback after publication is uncertain, not a pre-write refusal", async () => {
    const { api, scope, run, library } = await fixture();
    const create = library.reviewRecords.createReport.bind(library.reviewRecords);
    let calls = 0;
    library.reviewRecords.createReport = async (...args) => {
      calls++;
      const saved = await create(...args);
      return { ...saved, report: { ...saved.report, bytes: new TextEncoder().encode("{}") } };
    };
    expect(await api.save(scope, run)).toMatchObject({ ok: false, error: { code: "uncertain", outcome: "uncertain" } });
    expect(value(await api.list(scope)).total).toBe(1);
    expect(calls).toBe(1);
  });

  test("forged quote verification and source hashes never enter the store", async () => {
    const { api, scope, run, library } = await fixture();
    let calls = 0;
    library.reviewRecords.createReport = async () => { calls++; throw new Error("Must not run"); };
    const forged = structuredClone(run);
    const finding = required(forged.findings[0]);
    const evidence = required(finding.evidence[0]);
    const bad = { ...forged, findings: [{ ...finding, evidence: [{ ...evidence, citation: { ...evidence.citation, quote: "Invented quotation" } }] }] };
    expect(await api.save(scope, bad)).toMatchObject({ ok: false, error: { code: "invalid", outcome: "refused" } });
    expect(calls).toBe(0);
  });

  test("future/corrupt files stay visible with separately bounded issue paging and no writes", async () => {
    const { api, scope, port, book } = await fixture();
    for (let index = 0; index < 53; index++) {
      await port.commitFile(reportPath(book.id, `future-${index}`), new TextEncoder().encode('{"schemaVersion":2}'), { kind: "absent" });
    }
    let commits = 0;
    port.commitFile = async () => { commits++; throw new Error("Read must not write"); };
    const list = value(await api.list(scope));
    expect(list).toMatchObject({ total: 0, issueTotal: 53, issueOffset: 0 });
    expect(list.issues).toHaveLength(50);
    expect(list.issues[0]?.code).toBe("newer-schema");
    expect(value(await api.list(scope, 0, 50)).issues).toHaveLength(3);
    expect(commits).toBe(0);
  });

  test("stale report hash refuses; disposition report/finding binding is checked", async () => {
    const { api, scope, run, library, book, port } = await fixture();
    const report = value(await api.save(scope, run)).report;
    expect((await api.read(scope, run.runId, "b".repeat(64))).ok).toBe(false);
    const saved = await library.reviewRecords.recordDisposition(book.id, run.runId, { findingId: "finding-1", state: "ignored" });
    await port.commitFile(dispositionPath(book.id, run.runId), encodeReviewRecord("review-dispositions", {
      ...saved.record.record, report: { ...saved.record.record.report, hash: "c".repeat(64) }
    }), { kind: "any" });
    expect((await api.readDispositions(scope, run.runId, report.hash)).ok).toBe(false);
  });

  test("unsupported checked disposition seam refuses before calling the unchecked method", async () => {
    const { api, scope, run, library } = await fixture();
    const report = value(await api.save(scope, run)).report;
    let calls = 0;
    library.reviewRecords.recordDisposition = async () => { calls++; throw new Error("Unchecked mutation"); };
    const result = await api.saveDisposition({ scope, id: run.runId, hash: report.hash, base: { kind: "absent" },
      findingId: "finding-1", state: "ignored", note: "Retain my exact note  " });
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported", outcome: "refused" } });
    expect(calls).toBe(0);
  });

  test("library switch during validation never retargets a write; old tokens refuse", async () => {
    const first = await makeBook();
    const second = await makeBook();
    let current = first.library;
    const api = createReviewRecordApi(reviewRecordHandler(() => current));
    const scope = value(await api.open(first.book.id, crypto.randomUUID()));
    const run = await readerRun(first.book.id);
    let writes = 0;
    first.library.reviewRecords.createReport = async () => { writes++; throw new Error("Must not run"); };
    second.library.reviewRecords.createReport = async () => { writes++; throw new Error("Must not run"); };
    const promise = api.save(scope, run);
    current = second.library;
    expect((await promise).ok).toBe(false);
    expect(await api.list(scope)).toMatchObject({ ok: false, error: { code: "changed" } });
    expect(writes).toBe(0);
  });

  test.each(["requestId", "requestDigest", "hash", "contents", "savedAs"])("foreign %s cannot become success and is never retried", async (fault) => {
    const { handler, scope, run } = await fixture();
    let calls = 0;
    const api = createReviewRecordApi(async (payload) => {
      calls++;
      const response = await handler(payload) as { requestId: string; requestDigest: string; result: { ok: boolean; data: { report: { hash: string; rawJson: string } }; error?: unknown } };
      if (fault === "requestId") response.requestId = crypto.randomUUID();
      if (fault === "requestDigest") response.requestDigest = "b".repeat(64);
      if (fault === "hash") response.result.data.report.hash = "b".repeat(64);
      if (fault === "contents") response.result.data.report.rawJson = "{}";
      if (fault === "savedAs") response.result = { ok: false, error: { code: "conflict", outcome: "conflict", message: "Kept", savedAs: "books/book_foreign1/conflicts/copy.json" } } as never;
      return response;
    });
    expect(await api.save(scope, run)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(calls).toBe(1);
  });

  test("unavailable host, invalid IDs, extra paths and accessors cannot reach storage", async () => {
    const api = createReviewRecordApi(reviewRecordHandler(() => ({})));
    expect(await api.open("book_synthetic01", crypto.randomUUID())).toMatchObject({ ok: false, error: { code: "unsupported" } });
    let calls = 0;
    const invalid = createReviewRecordApi(async () => { calls++; return null; });
    expect((await invalid.open("../../other", crypto.randomUUID())).ok).toBe(false);
    const { handler, scope } = await fixture();
    let getters = 0;
    await expect(handler({ requestId: crypto.randomUUID(), request: { operation: "list", scope,
      get offset() { getters++; return 0; }, issueOffset: 0 } })).rejects.toThrow();
    await expect(handler({ requestId: crypto.randomUUID(), request: { operation: "list", scope, offset: 0, issueOffset: 0, path: "/forbidden" } })).rejects.toThrow();
    expect(calls).toBe(0);
    expect(getters).toBe(0);
  });
});
