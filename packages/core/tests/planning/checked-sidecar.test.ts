import { describe, expect, test } from "bun:test";
import { bookFilePath, chaptersPath } from "../../src/library/paths";
import { libraryPathFromArchivePath } from "../../src/library/path";
import { PlanningService } from "../../src/planning/service";
import { SidecarWriteError } from "../../src/planning/checked-sidecar";
import { encoder, SIDECAR_BYTES } from "../../src/planning/schema";
import { envelope, fields, fixture } from "./fixture";

describe("checked planning sidecars", () => {
  test("absent read is lazy; host-assigned create, edit, reopen and current no-op preserve unrelated files", async () => {
    const f = await fixture();
    const bookBefore = await f.raw(bookFilePath(f.book.id));
    const otherBefore = await f.raw(bookFilePath(f.other.id));
    const chaptersBefore = await f.port.listDirectory(chaptersPath(f.book.id));
    const absent = await f.planning.read(f.book.id);
    expect(absent).toEqual({ bookId: f.book.id, source: { kind: "absent", revision: 0 }, data: null, baselineJson: null });
    expect(f.commits).toHaveLength(0);
    expect(f.layouts).toHaveLength(0);
    const created = await f.seedPlanning();
    expect(created.data?.worldbuilding[0]).toMatchObject({ ...fields, kind: "worldbuilding", revision: 1, bookId: f.book.id });
    expect(created.data?.worldbuilding[0]?.id).toMatch(/^wb_[A-Za-z0-9-]{6,40}$/);
    expect(f.commits[0]?.expected).toEqual({ kind: "absent" });
    const edited = await f.planning.save(f.edit(created, { name: "The road" }));
    expect(edited.status).toBe("saved");
    const reopened = await new PlanningService(f.host).read(f.book.id);
    expect(reopened.data?.revision).toBe(2);
    expect(reopened.data?.worldbuilding[0]).toMatchObject({ name: "The road", revision: 2, id: created.data?.worldbuilding[0]?.id });
    expect(f.commits[1]?.expected).toEqual({ kind: "sha256", value: created.source.kind === "sha256" ? created.source.value : "" });
    const beforeNoop = await f.raw(f.activePath);
    expect((await f.planning.save(f.edit(reopened, { name: "The road" }))).status).toBe("unchanged");
    expect(f.commits).toHaveLength(2);
    expect(f.layouts).toHaveLength(0);
    expect(await f.raw(f.activePath)).toBe(beforeNoop);
    expect(await f.raw(bookFilePath(f.book.id))).toBe(bookBefore);
    expect(await f.raw(bookFilePath(f.other.id))).toBe(otherBefore);
    expect(await f.port.listDirectory(chaptersPath(f.book.id))).toEqual(chaptersBefore);
  });

  test("raw unknown fields, special object keys and all literal strings survive known-field edits", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const raw = JSON.parse(read.baselineJson ?? "{}");
    raw.future = { nested: [" \r\n界 😀 e\u0301 ", { unknown: true }] };
    Object.defineProperty(raw, "__proto__", { value: { text: "keep root" }, enumerable: true });
    raw.worldbuilding[0].unknown = JSON.parse('{"__proto__":{"literal":"keep nested"},"constructor":"text"}');
    raw.worldbuilding.push({ ...raw.worldbuilding[0], id: "wb_untouched", name: "Other", revision: 19, archived: true });
    await f.writeRaw(f.activePath, raw);
    const current = await f.planning.read(f.book.id);
    await f.planning.save(f.edit(current, { name: "Known edit" }));
    const after = JSON.parse(await f.raw(f.activePath));
    expect(after.future).toEqual(raw.future);
    expect(Object.hasOwn(after, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(after, "__proto__")?.value).toEqual(Object.getOwnPropertyDescriptor(raw, "__proto__")?.value);
    expect(after.worldbuilding[0].unknown).toEqual(raw.worldbuilding[0].unknown);
    expect(after.worldbuilding[0].description).toBe(fields.description);
    expect(after.worldbuilding[0].notes).toBe(fields.notes);
    expect(after.worldbuilding[1]).toEqual(raw.worldbuilding[1]);
  });

  test("two stale readers preserve the entire intended document, without merging disjoint changes", async () => {
    const f = await fixture();
    const original = await f.seedPlanning();
    await f.planning.save(f.edit(original, { name: "First writer" }));
    const before = await f.raw(f.activePath);
    const result = await f.planning.save(f.edit(original, { notes: "Second writer\r\n literal " }));
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") throw new Error("Expected conflict");
    const copy = JSON.parse(await f.raw(libraryPathFromArchivePath(result.savedAs)));
    expect(copy.worldbuilding[0]).toMatchObject({ name: fields.name, notes: "Second writer\r\n literal ", revision: 2 });
    expect(copy.timeline).toEqual([]);
    expect(copy.conflictMetadata).toMatchObject({ reason: "external-edit", baseline: original.source });
    expect(await f.raw(f.activePath)).toBe(before);
    expect(f.commits.filter((call) => call.path.endsWith("/planning.json"))).toHaveLength(2);
  });

  test("stale same-content draft and raw-format-only change are conflicts, never semantic no-ops", async () => {
    const f = await fixture();
    const base = await f.seedPlanning();
    await f.writeRaw(f.activePath, `${base.baselineJson} `);
    const before = await f.raw(f.activePath);
    const result = await f.planning.save(f.edit(base));
    expect(result.status).toBe("conflict");
    expect(await f.raw(f.activePath)).toBe(before);
    expect(f.commits.filter((call) => call.path.endsWith("/planning.json"))).toHaveLength(1);
  });

  test("missing after read preserves a full copy and never recreates the active file", async () => {
    const f = await fixture();
    const base = await f.seedPlanning();
    await f.port.removeFile(f.activePath);
    const result = await f.planning.save(f.edit(base, { notes: "Recovered" }));
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") throw new Error("Expected conflict");
    expect(result.reason).toBe("missing-file");
    expect(await f.port.readFile(f.activePath)).toBeNull();
    expect(JSON.parse(await f.raw(libraryPathFromArchivePath(result.savedAs))).worldbuilding[0].notes).toBe("Recovered");
  });

  test("absent create race makes exactly one active commit attempt with absent expectation", async () => {
    const f = await fixture();
    const read = await f.planning.read(f.book.id);
    let attempts = 0;
    let external = "";
    f.intercept(async (path, bytes, expected, original) => {
      if (path.join("/") === f.activePath.join("/")) {
        attempts += 1;
        expect(expected).toEqual({ kind: "absent" });
        const data = JSON.parse(new TextDecoder().decode(bytes));
        data.worldbuilding[0].name = "Outside writer";
        await f.writeRaw(path, data);
        external = await f.raw(path);
      }
      return original();
    });
    const result = await f.planning.save({ ...envelope(read), draft: { kind: "create-worldbuilding", fields } });
    expect(result.status).toBe("conflict");
    expect(attempts).toBe(1);
    expect(await f.raw(f.activePath)).toBe(external);
  });

  test("hash race attempts once and collision-safe copies never replace an existing copy", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    let activeAttempts = 0;
    let copyAttempts = 0;
    let firstCopyPath = "";
    f.intercept(async (path, _bytes, _expected, original) => {
      if (path.join("/") === f.activePath.join("/")) {
        activeAttempts += 1;
        await f.writeRaw(path, `${read.baselineJson} `);
      } else {
        copyAttempts += 1;
        if (copyAttempts === 1) {
          firstCopyPath = path.join("/");
          await f.writeRaw(path, "existing copy");
        }
      }
      return original();
    });
    const result = await f.planning.save(f.edit(read, { notes: "Draft" }));
    expect(activeAttempts).toBe(1);
    expect(copyAttempts).toBe(2);
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") throw new Error("Expected conflict");
    expect(result.savedAs).toEndWith("-2.json");
    expect(await f.raw(libraryPathFromArchivePath(firstCopyPath))).toBe("existing copy");
    expect(f.commits.slice(1).every((call) => call.expected.kind !== "any")).toBe(true);
  });

  for (const fault of ["throw-before", "throw-after", "wrong-bytes", "wrong-hash"] as const) {
    test(`active ${fault} is uncertain and never retried`, async () => {
      const f = await fixture();
      const read = await f.seedPlanning();
      const before = await f.raw(f.activePath);
      let attempts = 0;
      f.intercept(async (_path, _bytes, _expected, original) => {
        attempts += 1;
        if (fault === "throw-before") throw new Error("synthetic storage full");
        const result = await original();
        if (fault === "throw-after") throw new Error("synthetic readback failed");
        if (result.status === "written") {
          if (fault === "wrong-bytes") result.snapshot.bytes = encoder.encode("other writer");
          else result.snapshot.sha256 = "0".repeat(64);
        }
        return result;
      });
      let caught: unknown;
      try { await f.planning.save(f.edit(read, { notes: "Draft" })); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(SidecarWriteError);
      expect(caught).toMatchObject({ outcome: "uncertain", phase: "active" });
      expect(attempts).toBe(1);
      if (fault === "throw-before") expect(await f.raw(f.activePath)).toBe(before);
      else expect(JSON.parse(await f.raw(f.activePath)).worldbuilding[0].notes).toBe("Draft");
    });
  }

  for (const fault of ["throw-before", "throw-after", "wrong-bytes", "wrong-hash", "collisions"] as const) {
    test(`recovery ${fault} never reports a durable copy`, async () => {
      const f = await fixture();
      const read = await f.seedPlanning();
      await f.writeRaw(f.activePath, `${read.baselineJson} `);
      const before = await f.raw(f.activePath);
      let attempts = 0;
      f.intercept(async (_path, _bytes, _expected, original) => {
        attempts += 1;
        if (fault === "throw-before") throw new Error("synthetic permission denied");
        if (fault === "collisions") return { status: "changed", current: null };
        const result = await original();
        if (fault === "throw-after") throw new Error("synthetic readback failed");
        if (result.status === "written") {
          if (fault === "wrong-bytes") result.snapshot.bytes = encoder.encode("other writer");
          else result.snapshot.sha256 = "0".repeat(64);
        }
        return result;
      });
      let caught: unknown;
      try { await f.planning.save(f.edit(read, { notes: "Still only in editor" })); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(SidecarWriteError);
      expect(caught).toMatchObject({ phase: "recovery" });
      expect((caught as Error).message).toContain("draft is still only in the editor");
      expect(attempts).toBe(fault === "collisions" ? 100 : 1);
      expect(await f.raw(f.activePath)).toBe(before);
    });
  }

  for (const fault of ["missing", "invalid", "newer", "foreign"] as const) {
    test(`actual owning book ${fault} refuses every write, including stale preservation`, async () => {
      const f = await fixture();
      const read = await f.seedPlanning();
      await f.writeRaw(f.activePath, `${read.baselineJson} `);
      if (fault === "missing") await f.port.removeFile(bookFilePath(f.book.id));
      if (fault === "invalid") await f.writeRaw(bookFilePath(f.book.id), "{");
      if (fault === "newer") await f.mutateBook({ schemaVersion: 2 });
      if (fault === "foreign") await f.mutateBook({ id: f.other.id });
      await expect(f.planning.save(f.edit(read, { notes: "Draft" }))).rejects.toThrow();
      expect(f.commits).toHaveLength(1);
      expect(f.layouts).toHaveLength(0);
    });
  }

  for (const fault of ["invalid-json", "newer", "foreign", "record-owner", "duplicate", "wrong-kind", "copy-context", "over-budget"] as const) {
    test(`existing sidecar ${fault} is unavailable and retained`, async () => {
      const f = await fixture();
      const read = await f.seedPlanning();
      const data = JSON.parse(read.baselineJson ?? "{}");
      if (fault === "newer") data.schemaVersion = 2;
      if (fault === "foreign") data.bookId = f.other.id;
      if (fault === "record-owner") data.worldbuilding[0].bookId = f.other.id;
      if (fault === "duplicate") data.worldbuilding.push(data.worldbuilding[0]);
      if (fault === "wrong-kind") data.worldbuilding[0].kind = "timeline";
      if (fault === "copy-context") data.conflictMetadata = {};
      if (fault === "over-budget") data.unknown = "界".repeat(SIDECAR_BYTES / 2);
      await f.writeRaw(f.activePath, fault === "invalid-json" ? "{" : data);
      const before = await f.raw(f.activePath);
      await expect(f.planning.read(f.book.id)).rejects.toThrow();
      await expect(f.planning.save(f.edit(read, { notes: "Draft" }))).rejects.toThrow();
      expect(await f.raw(f.activePath)).toBe(before);
      expect(f.commits).toHaveLength(1);
    });
  }

  test("book upgraded during a commit race blocks recovery writes", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    f.intercept(async (_path, _bytes, _expected, _original) => {
      await f.mutateBook({ schemaVersion: 2 });
      return { status: "changed", current: null };
    });
    await expect(f.planning.save(f.edit(read, { notes: "Draft" }))).rejects.toThrow("draft is still only in the editor");
    expect(f.layouts).toHaveLength(0);
    expect(f.commits).toHaveLength(1);
  });

  test("two queued calls with the same token save once, then preserve rather than rebase", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    const results = await Promise.all([
      f.planning.save(f.edit(read, { name: "Queued one" })),
      f.planning.save(f.edit(read, { name: "Queued two" }))
    ]);
    expect(results.map((result) => result.status)).toEqual(["saved", "conflict"]);
    expect(JSON.parse(await f.raw(f.activePath)).worldbuilding[0].name).toBe("Queued one");
  });

  test("an adapter mutating the supplied buffer cannot verify altered bytes as the intended draft", async () => {
    const f = await fixture();
    const read = await f.seedPlanning();
    f.intercept(async (_path, bytes, _expected, original) => {
      bytes.fill(32);
      return original();
    });
    await expect(f.planning.save(f.edit(read, { notes: "Exact draft" }))).rejects.toMatchObject({ phase: "active", outcome: "uncertain" });
  });

  test("a mismatched snapshot hash cannot establish a readable baseline", async () => {
    const f = await fixture();
    await f.seedPlanning();
    f.host.storage.readFile = async (path) => {
      const snapshot = await f.port.readFile(path);
      if (snapshot && path.join("/") === f.activePath.join("/")) snapshot.sha256 = "f".repeat(64);
      return snapshot;
    };
    await expect(f.planning.read(f.book.id)).rejects.toThrow("could not be verified");
    expect(f.commits).toHaveLength(1);
  });
});
