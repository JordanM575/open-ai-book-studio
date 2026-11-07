import { describe, expect, test } from "bun:test";
import { PlanningService } from "../../src/planning/service";
import {
  encoder, planningSchema, recordIdSchema, serializeDocument, SIDECAR_BYTES, type Planning
} from "../../src/planning/schema";
import { envelope, fields, fixture } from "./fixture";

function minimal(): Planning {
  return {
    schemaVersion: 1, bookId: "book_synthetic", revision: 1,
    worldbuilding: [], timeline: [], timelineOrder: [], beats: [], beatOrder: []
  };
}
function record(index = 0) {
  return { id: `wb_${String(index).padStart(8, "0")}`, kind: "worldbuilding" as const, bookId: "book_synthetic", revision: 1, archived: false, ...fields };
}

describe("planning schema and exact byte bounds", () => {
  for (const size of [199, 200, 201]) {
    test(`${size} retained records includes archived entries`, () => {
      const data = minimal();
      data.worldbuilding = Array.from({ length: size }, (_, index) => ({ ...record(index), archived: index % 2 === 0 }));
      expect(planningSchema.safeParse(data).success).toBe(size <= 200);
    });
  }

  for (const size of [199, 200, 201]) {
    test(`short fields use ${size} UTF-16 units`, () => {
      const data = minimal();
      data.worldbuilding = [{ ...record(), name: "😀".repeat(Math.floor(size / 2)) + "x".repeat(size % 2) }];
      expect(data.worldbuilding[0]?.name.length).toBe(size);
      expect(planningSchema.safeParse(data).success).toBe(size <= 200);
    });
  }

  for (const size of [19_999, 20_000, 20_001]) {
    test(`prose uses ${size} UTF-16 units`, () => {
      const data = minimal();
      data.worldbuilding = [{ ...record(), notes: "😀".repeat(Math.floor(size / 2)) + "x".repeat(size % 2) }];
      expect(planningSchema.safeParse(data).success).toBe(size <= 20_000);
    });
  }

  test("all list kinds, notes singleton, ownership and order arrays are validated without defaults", () => {
    const base = minimal();
    const common = { bookId: base.bookId, revision: 1, archived: true };
    base.timeline = [{ ...common, id: "tl_synthetic", kind: "timeline", title: "Event", when: " after the siege ", description: "", notes: "" }];
    base.beats = [{ ...common, id: "beat_synthetic", kind: "beat", title: "Beat", summary: "", notes: "" }];
    base.storyNotes = { ...common, id: "sn_synthetic", kind: "story-notes", workingNotes: "", styleNotes: "", synopsis: "" };
    base.timelineOrder = ["tl_synthetic"];
    base.beatOrder = ["beat_synthetic"];
    expect(planningSchema.safeParse(base).success).toBe(true);
    expect(planningSchema.safeParse({ ...base, timelineOrder: [] }).success).toBe(false);
    expect(planningSchema.safeParse({ ...base, beatOrder: ["beat_synthetic", "beat_synthetic"] }).success).toBe(false);
    expect(planningSchema.safeParse({ ...base, storyNotes: [base.storyNotes] }).success).toBe(false);
    expect(planningSchema.safeParse({ ...base, storyNotes: { ...base.storyNotes, bookId: "book_foreign" } }).success).toBe(false);
    expect(planningSchema.safeParse({ ...base, timeline: undefined }).success).toBe(false);
    expect(planningSchema.safeParse({ ...base, worldbuilding: [{ ...record(), name: " \n " }] }).success).toBe(false);
  });

  test("new ID grammar remains prefix-specific and bounded", () => {
    for (const prefix of ["wb", "tl", "sn", "beat", "ann", "col"] as const) {
      expect(recordIdSchema(prefix).safeParse(`${prefix}_${"A-".repeat(3)}`).success).toBe(true);
      expect(recordIdSchema(prefix).safeParse(`${prefix}_${"z".repeat(40)}`).success).toBe(true);
      for (const value of [`${prefix}_short`, `${prefix}_${"z".repeat(41)}`, "book_synthetic", `${prefix}_../../xx`, `${prefix}_界界界界界界`]) {
        expect(recordIdSchema(prefix).safeParse(value).success).toBe(false);
      }
    }
  });

  test("exact serialized UTF-8 boundary includes indentation, newline and unknown values", () => {
    const data = { ...minimal(), extra: "" };
    const overhead = serializeDocument(data).byteLength;
    data.extra = "x".repeat(SIDECAR_BYTES - overhead);
    expect(serializeDocument(data).byteLength).toBe(SIDECAR_BYTES);
    data.extra += "x";
    expect(() => serializeDocument(data)).toThrow("2,500,000");
    expect(() => serializeDocument({ ...minimal(), extra: "界".repeat(900_000) })).toThrow();
    expect(() => serializeDocument({ ...minimal(), extra: "\u0000".repeat(420_000) })).toThrow();
  });

  test("stat is only an early check; oversized actual returned bytes are refused", async () => {
    const f = await fixture();
    await f.seedPlanning();
    await f.writeRaw(f.activePath, " ".repeat(SIDECAR_BYTES + 1));
    f.host.storage.stat = async () => ({ size: 1, createdAt: null, modifiedAt: null });
    await expect(f.planning.read(f.book.id)).rejects.toThrow("2,500,000");
    expect(f.commits).toHaveLength(1);
  });

  test("input at the byte limit reads, but a real edit exceeding the output limit is refused intact", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const data = { ...read.data, extra: "" } as Planning & { extra: string };
    data.extra = "x".repeat(SIDECAR_BYTES - serializeDocument(data).byteLength);
    await f.writeRaw(f.activePath, data);
    const current = await f.planning.read(f.book.id);
    const before = await f.raw(f.activePath);
    expect(encoder.encode(before).byteLength).toBe(SIDECAR_BYTES);
    await expect(f.planning.save(f.edit(current, { name: "A longer name than before" }))).rejects.toThrow("2,500,000");
    expect(await f.raw(f.activePath)).toBe(before);
    expect(f.commits).toHaveLength(1);
  });

  test("a maximum-size stale draft still fits a complete recovery copy", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const data = { ...read.data, extra: "" } as Planning & { extra: string };
    data.extra = "x".repeat(SIDECAR_BYTES - serializeDocument(data).byteLength);
    await f.writeRaw(f.activePath, data);
    const current = await f.planning.read(f.book.id);
    // Same-length edit keeps the draft exactly at the cap; external formatting changes the token.
    await f.writeRaw(f.activePath, JSON.stringify(data));
    expect((await f.planning.save(f.edit(current, { name: "Sand road" }))).status).toBe("conflict");
    const copy = f.commits.at(-1);
    expect(copy?.bytes.byteLength).toBeGreaterThan(SIDECAR_BYTES);
    expect(copy?.bytes.byteLength).toBeLessThan(2 * SIDECAR_BYTES);
  });

  for (const which of ["file", "record"] as const) {
    test(`${which} revision overflow refuses edits but allows a current no-op`, async () => {
      const f = await fixture();
      const read = await f.seedPlanning();
      const data = JSON.parse(read.baselineJson ?? "{}");
      if (which === "file") data.revision = Number.MAX_SAFE_INTEGER;
      else data.worldbuilding[0].revision = Number.MAX_SAFE_INTEGER;
      await f.writeRaw(f.activePath, data);
      const current = await f.planning.read(f.book.id);
      expect((await f.planning.save(f.edit(current))).status).toBe("unchanged");
      await expect(f.planning.save(f.edit(current, { notes: "change" }))).rejects.toThrow("revision");
      expect(f.commits).toHaveLength(1);
      expect(JSON.parse(await f.raw(f.activePath))).toEqual(data);
    });
  }

  test("baseline absence, raw hash and revision cannot be forged or interchanged", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const request = f.edit(read, { name: "Change" });
    for (const patch of [
      { source: { kind: "absent", revision: 0 } },
      { baselineJson: null },
      { baselineJson: `${read.baselineJson} ` },
      { source: { ...read.source, revision: 5 } },
      { source: { kind: "sha256", value: "0".repeat(64), revision: 1 } },
      { bookId: f.other.id }
    ]) {
      await expect(f.planning.save({ ...request, ...patch })).rejects.toThrow();
    }
    expect(f.commits).toHaveLength(1);
  });

  test("strict intent forbids caller IDs, paths, revisions, owner changes, unrelated patches and edit-as-create", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    for (const draft of [
      { kind: "create-worldbuilding", fields, id: "wb_supplied" },
      { kind: "edit-worldbuilding", id: read.data?.worldbuilding[0]?.id, fields: { ...fields, revision: 9 } },
      { kind: "edit-worldbuilding", id: read.data?.worldbuilding[0]?.id, fields: { ...fields, bookId: f.other.id } },
      { kind: "edit-worldbuilding", id: read.data?.worldbuilding[0]?.id, fields: { ...fields, unknown: "erase" } }
    ]) {
      expect(() => f.planning.save({ ...envelope(read), draft })).toThrow();
    }
    expect(() => f.planning.save({ ...f.edit(read), path: "/outside" })).toThrow();
    expect(() => f.planning.save({ ...f.edit(read), bookId: "../outside" })).toThrow();
    await expect(f.planning.save({ ...envelope(read), draft: { kind: "edit-worldbuilding", id: "wb_missing", fields } })).rejects.toThrow("cannot create");
    expect(f.commits).toHaveLength(1);
  });

  test("host-assigned duplicate and wrong-prefix IDs are refused", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const runtime = { now: () => f.port.now(), sha256: (bytes: Uint8Array) => f.port.sha256(bytes), newId: () => "tl_wrongkind" };
    const service = new PlanningService({ ...f.host, runtime });
    await expect(service.save({ ...envelope(read), draft: { kind: "create-worldbuilding", fields } })).rejects.toThrow("unique");
    runtime.newId = () => read.data?.worldbuilding[0]?.id ?? "";
    await expect(service.save({ ...envelope(read), draft: { kind: "create-worldbuilding", fields } })).rejects.toThrow("unique");
    expect(f.commits).toHaveLength(1);
  });

  test("read failures and invalid UTF-8 never become absent or trigger writes", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    await f.port.commitFile(f.activePath, new Uint8Array([0xff, 0xfe]), { kind: "any" });
    await expect(f.planning.read(f.book.id)).rejects.toThrow("UTF-8");
    f.host.storage.stat = async () => { throw new Error("synthetic permission denied"); };
    await expect(f.planning.save(f.edit(read))).rejects.toThrow("permission");
    expect(f.commits).toHaveLength(1);
  });

  test("a verified no-op retains a compact file even when reformatting would exceed the byte budget", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const data = { ...read.data, extra: "" } as Planning & { extra: string };
    data.extra = "x".repeat(SIDECAR_BYTES - encoder.encode(JSON.stringify(data)).length);
    const compact = JSON.stringify(data);
    await f.writeRaw(f.activePath, compact);
    const current = await f.planning.read(f.book.id);
    expect((await f.planning.save(f.edit(current))).status).toBe("unchanged");
    expect(await f.raw(f.activePath)).toBe(compact);
    expect(f.commits).toHaveLength(1);
  });

  test("unknown non-finite JSON numbers are refused instead of silently rewritten to null", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    await f.writeRaw(f.activePath, (read.baselineJson ?? "").replace('"schemaVersion": 1', '"huge": 1e400, "schemaVersion": 1'));
    await expect(f.planning.read(f.book.id)).rejects.toThrow("JSON");
    expect(f.commits).toHaveLength(1);
  });

  test("scoped intent bytes and oversized baselines are refused before host access", async () => {
    const f = await fixture();
    const request = { bookId: f.book.id, source: { kind: "absent", revision: 0 }, baselineJson: null,
      draft: { kind: "create-worldbuilding", fields } };
    expect(() => f.planning.save({ ...request, bookId: `book_${"x".repeat(SIDECAR_BYTES)}` })).toThrow("2,500,000");
    expect(() => f.planning.save({ ...request, baselineJson: "x".repeat(SIDECAR_BYTES + 1) })).toThrow("request");
    expect(f.commits).toHaveLength(0);
  });

  test("revisions advance exactly to the safe-integer maximum without resetting", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const data = JSON.parse(read.baselineJson ?? "{}");
    data.revision = Number.MAX_SAFE_INTEGER - 1;
    data.worldbuilding[0].revision = Number.MAX_SAFE_INTEGER - 1;
    await f.writeRaw(f.activePath, data);
    const current = await f.planning.read(f.book.id);
    await f.planning.save(f.edit(current, { notes: "Last safe revision" }));
    const after = await f.planning.read(f.book.id);
    expect(after.data?.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(after.data?.worldbuilding[0]?.revision).toBe(Number.MAX_SAFE_INTEGER);
  });
});
