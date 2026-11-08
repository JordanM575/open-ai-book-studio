/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanningApi, planningHandler, planningValue } from "@ai-book-studio/core/library/planning-api";
import type { PlanningSaveRequest } from "@ai-book-studio/core/planning/service";
import type { Planning } from "@ai-book-studio/core/planning/schema";
import type { SidecarRead, SidecarSave } from "@ai-book-studio/core/planning/checked-sidecar";
import { PlanningNavigation } from "../../../packages/app/src/components/planning/navigation";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let PlanningPanel!: typeof import("../../../packages/app/src/components/planning/PlanningPanel").PlanningPanel;
let ManualPlanningDialog!: typeof import("../../../packages/app/src/components/planning/ManualPlanningDialog").ManualPlanningDialog;
let Library!: typeof import("../src/main/library/store").Library;
const roots: string[] = [];
beforeAll(async () => {
  testing = await mountDom();
  ({ PlanningPanel } = await import("../../../packages/app/src/components/planning/PlanningPanel"));
  ({ ManualPlanningDialog } = await import("../../../packages/app/src/components/planning/ManualPlanningDialog"));
  ({ Library } = await import("../src/main/library/store"));
});
afterEach(() => testing.cleanup());
afterAll(unmountDom);
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });
function page() { return testing.within(document.body); }
function click(name: string) { testing.fireEvent.click(page().getByRole("button", { name })); }
function input(name: string) { return page().getByRole("textbox", { name }) as HTMLInputElement; }
function change(name: string, value: string) { testing.fireEvent.change(input(name), { target: { value } }); }
async function ready() { await page().findByText(/Ready · changes save/); }
async function saved() { await page().findByText("Saved."); }
async function open(name: string) { testing.fireEvent.click(await page().findByRole("button", { name })); await ready(); }
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing synthetic fixture value"); return value; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "w08-v19-manual-")); roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Synthetic manual coast" });
  await library.updateBook(book.id, { outline: "Existing literal outline" });
  const chapter = await library.createChapter(book.id, { title: "Synthetic chapter", content: "Retained chapter text." });
  const api = createPlanningApi(planningHandler(() => library));
  const navigation = new PlanningNavigation();
  const mounted = testing.render(<PlanningPanel bookId={book.id} bookTitle={book.title} api={api} navigation={navigation}
    sourceGeneration="synthetic:1" manuscriptState="clean" />);
  click("Story planning");
  await page().findByRole("button", { name: "New timeline event" });
  return { root, library, book, chapter, api, navigation, mounted };
}

