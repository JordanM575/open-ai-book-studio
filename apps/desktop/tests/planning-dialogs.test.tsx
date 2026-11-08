/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { StrictMode } from "react";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanningApi, planningChannels, planningValue } from "@ai-book-studio/core/library/planning-api";
import { PlanningNavigation } from "../../../packages/app/src/components/planning/navigation";
import { mockElectron } from "./support/mock-electron";
import type { SidecarRead, SidecarSave } from "@ai-book-studio/core/planning/checked-sidecar";
import type { Planning } from "@ai-book-studio/core/planning/schema";
import type { PlanningSaveRequest } from "@ai-book-studio/core/planning/service";
import type { Goal, GoalProgress, GoalSaveRequest } from "@ai-book-studio/core/organization/goals";
import type { DraftSaveResult, DraftSessionState } from "../../../packages/app/src/components/planning/contracts";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let WorldbuildingDialog!: typeof import("@ai-book-studio/app/components/planning/WorldbuildingDialog").WorldbuildingDialog;
let GoalDialog!: typeof import("@ai-book-studio/app/components/planning/GoalDialog").GoalDialog;
let SavedGoalProgress!: typeof import("@ai-book-studio/app/components/planning/SavedGoalProgress").SavedGoalProgress;
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;
let Library!: typeof import("../src/main/library/store").Library;
let registerIpc!: typeof import("../src/main/ipc").registerIpc;
const roots: string[] = [];
const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

beforeAll(async () => {
  testing = await mountDom();
  ({ WorldbuildingDialog } = await import("@ai-book-studio/app/components/planning/WorldbuildingDialog"));
  ({ GoalDialog } = await import("@ai-book-studio/app/components/planning/GoalDialog"));
  ({ SavedGoalProgress } = await import("@ai-book-studio/app/components/planning/SavedGoalProgress"));
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
  mockElectron(tmpdir(), { handle: (channel, handler) => { ipcHandlers.set(channel, handler); } });
  ({ Library } = await import("../src/main/library/store"));
  ({ registerIpc } = await import("../src/main/ipc"));
});
afterEach(() => testing.cleanup());
afterAll(unmountDom);
afterAll(async () => {
  mockElectron(tmpdir());
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const bookId = "book_synthetic01";
const view = { bookId, viewGeneration: 1 };
const basic = { ...view, open: true, bookTitle: "Synthetic coast", onClose: () => {} };
const recordId = "wb_synthetic01";
function absent<T>(id = bookId): SidecarRead<T> {
  return { bookId: id, data: null, source: { kind: "absent", revision: 0 }, baselineJson: null };
}
function planning(): SidecarRead<Planning> & { data: Planning } {
  const data: Planning = { schemaVersion: 1, bookId, revision: 3,
    worldbuilding: [{ id: recordId, bookId, revision: 2, kind: "worldbuilding", archived: false,
      name: "Harbor", category: " Place ", description: "Original\r\ntext", notes: "  notes  ", future: { literal: "keep" } }],
    timeline: [], timelineOrder: [], beats: [], beatOrder: [], future: { nested: ["keep"] } };
  return { bookId, data, source: { kind: "sha256", revision: 3, value: "a".repeat(64) }, baselineJson: ` ${JSON.stringify(data)}\r\n` };
}
function goal(targetWords: number | null = 100): SidecarRead<Goal> {
  const data: Goal = { schemaVersion: 1, bookId, revision: 1, targetWords };
  return { bookId, data, source: { kind: "sha256", revision: 1, value: "b".repeat(64) }, baselineJson: `${JSON.stringify(data)}\n` };
}
function complete(savedWords = 25, targetWords: number | null = 100): GoalProgress {
  return { status: "complete", bookId, targetWords, savedWords, remaining: targetWords === null ? null : Math.max(0, targetWords - savedWords) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function page() { return testing.within(document.body); }
function input(name: string) { return page().getByRole("textbox", { name }) as HTMLInputElement; }
function change(name: string, value: string) { testing.fireEvent.change(input(name), { target: { value } }); }
function click(name: string) { testing.fireEvent.click(page().getByRole("button", { name })); }
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected synthetic fixture value");
  return value;
}
function worldDraft(request: PlanningSaveRequest | undefined) {
  const draft = required(request).draft;
  if (draft.kind !== "create-worldbuilding" && draft.kind !== "edit-worldbuilding") {
    throw new Error("Expected a worldbuilding draft");
  }
  return draft.fields;
}
async function ready() { await page().findByText(/Ready · changes save/); }
function conflict(): SidecarSave<Planning> & { status: "conflict" } {
  return { status: "conflict", bookId, reason: "external-edit", savedAs: "conflicts/planning-synthetic.json", observed: { kind: "sha256", revision: 4, value: "c".repeat(64) },
    preserved: { rawJson: "{}", hash: "d".repeat(64) } };
}

async function realPlanningWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "w08-planning-ui-"));
  roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Synthetic integrated coast" });
  await library.createChapter(book.id, { title: "Synthetic source", content: "one two three" });
  registerIpc({ requireLibrary: () => library } as never, () => null, {} as never, {} as never,
    {} as never, {} as never, {} as never, { get: () => ({}) } as never, {} as never);
  const api = createPlanningApi((operation, payload) => required(ipcHandlers.get(planningChannels[operation]))({}, payload));
  let changed: (() => void) | undefined;
  Object.assign(window, { studio: {
    planning: api, platform: "darwin",
    books: { open: async (id: string) => ({ ok: true, data: await library.readBook(id) }) },
    conflicts: { list: async (id: string) => ({ ok: true, data: await library.listConflicts(id) }) },
    drafts: { set: async () => ({ ok: true, data: null }), clear: async () => ({ ok: true, data: null }), onFlushRequest: () => () => {} },
    recovery: { list: async () => ({ ok: true, data: [] }) },
    images: { list: async () => ({ ok: true, data: { manifest: { images: [] } } }) },
    library: { onChange: (callback: (value: unknown) => void) => { changed = () => callback({ paths: [`books/${book.id}/chapters`], at: new Date().toISOString() }); return () => {}; } },
    agent: { onEvent: () => () => {} },
    voice: { connections: async () => ({ ok: true, data: [] }), speakers: async () => ({ ok: true, data: { available: false, connectionLabel: null, model: null, voices: [] } }) }
  } });
  const back = mock(() => {});
  const notice = mock((_error: unknown) => {});
  const navigation = new PlanningNavigation();
  const mounted = testing.render(<WorkspaceView bookId={book.id} libraryRoot={root} planningNavigation={navigation}
    theme={{ choice: "light", set: () => {}, cycle: () => {} }} onBack={back} onNotice={notice} onSchemaRefusal={() => {}} />);
  await page().findByText("Saved: 3 words · no saved goal");
  return { root, library, book, api, back, notice, navigation, mounted, changed: () => changed?.() };
}

