import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { createBrowserStudioApi } from "../../src/runtime/browser-api";
import { BrowserLibraries } from "../../src/runtime/browser-libraries";
import { planningValue } from "@ai-book-studio/core/library/planning-api";
import { FakeDirectory, domError } from "./support/fake-directory";

const globals = globalThis as { navigator?: unknown; isSecureContext?: boolean };
const previousNavigator = globals.navigator;
const previousSecure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic fixture value.");
  return value;
}
afterEach(() => {
  if (previousNavigator === undefined) delete globals.navigator;
  else globals.navigator = previousNavigator;
  if (previousSecure) Object.defineProperty(globalThis, "isSecureContext", previousSecure);
  else delete globals.isSecureContext;
});
async function setup() {
  const root = new FakeDirectory("synthetic-planning");
  Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
  globals.navigator = { storage: { getDirectory: async () => root, persist: async () => true, estimate: async () => ({ usage: 0, quota: 1_000_000 }) } };
  const libraries = new BrowserLibraries();
  await libraries.openBrowserStorage();
  const studio = createBrowserStudioApi(libraries);
  const book = await planningValue(studio.books.create({ title: "Synthetic browser planning" }));
  const api = required(studio.planning);
  const libraryRoot = await (await root.getDirectoryHandle("libraries")).getDirectoryHandle(libraries.rootLabel().replace("browser://", ""));
  const directory = await (await libraryRoot.getDirectoryHandle("books")).getDirectoryHandle(book.id);
  return { libraries, studio, api, book, directory };
}

describe("actual browser API and directory-handle adapter", () => {
  test("goal set/reopen/clear, worldbuilding create/edit and stale recovery", async () => {
    const { api, book, libraries } = await setup();
    const base = await planningValue(api.readGoal(book.id));
    const request = { bookId: book.id, source: base.source, baselineJson: base.baselineJson, draft: { kind: "set-goal" as const, targetWords: 100 } };
    expect((await planningValue(api.saveGoal(request))).status).toBe("saved");
    expect((await planningValue(api.readGoal(book.id))).data?.targetWords).toBe(100);
    expect((await planningValue(api.saveGoal(request))).status).toBe("conflict");
    const copies = await planningValue(api.listCopies(book.id, 0));
    expect((await planningValue(api.readCopy(book.id, required(copies.names[0])))).rawJson).toContain("conflictMetadata");
    const current = await planningValue(api.readGoal(book.id));
    await planningValue(api.saveGoal({ bookId: book.id, source: current.source, baselineJson: current.baselineJson, draft: { kind: "set-goal", targetWords: null } }));
    expect((await libraries.require().goals.read(book.id)).data?.targetWords).toBeNull();
    const planning = await planningValue(api.read(book.id));
    const fields = { name: "Browser harbor", category: "Place", description: "Literal  ", notes: "" };
    await planningValue(api.save({ bookId: book.id, source: planning.source, baselineJson: planning.baselineJson, draft: { kind: "create-worldbuilding", fields } }));
    const read = await planningValue(api.read(book.id));
    await planningValue(api.save({ bookId: book.id, source: read.source, baselineJson: read.baselineJson, draft: { kind: "edit-worldbuilding", id: required(read.data?.worldbuilding[0]).id, fields: { ...fields, notes: "New notes" } } }));
    expect((await libraries.require().planning.read(book.id)).data?.worldbuilding[0]?.notes).toBe("New notes");
  });

  test.each(["write", "close", "readback"] as const)("%s failure keeps uncertainty and does not retry", async (fault) => {
    const { api, book, directory } = await setup();
    const base = await planningValue(api.readGoal(book.id));
    let attempts = 0;
    if (fault === "readback") directory.hooks.afterClose = (name, dir) => {
      if (name === "goals.json") { attempts++; dir.files.set(name, { bytes: new TextEncoder().encode("changed externally"), lastModified: 1 }); }
    };
    else directory.hooks.fail = (stage, name) => {
      if (stage === fault && name === "goals.json") { attempts++; return domError("QuotaExceededError"); }
      return undefined;
    };
    const saved = await api.saveGoal({ bookId: book.id, source: base.source, baselineJson: base.baselineJson, draft: { kind: "set-goal", targetWords: 100 } });
    expect(saved).toMatchObject({ ok: false, error: { outcome: "uncertain", phase: "active" } });
    expect(attempts).toBe(1);
  });

  test("saved progress uses actual chapter saves and refuses a malformed source", async () => {
    const { api, book, studio, directory } = await setup();
    const chapter = await planningValue(studio.chapters.create(book.id, { title: "Synthetic" }));
    await planningValue(studio.chapters.save({ bookId: book.id, chapterId: chapter.id, content: "one two three", baseVersion: chapter.version, baseHash: chapter.hash }));
    expect(await planningValue(api.progress(book.id))).toMatchObject({ status: "complete", savedWords: 3 });
    const chapters = await directory.getDirectoryHandle("chapters");
    chapters.files.set("0002-bad.md", { bytes: new TextEncoder().encode("---\nid: [\n---\nbad"), lastModified: 1 });
    expect((await planningValue(api.progress(book.id))).status).toBe("incomplete");
  });

  test("different readback after conflict-copy publication is uncertain, never a collision retry", async () => {
    const { api, book, directory } = await setup();
    const base = await planningValue(api.readGoal(book.id));
    const request = { bookId: book.id, source: base.source, baselineJson: base.baselineJson, draft: { kind: "set-goal" as const, targetWords: 100 } };
    await planningValue(api.saveGoal(request));
    const conflicts = await directory.getDirectoryHandle("conflicts");
    let attempts = 0;
    conflicts.hooks.afterClose = (name, dir) => {
      attempts++;
      dir.files.set(name, { bytes: new TextEncoder().encode("external copy bytes"), lastModified: 1 });
    };
    expect(await api.saveGoal(request)).toMatchObject({ ok: false, error: { outcome: "uncertain", phase: "recovery" } });
    expect(attempts).toBe(1);
    const list = await planningValue(api.listCopies(book.id, 0));
    expect(await api.readCopy(book.id, required(list.names[0]))).toMatchObject({ ok: false });
  });
});
