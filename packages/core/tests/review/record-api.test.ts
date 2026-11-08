import { afterEach, describe, expect, test } from "bun:test";
import {
  createReviewRecordApi, reviewRecordHandler, type ReviewRecordResult, type ReviewRecordScope, type SavedReview, type SavedDispositions
} from "../../src/library/review-record-api";
import { decodeReviewRecord, encodeReviewRecord } from "../../src/review/record-format";
import { ReviewRecordError } from "../../src/review/record-error";
import { dispositionPath, reportPath } from "../../src/review/record-store";
import { makeBook, readerRun } from "./record-fixtures";
import { toLibraryFilePath } from "../../src/library/path";
import type { ReviewInspection } from "../../src/review/record-recovery";

function value<T>(result: ReviewRecordResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
function required<T>(item: T | null | undefined): T {
  if (item == null) throw new Error("Missing synthetic fixture value");
  return item;
}
const manuscriptChecks: Array<() => Promise<void>> = [];
afterEach(async () => { for (const check of manuscriptChecks.splice(0)) await check(); });
async function fixture() {
  const result = await makeBook();
  const chapter = await result.library.createChapter(result.book.id, { title: "Sentinel manuscript", content: "Synthetic sentinel: every review outcome leaves me unchanged." });
  const path = toLibraryFilePath(["books", result.book.id, "chapters", chapter.path]);
  const read = result.port.readFile.bind(result.port);
  const before = required(await read(path)).sha256;
  manuscriptChecks.push(async () => { expect(required(await read(path)).sha256).toBe(before); });
  const handler = reviewRecordHandler(() => result.library);
  const api = createReviewRecordApi(async (payload) => structuredClone(await handler(structuredClone(payload))));
  const scope = value(await api.open(result.book.id, crypto.randomUUID()));
  const run = await readerRun(result.book.id);
  return { ...result, handler, api, scope, run };
}
function intent(scope: ReviewRecordScope, report: SavedReview, base: SavedDispositions | null = null) {
  return { scope, id: report.record.id, hash: report.hash, report: { hash: report.hash, rawJson: report.rawJson },
    base: base ? { kind: "sha256" as const, value: base.hash, revision: base.record.revision, rawJson: base.rawJson } : { kind: "absent" as const },
    findingId: "finding-1", state: "ignored" as const, note: "Retain my exact note  \n" };
}
function confirmation(group: ReviewInspection) {
  return { id: group.id, groupId: group.groupId, hash: group.hash, token: group.token };
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
    const copy = required(result.error.copy);
    expect(new TextDecoder().decode(required(await port.readFile(toLibraryFilePath(required(result.error.savedAs).split("/")))).bytes)).toBe(copy.rawJson);
    expect(copy.rawJson).toContain("Another subjective opinion.");
    expect((await port.readFile(reportPath(book.id, run.runId)))?.sha256).toBe(first.report.hash);
  });

  test.each(["missing", "unrelated"] as const)("host rejects %s named report copy even with a complete matching receipt", async (fault) => {
    const { api, scope, run, port, book, library } = await fixture();
    value(await api.save(scope, run));
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Intended synthetic report" })) };
    const legitimate = await api.save(scope, changed);
    if (legitimate.ok || !legitimate.error.copy) throw new Error("Expected checked conflict");
    const path = `books/${book.id}/conflicts/review-report.forged.json`;
    if (fault === "unrelated") await port.commitFile(toLibraryFilePath(path.split("/")), new TextEncoder().encode("unrelated bytes"), { kind: "absent" });
    let calls = 0;
    library.reviewRecords.createReport = async () => { calls++; throw new ReviewRecordError("conflict", "Forged", path, legitimate.error.copy); };
    expect(await api.save(scope, changed)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(calls).toBe(1);
  });

  test.each(["missing", "unrelated", "other-intent"] as const)("receiver rejects %s report-copy claims and retains uncertainty", async (fault) => {
    const { api, handler, scope, run, port, book } = await fixture();
    value(await api.save(scope, run));
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Intended synthetic report" })) };
    const forgedPath = `books/${book.id}/conflicts/review-report.forged.json`;
    if (fault === "unrelated") await port.commitFile(toLibraryFilePath(forgedPath.split("/")), new TextEncoder().encode("unrelated bytes"), { kind: "absent" });
    const other = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Other intent" })) };
    const otherResult = await api.save(scope, other);
    if (otherResult.ok) throw new Error("Expected other conflict");
    let saves = 0;
    const receiver = createReviewRecordApi(async (payload) => {
      const request = payload as { request: { operation: string } };
      const response = await handler(payload) as { result: { ok: boolean; error?: { savedAs?: string | undefined; copy?: { at: string; hash: string; rawJson: string } | undefined } } };
      if (request.request.operation === "save") {
        saves++;
        if (!response.result.error) throw new Error("Expected report conflict");
        if (fault === "other-intent") response.result.error = { ...otherResult.error };
        else response.result.error.savedAs = forgedPath;
      }
      return response;
    });
    expect(await receiver.save(scope, changed)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(saves).toBe(1);
  });

  test("lost independent report-copy readback stays uncertain and never retries publication", async () => {
    const { api, handler, scope, run } = await fixture();
    value(await api.save(scope, run));
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Readback must be confirmed." })) };
    let saves = 0, reads = 0;
    const receiver = createReviewRecordApi(async (payload) => {
      const request = payload as { request: { operation: string } };
      if (request.request.operation === "readReportConflict") { reads++; throw new Error("Lost independent readback"); }
      if (request.request.operation === "save") saves++;
      return handler(payload);
    });
    expect(await receiver.save(scope, changed)).toMatchObject({ ok: false, error: { code: "uncertain", outcome: "uncertain" } });
    expect(saves).toBe(1);
    expect(reads).toBe(1);
  });

  test("named report-copy reads require a current owning book and a narrow conflict path", async () => {
    const { api, scope, run, book, library, port } = await fixture();
    value(await api.save(scope, run));
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Synthetic copy for readback." })) };
    const conflict = await api.save(scope, changed);
    if (conflict.ok || !conflict.error.savedAs) throw new Error("Expected report conflict");
    expect((await library.reviewRecords.readReportConflictCopy(book.id, conflict.error.savedAs)).rawJson).toContain("Synthetic copy for readback.");
    await expect(library.reviewRecords.readReportConflictCopy(book.id, `books/${book.id}/reviews/${run.runId}.json`)).rejects.toThrow();
    await port.removeFile(toLibraryFilePath(["books", book.id, "book.json"]));
    await expect(library.reviewRecords.readReportConflictCopy(book.id, conflict.error.savedAs)).rejects.toThrow();
  });

  test("report conflict publication uncertainty remains uncertain without a retry", async () => {
    const { api, scope, run, port } = await fixture();
    value(await api.save(scope, run));
    const commit = port.commitFile.bind(port);
    let writes = 0;
    port.commitFile = async (path, bytes, expected) => {
      if (path.includes("conflicts")) { writes++; await commit(path, bytes, expected); return { status: "changed", current: null, publication: "uncertain" }; }
      return commit(path, bytes, expected);
    };
    const changed = { ...run, findings: run.findings.map((finding) => ({ ...finding, interpretation: "Uncertain publication" })) };
    expect(await api.save(scope, changed)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(writes).toBe(1);
  });

  test.each([false, true])("disposition rejects top-level accessor without execution or synchronous throw (throws=%s)", async (throws) => {
    const { api, scope, run, library } = await fixture();
    const report = value(await api.save(scope, run)).report;
    let gets = 0, writes = 0;
    const original = library.reviewRecords.recordDispositionChecked.bind(library.reviewRecords);
    library.reviewRecords.recordDispositionChecked = async (...args) => { writes++; return original(...args); };
    const input = intent(scope, report);
    Object.defineProperty(input, "state", { enumerable: true, get() { gets++; if (throws) throw new Error("getter"); return "ignored"; } });
    const promise = api.saveDisposition(input);
    expect(await promise).toMatchObject({ ok: false, error: { code: "invalid", outcome: "refused" } });
    expect(gets).toBe(0);
    expect(writes).toBe(0);
  });

  test("disposition inputs detach synchronously before their caller mutates nested data", async () => {
    const { api, scope, run } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const input = intent(scope, report);
    input.note = "Before await  \n";
    const pending = api.saveDisposition(input);
    input.note = "After await";
    input.report.rawJson = "changed";
    expect(value(await pending).record.record.dispositions[0]?.events[0]?.note).toBe("Before await  \n");
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

  test("checked disposition save/reopen never calls the unchecked method", async () => {
    const { api, scope, run, library } = await fixture();
    const report = value(await api.save(scope, run)).report;
    let calls = 0;
    library.reviewRecords.recordDisposition = async () => { calls++; throw new Error("Unchecked mutation"); };
    const result = value(await api.saveDisposition(intent(scope, report)));
    expect(result.record.record.dispositions[0]?.events[0]?.note).toBe("Retain my exact note  \n");
    expect(value(await api.readDispositions(scope, run.runId, report.hash))).toEqual(result.record);
    expect(calls).toBe(0);
  });

  test.each(["competing", "missing", "report-replaced", "report-missing"])("%s inspected base keeps full stale history and unknown own fields", async (fault) => {
    const { api, scope, run, port, book } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const initial = value(await api.saveDisposition(intent(scope, report))).record;
    const unknown = JSON.parse(initial.rawJson);
    Object.defineProperty(unknown, "__proto__", { value: { kept: true }, enumerable: true });
    unknown.dispositions[0].extension = "entry kept";
    unknown.dispositions[0].events[0].extension = "event kept";
    await port.commitFile(dispositionPath(book.id, run.runId), new TextEncoder().encode(JSON.stringify(unknown)), { kind: "any" });
    const base = required(value(await api.readDispositions(scope, run.runId, report.hash)));
    if (fault === "competing") value(await api.saveDisposition({ ...intent(scope, report, base), note: "Other author", state: "author-resolved" }));
    if (fault === "missing") await port.removeFile(dispositionPath(book.id, run.runId));
    if (fault === "report-missing") await port.removeFile(reportPath(book.id, run.runId));
    if (fault === "report-replaced") await port.commitFile(reportPath(book.id, run.runId), encodeReviewRecord("review-report", { ...report.record, extra: "replacement" }), { kind: "any" });
    const before = await port.readFile(dispositionPath(book.id, run.runId));
    const result = await api.saveDisposition({ ...intent(scope, report, base), state: "reopened", note: "Stale exact intent  \n" });
    expect(result).toMatchObject({ ok: false, error: { outcome: "conflict" } });
    if (result.ok) throw new Error("Expected conflict");
    const copy = required(await port.readFile(toLibraryFilePath(required(result.error.savedAs).split("/"))));
    const decoded = decodeReviewRecord(copy.bytes, { kind: "review-dispositions", bookId: book.id, allowConflictMetadata: true });
    expect(decoded.record.dispositions[0]?.events.map((event) => event.note)).toEqual(["Retain my exact note  \n", "Stale exact intent  \n"]);
    expect(Object.hasOwn(decoded.raw, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded.raw, "__proto__")?.value).toEqual({ kept: true });
    expect(decoded.record.dispositions[0]?.extension).toBe("entry kept");
    expect(decoded.record.dispositions[0]?.events[0]?.extension).toBe("event kept");
    expect((await port.readFile(dispositionPath(book.id, run.runId)))?.sha256).toBe(before?.sha256);
  });

  test("two commands with the same inspected absent base serialize to saved plus conflict, not a fresh-state append", async () => {
    const { api, scope, run } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const results = await Promise.all([api.saveDisposition(intent(scope, report)), api.saveDisposition({ ...intent(scope, report), note: "Second author" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.outcome === "conflict")).toHaveLength(1);
    expect(value(await api.readDispositions(scope, run.runId, report.hash))?.record.dispositions[0]?.events).toHaveLength(1);
  });

  test("forged hash/revision/raw baseline and altered complete output never become saved success", async () => {
    const { api, scope, run, handler } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const base = value(await api.saveDisposition(intent(scope, report))).record;
    const input = intent(scope, report, base);
    expect((await api.saveDisposition({ ...input, base: { kind: "sha256", value: base.hash, revision: 2, rawJson: base.rawJson } })).ok).toBe(false);
    expect((await api.saveDisposition({ ...input, base: { kind: "sha256", value: "b".repeat(64), revision: 1, rawJson: base.rawJson } })).ok).toBe(false);
    const forged = createReviewRecordApi(async (payload) => {
      const response = await handler(payload) as { result: { data: { record: { hash: string; rawJson: string } } } };
      const raw = JSON.parse(response.result.data.record.rawJson);
      raw.extra = "Not part of the complete intended output";
      const bytes = encodeReviewRecord("review-dispositions", raw);
      response.result.data.record = { rawJson: new TextDecoder().decode(bytes), hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())), (n) => n.toString(16).padStart(2, "0")).join("") };
      return response;
    });
    expect(await forged.saveDisposition(input)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
  });

  test("supported unknown fields survive a checked active update; exact no-note repeat is read-only", async () => {
    const { api, scope, run, port, book } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const initial = value(await api.saveDisposition(intent(scope, report))).record;
    const raw = JSON.parse(initial.rawJson);
    raw.extra = { preserved: [1, "exact"] };
    raw.dispositions[0].events[0].extra = true;
    await port.commitFile(dispositionPath(book.id, run.runId), encodeReviewRecord("review-dispositions", raw), { kind: "any" });
    const base = required(value(await api.readDispositions(scope, run.runId, report.hash)));
    const saved = value(await api.saveDisposition({ ...intent(scope, report, base), state: "author-resolved" })).record;
    expect(saved.record.extra).toEqual({ preserved: [1, "exact"] });
    expect(saved.record.dispositions[0]?.events[0]?.extra).toBe(true);
    let writes = 0;
    port.commitFile = async () => { writes++; throw new Error("No-op cannot write"); };
    const { note: _note, ...repeat } = intent(scope, report, saved);
    expect(value(await api.saveDisposition({ ...repeat, state: "author-resolved" })).status).toBe("unchanged");
    expect(writes).toBe(0);
  });

  test.each(["active-readback", "report-race", "conflict-readback", "conflict-forged"])("disposition %s is uncertain and never retried", async (fault) => {
    const { api, scope, run, port, book, handler } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const input = intent(scope, report);
    const commit = port.commitFile.bind(port);
    let writes = 0;
    if (fault.startsWith("conflict")) value(await api.saveDisposition(input));
    port.commitFile = async (path, bytes, expected) => {
      if (path.includes("dispositions") || path.includes("conflicts")) {
        writes++;
        if (fault === "active-readback" || fault === "conflict-readback") {
          await commit(path, bytes, expected);
          return { status: "changed", current: null, publication: "uncertain" };
        }
        if (fault === "report-race") await commit(reportPath(book.id, run.runId), encodeReviewRecord("review-report", { ...report.record, raced: true }), { kind: "any" });
      }
      return commit(path, bytes, expected);
    };
    const receiver = fault === "conflict-forged" ? createReviewRecordApi(async (payload) => {
      const response = await handler(payload) as { result: { error: { copy: { rawJson: string } } } };
      response.result.error.copy.rawJson = "{}";
      return response;
    }) : api;
    expect(await receiver.saveDisposition(input)).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(writes).toBe(1);
  });

  test("confirmed trash and free-path restore preserve exact bytes and use one-use host inspection", async () => {
    const { api, scope, run, port, library, book } = await fixture();
    const chapter = await library.createChapter(book.id, { title: "Unchanged manuscript", content: "Never edit these synthetic bytes." });
    const path = toLibraryFilePath(["books", book.id, "chapters", chapter.path]);
    const manuscript = required(await port.readFile(path)).sha256;
    const report = value(await api.save(scope, run)).report;
    const dispositions = value(await api.saveDisposition(intent(scope, report))).record;
    const group = value(await api.inspectGroup(scope, run.runId, report.hash));
    expect(await api.moveGroup(scope, { ...confirmation(group), token: "forged-token" })).toMatchObject({ ok: false, error: { outcome: "refused" } });
    const trashed = value(await api.moveGroup(scope, confirmation(group)));
    expect(trashed.status).toBe("trashed");
    expect((await api.moveGroup(scope, confirmation(group))).ok).toBe(false);
    expect(value(await api.list(scope)).total).toBe(0);
    const listed = value(await api.listTrash(scope));
    expect(listed.total).toBe(1);
    const trash = value(await api.inspectTrash(scope, required(trashed.destinationGroupId)));
    expect(trash.report?.rawJson).toBe(report.rawJson);
    expect(trash.dispositions?.rawJson).toBe(dispositions.rawJson);
    expect(value(await api.moveGroup(scope, confirmation(trash))).status).toBe("restored");
    expect(value(await api.read(scope, run.runId, report.hash)).rawJson).toBe(report.rawJson);
    expect(value(await api.readDispositions(scope, run.runId, report.hash))?.rawJson).toBe(dispositions.rawJson);
    expect(value(await api.listTrash(scope)).total).toBe(0);
    expect(required(await port.readFile(path)).sha256).toBe(manuscript);
  });

  test.each(["new-dispositions", "changed-report"])("trash refuses %s after inspection without moving any files", async (fault) => {
    const { api, scope, run, port, book } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const group = value(await api.inspectGroup(scope, run.runId, report.hash));
    if (fault === "new-dispositions") value(await api.saveDisposition(intent(scope, report)));
    else await port.commitFile(reportPath(book.id, run.runId), encodeReviewRecord("review-report", { ...report.record, external: true }), { kind: "any" });
    expect((await api.moveGroup(scope, confirmation(group))).ok).toBe(false);
    expect(value(await api.listTrash(scope)).total).toBe(0);
    expect(await port.readFile(reportPath(book.id, run.runId))).not.toBeNull();
  });

  test("recovery permissions are bound to the inspecting view and expire without touching files", async () => {
    const { api, scope, run } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const group = value(await api.inspectGroup(scope, run.runId, report.hash));
    const otherView = value(await api.open(scope.bookId, crypto.randomUUID()));
    expect((await api.moveGroup(otherView, confirmation(group))).ok).toBe(false);
    expect((await api.moveGroup(scope, confirmation(group))).ok).toBe(false);
    const oldest = value(await api.inspectGroup(scope, run.runId, report.hash));
    for (let index = 0; index < 64; index++) value(await api.inspectGroup(scope, run.runId, report.hash));
    expect((await api.moveGroup(scope, confirmation(oldest))).ok).toBe(false);
    expect(value(await api.list(scope)).total).toBe(1);
    expect(value(await api.listTrash(scope)).total).toBe(0);
  });

  test("trash paging is bounded and inspection refuses extra group members without writes", async () => {
    const { api, scope, port, book, run } = await fixture();
    for (let index = 0; index < 53; index++) await port.commitFile(toLibraryFilePath([".studio", "trash", book.id, "reviews", `group-${index}`, "future.json"]), new TextEncoder().encode('{"schemaVersion":2}'), { kind: "absent" });
    expect(value(await api.listTrash(scope)).groups).toHaveLength(50);
    expect(value(await api.listTrash(scope, 50)).groups).toHaveLength(3);
    const report = value(await api.save(scope, run)).report;
    const moved = value(await api.moveGroup(scope, confirmation(value(await api.inspectGroup(scope, run.runId, report.hash)))));
    const id = required(moved.destinationGroupId);
    const inspected = value(await api.inspectTrash(scope, id));
    await port.commitFile(toLibraryFilePath([".studio", "trash", book.id, "reviews", id, "extra.json"]), new TextEncoder().encode("{}"), { kind: "absent" });
    let moves = 0;
    port.moveFile = async () => { moves++; throw new Error("Extra content cannot move"); };
    expect((await api.moveGroup(scope, confirmation(inspected))).ok).toBe(false);
    expect((await api.inspectTrash(scope, id)).ok).toBe(false);
    expect(moves).toBe(0);
  });

  test("partial restore reopens as a disposition-only group against the exact active report", async () => {
    const { api, scope, run, port } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const saved = value(await api.saveDisposition(intent(scope, report))).record;
    const moved = value(await api.moveGroup(scope, confirmation(value(await api.inspectGroup(scope, run.runId, report.hash)))));
    const group = value(await api.inspectTrash(scope, required(moved.destinationGroupId)));
    const move = port.moveFile.bind(port);
    let calls = 0;
    port.moveFile = async (from, to) => { calls++; if (calls === 2) throw new Error("Synthetic second restore interruption"); await move(from, to); };
    expect(await api.moveGroup(scope, confirmation(group))).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    port.moveFile = move;
    const remaining = value(await api.inspectTrash(scope, required(group.groupId)));
    expect(remaining.dependencyReport?.hash).toBe(report.hash);
    expect(value(await api.moveGroup(scope, confirmation(remaining))).status).toBe("restored");
    expect(value(await api.readDispositions(scope, run.runId, report.hash))?.rawJson).toBe(saved.rawJson);
  });

  test.each(["source-change", "restore-destination", "source-member"])("%s during primitive move is uncertain, preserves external bytes and never overwrites", async (fault) => {
    const { api, scope, run, port } = await fixture();
    const report = value(await api.save(scope, run)).report;
    let inspected = value(await api.inspectGroup(scope, run.runId, report.hash));
    if (fault !== "source-change") {
      const moved = value(await api.moveGroup(scope, confirmation(inspected)));
      inspected = value(await api.inspectTrash(scope, required(moved.destinationGroupId)));
    }
    const move = port.moveFile.bind(port);
    const external = new TextEncoder().encode("Concurrent external bytes");
    let calls = 0;
    let preservedPath = toLibraryFilePath(["unused"]);
    port.moveFile = async (from, to) => {
      calls++;
      if (fault === "source-change") { await port.commitFile(from, external, { kind: "any" }); preservedPath = to; }
      else if (fault === "restore-destination") { await port.commitFile(to, external, { kind: "absent" }); preservedPath = to; }
      await move(from, to);
      if (fault === "source-member") {
        preservedPath = toLibraryFilePath([...from.slice(0, -1), "extra.json"]);
        await port.commitFile(preservedPath, external, { kind: "absent" });
      }
    };
    expect(await api.moveGroup(scope, confirmation(inspected))).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(required(await port.readFile(preservedPath)).bytes).toEqual(external);
    expect((await api.moveGroup(scope, confirmation(inspected))).ok).toBe(false);
    expect(calls).toBe(1);
  });

  test("occupied restore destination and changed trash content refuse; future groups remain inspectably unavailable", async () => {
    const { api, scope, run, port, book } = await fixture();
    const report = value(await api.save(scope, run)).report;
    const moved = value(await api.moveGroup(scope, confirmation(value(await api.inspectGroup(scope, run.runId, report.hash)))));
    const groupId = required(moved.destinationGroupId);
    const trash = value(await api.inspectTrash(scope, groupId));
    value(await api.save(scope, run));
    expect(await api.moveGroup(scope, confirmation(trash))).toMatchObject({ ok: false, error: { code: "exists" } });
    expect(value(await api.listTrash(scope)).total).toBe(1);
    const path = toLibraryFilePath([".studio", "trash", book.id, "reviews", groupId, `${run.runId}.json`]);
    const next = value(await api.inspectTrash(scope, groupId));
    await port.commitFile(path, new TextEncoder().encode('{"schemaVersion":2}'), { kind: "any" });
    expect((await api.moveGroup(scope, confirmation(next))).ok).toBe(false);
    expect(await api.inspectTrash(scope, groupId)).toMatchObject({ ok: false, error: { code: "newer-schema" } });
    expect(value(await api.listTrash(scope)).total).toBe(1);
    expect(new TextDecoder().decode(required(await port.readFile(path)).bytes)).toBe('{"schemaVersion":2}');
  });

  test.each(["second-move", "readback", "destination-race"])("%s remains uncertain, never replays, and partial files remain recoverable", async (fault) => {
    const { api, scope, run, port } = await fixture();
    const report = value(await api.save(scope, run)).report;
    value(await api.saveDisposition(intent(scope, report)));
    const group = value(await api.inspectGroup(scope, run.runId, report.hash));
    const move = port.moveFile.bind(port);
    const read = port.readFile.bind(port);
    let moves = 0;
    let failReads = false;
    port.moveFile = async (from, to) => {
      moves++;
      if (fault === "second-move" && moves === 2) throw new Error("Synthetic interruption");
      if (fault === "destination-race") await port.commitFile(to, new TextEncoder().encode("External destination"), { kind: "absent" });
      await move(from, to);
      if (fault === "readback") failReads = true;
    };
    port.readFile = async (path) => { if (failReads && path.includes("reviews")) throw new Error("Synthetic unreadable receipt"); return read(path); };
    expect(await api.moveGroup(scope, confirmation(group))).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect((await api.moveGroup(scope, confirmation(group))).ok).toBe(false);
    expect(moves).toBe(fault === "second-move" ? 2 : 1);
    failReads = false;
    port.moveFile = move;
    port.readFile = read;
    if (fault !== "destination-race") {
      const listed = value(await api.listTrash(scope));
      const partial = value(await api.inspectTrash(scope, required(listed.groups[0]).groupId));
      expect(partial.report).toBeNull();
      expect(partial.dependencyReport?.hash).toBe(report.hash);
      expect(value(await api.moveGroup(scope, confirmation(partial))).status).toBe("restored");
    }
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