describe("mounted manual planning through real filesystem Library and handler", () => {
  test("create, continue editing stable IDs, reopen, order, archive confirmation and restore all list kinds", async () => {
    const f = await setup();
    const paths = [join(f.root, "books", f.book.id, "book.json"), join(f.root, "books", f.book.id, "chapters", f.chapter.path)];
    const before = await Promise.all(paths.map((path) => readFile(path)));
    await open("New timeline event");
    change("Title", "Winter"); change("When · literal label", "the winter after the siege"); change("Notes", "  exact event notes  ");
    click("Save changes"); await saved();
    const event = required((await planningValue(f.api.read(f.book.id))).data?.timeline[0]);
    expect(input("Title").value).toBe("Winter");
    change("Title", "Winter revised"); click("Save changes"); await saved(); click("Close editor");
    await open("Winter revised"); expect(input("When · literal label").value).toBe("the winter after the siege");
    expect(input("Notes").value).toBe("  exact event notes  "); click("Close editor");
    await open("New timeline event"); change("Title", "Before winter"); click("Save changes"); await saved(); click("Close editor");
    await open("Order timeline"); click("Move Before winter · position 2 up"); click("Save changes"); await saved(); click("Close editor");
    const events = required((await planningValue(f.api.read(f.book.id))).data);
    expect(events.timeline).toHaveLength(2);
    expect(events.timeline[0]).toMatchObject({ id: event.id, revision: 2 });
    expect(events.timelineOrder).toEqual(events.timeline.map((item) => item.id).reverse());

    await open("New outline beat"); change("Title", "Arrival"); change("Summary", "  exact summary  "); click("Save changes"); await saved();
    change("Notes", "continued edit"); click("Save changes"); await saved(); click("Close editor");
    await open("New outline beat"); change("Title", "Departure"); click("Save changes"); await saved(); click("Close editor");
    await open("Order beats"); click("Move Departure · position 2 up"); click("Save changes"); await saved(); click("Close editor");
    await open("New world detail"); change("Name", "Harbor"); click("Save changes"); await saved();
    change("Notes", "continued world edit"); click("Save changes"); await saved(); click("Close editor");
    const beforeArchive = required((await planningValue(f.api.read(f.book.id))).data);
    for (const title of ["Winter revised", "Arrival", "Harbor"]) {
      await open(`Archive ${title}`);
      click("Save changes"); await page().findByText(/Confirm the archive action before saving/);
      expect((await planningValue(f.api.read(f.book.id))).data).toEqual(beforeArchive);
      testing.fireEvent.click(page().getByRole("checkbox", { name: "Confirm archive · keep all content" }));
      click("Save changes"); await saved(); click("Close editor");
      await open(`Restore ${title}`); click("Save changes"); await saved(); click("Close editor");
      // Other records stay unchanged while each affected record advances twice.
      const restored = required((await planningValue(f.api.read(f.book.id))).data);
      Object.assign(beforeArchive, restored);
    }
    const reopened = await Library.open(f.root);
    const data = required((await reopened.planning.read(f.book.id)).data);
    expect(data.beatOrder).toEqual(data.beats.map((item) => item.id).reverse());
    expect(data.beats[0]).toMatchObject({ summary: "  exact summary  ", notes: "continued edit", revision: 4, archived: false });
    expect(data.worldbuilding).toHaveLength(1);
    expect(data.worldbuilding[0]).toMatchObject({ notes: "continued world edit", revision: 4, archived: false });
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
  });

  test("optional notes no-op, save, edit, clear and reopen preserve identity and keep outline bytes", async () => {
    const f = await setup();
    const bookBytes = await readFile(join(f.root, "books", f.book.id, "book.json"));
    await open("Edit story notes"); click("Save changes"); await page().findByText("Already current · no file was written.");
    expect((await planningValue(f.api.read(f.book.id))).data).toBeNull();
    change("Working notes", "  Exact working notes  "); change("Style notes", "Literal style"); change("Synopsis", "Literal synopsis");
    click("Save changes"); await saved(); click("Close editor");
    const original = required((await planningValue(f.api.read(f.book.id))).data?.storyNotes);
    await open("Edit story notes"); expect(input("Working notes").value).toBe("  Exact working notes  ");
    change("Synopsis", "Revised synopsis"); click("Save changes"); await saved();
    click("Clear story notes"); expect(input("Working notes").value).toBe("");
    expect((await planningValue(f.api.read(f.book.id))).data?.storyNotes?.workingNotes).toBe("  Exact working notes  ");
    click("Save changes"); await saved(); click("Close editor");
    await open("Edit story notes"); expect(input("Synopsis").value).toBe("");
    expect((await planningValue(f.api.read(f.book.id))).data?.storyNotes).toMatchObject({ id: original.id, revision: 3, workingNotes: "", styleNotes: "", synopsis: "" });
    expect(await readFile(join(f.root, "books", f.book.id, "book.json"))).toEqual(bookBytes);
  });

  test("stale event keeps exact author fields, guards navigation and preserves a readable recovery copy", async () => {
    const f = await setup();
    await open("New timeline event"); change("Title", "  Local event  "); change("When · literal label", "  after the siege  "); change("Description", "Local description");
    const read = await f.library.planning.read(f.book.id);
    await f.library.planning.save({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson,
      draft: { kind: "create-beat", fields: { title: "Competing beat", summary: "Other", notes: "" } } });
    click("Save changes"); await page().findByText(/Your submitted draft was kept in conflict copy/);
    expect(input("Title").value).toBe("  Local event  "); expect(input("When · literal label").value).toBe("  after the siege  ");
    testing.act(() => expect(f.navigation.allow()).toBe(false));
    testing.fireEvent.click(testing.within(page().getByRole("group", { name: "Confirm draft discard" })).getByRole("button", { name: "Keep editing" }));
    expect(input("Title").value).toBe("  Local event  ");
    expect(page().getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
    const list = await planningValue(f.api.listCopies(f.book.id, 0));
    const copy = await planningValue(f.api.readCopy(f.book.id, required(list.names[0])));
    expect(JSON.parse(copy.rawJson).timeline[0]).toMatchObject({ title: "  Local event  ", when: "  after the siege  ", description: "Local description" });
    click("Review saved version"); await page().findByRole("region", { name: "Saved version for comparison" });
    expect(input("Title").value).toBe("  Local event  ");
    click("Reload saved data"); click("Reload and discard draft"); await page().findByText(/Reloaded saved data/);
    expect(input("Title").value).toBe(""); click("Close editor");
    expect(f.navigation.allow()).toBe(true);
    await open("New timeline event"); change("Title", "  Local event  "); change("When · literal label", "  after the siege  ");
    click("Save changes"); await saved();
    const data = required((await planningValue(f.api.read(f.book.id))).data);
    expect(data.beats[0]?.title).toBe("Competing beat"); expect(data.timeline[0]?.title).toBe("  Local event  ");
  });

  test("pending and uncertain beat save never duplicates or permits navigation, reopen reads actual storage", async () => {
    const f = await setup();
    const save = f.api.save;
    const release = deferred<void>(); const entered = deferred<void>();
    let calls = 0;
    f.api.save = async (request) => { calls++; entered.resolve(); await release.promise; await save(request); throw new Error("Synthetic lost response after publication"); };
    await open("New outline beat"); change("Title", "  Exact beat  "); change("Summary", "  exact summary  "); click("Save changes");
    await entered.promise;
    expect(page().getByRole("button", { name: "Please wait…" }).hasAttribute("disabled")).toBe(true);
    testing.act(() => expect(f.navigation.allow()).toBe(false));
    click("Please wait…"); expect(calls).toBe(1); expect(input("Summary").value).toBe("  exact summary  ");
    release.resolve(); await page().findByText(/The save outcome is uncertain/);
    expect(input("Title").value).toBe("  Exact beat  ");
    click("Close editor"); click("Discard draft and close");
    f.api.save = save;
    await open("  Exact beat  ".trim()); expect(input("Summary").value).toBe("  exact summary  ");
    expect((await planningValue(f.api.read(f.book.id))).data?.beats).toHaveLength(1); expect(calls).toBe(1);
  });

  test.each(["corrupt", "future"] as const)("%s planning never becomes an empty writable form", async (scenario) => {
    const f = await setup();
    const path = join(f.root, "books", f.book.id, "planning.json");
    const raw = scenario === "corrupt" ? "{bad" : JSON.stringify({ schemaVersion: 2, bookId: f.book.id });
    await writeFile(path, raw);
    click("Refresh planning"); await page().findByText(/Planning could not be read/);
    expect(page().queryByRole("button", { name: "New timeline event" })).toBeNull();
    expect(await readFile(path, "utf8")).toBe(raw);
  });

  test("unavailable host disables planning entry points", () => {
    testing.render(<PlanningPanel bookId="book_synthetic01" bookTitle="Synthetic unavailable" api={undefined} navigation={new PlanningNavigation()}
      sourceGeneration="1" manuscriptState="clean" />);
    expect(page().getByText("Planning is unavailable on this host.")).toBeTruthy();
    expect(page().getByRole("button", { name: "Story planning" }).hasAttribute("disabled")).toBe(true);
  });

  test("known output overflow retains the baseline and exact draft, then a shortened explicit save succeeds", async () => {
    const f = await setup();
    const base = await planningValue(f.api.read(f.book.id));
    await planningValue(f.api.save({ bookId: base.bookId, source: base.source, baselineJson: base.baselineJson,
      draft: { kind: "create-timeline", fields: { title: "Near limit", when: "literal", description: "", notes: "" } } }));
    const current = required((await f.library.planning.read(f.book.id)).data);
    const path = join(f.root, "books", f.book.id, "planning.json");
    const raw = JSON.stringify({ ...current, futurePayload: "x".repeat(2_499_000) });
    await writeFile(path, raw);
    click("Refresh planning"); await open("Near limit");
    const oversized = "Y".repeat(2_000);
    change("Description", oversized); click("Save changes");
    await page().findByText(/Not saved.*2,500,000/);
    expect(input("Description").value).toBe(oversized);
    expect(await readFile(path, "utf8")).toBe(raw);
    expect((page().getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    change("Description", "Short enough"); click("Save changes"); await saved();
    expect((await f.library.planning.read(f.book.id)).data?.timeline[0]?.description).toBe("Short enough");
    expect((await f.library.planning.read(f.book.id)).data?.futurePayload).toBe("x".repeat(2_499_000));
  });

  test("same-book conflict replay never claims that a different submitted draft was kept", async () => {
    const f = await setup();
    const base = await planningValue(f.api.read(f.book.id));
    const envelope = { bookId: base.bookId, source: base.source, baselineJson: base.baselineJson };
    await planningValue(f.api.save({ ...envelope, draft: { kind: "create-beat", fields: { title: "Winner", summary: "", notes: "" } } }));
    const receipt = await planningValue(f.api.save({ ...envelope, draft: { kind: "create-timeline", fields: { title: "Draft A", when: "", description: "", notes: "" } } }));
    expect(receipt.status).toBe("conflict");
    f.mounted.unmount();
    const replay = createPlanningApi(async () => ({ ok: true, data: receipt }));
    let calls = 0;
    testing.render(<ManualPlanningDialog open bookId={f.book.id} bookTitle="Synthetic replay" viewGeneration={1} editor={{ kind: "timeline" }}
      read={async () => base} save={(request) => { calls++; return planningValue(replay.save(request)); }} onClose={() => {}} />);
    await ready(); change("Title", "Draft B"); click("Save changes");
    await page().findByText(/The save outcome is uncertain/);
    expect(input("Title").value).toBe("Draft B");
    expect(page().queryByText(/Your submitted draft was kept/)).toBeNull();
    expect(page().queryByText(/Submitted draft copy/)).toBeNull();
    click("Save changes"); expect(calls).toBe(1);
  });

  test("duplicate edit/archive/restore labels identify each retained record and move labels follow live order", async () => {
    const f = await setup();
    for (let index = 0; index < 3; index++) {
      for (const kind of ["create-worldbuilding", "create-timeline", "create-beat"] as const) {
        const read = await planningValue(f.api.read(f.book.id));
        const draft = kind === "create-worldbuilding" ? { kind, fields: { name: "Echo", category: "", description: "", notes: `World ${index}` } }
          : kind === "create-timeline" ? { kind, fields: { title: "Echo", when: "same time", description: "", notes: `Event ${index}` } }
          : { kind, fields: { title: "Echo", summary: "", notes: `Beat ${index}` } };
        await planningValue(f.api.save({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson, draft }));
      }
    }
    const initial = required((await f.library.planning.read(f.book.id)).data);
    for (const [kind, id] of [["archive-worldbuilding", required(initial.worldbuilding[2]).id],
      ["archive-timeline", required(initial.timeline[2]).id], ["archive-beat", required(initial.beats[2]).id]] as const) {
      const read = await f.library.planning.read(f.book.id);
      await planningValue(f.api.save({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson, draft: { kind, id, archived: true } }));
    }
    click("Refresh planning");
    for (const [kind, expected] of [["world detail", "World"], ["timeline event", "Event"], ["outline beat", "Beat"]] as const) {
      const suffix = kind === "timeline event" ? " · same time" : "";
      await open(`Echo · ${kind} 2${suffix}`); expect(input("Notes").value).toBe(`${expected} 1`); click("Close editor");
      expect(await page().findByRole("button", { name: `Archive Echo · ${kind} 1${suffix}` })).toBeTruthy();
      await open(`Restore Echo · ${kind} 3${suffix}`); click("Save changes"); await saved(); click("Close editor");
    }
    await open("Order timeline");
    const list = page().getByRole("list", { name: "Draft planning order" });
    const second = required(list.children[1]);
    click("Move Echo · same time · position 2 up");
    expect(list.children[0]).toBe(second);
    expect(testing.within(second as HTMLElement).getByRole("button", { name: "Move Echo · same time · position 1 up" }).hasAttribute("disabled")).toBe(true);
    click("Save changes"); await saved(); click("Close editor");
    await open("Echo · timeline event 1 · same time"); expect(input("Notes").value).toBe("Event 1"); click("Close editor");
    await open("Order beats");
    click("Move Echo · position 2 up"); click("Save changes"); await saved(); click("Close editor");
    await open("Echo · outline beat 1"); expect(input("Notes").value).toBe("Beat 1");
  });
});

describe("manual editor lifetime and exact validation recovery", () => {
  const bookId = "book_synthetic01";
  const absent = (id = bookId): SidecarRead<Planning> => ({ bookId: id, data: null, source: { kind: "absent", revision: 0 }, baselineJson: null });
  test("over-limit literal fields remain editable and dirty close returns focus without submitting", async () => {
    const save = mock(async (_request: PlanningSaveRequest): Promise<SidecarSave<Planning>> => ({ status: "unchanged", current: absent() }));
    const onClose = mock(() => {});
    testing.render(<ManualPlanningDialog open bookId={bookId} bookTitle="Synthetic" viewGeneration={1} editor={{ kind: "timeline" }}
      read={async () => absent()} save={save} onClose={onClose} />);
    await ready(); change("Title", "Valid"); const text = "😀".repeat(101); change("When · literal label", text);
    click("Save changes"); await page().findByText(/Check required titles and field limits/);
    expect(input("When · literal label").value).toBe(text); expect(save).not.toHaveBeenCalled();
    click("Close editor"); click("Keep editing");
    expect(input("When · literal label").value).toBe(text); expect(document.activeElement).toBe(input("Title"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("A → B → A keys ignore late reads and late save notifications", async () => {
    const old = deferred<SidecarRead<Planning>>();
    const late = deferred<SidecarSave<Planning>>();
    const onResult = mock(() => {});
    const props = { open: true, bookId, bookTitle: "Synthetic A", viewGeneration: 1, editor: { kind: "notes" as const },
      read: () => old.promise, save: () => late.promise, onClose: () => {}, onResult };
    const mounted = testing.render(<ManualPlanningDialog {...props} />);
    mounted.rerender(<ManualPlanningDialog {...props} bookId="book_synthetic02" bookTitle="Synthetic B" viewGeneration={2} read={async () => absent("book_synthetic02")} />);
    await ready(); change("Working notes", "B draft");
    await testing.act(async () => { old.resolve(absent()); await old.promise; });
    expect(input("Working notes").value).toBe("B draft");
    click("Save changes");
    mounted.rerender(<ManualPlanningDialog {...props} viewGeneration={3} read={async () => absent()} />);
    await ready(); change("Working notes", "A new lifetime");
    await testing.act(async () => { late.resolve({ status: "unchanged", current: absent("book_synthetic02") }); await late.promise; });
    expect(input("Working notes").value).toBe("A new lifetime"); expect(onResult).not.toHaveBeenCalled();
    expect(page().queryByText("Saved.")).toBeNull();
  });
});
