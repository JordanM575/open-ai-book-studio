/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { HistoryComparison, HistoryListing, StoredHistoryRecord } from "@ai-book-studio/core/library/history";
import type { ChapterHistoryDialogProps, ChapterHistoryState } from "../../../packages/app/src/components/chapter-history/types";
import { mountDom, unmountDom } from "./support/dom";

let testing: Awaited<ReturnType<typeof mountDom>>;
let ChapterHistoryDialog: typeof import("../../../packages/app/src/components/chapter-history/ChapterHistoryDialog").ChapterHistoryDialog;
beforeAll(async () => {
  testing = await mountDom();
  ({ ChapterHistoryDialog } = await import("../../../packages/app/src/components/chapter-history/ChapterHistoryDialog"));
});
afterEach(() => testing.cleanup());
afterAll(unmountDom);

const target = { libraryId: "synthetic-library", bookId: "book_synthetic", chapterId: "ch_synthetic", viewId: "visit-1" };
const clean = (): ChapterHistoryState => ({ revision: 1, saved: { version: 8, hash: "b".repeat(64) }, dirty: false, pending: false, conflict: false, failed: false });
function record(name = "first", content = "# Saved <img src='https://invalid.test/image'>\n  Literal **text**.\n"): StoredHistoryRecord {
  return {
    fileName: `${name}.md`, hash: "c".repeat(64), content,
    meta: { schemaVersion: 1, id: `hist_${name}000`, kind: "snapshot", bookId: target.bookId, chapterId: target.chapterId,
      label: name, sourceVersion: 2, sourceHash: "a".repeat(64), bodyHash: "d".repeat(64), capturedAt: "2026-11-07T10:00:00.000Z" }
  };
}
function listing(...records: StoredHistoryRecord[]): HistoryListing {
  return { records: records.map(({ content: _content, ...item }) => ({ ...item, size: 912 })), issues: [] };
}
function comparison(snapshot = record(), content = "# Current\n  Literal **text**.\n"): HistoryComparison {
  return { basis: "saved", snapshot, current: { bookId: target.bookId, chapterId: target.chapterId, version: 8, hash: "b".repeat(64), content }, equal: snapshot.content === content };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle(action: () => void) { await testing.act(async () => { action(); }); }

function setup(overrides: Partial<ChapterHistoryDialogProps> = {}) {
  const api = {
    list: mock(async () => listing(record(), record("second"))),
    read: mock(async (_target, input) => record(input.fileName.replace(".md", ""))),
    compare: mock(async () => comparison()),
    capture: mock(async (_target, input) => ({ ...record("kept"), meta: { ...record("kept").meta, label: input.label.trim(), sourceVersion: input.source.version, sourceHash: input.source.hash } }))
  } satisfies ChapterHistoryDialogProps["api"];
  let props: ChapterHistoryDialogProps = { open: true, target: { ...target }, chapterTitle: "Synthetic chapter", state: clean(), api, onClose: mock(() => {}), ...overrides };
  const rendered = testing.render(<ChapterHistoryDialog {...props} />);
  const view = testing.within(document.body);
  return {
    api, view, rendered,
    update(next: Partial<ChapterHistoryDialogProps>) { props = { ...props, ...next }; rendered.rerender(<ChapterHistoryDialog {...props} />); },
    loaded: async () => { await testing.waitFor(() => expect(view.getAllByRole("button", { name: "Open record" }).length).toBeGreaterThan(0)); },
    label(value: string) { testing.fireEvent.change(view.getByLabelText("Snapshot label"), { target: { value } }); },
    click(name: string, index = 0) { testing.fireEvent.click(required(view.getAllByRole("button", { name })[index])); }
  };
}

describe("isolated saved chapter history UI", () => {
  test("lists stat sizes, provenance and each unavailable record alongside good records", async () => {
    const data = listing(record());
    data.issues = [
      { fileName: "future.md", code: "newer-schema", message: "A newer app is required." },
      { fileName: "broken.md", code: "corrupt", message: "Body integrity failed." }
    ];
    const host = setup({ api: { ...setupApi(), list: async () => data } });
    await host.loaded();
    expect(host.view.getByText(/912 bytes · snapshot/)).toBeDefined();
    expect(host.view.getByText(/future.md · Unavailable/)).toBeDefined();
    expect(host.view.getByText(/broken.md · Unavailable/)).toBeDefined();
    expect(host.view.getByText("A newer app is required.")).toBeDefined();
    expect(host.view.queryByText("No saved history yet.")).toBeNull();
    expect(host.view.queryByRole("button", { name: /restore|undo|delete/i })).toBeNull();
  });

  test("opens full literal text, selects the record and focuses the result without writing", async () => {
    const host = setup();
    await host.loaded();
    host.click("Open record");
    await testing.waitFor(() => expect(host.view.getByLabelText("Snapshot body").textContent).toBe(record().content));
    expect(document.querySelector("img")).toBeNull();
    expect(host.view.getAllByRole("button", { name: "Open record" })[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Read-only history · first");
    expect(host.api.capture).not.toHaveBeenCalled();
    expect(host.api.read).toHaveBeenCalledWith(target, { bookId: target.bookId, chapterId: target.chapterId, fileName: "first.md" });
  });

  test("dirty browsing and comparison exclude the draft, make no save/flush calls and keep text faithful", async () => {
    const previous = Object.getOwnPropertyDescriptor(window, "studio");
    const globalAccess = mock(() => { throw new Error("History must not access global save/draft APIs."); });
    Object.defineProperty(window, "studio", { configurable: true, get: globalAccess });
    try {
      const state = { ...clean(), dirty: true };
      const host = setup({ state });
      await host.loaded();
      host.label("Draft is not a source");
      expect((host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement).disabled).toBe(true);
      host.click("Open record");
      await testing.waitFor(() => expect(host.view.getByLabelText("Snapshot body")).toBeDefined());
      host.click("Compare saved text");
      await testing.waitFor(() => expect(host.view.getByLabelText("Current saved body").textContent).toBe(comparison().current.content));
      expect(host.view.getByLabelText("Snapshot body").textContent).toBe(record().content);
      expect(host.view.getByText("Your unsaved editor draft is excluded from history and comparisons.")).toBeDefined();
      expect(host.view.getByText(/first through last difference/)).toBeDefined();
      expect(host.view.getByText(/Raw file hash: b{64}/)).toBeDefined();
      expect(host.api.capture).not.toHaveBeenCalled();
      expect(globalAccess).not.toHaveBeenCalled();
      expect(state).toEqual({ ...clean(), dirty: true });
    } finally {
      if (previous) Object.defineProperty(window, "studio", previous);
      else Reflect.deleteProperty(window, "studio");
    }
  });

  for (const flag of ["dirty", "pending", "conflict", "failed"] as const) {
    test(`capture refuses ${flag} state even on direct form submit`, async () => {
      const host = setup({ state: { ...clean(), [flag]: true } });
      await host.loaded();
      host.label("Keep saved text");
      testing.fireEvent.submit(required(host.view.getByLabelText("Snapshot label").closest("form")));
      expect(host.api.capture).not.toHaveBeenCalled();
    });
  }

  test("missing saved source allows open but disables capture and compare", async () => {
    const host = setup({ state: { ...clean(), saved: null } });
    await host.loaded();
    host.label("Named");
    expect((host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect((host.view.getAllByRole("button", { name: "Compare saved text" })[0] as HTMLButtonElement).disabled).toBe(true);
    host.click("Open record");
    await testing.waitFor(() => expect(host.view.getByLabelText("Snapshot body")).toBeDefined());
  });

  test("validates Unicode code points and controls without truncation; sends only exact saved token", async () => {
    const host = setup();
    await host.loaded();
    for (const invalid of ["   ", "bad\nlabel", "bad\tlabel", "bad\u0085label", "bad\u2028label", "😀".repeat(201)]) {
      host.label(invalid);
      expect((host.view.getByLabelText("Snapshot label") as HTMLTextAreaElement).value).toBe(invalid);
      testing.fireEvent.submit(required(host.view.getByLabelText("Snapshot label").closest("form")));
      expect(host.api.capture).not.toHaveBeenCalled();
    }
    const valid = "😀".repeat(200);
    host.label(valid);
    host.click("Keep snapshot");
    await testing.waitFor(() => expect(host.view.getByText(/kept from saved version 8/)).toBeDefined());
    expect(host.api.capture).toHaveBeenCalledTimes(1);
    expect(host.api.capture).toHaveBeenCalledWith(target, { bookId: target.bookId, chapterId: target.chapterId, label: valid, source: { status: "saved", version: 8, hash: "b".repeat(64) } });
  });

  test("repeated submit dispatches once and a source change cannot relabel a kept capture cancelled", async () => {
    const pending = deferred<StoredHistoryRecord>();
    const capture = mock<ChapterHistoryDialogProps["api"]["capture"]>(() => pending.promise);
    const host = setup({ api: { ...setupApi(), capture } });
    await host.loaded();
    host.label("Milestone");
    const form = required(host.view.getByLabelText("Snapshot label").closest("form"));
    testing.fireEvent.submit(form);
    testing.fireEvent.submit(form);
    expect(capture).toHaveBeenCalledTimes(1);
    host.update({ state: { ...clean(), saved: { version: 9, hash: "e".repeat(64) }, dirty: true } });
    expect(host.view.getByText(/Capture request source · version 8 · raw file hash b{64}/)).toBeDefined();
    expect(host.view.getByText(/Current saved source · version 9 · raw file hash e{64}/)).toBeDefined();
    const kept = record("Milestone");
    kept.meta.sourceVersion = 8;
    kept.meta.sourceHash = "b".repeat(64);
    await settle(() => pending.resolve(kept));
    expect(host.view.getByText(/kept from saved version 8.*earlier saved source/)).toBeDefined();
    expect(host.view.queryByText(/cancelled|canceled/i)).toBeNull();
    expect(capture.mock.calls[0]?.[1].source).toEqual({ status: "saved", version: 8, hash: "b".repeat(64) });
  });

  test("capture failure retains the label and blocks retry until explicit successful history review", async () => {
    const capture = mock(async () => { throw new Error("Storage is full; publication could not be confirmed."); });
    const list = mock(async () => listing(record()));
    const host = setup({ api: { ...setupApi(), capture, list } });
    await host.loaded();
    host.label("Recovery point");
    host.click("Keep snapshot");
    await testing.waitFor(() => expect(host.view.getByText(/Capture could not be confirmed/)).toBeDefined());
    expect((host.view.getByLabelText("Snapshot label") as HTMLTextAreaElement).value).toBe("Recovery point");
    expect((host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    list.mockImplementationOnce(async () => { throw new Error("Read permission denied."); });
    host.click("Refresh history");
    await testing.waitFor(() => expect(host.view.getByText(/Read permission denied/)).toBeDefined());
    expect((host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    host.click("Refresh history");
    await testing.waitFor(() => expect((host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement).disabled).toBe(false));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test.each(["success", "failure"] as const)("pre-capture refresh %s cannot unlock an uncertain capture", async (outcome) => {
    const oldList = deferred<HistoryListing>();
    const pendingCapture = deferred<StoredHistoryRecord>();
    const capture = mock<ChapterHistoryDialogProps["api"]["capture"]>(() => pendingCapture.promise);
    const list = mock<ChapterHistoryDialogProps["api"]["list"]>()
      .mockImplementationOnce(async () => listing(record()))
      .mockImplementationOnce(() => oldList.promise)
      .mockImplementationOnce(async () => { throw new Error("New review failed"); })
      .mockImplementation(async () => listing(record(), record("possibly-kept")));
    const host = setup({ api: { ...setupApi(), capture, list } });
    await host.loaded();
    host.label("Uncertain snapshot");
    host.click("Refresh history");
    host.click("Keep snapshot");
    expect(list).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
    await settle(() => pendingCapture.reject(new Error("Lost capture acknowledgment")));
    const button = () => host.view.getByRole("button", { name: "Keep snapshot" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    await settle(() => {
      if (outcome === "success") oldList.resolve(listing(record()));
      else oldList.reject(new Error("Older review failed"));
    });
    expect(button().disabled).toBe(true);
    expect(host.view.getByText(/Lost capture acknowledgment/)).toBeDefined();
    const label = host.view.getByLabelText("Snapshot label") as HTMLTextAreaElement;
    expect(label.value).toBe("Uncertain snapshot");
    testing.fireEvent.submit(required(label.closest("form")));
    expect(capture).toHaveBeenCalledTimes(1);
    host.click("Refresh history");
    await testing.waitFor(() => expect(host.view.getByText(/New review failed/)).toBeDefined());
    expect(button().disabled).toBe(true);
    host.click("Refresh history");
    await testing.waitFor(() => expect(button().disabled).toBe(false));
    expect(host.view.getByText("possibly-kept")).toBeDefined();
    expect(list).toHaveBeenCalledTimes(4);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])("same-batch close is idempotent with a pending capture (callback throws %s)", async (throws) => {
    const pending = deferred<StoredHistoryRecord>();
    const api = { ...setupApi(), capture: mock<ChapterHistoryDialogProps["api"]["capture"]>(() => pending.promise) };
    const onClose = mock(() => { if (throws) throw new Error("Synthetic close notification failure"); });
    const host = setup({ api, onClose });
    await host.loaded();
    host.label("Closing snapshot");
    host.click("Keep snapshot");
    const close = host.view.getByRole("button", { name: "Close" });
    testing.act(() => { testing.fireEvent.click(close); testing.fireEvent.click(close); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.view.queryByRole("dialog")).toBeNull();
    const kept = record("Closing snapshot");
    kept.meta.sourceVersion = 8;
    kept.meta.sourceHash = "b".repeat(64);
    await settle(() => pending.resolve(kept));
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.capture).toHaveBeenCalledTimes(1);
    host.update({ open: false });
    host.update({ open: true });
    await host.loaded();
    expect(host.view.queryByText(/kept from saved version/)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("list failure is distinct from an empty history and is explicitly retryable", async () => {
    const list = mock<ChapterHistoryDialogProps["api"]["list"]>(async () => { throw new Error("Cannot read history."); });
    const host = setup({ api: { ...setupApi(), list } });
    await testing.waitFor(() => expect(host.view.getByText(/History could not be refreshed/)).toBeDefined());
    expect(host.view.queryByText("No saved history yet.")).toBeNull();
    list.mockImplementationOnce(async () => ({ records: [], issues: [] }));
    host.click("Refresh history");
    await testing.waitFor(() => expect(host.view.getByText("No saved history yet.")).toBeDefined());
  });

  for (const mode of ["read", "compare"] as const) {
    test(`${mode} failure clears old bodies and allows explicit retry`, async () => {
      const api = setupApi();
      api[mode] = mock(async () => { throw new Error("Selected record is unavailable. Refresh history."); });
      const host = setup({ api });
      await host.loaded();
      host.click(mode === "read" ? "Open record" : "Compare saved text");
      await testing.waitFor(() => expect(host.view.getByText(/Selected record is unavailable/)).toBeDefined());
      expect(host.view.queryByLabelText("Snapshot body")).toBeNull();
    });

    test(`late ${mode} errors cannot replace a newer selection`, async () => {
      const old = deferred<never>();
      const api = setupApi();
      if (mode === "read") api.read = mock().mockImplementationOnce(() => old.promise).mockImplementation(async () => record("second"));
      else api.compare = mock().mockImplementationOnce(() => old.promise).mockImplementation(async () => comparison(record("second")));
      const host = setup({ api });
      await host.loaded();
      const action = mode === "read" ? "Open record" : "Compare saved text";
      host.click(action, 0);
      host.click(action, 1);
      await testing.waitFor(() => expect(host.view.getByRole("heading", { name: /· second/ })).toBeDefined());
      await settle(() => old.reject(new Error("Obsolete failure")));
      expect(host.view.queryByText(/Obsolete failure/)).toBeNull();
      expect(host.view.getByLabelText("Snapshot body").textContent).toBe(record("second").content);
    });
  }

  test("compare source ABA invalidates delayed success and loaded comparisons", async () => {
    const delayed = deferred<HistoryComparison>();
    const compare = mock().mockImplementationOnce(() => delayed.promise).mockImplementation(async () => comparison());
    const host = setup({ api: { ...setupApi(), compare } });
    await host.loaded();
    host.click("Compare saved text");
    host.update({ state: { ...clean(), dirty: true } });
    host.update({ state: clean() });
    await settle(() => delayed.resolve(comparison()));
    expect(host.view.queryByLabelText("Current saved body")).toBeNull();
    expect(host.view.getByText(/editor save state changed/)).toBeDefined();
    host.click("Compare saved text");
    await testing.waitFor(() => expect(host.view.getByLabelText("Current saved body")).toBeDefined());
    host.update({ state: { ...clean(), saved: { version: 9, hash: "e".repeat(64) } } });
    expect(host.view.queryByLabelText("Current saved body")).toBeNull();
  });

  test("the host source generation catches batched ABA with identical final values", async () => {
    const delayed = deferred<HistoryComparison>();
    const host = setup({ api: { ...setupApi(), compare: () => delayed.promise } });
    await host.loaded();
    host.click("Compare saved text");
    // The host observed two transitions, but React committed only the final state.
    host.update({ state: { ...clean(), revision: 3 } });
    await settle(() => delayed.resolve(comparison()));
    expect(host.view.queryByLabelText("Current saved body")).toBeNull();
    expect(host.view.getByText(/editor save state changed/)).toBeDefined();
  });

  test("refuses comparison returned for a different saved hash", async () => {
    const result = comparison();
    result.current.hash = "e".repeat(64);
    const host = setup({ api: { ...setupApi(), compare: async () => result } });
    await host.loaded();
    host.click("Compare saved text");
    await testing.waitFor(() => expect(host.view.getByText(/saved source changed or could not be confirmed/)).toBeDefined());
    expect(host.view.queryByLabelText("Current saved body")).toBeNull();
  });

  test("a mismatched history identity or changed raw record hash is never displayed", async () => {
    const wrong = record("foreign", "Foreign body must not appear");
    wrong.meta.bookId = "book_foreign";
    const changed = record();
    changed.hash = "f".repeat(64);
    const host = setup({ api: { ...setupApi(), list: async () => listing(record(), wrong), read: async () => changed } });
    await host.loaded();
    expect(host.view.getByText(/foreign.md · Unavailable \(identity\)/)).toBeDefined();
    expect(host.view.getAllByRole("button", { name: "Open record" })).toHaveLength(1);
    host.click("Open record");
    await testing.waitFor(() => expect(host.view.getByText(/selected history record changed/)).toBeDefined());
    expect(host.view.queryByLabelText("Snapshot body")).toBeNull();
    expect(host.view.queryByText("Foreign body must not appear")).toBeNull();
  });

  test("list replies superseded by a confirmed capture cannot hide the new snapshot", async () => {
    const old = deferred<HistoryListing>();
    const api = setupApi();
    api.list = mock().mockImplementationOnce(() => old.promise).mockImplementation(async () => listing(record("kept")));
    const host = setup({ api });
    host.label("Kept now");
    host.click("Keep snapshot");
    await host.loaded();
    await settle(() => old.resolve(listing(record("old-list"))));
    expect(host.view.getByText("kept")).toBeDefined();
    expect(host.view.queryByText("old-list")).toBeNull();
    expect(host.view.getByText(/kept from saved version 8/)).toBeDefined();
  });

  test("list rejection after closing does not replace a reopened session", async () => {
    const old = deferred<HistoryListing>();
    const api = setupApi();
    api.list = mock().mockImplementationOnce(() => old.promise).mockImplementation(async () => listing(record()));
    const host = setup({ api });
    host.update({ open: false });
    host.update({ open: true });
    await host.loaded();
    await settle(() => old.reject(new Error("Old list error")));
    expect(host.view.queryByText(/Old list error/)).toBeNull();
    expect(host.view.getByText("first")).toBeDefined();
  });

  for (const mode of ["read", "compare"] as const) {
    test(`late ${mode} success cannot cross a close/reopen or replace a newer selected body`, async () => {
      const oldRead = deferred<StoredHistoryRecord>();
      const oldCompare = deferred<HistoryComparison>();
      const api = setupApi();
      if (mode === "read") api.read = mock().mockImplementationOnce(() => oldRead.promise).mockImplementation(async () => record("second"));
      else api.compare = mock().mockImplementationOnce(() => oldCompare.promise).mockImplementation(async () => comparison(record("second")));
      const host = setup({ api });
      await host.loaded();
      const action = mode === "read" ? "Open record" : "Compare saved text";
      host.click(action);
      host.update({ open: false });
      host.update({ open: true });
      await host.loaded();
      host.click(action, 1);
      await testing.waitFor(() => expect(host.view.getByLabelText("Snapshot body")).toBeDefined());
      await settle(() => {
        if (mode === "read") oldRead.resolve(record("first", "Obsolete read body"));
        else oldCompare.resolve(comparison(record("first", "Obsolete compared body")));
      });
      expect(host.view.getByLabelText("Snapshot body").textContent).toBe(record("second").content);
      expect(host.view.queryByText(/Obsolete/)).toBeNull();
    });
  }

  test("delayed compare failure is stale after a source change, and a pending capture error keeps its original source", async () => {
    const oldCompare = deferred<HistoryComparison>();
    const oldCapture = deferred<StoredHistoryRecord>();
    const api = { ...setupApi(), compare: () => oldCompare.promise, capture: () => oldCapture.promise };
    const host = setup({ api });
    await host.loaded();
    host.label("Old source");
    host.click("Keep snapshot");
    host.click("Compare saved text");
    host.update({ state: { ...clean(), saved: { version: 9, hash: "e".repeat(64) } } });
    await settle(() => {
      oldCompare.reject(new Error("Obsolete compare error"));
      oldCapture.reject(new Error("Capture outcome unknown"));
    });
    expect(host.view.queryByText(/Obsolete compare error/)).toBeNull();
    expect(host.view.getByText(/Capture outcome unknown/)).toBeDefined();
    expect(host.view.getByText(/Capture request source · version 8/)).toBeDefined();
    expect(host.view.getByText(/Current saved source · version 9/)).toBeDefined();
  });

  for (const content of ["", "😀 Same\n", "😀 New\n"]) {
    test(`comparison preserves literal empty/Unicode bodies: ${JSON.stringify(content)}`, async () => {
      const snapshot = record("first", "😀 Same\n");
      const host = setup({ api: { ...setupApi(), list: async () => listing(snapshot), compare: async () => comparison(snapshot, content) } });
      await host.loaded();
      host.click("Compare saved text");
      await testing.waitFor(() => expect(host.view.getByLabelText("Current saved body").textContent).toBe(content));
      expect(host.view.getByLabelText("Snapshot body").textContent).toBe(snapshot.content);
      if (content === snapshot.content) expect(host.view.getByText("The saved bodies are identical.")).toBeDefined();
    });
  }

  for (const field of ["libraryId", "bookId", "chapterId", "viewId"] as const) {
    test(`${field} navigation ABA discards old list success and capture errors`, async () => {
      const oldList = deferred<HistoryListing>();
      const oldCapture = deferred<StoredHistoryRecord>();
      const api = setupApi();
      api.list = mock().mockImplementationOnce(() => oldList.promise).mockImplementation(async () => listing(record("second")));
      api.capture = mock(() => oldCapture.promise);
      const host = setup({ api });
      host.label("Old capture");
      host.click("Keep snapshot");
      host.update({ target: { ...target, [field]: `${target[field]}-other` } });
      host.update({ target: { ...target } });
      await host.loaded();
      await settle(() => { oldList.resolve(listing(record("obsolete"))); oldCapture.reject(new Error("Old capture failure")); });
      expect(host.view.queryByText("obsolete")).toBeNull();
      expect(host.view.queryByText(/Old capture failure/)).toBeNull();
      expect(host.view.getByText("second")).toBeDefined();
      expect((host.view.getByLabelText("Snapshot label") as HTMLTextAreaElement).value).toBe("");
    });
  }

  test("close invalidates a pending capture immediately, even before the parent updates open", async () => {
    const pending = deferred<StoredHistoryRecord>();
    const api = setupApi();
    api.capture = mock(() => pending.promise);
    const onClose = mock(() => {});
    const host = setup({ api, onClose });
    await host.loaded();
    host.label("Closing capture");
    host.click("Keep snapshot");
    host.click("Close");
    const kept = record("Closing capture");
    kept.meta.sourceVersion = 8;
    kept.meta.sourceHash = "b".repeat(64);
    await settle(() => pending.resolve(kept));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(host.view.queryByRole("dialog")).toBeNull();
    host.update({ open: false });
    host.update({ open: true });
    await host.loaded();
    expect(host.view.queryByText(/kept from saved version/)).toBeNull();
  });

  test("unmount consumes delayed read rejection without dispatching another operation", async () => {
    const pending = deferred<StoredHistoryRecord>();
    const api = setupApi();
    api.read = mock(() => pending.promise);
    const host = setup({ api });
    await host.loaded();
    host.click("Open record");
    host.rendered.unmount();
    await settle(() => pending.reject(new Error("Late unmounted read")));
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(host.view.queryByRole("dialog")).toBeNull();
  });

  test("intent remains visible as status without a compare or restoration action", async () => {
    const intent = record("intent", "");
    intent.meta = { ...intent.meta, kind: "intent", state: "prepared", selected: { fileName: "chosen.md", id: "hist_chosen0", hash: "a".repeat(64) }, safety: { fileName: "safety.md", id: "hist_safety0", hash: "b".repeat(64) }, intendedBodyHash: "d".repeat(64) };
    const host = setup({ api: { ...setupApi(), list: async () => listing(intent), read: async () => intent } });
    await host.loaded();
    host.click("Open record");
    await testing.waitFor(() => expect(host.view.getByText(/Restore intent · prepared/)).toBeDefined());
    expect(host.view.queryByRole("button", { name: "Compare saved text" })).toBeNull();
    expect(host.view.queryByLabelText("Snapshot body")).toBeNull();
  });

  test("Escape returns keyboard focus to the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Show history";
    document.body.append(opener);
    opener.focus();
    const host = setup();
    await host.loaded();
    const label = host.view.getByLabelText("Snapshot label");
    label.focus();
    testing.fireEvent.keyDown(label, { key: "Escape", code: "Escape" });
    await testing.waitFor(() => expect(host.view.queryByRole("dialog")).toBeNull());
    await testing.waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});

function setupApi(): ChapterHistoryDialogProps["api"] {
  return {
    list: mock(async () => listing(record(), record("second"))),
    read: mock(async (_target, input) => record(input.fileName.replace(".md", ""))),
    compare: mock(async (_target, input) => comparison(record(input.fileName.replace(".md", "")))),
    capture: mock(async (_target, input) => ({ ...record("kept"), meta: { ...record("kept").meta, label: input.label.trim(), sourceVersion: input.source.version, sourceHash: input.source.hash } }))
  };
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected synthetic test element.");
  return value;
}
