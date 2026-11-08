import { describe, expect, test } from "bun:test";
import { LibraryService } from "../../src/library/service";
import { createPlanningApi, planningHandler, planningValue } from "../../src/library/planning-api";
import { inspectPlanningCopy } from "../../src/library/planning-recovery";
import { chapterPath, bookFilePath, bookPath } from "../../src/library/paths";
import { libraryPathFromArchivePath } from "../../src/library/path";
import { createLibraryArchive } from "../../src/archive/export";
import { sidecarPath } from "../../src/planning/checked-sidecar";
import { encoder } from "../../src/planning/schema";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { envelope, fields } from "./fixture";

async function setup() {
  const port = new InMemoryLibraryPort();
  const library = await LibraryService.open({ storage: port, runtime: port });
  const book = await library.createBook({ title: "Synthetic integrated planning" });
  const api = createPlanningApi(planningHandler(() => library));
  return { port, library, book, api };
}
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic fixture value.");
  return value;
}

describe("real Library planning composition", () => {
  test("set/reopen/clear, world create/edit/reopen, exact raw unknown preservation and zero journal no-op", async () => {
    const { port, library, book, api } = await setup();
    const base = await planningValue(api.readGoal(book.id));
    expect((await planningValue(api.saveGoal({ ...envelope(base), draft: { kind: "set-goal", targetWords: 100 } }))).status).toBe("saved");
    const reopen = await LibraryService.open({ storage: port, runtime: port });
    expect((await reopen.goals.read(book.id)).data?.targetWords).toBe(100);
    const raw = ` {"schemaVersion":1,"bookId":"${book.id}","revision":2,"targetWords":100,"future":{"literal":"  keep  "}}\r\n`;
    await port.commitFile(sidecarPath(book.id, "goals"), encoder.encode(raw), { kind: "any" });
    const read = await planningValue(api.readGoal(book.id));
    expect(read.baselineJson).toBe(raw);
    const commits: string[] = [];
    const commit = port.commitFile.bind(port);
    port.commitFile = (path, bytes, expected) => { commits.push(path.join("/")); return commit(path, bytes, expected); };
    expect((await planningValue(api.saveGoal({ ...envelope(read), draft: { kind: "set-goal", targetWords: 100 } }))).status).toBe("unchanged");
    expect(commits).toEqual([]);
    await planningValue(api.saveGoal({ ...envelope(read), draft: { kind: "set-goal", targetWords: null } }));
    expect((await library.goals.read(book.id)).data).toMatchObject({ targetWords: null, future: { literal: "  keep  " } });
    const planning = await planningValue(api.read(book.id));
    await planningValue(api.save({ ...envelope(planning), draft: { kind: "create-worldbuilding", fields } }));
    const saved = await planningValue(api.read(book.id));
    const id = required(saved.data?.worldbuilding[0]).id;
    await planningValue(api.save({ ...envelope(saved), draft: { kind: "edit-worldbuilding", id, fields: { ...fields, notes: "revised" } } }));
    expect((await reopen.planning.read(book.id)).data?.worldbuilding[0]).toMatchObject({ id, revision: 2, notes: "revised" });
  });

  test.each(["chapter", "book", "trash"] as const)("goal commit holds the actual queue against %s writes", async (writer) => {
    const { port, library, book } = await setup();
    const chapter = await library.createChapter(book.id, { content: "one two" });
    const base = await library.goals.read(book.id);
    const entered = latch(); const release = latch();
    const commit = port.commitFile.bind(port);
    port.commitFile = async (path, bytes, expected) => {
      if (path.join("/") === sidecarPath(book.id, "goals").join("/")) { entered.resolve(); await release.promise; }
      return commit(path, bytes, expected);
    };
    const saving = library.goals.save({ ...envelope(base), draft: { kind: "set-goal", targetWords: 10 } });
    await entered.promise;
    let finished = false;
    const competing = (writer === "chapter" ? library.saveChapter(book.id, chapter.id, "three four five", { baseVersion: chapter.version, baseHash: chapter.hash })
      : writer === "book" ? library.updateBook(book.id, { title: "Changed" }) : library.deleteBook(book.id)).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(finished).toBe(false);
    release.resolve();
    expect((await saving).status).toBe("saved");
    await competing;
    if (writer === "chapter") expect(await library.goals.progress(book.id)).toMatchObject({ status: "complete", savedWords: 3 });
    if (writer === "trash") await expect(library.goals.read(book.id)).rejects.toThrow();
  });

  test("stale saves retain verified discoverable copies through archive and whole-book trash", async () => {
    const { port, library, book, api } = await setup();
    const base = await library.goals.read(book.id);
    await library.goals.save({ ...envelope(base), draft: { kind: "set-goal", targetWords: 20 } });
    const conflict = await planningValue(api.saveGoal({ ...envelope(base), draft: { kind: "set-goal", targetWords: 10 } }));
    expect(conflict.status).toBe("conflict");
    const names = await planningValue(api.listCopies(book.id, 0));
    expect(names.names).toHaveLength(1);
    const copy = await planningValue(api.readCopy(book.id, required(names.names[0])));
    expect(inspectPlanningCopy(copy)).toMatchObject({ kind: "goals", data: { targetWords: 10 } });
    expect((await library.goals.read(book.id)).data?.targetWords).toBe(20);
    const archive = await createLibraryArchive({ storage: port, runtime: port }, { appVersion: "synthetic" });
    const paths = archive.manifest.entries.map((entry) => entry.path);
    expect(paths).toContain(`books/${book.id}/goals.json`);
    expect(paths).toContain(`books/${book.id}/conflicts/${copy.name}`);
    const trash = await library.deleteBook(book.id);
    await expect(library.goals.save({ ...envelope(base), draft: { kind: "set-goal", targetWords: 30 } })).rejects.toThrow();
    await port.moveDirectory(libraryPathFromArchivePath(trash.trashedAt), bookPath(book.id));
    expect((await planningValue(api.readCopy(book.id, copy.name))).hash).toBe(copy.hash);
    expect((await library.goals.read(book.id)).data?.targetWords).toBe(20);
  });

  test.each(["duplicate", "corrupt", "utf8", "foreign", "read-failure", "enumeration-failure", "partial-meta", "headerless"] as const)("complete reader handles %s without a falsely confirmed total", async (scenario) => {
    const { port, library, book } = await setup();
    const chapter = await library.createChapter(book.id, { content: "one two" });
    const path = chapterPath(book.id, chapter.path);
    const snapshot = required(await port.readFile(path));
    if (scenario === "duplicate") await port.commitFile(chapterPath(book.id, "0002-duplicate.md"), snapshot.bytes, { kind: "absent" });
    if (scenario === "corrupt") await port.commitFile(path, encoder.encode("---\nid: [\n---\nwords"), { kind: "any" });
    if (scenario === "utf8") await port.commitFile(path, new Uint8Array([0xff]), { kind: "any" });
    if (scenario === "foreign") await port.commitFile(path, encoder.encode(new TextDecoder().decode(snapshot.bytes).replace("---\n", "---\nbookId: book_foreign01\n")), { kind: "any" });
    if (scenario === "partial-meta") await port.commitFile(path, encoder.encode("---\ntitle: Partial\n---\none two\n"), { kind: "any" });
    if (scenario === "headerless") await port.commitFile(path, encoder.encode("one two\r\n"), { kind: "any" });
    if (scenario === "read-failure") {
      const read = port.readFile.bind(port);
      port.readFile = (target) => target.join("/") === path.join("/") ? Promise.reject(new Error("synthetic read failure")) : read(target);
    }
    if (scenario === "enumeration-failure") {
      const list = port.listDirectory.bind(port);
      port.listDirectory = (target) => target.at(-1) === "chapters" ? Promise.reject(new Error("synthetic enumeration failure")) : list(target);
    }
    const result = await library.goals.progress(book.id);
    if (scenario === "partial-meta" || scenario === "headerless") expect(result).toMatchObject({ status: "complete", savedWords: 2 });
    else expect(result.status).not.toBe("complete");
  });

  test("fresh second enumeration detects additions and refuses foreign owner", async () => {
    const { port, library, book } = await setup();
    const chapter = await library.createChapter(book.id, { content: "one two" });
    const read = port.readFile.bind(port);
    let reads = 0;
    port.readFile = async (path) => {
      const snapshot = await read(path);
      if (path.at(-1) === chapter.path && ++reads === 2) {
        await port.commitFile(chapterPath(book.id, "0002-new.md"), encoder.encode("new text"), { kind: "absent" });
      }
      return snapshot;
    };
    expect(await library.goals.progress(book.id)).toMatchObject({ status: "unavailable", reason: "changed" });
    await port.commitFile(bookFilePath(book.id), encoder.encode(JSON.stringify({ ...book, id: "book_foreign01" })), { kind: "any" });
    expect((await library.goals.progress(book.id)).status).toBe("unavailable");
  });

  test.each(["active-throw", "active-readback", "copy-throw", "copy-readback"] as const)("%s remains uncertain with single publication attempt", async (scenario) => {
    const { port, library, book, api } = await setup();
    const base = await library.goals.read(book.id);
    if (scenario.startsWith("copy")) await library.goals.save({ ...envelope(base), draft: { kind: "set-goal", targetWords: 20 } });
    const commit = port.commitFile.bind(port);
    let attempts = 0;
    port.commitFile = async (path, bytes, expected) => {
      const selected = scenario.startsWith("copy") ? path.includes("conflicts") : path.at(-1) === "goals.json";
      if (!selected) return commit(path, bytes, expected);
      attempts++;
      const written = await commit(path, bytes, expected);
      if (scenario.endsWith("throw")) throw new Error("synthetic postpublication failure");
      if (written.status === "written") written.snapshot.bytes = encoder.encode("wrong readback");
      return written;
    };
    const result = await api.saveGoal({ ...envelope(base), draft: { kind: "set-goal", targetWords: 10 } });
    expect(result).toMatchObject({ ok: false, error: { outcome: "uncertain", phase: scenario.startsWith("copy") ? "recovery" : "active" } });
    expect(attempts).toBe(1);
  });
});