describe("mounted Workspace through real checked filesystem and registered IPC", () => {
  test("unknown save failure holds the exact draft and close guard until explicit discard and fresh reopen", async () => {
    const { api, book, back } = await realPlanningWorkspace();
    const save = api.saveGoal;
    let calls = 0;
    api.saveGoal = async (request) => { calls++; await save(request); throw new Error("Synthetic lost transport reply"); };
    click("Set saved-word goal"); await ready(); change("Total saved-word target", "00100"); click("Save changes");
    await page().findByText(/The save outcome is uncertain/);
    expect(calls).toBe(1);
    expect(input("Total saved-word target").value).toBe("00100");
    testing.fireEvent.click(page().getByRole("button", { name: "Back to library", hidden: true }));
    expect(back).not.toHaveBeenCalled();
    testing.fireEvent.click(testing.within(page().getByRole("group", { name: "Confirm draft discard" })).getByRole("button", { name: "Keep editing" }));
    expect(input("Total saved-word target").value).toBe("00100");
    click("Close editor"); click("Discard draft and close");
    click("Set saved-word goal"); await ready();
    expect(input("Total saved-word target").value).toBe("100");
    expect((await planningValue(api.readGoal(book.id))).data?.targetWords).toBe(100);
    expect(calls).toBe(1);
  });
  test("goal set, reopen, clear and world create, edit, reopen", async () => {
    const { api, book } = await realPlanningWorkspace();
    click("Set saved-word goal"); await ready();
    change("Total saved-word target", "100"); click("Save changes");
    await page().findByText("Saved."); click("Close editor");
    await page().findByText("Saved: 3 words · target 100 · 97 remaining");
    click("Set saved-word goal"); await ready();
    expect(input("Total saved-word target").value).toBe("100");
    click("Clear goal"); click("Save changes"); await page().findByText("Saved."); click("Close editor");
    expect((await planningValue(api.readGoal(book.id))).data?.targetWords).toBeNull();
    click("World details"); testing.fireEvent.click(await page().findByRole("button", { name: "New world detail" })); await ready();
    change("Name", "Synthetic harbor"); change("Description", "Exact text  "); click("Save changes");
    await page().findByText("Saved."); click("Close editor");
    testing.fireEvent.click(await page().findByRole("button", { name: "World detail 1 · Edit Synthetic harbor" })); await ready();
    expect(input("Description").value).toBe("Exact text  ");
    change("Notes", "Recovered tide notes"); click("Save changes"); await page().findByText("Saved."); click("Close editor");
    testing.fireEvent.click(await page().findByRole("button", { name: "World detail 1 · Edit Synthetic harbor" })); await ready();
    expect(input("Notes").value).toBe("Recovered tide notes");
  });

  test("real stale IPC save retains newer target, exact dirty intent and discoverable inspected copy", async () => {
    const { api, library, book } = await realPlanningWorkspace();
    click("Set saved-word goal"); await ready(); change("Total saved-word target", "00100");
    const external = await library.goals.read(book.id);
    await library.goals.save({ bookId: book.id, source: external.source, baselineJson: external.baselineJson, draft: { kind: "set-goal", targetWords: 200 } });
    click("Save changes"); await page().findByText(/Your submitted draft was kept in conflict copy/);
    expect(input("Total saved-word target").value).toBe("00100");
    expect((await planningValue(api.readGoal(book.id))).data?.targetWords).toBe(200);
    click("Close editor");
    testing.fireEvent.click(testing.within(page().getByRole("group", { name: "Confirm draft discard" })).getByRole("button", { name: "Keep editing" }));
    expect(input("Total saved-word target").value).toBe("00100");
    click("Close editor"); click("Discard draft and close");
    const list = await planningValue(api.listCopies(book.id, 0));
    testing.fireEvent.click(page().getByText("Planning recovery copies"));
    const button = await page().findByRole("button", { name: `Inspect ${list.names[0]}` });
    testing.fireEvent.click(button);
    await page().findByText("Copy target: 100");
    expect(page().getByText(/Reopen Set saved-word goal or Edit saved-word goal/)).toBeTruthy();
  });

  test("More-sheet Back respects the planning guard and leaves the dirty draft usable", async () => {
    const { back, navigation } = await realPlanningWorkspace();
    click("Set saved-word goal"); await ready(); change("Total saved-word target", "777");
    testing.fireEvent.click(page().getByTestId("mobile-more"));
    testing.fireEvent.click(await page().findByTestId("more-back"));
    expect(back).not.toHaveBeenCalled();
    expect(input("Total saved-word target").value).toBe("777");
    testing.fireEvent.click(testing.within(page().getByRole("group", { name: "Confirm draft discard" })).getByRole("button", { name: "Keep editing" }));
    expect(input("Total saved-word target").value).toBe("777");
    expect(back).not.toHaveBeenCalled();
    click("Close editor"); click("Discard draft and close");
    testing.fireEvent.click(page().getByTestId("mobile-more"));
    testing.fireEvent.click(await page().findByTestId("more-back"));
    expect(back).toHaveBeenCalledTimes(1);
    expect(navigation.begin({ bookId: "book_fresh01", viewGeneration: 99 })).toBe(true);
  });

  test("dirty host navigation, unregistered/foreign guards, pending save and observed unreadable sources", async () => {
    const { api, book, root, back, navigation, changed } = await realPlanningWorkspace();
    const foreign = { bookId: book.id, viewGeneration: "foreign" };
    expect(navigation.begin(foreign)).toBe(true);
    expect(navigation.allow()).toBe(false);
    expect(() => navigation.register({ ...foreign, viewGeneration: "old" }, { dirty: false, pending: false, needsReload: false, requestClose: () => {} })).toThrow();
    expect(navigation.close(foreign)).toBe(true);
    click("Set saved-word goal"); await ready(); change("Total saved-word target", "100");
    testing.fireEvent.click(page().getByRole("button", { name: "Back to library", hidden: true }));
    expect(back).not.toHaveBeenCalled(); click("Keep editing");
    expect(input("Total saved-word target").value).toBe("100");
    const release = deferred<void>(); const entered = deferred<void>();
    const save = api.saveGoal;
    api.saveGoal = async (request) => { entered.resolve(); await release.promise; return save(request); };
    click("Save changes"); await entered.promise;
    testing.fireEvent.click(page().getByRole("button", { name: "Back to library", hidden: true })); expect(back).not.toHaveBeenCalled();
    release.resolve(); await page().findByText("Saved."); click("Close editor");
    await writeFile(join(root, "books", book.id, "chapters", "0002-unreadable.md"), "---\nid: [\n---\nbad");
    testing.act(() => changed());
    await page().findByText(/Saved progress is incomplete/);
    click("Back to library"); expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("worldbuilding leaf", () => {
  test("a throwing state observer retains the dirty editor and exact baseline", async () => {
    const original = planning();
    const save = mock(async (_request: PlanningSaveRequest): Promise<DraftSaveResult<Planning>> => ({ status: "refused", message: "Synthetic refusal" }));
    const onClose = mock(() => {});
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => original} save={save} onClose={onClose}
      onSessionState={(_view, state) => { if (state.dirty) throw new Error("Synthetic observer failure"); }} />);
    await ready();
    change("Name", "Exact observer draft  ");
    expect(page().getByRole("alert").textContent).toContain("could not receive this editor’s state");
    expect(input("Name").value).toBe("Exact observer draft  ");
    click("Close editor");
    click("Keep editing");
    expect(onClose).not.toHaveBeenCalled();
    click("Save changes");
    await page().findByText(/Not saved. Synthetic refusal/);
    expect(save.mock.calls[0]?.[0].baselineJson).toBe(original.baselineJson);
    expect(worldDraft(save.mock.calls[0]?.[0]).name).toBe("Exact observer draft  ");
  });

  test.each([false, true])("failed close leaves a usable retained session (dirty %s)", async (dirty) => {
    const original = planning();
    const save = mock(async (_request: PlanningSaveRequest): Promise<DraftSaveResult<Planning>> => ({ status: "refused", message: "Synthetic refusal" }));
    let fail = true;
    const onClose = mock(() => { if (fail) throw new Error("Synthetic close failure"); });
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => original} save={save} onClose={onClose} />);
    await ready();
    if (dirty) change("Notes", "Uncommitted notes  ");
    click("Close editor");
    if (dirty) click("Discard draft and close");
    expect(page().getByRole("alert").textContent).toContain("could not close this editor");
    expect(page().queryByRole("group", { name: "Confirm draft discard" })).toBeNull();
    expect(input("Notes").value).toBe(dirty ? "Uncommitted notes  " : "  notes  ");
    change("Name", "After failed close");
    click("Save changes");
    await page().findByText(/Not saved. Synthetic refusal/);
    expect(save.mock.calls[0]?.[0].baselineJson).toBe(original.baselineJson);
    expect(worldDraft(save.mock.calls[0]?.[0]).name).toBe("After failed close");
    fail = false;
    click("Close editor");
    click("Discard draft and close");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test.each(["saved", "unchanged", "conflict"] as const)("throwing result observer cannot relabel %s or replay its write", async (status) => {
    const save = mock(async (): Promise<SidecarSave<Planning>> => status === "conflict" ? conflict() : { status, current: planning() });
    const onResult = mock(() => { throw new Error("Synthetic result failure"); });
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => planning()} save={save} onResult={onResult} />);
    await ready();
    change("Name", "Submitted draft");
    click("Save changes");
    await page().findByText(/could not receive the checked save result/);
    expect(page().getByText(status === "conflict" ? /Your submitted draft was kept/ : status === "saved" ? "Saved." : "Already current · no file was written.")).toBeTruthy();
    expect(page().queryByText(/The save outcome is uncertain/)).toBeNull();
    change("Name", "Still editable");
    expect(input("Name").value).toBe("Still editable");
    expect(save).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  test("opening is read-only; a literal create has no caller ID and duplicate submits/close are blocked", async () => {
    const call = deferred<SidecarSave<Planning>>();
    const save = mock((_request: PlanningSaveRequest) => call.promise);
    const onClose = mock(() => {});
    const onResult = mock(() => {});
    const read = mock(async () => absent<Planning>());
    testing.render(<WorldbuildingDialog {...basic} read={read} save={save} onClose={onClose} onResult={onResult} />);
    await ready();
    expect(save).not.toHaveBeenCalled();
    change("Name", "  Élan e\u0301  ");
    change("Category", "  coast  ");
    change("Description", "line one\nline two\n");
    change("Notes", "  keep spaces  ");
    const form = required(input("Name").closest("form"));
    testing.fireEvent.submit(form);
    testing.fireEvent.submit(form);
    click("Close");
    testing.fireEvent.keyDown(document, { key: "Escape" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(save.mock.calls[0]?.[0]).toEqual({ bookId, source: { kind: "absent", revision: 0 }, baselineJson: null,
      draft: { kind: "create-worldbuilding", fields: { name: "  Élan e\u0301  ", category: "  coast  ", description: "line one\nline two\n", notes: "  keep spaces  " } } });
    await testing.act(async () => call.resolve({ status: "saved", current: planning() }));
    expect(page().getByText("Saved.")).toBeTruthy();
    expect(onResult).toHaveBeenCalledWith(view, { status: "saved", current: planning() });
  });

  test("retains an exact baseline across prop refresh, refusal, edits and explicit retry", async () => {
    const original = planning();
    const save = mock(async (_request: PlanningSaveRequest): Promise<DraftSaveResult<Planning>> => ({ status: "refused", message: "Permission denied before publication." }));
    const props = { ...basic, recordId, read: async () => original, save };
    const rendered = testing.render(<WorldbuildingDialog {...props} />);
    await ready();
    change("Name", "  New harbor  ");
    // Mutating the callback's object must not mutate the retained UI baseline.
    original.source.revision = 88;
    original.baselineJson = "wrong";
    rendered.rerender(<WorldbuildingDialog {...props} read={async () => absent<Planning>()} />);
    click("Save changes");
    await page().findByText(/Not saved. Permission denied/);
    expect(input("Name").value).toBe("  New harbor  ");
    change("Notes", "retry notes  ");
    click("Save changes");
    await testing.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    for (const [request] of save.mock.calls) {
      expect(request.baselineJson).toBe(planning().baselineJson);
      expect(request.source).toEqual(planning().source);
    }
    expect(worldDraft(save.mock.calls[1]?.[0]).notes).toBe("retry notes  ");
  });

  test("current no-op still calls the checked service and says no file was written", async () => {
    const original = planning();
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: original }));
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => original} save={save} />);
    await ready();
    click("Save changes");
    await page().findByText("Already current · no file was written.");
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("dirty close confirms discard, keep editing restores focus, and neither action writes", async () => {
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: planning() }));
    const onClose = mock(() => {});
    let state: DraftSessionState | undefined;
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => planning()} save={save} onClose={onClose}
      onSessionState={(_scope, next) => { state = next; }} />);
    await ready();
    change("Notes", "unsaved draft");
    expect(state?.dirty).toBe(true);
    testing.act(() => state?.requestClose());
    expect(document.activeElement).toBe(page().getByRole("group", { name: "Confirm draft discard" }));
    click("Keep editing");
    expect(document.activeElement).toBe(input("Name"));
    expect(input("Notes").value).toBe("unsaved draft");
    expect(onClose).not.toHaveBeenCalled();
    click("Close editor");
    click("Discard draft and close");
    expect(onClose).toHaveBeenCalledWith(view);
    expect(save).not.toHaveBeenCalled();
  });

  test.each([
    ["Name", " ", "Name is required"],
    ["Name", "😀".repeat(101), "Name exceeds 200 UTF-16"],
    ["Category", "a".repeat(201), "Category exceeds 200 UTF-16"],
    ["Description", "a".repeat(20_001), "Description exceeds 20,000 UTF-16"],
    ["Notes", "a".repeat(20_001), "Notes exceeds 20,000 UTF-16"]
  ])("refuses %s without truncating the full draft", async (field, value, message) => {
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: planning() }));
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => planning()} save={save} />);
    await ready();
    change(field, value);
    click("Save changes");
    expect(page().getByRole("alert").textContent).toContain(message);
    expect(input(field).value).toBe(value);
    expect(save).not.toHaveBeenCalled();
  });

  test("refuses retained-count and raw UTF-8 baseline budgets before the callback", async () => {
    const read = planning();
    const record = required(read.data.worldbuilding[0]);
    read.data.worldbuilding = Array.from({ length: 200 }, (_, index) => ({ ...record, id: `wb_item${index.toString().padStart(6, "0")}`, archived: true }));
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: read }));
    const rendered = testing.render(<WorldbuildingDialog {...basic} read={async () => read} save={save} />);
    await ready();
    change("Name", "New one");
    click("Save changes");
    expect(page().getByRole("alert").textContent).toContain("200 retained world details");
    expect(save).not.toHaveBeenCalled();
    const tooLarge = planning();
    tooLarge.baselineJson = "界".repeat(833_334);
    rendered.rerender(<WorldbuildingDialog {...basic} viewGeneration={2} recordId={recordId} read={async () => tooLarge} save={save} />);
    await ready();
    change("Name", "Still here");
    click("Save changes");
    expect(page().getByRole("alert").textContent).toContain("2,500,000 UTF-8 bytes");
    expect(input("Name").value).toBe("Still here");
    expect(save).not.toHaveBeenCalled();
  });

  test("final serialized-file budget refusal preserves every field and the exact original request", async () => {
    const save = mock(async (_request: PlanningSaveRequest): Promise<DraftSaveResult<Planning>> => ({ status: "refused", message: "The complete file exceeds 2,500,000 UTF-8 bytes, including unknown data." }));
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => planning()} save={save} />);
    await ready();
    change("Description", "界".repeat(20_000));
    click("Save changes");
    await page().findByText(/Not saved. The complete file exceeds/);
    expect(input("Description").value).toBe("界".repeat(20_000));
    expect(save.mock.calls[0]?.[0].baselineJson).toBe(planning().baselineJson);
  });

  test("conflict comparison never rebases; reload is explicit and a failed reload keeps the draft", async () => {
    const original = planning();
    const current = planning();
    required(current.data.worldbuilding[0]).name = "Other writer";
    current.source = { kind: "sha256", revision: 4, value: "c".repeat(64) };
    current.baselineJson = JSON.stringify(current.data);
    let failRead = false;
    const read = mock(async () => { if (failRead) throw new Error("Permission lost."); return read.mock.calls.length === 1 ? original : current; });
    const save = mock(async (_request: PlanningSaveRequest): Promise<SidecarSave<Planning>> => conflict());
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={read} save={save} />);
    await ready();
    change("Name", "My exact draft  ");
    click("Save changes");
    await page().findByText(/Your submitted draft was kept in conflict copy/);
    expect(read).toHaveBeenCalledTimes(1);
    click("Keep editing");
    change("Notes", "more text");
    testing.fireEvent.submit(required(input("Name").closest("form")));
    expect(save).toHaveBeenCalledTimes(1);
    click("Review saved version");
    await page().findByText("Other writer");
    expect(input("Name").value).toBe("My exact draft  ");
    expect(save.mock.calls[0]?.[0].baselineJson).toBe(original.baselineJson);
    click("Reload saved data");
    failRead = true;
    click("Reload and discard draft");
    await page().findByText(/Could not read saved data. Permission lost/);
    expect(input("Name").value).toBe("My exact draft  ");
    expect(page().getByText(/Submitted draft copy: conflicts\/planning-synthetic.json/)).toBeTruthy();
    failRead = false;
    click("Reload and discard draft");
    await page().findByText(/Reloaded saved data/);
    expect(input("Name").value).toBe("Other writer");
    click("Save changes");
    await testing.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0].baselineJson).toBe(current.baselineJson);
    expect(save.mock.calls[1]?.[0].source).toEqual(current.source);
  });

  test.each(["uncertain", "not-kept", "transport"])("%s failure is distinct, preserves the draft and cannot replay", async (outcome) => {
    const save = mock(async (): Promise<SidecarSave<Planning>> => {
      if (outcome === "transport") throw new Error("Disconnected after send");
      throw { outcome, phase: outcome === "not-kept" ? "recovery" : "active" };
    });
    const onResult = mock(() => {});
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={async () => planning()} save={save} onResult={onResult} />);
    await ready();
    change("Notes", "Exact unsaved notes  ");
    click("Save changes");
    await page().findByText(outcome === "not-kept" ? /No durable conflict copy was verified/ : /The save outcome is uncertain/);
    expect(input("Notes").value).toBe("Exact unsaved notes  ");
    click("Keep editing");
    testing.fireEvent.submit(required(input("Notes").closest("form")));
    expect(save).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
  });

  test.each(["missing", "archived", "foreign", "read error"])("%s read does not become an empty editable record", async (kind) => {
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: planning() }));
    const read = async () => {
      if (kind === "read error") throw new Error("Future schema refused");
      const value = planning();
      if (kind === "missing") value.data.worldbuilding = [];
      if (kind === "archived") required(value.data.worldbuilding[0]).archived = true;
      if (kind === "foreign") value.bookId = "book_elsewhere01";
      return value;
    };
    testing.render(<WorldbuildingDialog {...basic} recordId={recordId} read={read} save={save} />);
    await page().findByRole("alert");
    expect(page().queryByRole("textbox", { name: "Name" })).toBeNull();
    expect((page().getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("view-bound operations", () => {
  test.each(["saved", "conflict", "failure"])("late %s from A cannot affect B or reopened A", async (status) => {
    const call = deferred<SidecarSave<Planning>>();
    const save = mock(() => call.promise);
    const onResult = mock(() => {});
    const props = { ...basic, recordId, read: async () => planning(), save, onResult };
    const rendered = testing.render(<WorldbuildingDialog {...props} />);
    await ready();
    change("Name", "Old A draft");
    click("Save changes");
    const other = planning();
    other.bookId = "book_elsewhere01";
    other.data.bookId = other.bookId;
    required(other.data.worldbuilding[0]).bookId = other.bookId;
    rendered.rerender(<WorldbuildingDialog {...props} bookId="book_elsewhere01" viewGeneration={2} read={async () => other} />);
    await ready();
    rendered.rerender(<WorldbuildingDialog {...props} viewGeneration={3} />);
    await ready();
    change("Name", "Reopened A draft");
    await testing.act(async () => {
      if (status === "failure") call.reject(new Error("Old failure"));
      else call.resolve(status === "saved" ? { status: "saved", current: planning() } : conflict());
    });
    expect(input("Name").value).toBe("Reopened A draft");
    expect(onResult).not.toHaveBeenCalled();
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("late reads after A → B → A and after closing cannot populate the new session", async () => {
    const oldRead = deferred<SidecarRead<Planning>>();
    const save = mock(async (): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: planning() }));
    const props = { ...basic, recordId, save };
    const rendered = testing.render(<WorldbuildingDialog {...props} read={() => oldRead.promise} />);
    rendered.rerender(<WorldbuildingDialog {...props} open={false} read={async () => planning()} />);
    rendered.rerender(<WorldbuildingDialog {...props} viewGeneration={3} read={async () => planning()} />);
    await ready();
    change("Name", "New lifetime");
    const old = planning(); required(old.data.worldbuilding[0]).name = "Late old read";
    await testing.act(async () => oldRead.resolve(old));
    expect(input("Name").value).toBe("New lifetime");
  });

  test("Strict Mode cleanup ignores the first read without ignoring the current one", async () => {
    const old = deferred<SidecarRead<Planning>>();
    let calls = 0;
    const read = () => ++calls === 1 ? old.promise : Promise.resolve(planning());
    testing.render(<StrictMode><WorldbuildingDialog {...basic} recordId={recordId} read={read}
      save={async () => ({ status: "unchanged", current: planning() })} /></StrictMode>);
    await ready();
    change("Name", "Current draft");
    await testing.act(async () => old.resolve(planning()));
    expect(input("Name").value).toBe("Current draft");
  });

  test("late comparison reads do not populate a different view", async () => {
    const comparison = deferred<SidecarRead<Planning>>();
    let reads = 0;
    const props = { ...basic, recordId, save: async () => conflict() };
    const rendered = testing.render(<WorldbuildingDialog {...props} read={() => ++reads === 1 ? Promise.resolve(planning()) : comparison.promise} />);
    await ready();
    click("Save changes");
    await page().findByText(/Your submitted draft was kept/);
    click("Review saved version");
    rendered.rerender(<WorldbuildingDialog {...props} viewGeneration={2} read={async () => planning()} />);
    await ready();
    await testing.act(async () => comparison.resolve(planning()));
    expect(page().queryByRole("region", { name: "Saved version for comparison" })).toBeNull();
  });
});

describe("saved-word goal leaf", () => {
  test("accepts the safe maximum, then a new draft clears the previous Saved status", async () => {
    const save = mock(async (_request: GoalSaveRequest): Promise<SidecarSave<Goal>> => ({ status: "saved", current: goal(Number.MAX_SAFE_INTEGER) }));
    testing.render(<GoalDialog {...basic} read={async () => goal()} save={save} readProgress={async () => complete()} sourceGeneration={1} manuscriptState="clean" />);
    await ready();
    change("Total saved-word target", "9007199254740991");
    click("Save changes");
    await page().findByText("Saved.");
    expect(save.mock.calls[0]?.[0].draft.targetWords).toBe(Number.MAX_SAFE_INTEGER);
    change("Total saved-word target", "999");
    expect(page().queryByText("Saved.")).toBeNull();
    expect(page().getByText(/Draft not saved/)).toBeTruthy();
  });

  test("absent clear requests a checked no-op, never a local fake success", async () => {
    const save = mock(async (_request: GoalSaveRequest): Promise<SidecarSave<Goal>> => ({ status: "unchanged", current: absent<Goal>() }));
    testing.render(<GoalDialog {...basic} read={async () => absent<Goal>()} save={save} readProgress={async () => complete(0, null)} sourceGeneration={1} manuscriptState="clean" />);
    await ready();
    click("Clear goal");
    expect(save).not.toHaveBeenCalled();
    click("Save changes");
    await page().findByText("Already current · no file was written.");
    expect(save.mock.calls[0]?.[0]).toEqual({ bookId, source: { kind: "absent", revision: 0 }, baselineJson: null, draft: { kind: "set-goal", targetWords: null } });
  });

  test("pending clear blocks duplicate submit and dismissal; its reply cannot change reopened A", async () => {
    const call = deferred<SidecarSave<Goal>>();
    const save = mock((_request: GoalSaveRequest) => call.promise);
    const onResult = mock(() => {});
    const onClose = mock(() => {});
    const props = { ...basic, save, onResult, onClose, read: async () => goal(), readProgress: async () => complete(), sourceGeneration: 1, manuscriptState: "clean" as const };
    const rendered = testing.render(<GoalDialog {...props} />);
    await ready();
    click("Clear goal");
    click("Save changes");
    testing.fireEvent.submit(required(input("Total saved-word target").closest("form")));
    click("Close");
    expect(save).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    const other = goal(); other.bookId = "book_elsewhere01"; required(other.data).bookId = other.bookId;
    rendered.rerender(<GoalDialog {...props} bookId={other.bookId} viewGeneration={2} read={async () => other} />);
    await ready();
    rendered.rerender(<GoalDialog {...props} viewGeneration={3} />);
    await ready();
    change("Total saved-word target", "777");
    await testing.act(async () => call.resolve({ status: "saved", current: goal(null) }));
    expect(input("Total saved-word target").value).toBe("777");
    expect(onResult).not.toHaveBeenCalled();
  });

  test("sets and clears only on explicit save, retaining the prior saved target on refusal", async () => {
    const save = mock(async (_request: GoalSaveRequest): Promise<DraftSaveResult<Goal>> => ({ status: "refused", message: "Final byte budget exceeded." }));
    testing.render(<GoalDialog {...basic} read={async () => goal()} save={save} readProgress={async () => complete()} sourceGeneration={1} manuscriptState="clean" />);
    await ready();
    change("Total saved-word target", "250");
    click("Save changes");
    await page().findByText(/Not saved. Final byte budget exceeded/);
    expect(input("Total saved-word target").value).toBe("250");
    expect(page().getByText(/Last confirmed saved: 25 words · target 100 · 75 remaining/)).toBeTruthy();
    expect(save.mock.calls[0]?.[0]).toEqual({ bookId, source: goal().source, baselineJson: goal().baselineJson, draft: { kind: "set-goal", targetWords: 250 } });
    click("Clear goal");
    expect(save).toHaveBeenCalledTimes(1);
    expect(input("Total saved-word target").value).toBe("");
    click("Save changes");
    await testing.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0].draft.targetWords).toBeNull();
    expect(save.mock.calls[1]?.[0].baselineJson).toBe(goal().baselineJson);
  });

  test.each(["0", "-1", "1.5", "1e4", " 100 ", "9007199254740992", "1".repeat(1000)])("invalid target %s remains literal and is never submitted", async (value) => {
    const save = mock(async (): Promise<SidecarSave<Goal>> => ({ status: "saved", current: goal() }));
    testing.render(<GoalDialog {...basic} read={async () => goal()} save={save} readProgress={async () => complete()} sourceGeneration={1} manuscriptState="clean" />);
    await ready();
    change("Total saved-word target", value);
    click("Save changes");
    expect(page().getByRole("alert").textContent).toContain("positive whole number");
    expect(input("Total saved-word target").value).toBe(value);
    expect(save).not.toHaveBeenCalled();
  });

  test.each(["saved", "unchanged", "conflict", "uncertain", "not-kept"])("goal %s uses the same checked draft protocol", async (status) => {
    const save = mock(async (): Promise<SidecarSave<Goal>> => {
      if (status === "uncertain" || status === "not-kept") throw { outcome: status };
      if (status === "conflict") return conflict();
      return { status: status as "saved" | "unchanged", current: goal(200) };
    });
    testing.render(<GoalDialog {...basic} read={async () => goal()} save={save} readProgress={async () => complete()} sourceGeneration={1} manuscriptState="clean" />);
    await ready();
    change("Total saved-word target", "200");
    click("Save changes");
    await page().findByText(status === "saved" ? "Saved." : status === "unchanged" ? "Already current · no file was written."
      : status === "conflict" ? /Your submitted draft was kept/ : status === "not-kept" ? /No durable conflict copy/ : /The save outcome is uncertain/);
    expect(input("Total saved-word target").value).toBe("200");
  });
});

