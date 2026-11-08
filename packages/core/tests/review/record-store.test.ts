import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bookFilePath } from "../../src/library/paths";
import { toLibraryFilePath } from "../../src/library/path";
import { readSyncJournal } from "../../src/sync/journal";
import { ReviewRecordError } from "../../src/review/record-error";
import { decodeReviewRecord, encodeReviewRecord, type CampaignDraft } from "../../src/review/record-format";
import {
  ReviewRecordStore, campaignPath, dispositionPath, profilePath, reportPath, reviewTrashGroupPath,
  reviewTrashPath
} from "../../src/review/record-store";
import { builtinReaderProfile, editReaderProfile } from "../../src/review/profiles";
import {
  afterRun, authorContent, authorProfile, citationFor, clockAt, item, makeBook, readerRun, stamp
} from "./record-fixtures";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const runId = "run_00000001";
const at = "2026-11-07T12:11:00.000Z";

function storeSource(): string {
  return readFileSync(new URL("../../src/review/record-store.ts", import.meta.url), "utf8");
}

function reviewSource(name: string): string {
  return readFileSync(new URL(`../../src/review/${name}`, import.meta.url), "utf8");
}

describe("checked review record store", () => {
  test("creates an immutable report through the Library queue/journal and reads it back", async () => {
    const { library, book, port } = await makeBook();
    expect(library.reviewRecords).toBeInstanceOf(ReviewRecordStore);
    const run = await readerRun(book.id);
    const created = await library.reviewRecords.createReport(book.id, run);
    expect(created.status).toBe("created");
    expect(created.report.record.id).toBe(runId);
    const file = await port.readFile(reportPath(book.id, runId));
    expect(file).not.toBeNull();
    expect(decoder.decode(file?.bytes)).not.toContain("ADJACENT_BEFORE");
    const snapshot = await library.reviewRecords.readReport(book.id, runId);
    expect(snapshot?.hash).toBe(created.report.hash);
    expect(snapshot?.record.findings[0]?.evidence[0]?.citation.quote).toBe(citationFor(book.id).quote);
    const journal = await readSyncJournal(port, "device_fixture01");
    expect(journal?.files[`books/${book.id}/reviews/${runId}.json`]?.sha256).toBe(created.report.hash);
    const listing = await library.reviewRecords.listReports(book.id);
    expect(listing).toMatchObject({ total: 1, offset: 0, limit: 50, issues: [] });
    expect(listing.reports[0]).toMatchObject({ id: runId, findings: 1, quotations: 1, books: [book.id] });
    expect(storeSource()).not.toContain("storage.commitFile");
    expect(storeSource()).not.toContain("removeFile");
    expect(storeSource()).not.toMatch(/from "node:fs"/);
    const service = readFileSync(new URL("../../src/library/service.ts", import.meta.url), "utf8");
    expect(service).toContain("new ReviewRecordStore(");
  });

  test("same-id equal bytes are idempotent after the clock advances; unequal bytes keep a conflict copy", async () => {
    const clock = clockAt(afterRun);
    const { library, book, port } = await makeBook(clock);
    const run = await readerRun(book.id);
    const first = await library.reviewRecords.createReport(book.id, run);
    clock.value = at;
    const again = await library.reviewRecords.createReport(book.id, run);
    expect(again.status).toBe("unchanged");
    expect(again.report.hash).toBe(first.report.hash);
    await port.commitFile(reportPath(book.id, runId), encoder.encode("{}"), { kind: "any" });
    let savedAs = "";
    try {
      await library.reviewRecords.createReport(book.id, run);
      throw new Error("A differing report was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewRecordError);
      if (!(error instanceof ReviewRecordError)) throw error;
      expect(error.code).toBe("conflict");
      savedAs = error.savedAs ?? "";
    }
    expect(savedAs).toMatch(new RegExp(`^books/${book.id}/conflicts/review-report\\.${runId}\\.conflict-external-edit\\.`));
    expect(decoder.decode((await port.readFile(reportPath(book.id, runId)))?.bytes)).toBe("{}");
    const copy = decodeReviewRecord(
      (await port.readFile(toLibraryFilePath(savedAs.split("/"))))?.bytes ?? new Uint8Array(),
      { kind: "review-report", bookId: book.id, allowConflictMetadata: true }
    );
    expect(copy.raw.conflictMetadata).toMatchObject({ reason: "external-edit", observed: { kind: "sha256" } });
  });

  test("lists reports by completion instant, not by the preserved offset spelling", async () => {
    const clock = clockAt("2026-11-07T14:00:00.000Z");
    const { library, book } = await makeBook(clock);
    const older = {
      ...(await readerRun(book.id, "run_00000001")),
      completedAt: "2026-11-07T14:00:00.000+02:00"
    };
    const newer = {
      ...(await readerRun(book.id, "run_00000002")),
      completedAt: "2026-11-07T13:00:00.000Z"
    };
    await library.reviewRecords.createReport(book.id, older);
    await library.reviewRecords.createReport(book.id, newer);
    const listing = await library.reviewRecords.listReports(book.id);
    expect(listing.reports.map((report) => report.id)).toEqual(["run_00000002", "run_00000001"]);
  });

  test("serialized disposition writers lose no event and preserve unknown fields", async () => {
    const clock = clockAt(afterRun);
    const { library, book, port } = await makeBook(clock);
    await library.reviewRecords.createReport(book.id, await readerRun(book.id));
    clock.value = at;
    const first = await library.reviewRecords.recordDisposition(book.id, runId, {
      findingId: "finding-1",
      state: "ignored"
    });
    expect(first.status).toBe("saved");
    expect(first.record.record.revision).toBe(1);
    const rawFile = await port.readFile(dispositionPath(book.id, runId));
    const raw = JSON.parse(decoder.decode(rawFile?.bytes)) as Record<string, unknown>;
    raw.future = { keep: true, nested: [" literal "] };
    const rawEntry = item(raw.dispositions as Array<Record<string, unknown>>);
    rawEntry.futureEntry = "keep";
    rawEntry.events = [{ ...item(rawEntry.events as Array<Record<string, unknown>>), futureEvent: "keep" }];
    await port.commitFile(dispositionPath(book.id, runId), encoder.encode(JSON.stringify(raw)), { kind: "any" });
    clock.value = "2026-11-07T12:12:00.000Z";
    const concurrent = await Promise.all([
      library.reviewRecords.recordDisposition(book.id, runId, { findingId: "finding-1", state: "author-resolved" }),
      library.reviewRecords.recordDisposition(book.id, runId, { findingId: "finding-1", state: "reopened" })
    ]);
    expect(concurrent.every((result) => result.status === "saved")).toBe(true);
    const reopened = await library.reviewRecords.readDispositions(book.id, runId);
    expect(reopened?.record.revision).toBe(3);
    expect(reopened?.record.dispositions[0]?.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    const reopenedRaw = reopened?.raw;
    if (!reopenedRaw) throw new Error("Expected reopened dispositions");
    expect(reopenedRaw.future).toEqual({ keep: true, nested: [" literal "] });
    const reopenedEntry = item(reopenedRaw.dispositions as Array<Record<string, unknown>>);
    expect(reopenedEntry.futureEntry).toBe("keep");
    const events = reopenedEntry.events as Array<Record<string, unknown>>;
    expect(item(events).futureEvent).toBe("keep");
    expect(item(events, 1).to).toBeDefined();
    expect(item(events, 2).to).toBe("reopened");
    const reopenedReport = await library.reviewRecords.readReport(book.id, runId);
    if (!reopenedReport) throw new Error("Expected the saved report");
    expect(reopened?.record.report.hash).toBe(reopenedReport.hash);
  });

  test("a writer that changes the file underneath the save keeps a conflict copy", async () => {
    const clock = clockAt(afterRun);
    const { library, book, port } = await makeBook(clock);
    await library.reviewRecords.createReport(book.id, await readerRun(book.id));
    clock.value = at;
    await library.reviewRecords.recordDisposition(book.id, runId, { findingId: "finding-1", state: "ignored" });
    const original = port.commitFile.bind(port);
    const active = dispositionPath(book.id, runId).join("/");
    let armed = true;
    port.commitFile = async (path, bytes, expected) => {
      if (armed && path.join("/") === active && expected.kind === "sha256") {
        armed = false;
        const current = await port.readFile(path);
        const external = JSON.parse(decoder.decode(current?.bytes)) as Record<string, unknown>;
        external.outside = "writer";
        await original(path, encoder.encode(JSON.stringify(external)), { kind: "any" });
      }
      return original(path, bytes, expected);
    };
    clock.value = "2026-11-07T12:12:00.000Z";
    let savedAs = "";
    try {
      await library.reviewRecords.recordDisposition(book.id, runId, { findingId: "finding-1", state: "author-resolved" });
      throw new Error("A stale base was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewRecordError);
      if (!(error instanceof ReviewRecordError)) throw error;
      expect(error.code).toBe("conflict");
      savedAs = error.savedAs ?? "";
    }
    expect(savedAs).toContain(`books/${book.id}/conflicts/review-dispositions.${runId}.conflict-external-edit.`);
    const activeNow = JSON.parse(decoder.decode((await port.readFile(dispositionPath(book.id, runId)))?.bytes)) as Record<string, unknown>;
    expect(activeNow.outside).toBe("writer");
    expect((activeNow.dispositions as Array<Record<string, unknown>>)[0]?.state).toBe("ignored");
  });

  test("report trash keeps the disposition with it, survives a destination collision and restores only into free paths", async () => {
    const clock = clockAt(afterRun);
    const { library, book, port } = await makeBook(clock);
    await library.reviewRecords.createReport(book.id, await readerRun(book.id));
    clock.value = at;
    await library.reviewRecords.recordDisposition(book.id, runId, { findingId: "finding-1", state: "ignored" });
    const reportHash = (await library.reviewRecords.readReport(book.id, runId))?.hash;
    const dispositionHash = (await library.reviewRecords.readDispositions(book.id, runId))?.hash;
    expect(reportHash).toBeDefined();
    expect(dispositionHash).toBeDefined();
    const stampText = clock.value.replace(/[:.]/g, "-");
    const collision = reviewTrashGroupPath(book.id, stampText);
    await port.ensureDirectory(collision);
    const keep = toLibraryFilePath([...collision, "keep.txt"]);
    await port.commitFile(keep, encoder.encode("keep"), { kind: "absent" });
    const trashed = await library.reviewRecords.trashReport(book.id, runId);
    expect(trashed.status).toBe("trashed");
    if (trashed.status !== "trashed") throw new Error("Expected trash");
    expect(trashed.trashedAt).toBe(reviewTrashGroupPath(book.id, `${stampText}-2`).join("/"));
    expect(trashed.files).toHaveLength(2);
    expect(decoder.decode((await port.readFile(keep))?.bytes)).toBe("keep");
    expect(await port.readFile(reportPath(book.id, runId))).toBeNull();
    expect(await port.readFile(dispositionPath(book.id, runId))).toBeNull();
    const restored = await library.reviewRecords.restoreReport(book.id, runId, trashed.trashedAt);
    expect(restored.report?.hash).toBe(reportHash);
    expect(restored.dispositions?.hash).toBe(dispositionHash);
    expect((await library.reviewRecords.readReport(book.id, runId))?.hash).toBe(reportHash);
    await expect(library.reviewRecords.restoreReport(book.id, runId, trashed.trashedAt)).rejects.toThrow("no longer in the trash");
    const trashedAgain = await library.reviewRecords.trashReport(book.id, runId);
    if (trashedAgain.status !== "trashed") throw new Error("Expected second trash");
    await port.commitFile(reportPath(book.id, runId), encoder.encode("intruder"), { kind: "absent" });
    await expect(library.reviewRecords.restoreReport(book.id, runId, trashedAgain.trashedAt)).rejects.toThrow("already occupies");
    const group = trashedAgain.trashedAt.split("/");
    expect(await port.readFile(toLibraryFilePath([...group, `${runId}.json`]))).not.toBeNull();
    expect(await library.reviewRecords.trashReport(book.id, "run_missing01")).toEqual({ status: "missing" });
  });

  test("lists pages in order and reports unreadable entries without rewriting them", async () => {
    const { library, book, port } = await makeBook();
    await library.reviewRecords.createReport(book.id, await readerRun(book.id, "run_00000001"));
    await library.reviewRecords.createReport(book.id, await readerRun(book.id, "run_00000002"));
    await port.commitFile(
      toLibraryFilePath(["books", book.id, "reviews", "bad.json"]),
      encoder.encode("{}"),
      { kind: "any" }
    );
    await port.commitFile(
      toLibraryFilePath(["books", book.id, "reviews", "future.json"]),
      encoder.encode('{"schemaVersion":2}'),
      { kind: "any" }
    );
    const first = await library.reviewRecords.listReports(book.id, { limit: 1 });
    expect(first.total).toBe(2);
    expect(first.reports).toHaveLength(1);
    expect(first.reports[0]?.id).toBe("run_00000001");
    expect(first.issues.map((issue) => issue.fileName)).toEqual(["bad.json", "future.json"]);
    expect(first.issues.map((issue) => issue.code)).toEqual(["corrupt", "newer-schema"]);
    const second = await library.reviewRecords.listReports(book.id, { offset: 1, limit: 1 });
    expect(second.reports[0]?.id).toBe("run_00000002");
    expect(await port.readFile(toLibraryFilePath(["books", book.id, "reviews", "bad.json"]))).not.toBeNull();
    await expect(library.reviewRecords.listReports(book.id, { limit: 201 })).rejects.toThrow("1 to 200");
  });

  test("author lenses and campaigns are checked revisions and refuse stale or foreign references", async () => {
    const clock = clockAt(afterRun);
    const { library, book, port } = await makeBook(clock);
    const firstProfile = await authorProfile();
    const saved = await library.reviewRecords.saveProfile(book.id, firstProfile, { kind: "absent" });
    expect(saved.status).toBe("saved");
    expect(saved.record.record.revision).toBe(1);
    expect((await library.reviewRecords.readProfile(book.id, firstProfile.id))?.record.profile.digest).toBe(firstProfile.digest);
    clock.value = at;
    const secondProfile = await editReaderProfile(firstProfile, { ...authorContent, guidance: "Changed guidance." });
    const updated = await library.reviewRecords.saveProfile(book.id, secondProfile, {
      kind: "sha256",
      value: saved.record.hash,
      revision: 1
    });
    expect(updated.record.record.revision).toBe(2);
    // Two authors editing version 1 into different version 2 lenses: the loser keeps a copy.
    const rivalProfile = await editReaderProfile(firstProfile, { ...authorContent, guidance: "Rival guidance." });
    let savedAs = "";
    try {
      await library.reviewRecords.saveProfile(book.id, rivalProfile, {
        kind: "sha256",
        value: saved.record.hash,
        revision: 1
      });
      throw new Error("A stale lens edit was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewRecordError);
      if (!(error instanceof ReviewRecordError)) throw error;
      expect(error.code).toBe("conflict");
      savedAs = error.savedAs ?? "";
    }
    expect(savedAs).toContain(`books/${book.id}/conflicts/`);
    const thirdProfile = await editReaderProfile(secondProfile, { ...authorContent, guidance: "Third guidance." });
    await expect(
      library.reviewRecords.saveProfile(book.id, thirdProfile, { kind: "sha256", value: saved.record.hash, revision: 1 })
    ).rejects.toThrow("changed since it was read");
    await expect(
      library.reviewRecords.saveProfile(book.id, thirdProfile, { kind: "sha256", value: "c".repeat(64), revision: 9 })
    ).rejects.toThrow("changed since it was read");
    const alpha = await builtinReaderProfile("alpha");
    const run = await readerRun(book.id);
    const created = await library.reviewRecords.createReport(book.id, run);
    const planned = [{ start: citationFor(book.id).start, end: citationFor(book.id).end }];
    const draft: CampaignDraft = {
      status: "incomplete",
      profile: { id: alpha.id, version: alpha.version, digest: alpha.digest },
      sources: [
        {
          sourceId: "source-1",
          bookId: book.id,
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
          report: { runId, hash: created.report.hash },
          at: afterRun
        }
      ],
      synthesis: [],
      plannedAt: stamp,
      sourceBytes: 40
    };
    const campaign = await library.reviewRecords.saveCampaign(book.id, "campaign-1", draft, { kind: "absent" });
    expect(campaign.record.record.plan.items).toBe(1);
    expect((await library.reviewRecords.readCampaign(book.id, "campaign-1"))?.record.stages[0]?.report?.hash).toBe(created.report.hash);
    const seededFile = await port.readFile(campaignPath(book.id, "campaign-1"));
    const seededCampaign = JSON.parse(decoder.decode(seededFile?.bytes)) as Record<string, unknown>;
    seededCampaign.futureRoot = { keep: true };
    item(seededCampaign.sources as Array<Record<string, unknown>>).futureSource = "keep";
    item(seededCampaign.stages as Array<Record<string, unknown>>).futureStage = "keep";
    await port.commitFile(campaignPath(book.id, "campaign-1"), encoder.encode(JSON.stringify(seededCampaign)), { kind: "any" });
    const seededHash = (await port.readFile(campaignPath(book.id, "campaign-1")))?.sha256;
    if (!seededHash) throw new Error("Expected a seeded campaign");
    clock.value = "2026-11-07T12:20:00.000Z";
    const updatedCampaign = await library.reviewRecords.saveCampaign(book.id, "campaign-1", draft, {
      kind: "sha256",
      value: seededHash,
      revision: 1
    });
    expect(updatedCampaign.record.record.revision).toBe(2);
    expect(updatedCampaign.record.raw.futureRoot).toEqual({ keep: true });
    expect(item(updatedCampaign.record.raw.sources as Array<Record<string, unknown>>).futureSource).toBe("keep");
    expect(item(updatedCampaign.record.raw.stages as Array<Record<string, unknown>>).futureStage).toBe("keep");
    await expect(
      library.reviewRecords.saveCampaign(
        book.id,
        "campaign-2",
        {
          ...draft,
          stages: [{ ...draft.stages[0]!, report: { runId, hash: "c".repeat(64) } }]
        },
        { kind: "absent" }
      )
    ).rejects.toThrow("another version of a saved review");
    await expect(
      library.reviewRecords.saveCampaign(
        book.id,
        "campaign-3",
        {
          ...draft,
          stages: [{ ...draft.stages[0]!, report: { runId: "run_99999999", hash: created.report.hash } }]
        },
        { kind: "absent" }
      )
    ).rejects.toThrow("missing");
    const trashedProfile = await library.reviewRecords.trashProfile(book.id, firstProfile.id);
    expect(trashedProfile.status).toBe("trashed");
    expect(await port.readFile(profilePath(book.id, firstProfile.id))).toBeNull();
    if (trashedProfile.status !== "trashed") throw new Error("Expected profile trash");
    const restoredProfile = await library.reviewRecords.restoreProfile(book.id, firstProfile.id, trashedProfile.trashedAt);
    expect(restoredProfile.hash).toHaveLength(64);
    const trashedCampaign = await library.reviewRecords.trashCampaign(book.id, "campaign-1");
    if (trashedCampaign.status !== "trashed") throw new Error("Expected campaign trash");
    expect(await port.readFile(campaignPath(book.id, "campaign-1"))).toBeNull();
    expect((await library.reviewRecords.restoreCampaign(book.id, "campaign-1", trashedCampaign.trashedAt)).hash).toHaveLength(64);
    expect(reviewTrashPath(book.id).join("/")).toBe(`.studio/trash/${book.id}/reviews`);
  });

  test("refuses an unavailable or foreign owning book and never writes outside reviews", async () => {
    const { library, book, port } = await makeBook();
    const run = await readerRun(book.id);
    await expect(library.reviewRecords.createReport("book_999999", run)).rejects.toThrow("owning book");
    const bookFile = await port.readFile(bookFilePath(book.id));
    expect(bookFile).not.toBeNull();
    const before = decoder.decode(bookFile?.bytes);
    await library.reviewRecords.createReport(book.id, run);
    expect(decoder.decode((await port.readFile(bookFilePath(book.id)))?.bytes)).toBe(before);
    expect((await port.listDirectory(reviewTrashPath(book.id))).length).toBe(0);
  });
});

describe("no unchecked review writer", () => {
  test("format modules cannot commit and the store has no adapter-level or destructive writer", () => {
    for (const name of ["record-error.ts", "record-json.ts", "record-format.ts"]) {
      const source = reviewSource(name);
      expect(source).not.toContain("commitFile");
      expect(source).not.toContain("node:fs");
      expect(source).not.toContain("writeFile");
    }
    const store = storeSource();
    expect(store).not.toContain("node:fs");
    expect(store).not.toMatch(/\bstorage\.commitFile\s*\(/);
    expect(store).not.toContain(".removeFile(");
    expect(store).not.toContain(".removeDirectory(");
    expect(store).toMatch(/this\.host\.commitFile\(/);
    expect(store).toMatch(/this\.host\.withBook\(/);
    expect(store).toMatch(/noteMovedPrefix\(/);
    expect(store).not.toContain("prune");
    expect(store).not.toContain("unlink");
    const format = reviewSource("record-format.ts");
    expect(format).toContain("REVIEW_RECORD_SCHEMA_VERSION = 1");
    expect(format).not.toContain("prune");
    expect(format).not.toContain("unlink");
    expect(encodeReviewRecord).toBeDefined();
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });
});