describe("planning transport", () => {
  test("save replies must match the submitted goal, baseline, revision and phase", async () => {
    const { library, book, api } = await setup();
    const base = await planningValue(api.readGoal(book.id));
    const request = { ...envelope(base), draft: { kind: "set-goal" as const, targetWords: 10 } };
    const saved = await planningValue(api.saveGoal(request));
    const current = await library.goals.read(book.id);
    for (const reply of [
      { ok: true, data: saved },
      { ok: true, data: { status: "unchanged", current } },
      { ok: true, data: { status: "saved", current: base } },
      { ok: true, data: { status: "saved", current: { ...current, baselineJson: "{}" } } },
      { ok: false, error: { code: "io", message: "Invalid phase", outcome: "not-kept", phase: "active" } }
    ]) {
      let calls = 0;
      const bad = createPlanningApi(async () => { calls++; return reply; });
      await expect(bad.saveGoal({ ...request, draft: { kind: "set-goal", targetWords: 11 } })).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });
  test("strict controls, bounded inputs, foreign/raw-hash replies and malformed result envelopes are refused", async () => {
    const { library, book, api } = await setup();
    const handler = planningHandler(() => library);
    expect(await handler("read", { bookId: book.id, path: "elsewhere" })).toMatchObject({ ok: false, error: { outcome: "refused" } });
    const base = await planningValue(api.readGoal(book.id));
    expect(await handler("saveGoal", { ...envelope(base), draft: { kind: "set-goal", targetWords: 10, extra: true } })).toMatchObject({ ok: false, error: { outcome: "refused" } });
    expect(await handler("saveGoal", { ...envelope(base), baselineJson: "x".repeat(2_500_001), draft: { kind: "set-goal", targetWords: 10 } })).toMatchObject({ ok: false, error: { outcome: "refused" } });
    for (const reply of [
      { ok: true, data: { ...base, bookId: "book_foreign01" } },
      { ok: true, data: { ...base, baselineJson: "{}" } },
      { ok: false, error: { code: "io", message: "bad", extra: true } },
      { ok: true, data: base, extra: true }
    ]) {
      let calls = 0;
      const bad = createPlanningApi(async () => { calls++; return reply; });
      await expect(bad.readGoal(book.id)).rejects.toThrow();
      expect(calls).toBe(1);
    }
    const foreign = createPlanningApi(async () => ({ ok: true, data: { status: "complete", bookId: book.id, targetWords: 10, savedWords: 2, remaining: 99 } }));
    await expect(foreign.progress(book.id)).rejects.toThrow();
    await expect(api.readCopy(book.id, "../goals.json")).rejects.toThrow();
    expect(await library.goals.progress(book.id)).toMatchObject({ status: "complete", savedWords: 0 });
  });
});