describe("saved progress", () => {
  test.each([0, 25, 100, 120])("shows complete saved %s with a floored remainder", async (words) => {
    testing.render(<SavedGoalProgress {...view} readProgress={async () => complete(words)} sourceGeneration={1} manuscriptState="clean" />);
    await page().findByText(`Saved: ${words} words · target 100 · ${Math.max(0, 100 - words)} remaining`);
    expect(page().getByRole("progressbar").getAttribute("value")).toBe(String(Math.min(words, 100)));
  });

  test.each(["dirty", "pending", "failed", "conflict"] as const)("%s manuscript state labels last-confirmed saved words", async (manuscriptState) => {
    testing.render(<SavedGoalProgress {...view} readProgress={async () => complete()} sourceGeneration={1} manuscriptState={manuscriptState} />);
    await page().findByText(/Last confirmed saved: 25 words/);
  });

  test.each(["incomplete", "unavailable", "thrown", "foreign"])("%s source never exposes a whole-book progress bar", async (kind) => {
    const readProgress = async (): Promise<GoalProgress> => {
      if (kind === "thrown") throw new Error("Read failed");
      if (kind === "foreign") return { ...complete(), bookId: "book_elsewhere01" };
      return kind === "incomplete" ? { status: "incomplete", bookId, targetWords: 100, unreadableChapters: 2 }
        : { status: "unavailable", bookId, reason: "changed" };
    };
    testing.render(<SavedGoalProgress {...view} readProgress={readProgress} sourceGeneration={1} manuscriptState="clean" />);
    await page().findByText(kind === "incomplete" ? /Saved progress is incomplete · 2 unreadable chapters/ : /Saved progress is unavailable/);
    expect(page().queryByRole("progressbar")).toBeNull();
    expect(page().queryByText(/remaining/)).toBeNull();
  });

  test("no target has no percentage; source invalidation removes a confirmed count before the new read", async () => {
    const call = deferred<GoalProgress>();
    const rendered = testing.render(<SavedGoalProgress {...view} readProgress={async () => complete(0, null)} sourceGeneration={1} manuscriptState="clean" />);
    await page().findByText("Saved: 0 words · no saved goal");
    expect(page().queryByRole("progressbar")).toBeNull();
    rendered.rerender(<SavedGoalProgress {...view} readProgress={() => call.promise} sourceGeneration={2} manuscriptState="dirty" />);
    expect(page().queryByText(/Saved: 0 words/)).toBeNull();
    await testing.act(async () => call.resolve(complete(5)));
    expect(page().getByText(/Last confirmed saved: 5 words/)).toBeTruthy();
  });

  test("late old progress cannot appear after A → B → A", async () => {
    const call = deferred<GoalProgress>();
    const rendered = testing.render(<SavedGoalProgress {...view} readProgress={() => call.promise} sourceGeneration={1} manuscriptState="clean" />);
    rendered.rerender(<SavedGoalProgress {...view} bookId="book_elsewhere01" viewGeneration={2} readProgress={async () => ({ ...complete(20), bookId: "book_elsewhere01" })} sourceGeneration={1} manuscriptState="clean" />);
    rendered.rerender(<SavedGoalProgress {...view} viewGeneration={3} readProgress={async () => complete(30)} sourceGeneration={1} manuscriptState="clean" />);
    await page().findByText(/Saved: 30 words/);
    await testing.act(async () => call.resolve(complete(99)));
    expect(page().queryByText(/99 words/)).toBeNull();
  });
});
