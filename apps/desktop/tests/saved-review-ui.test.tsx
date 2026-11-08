/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { ReviewRecordApi, ReviewRecordResult, SavedReviewList } from "@ai-book-studio/core/library/review-record-api";
import { toLibraryFilePath } from "@ai-book-studio/core/library/path";
import type { BrowserLibraries } from "../../web/src/runtime/browser-libraries";
import { makeBook, readerRun } from "../../../packages/core/tests/review/record-fixtures";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let SavedReviewsPanel!: typeof import("@ai-book-studio/app/components/saved-review/SavedReviewsPanel").SavedReviewsPanel;
let ReaderReviewResults!: typeof import("@ai-book-studio/app/components/reader-review/ReaderReviewResults").ReaderReviewResults;
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;
let createBrowserStudioApi!: typeof import("../../web/src/runtime/browser-api").createBrowserStudioApi;
beforeAll(async () => {
  testing = await mountDom();
  ({ SavedReviewsPanel } = await import("@ai-book-studio/app/components/saved-review/SavedReviewsPanel"));
  ({ ReaderReviewResults } = await import("@ai-book-studio/app/components/reader-review/ReaderReviewResults"));
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
  ({ createBrowserStudioApi } = await import("../../web/src/runtime/browser-api"));
});
afterEach(() => testing.cleanup());
afterAll(unmountDom);
const page = () => testing.within(document.body);
const click = (name: string) => testing.fireEvent.click(page().getByRole("button", { name }));
function value<T>(result: ReviewRecordResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
function required<T>(item: T | null | undefined): T {
  if (item == null) throw new Error("Missing synthetic fixture value");
  return item;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function fixture() {
  const result = await makeBook();
  const studio = createBrowserStudioApi({ require: () => result.library } as BrowserLibraries);
  const api = required(studio.reviewRecords);
  const scope = value(await api.open(result.book.id, crypto.randomUUID()));
  const run = await readerRun(result.book.id);
  return { ...result, studio, api, scope, run };
}
async function openReview(id: string) {
  click("Saved reviews");
  testing.fireEvent.click(await page().findByRole("button", { name: `Inspect review ${id}` }));
  await page().findByText(/Review opened · Quotations/);
}

describe("saved reviews mounted over the real browser adapter and Library", () => {
  test("explicit result save/repeat/reopen, attribution, local disposition refusal and unchanged manuscript", async () => {
    const { api, scope, run, book, library, port } = await fixture();
    const chapter = await library.createChapter(book.id, { title: "Synthetic manuscript", content: "Keep these synthetic words." });
    const path = toLibraryFilePath(["books", book.id, "chapters", chapter.path]);
    const before = required(await port.readFile(path)).sha256;
    const result = testing.render(<ReaderReviewResults runs={[run]} currentSources={[]} editor={undefined}
      navigationBusy={false} navigationRefusals={new Map()} onNavigate={() => { throw new Error("No navigation"); }} persistence={{ api, scope }} />);
    expect(value(await api.list(scope)).total).toBe(0);
    click("Save review");
    await page().findByText(/Review saved · Historical quotations/);
    click("Save review");
    await page().findByText(/Review already saved · Exact existing report confirmed/);
    result.unmount();
    testing.render(<SavedReviewsPanel bookId={book.id} libraryKey="synthetic-browser" api={api} />);
    await openReview(run.runId);
    expect(page().getByText("Saved reader review · Synthetic provider · synthetic/model")).toBeTruthy();
    expect(page().getByText(/Not currently verified/)).toBeTruthy();
    expect(page().getByText("Selected 😀 exact.")).toBeTruthy();
    const note = page().getByRole("textbox", { name: "Local note for finding-1" }) as HTMLTextAreaElement;
    const disposition = page().getByRole("combobox", { name: "Local disposition for finding-1" }) as HTMLSelectElement;
    testing.fireEvent.change(note, { target: { value: "Exact local note  \n" } });
    testing.fireEvent.change(disposition, { target: { value: "ignored" } });
    click("Save disposition");
    await page().findByText(/Request refused · Checked disposition saving/);
    expect(note.value).toBe("Exact local note  \n");
    expect(disposition.value).toBe("ignored");
    expect(value(await api.readDispositions(scope, run.runId, required(value(await api.list(scope)).reports[0]).hash))).toBeNull();
    click("Saved reviews"); click("Saved reviews");
    expect((page().getByRole("textbox", { name: "Local note for finding-1" }) as HTMLTextAreaElement).value).toBe("Exact local note  \n");
    expect((await port.readFile(path))?.sha256).toBe(before);
  });

  test("real Workspace exposes Saved reviews and inspection through browser storage", async () => {
    const { api, scope, run, book, studio } = await fixture();
    value(await api.save(scope, run));
    Object.assign(window, { studio });
    const errors: unknown[] = [];
    testing.render(<WorkspaceView bookId={book.id} libraryRoot="synthetic-browser" theme={{ choice: "light", set: () => {}, cycle: () => {} }}
      onBack={() => {}} onNotice={(error) => errors.push(error)} onSchemaRefusal={() => {}} />);
    await page().findByRole("button", { name: "Saved reviews" });
    await openReview(run.runId);
    expect(page().getByRole("article", { name: `Saved review ${run.runId}` })).toBeTruthy();
    expect(page().getByText(/Structured reader generation is not connected/)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test("uncertain publication keeps the volatile result and prevents an automatic or repeated save", async () => {
    const { api, scope, run } = await fixture();
    let calls = 0;
    const lost: ReviewRecordApi = { ...api, save: async (...args) => { calls++; await api.save(...args); throw new Error("Synthetic lost receipt"); } };
    testing.render(<ReaderReviewResults runs={[run]} currentSources={[]} editor={undefined}
      navigationBusy={false} navigationRefusals={new Map()} onNavigate={() => {}} persistence={{ api: lost, scope }} />);
    click("Save review");
    await page().findByText(/Save outcome uncertain · Keep this review/);
    expect(page().getByText(required(run.findings[0]).interpretation)).toBeTruthy();
    expect((page().getByRole("button", { name: "Save review" }) as HTMLButtonElement).disabled).toBe(true);
    click("Save review");
    expect(calls).toBe(1);
    expect(value(await api.list(scope)).total).toBe(1);
  });

  test("late save completion cannot relabel a new view, including A → B → A", async () => {
    const { api, scope, run, book } = await fixture();
    const delayed = deferred<Awaited<ReturnType<ReviewRecordApi["save"]>>>();
    const slow = { ...api, save: () => delayed.promise };
    const render = (viewId: string) => <ReaderReviewResults runs={[run]} currentSources={[]} editor={undefined}
      navigationBusy={false} navigationRefusals={new Map()} onNavigate={() => {}} persistence={{ api: slow, scope: { ...scope, viewId } }} />;
    const mounted = testing.render(render(scope.viewId));
    click("Save review");
    mounted.rerender(render(crypto.randomUUID()));
    mounted.rerender(render(scope.viewId));
    await testing.act(async () => delayed.resolve(await api.save(scope, run)));
    expect(page().queryByText(/Review saved ·/)).toBeNull();
    expect(page().getByText(/Volatile review · Save explicitly/)).toBeTruthy();
    expect(value(await api.list(scope)).bookId).toBe(book.id);
  });

  test("late list completion cannot enter a returned book; missing API is explicit", async () => {
    const { api, scope, run, book } = await fixture();
    value(await api.save(scope, run));
    const delayed = deferred<ReviewRecordResult<SavedReviewList>>();
    let calls = 0;
    const slow: ReviewRecordApi = { ...api, list: async (...args) => { calls++; return calls === 1 ? delayed.promise : api.list(...args); } };
    const mounted = testing.render(<SavedReviewsPanel bookId={book.id} libraryKey="synthetic-A" api={slow} />);
    click("Saved reviews");
    await testing.waitFor(() => expect(calls).toBe(1));
    mounted.rerender(<SavedReviewsPanel bookId="book_other001" libraryKey="synthetic-A" api={undefined} />);
    click("Saved reviews");
    expect(page().getByText(/Saved reviews are unavailable on this host/)).toBeTruthy();
    mounted.rerender(<SavedReviewsPanel bookId={book.id} libraryKey="synthetic-A" api={slow} />);
    await testing.act(async () => delayed.resolve(await api.list(scope)));
    expect(page().getByRole("button", { name: "Saved reviews" }).getAttribute("aria-expanded")).toBe("false");
    expect(page().queryByRole("button", { name: `Inspect review ${run.runId}` })).toBeNull();
    await openReview(run.runId);
  });

  test("failed refresh/read retains inspected feedback, saved disposition history and exact local drafts", async () => {
    const { api, scope, run, book, library } = await fixture();
    value(await api.save(scope, run));
    await library.reviewRecords.recordDisposition(book.id, run.runId, { findingId: "finding-1", state: "ignored", note: "Previously saved author note" });
    const mutable = { ...api };
    testing.render(<SavedReviewsPanel bookId={book.id} libraryKey="synthetic" api={mutable} />);
    await openReview(run.runId);
    const note = page().getByRole("textbox", { name: "Local note for finding-1" }) as HTMLTextAreaElement;
    testing.fireEvent.change(note, { target: { value: "Retain draft through failure" } });
    mutable.list = async () => { throw new Error("Synthetic list failure"); };
    click("Refresh saved reviews");
    await page().findByText(/Saved reviews could not be loaded/);
    expect(note.value).toBe("Retain draft through failure");
    mutable.readDispositions = async () => ({ ok: false, error: { code: "corrupt", outcome: "refused", message: "Synthetic corrupt dispositions" } });
    click(`Inspect review ${run.runId}`);
    await page().findByText(/Saved dispositions unavailable · Request refused/);
    expect(page().getByText(/Previously saved author note/)).toBeTruthy();
    expect((page().getByRole("textbox", { name: "Local note for finding-1" }) as HTMLTextAreaElement).value).toBe("Retain draft through failure");
    expect(page().getByText(required(run.findings[0]).interpretation)).toBeTruthy();
    expect((page().getByRole("button", { name: "Move review to trash" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("local filtering and keyboard-labelled inspection controls never write", async () => {
    const { api, scope, run, book, port } = await fixture();
    value(await api.save(scope, run));
    let writes = 0;
    port.commitFile = async () => { writes++; throw new Error("No writes during inspection"); };
    testing.render(<SavedReviewsPanel bookId={book.id} libraryKey="synthetic" api={api} />);
    const opener = page().getByRole("button", { name: "Saved reviews" });
    opener.focus();
    expect(document.activeElement).toBe(opener);
    await openReview(run.runId);
    const filter = page().getByRole("textbox", { name: "Filter this page" });
    testing.fireEvent.change(filter, { target: { value: "no matching report" } });
    expect(page().queryByRole("button", { name: `Inspect review ${run.runId}` })).toBeNull();
    expect(page().getByRole("article", { name: `Saved review ${run.runId}` })).toBeTruthy();
    expect(writes).toBe(0);
  });
});
