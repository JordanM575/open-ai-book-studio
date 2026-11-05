/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema } from "@ai-book-studio/core/schema";
import type { Chapter } from "@ai-book-studio/core/schema";
import { ambientStatus } from "@ai-book-studio/core/agent/ambient";

let testing!: typeof import("@testing-library/react/pure");
let WorkspaceView!: typeof import("@ai-book-studio/app/views/WorkspaceView").WorkspaceView;

beforeAll(async () => {
  testing = await mountDom();
  ({ WorkspaceView } = await import("@ai-book-studio/app/views/WorkspaceView"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * Spec 035 with D-108: the Format dialog exports the chosen target. It saves the open chapter
 * first and never exports over a failed save, uses each target's own channel, names the saved
 * file the way the header does, and says plainly why an export did not happen. The browser build
 * explains that exporting is a desktop feature. Synthetic content only.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_fx000002";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `000${order}-x.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: "a".repeat(64)
  };
}

const CHAPTER = chapter("ch_fx000010", "First", 1, "First line.\n");

type Answer = { ok: true; data: string | null } | { ok: false; error: { code: string; message: string } };

interface Setup {
  platform?: string;
  save?: () => Promise<unknown>;
  answers?: Partial<Record<"exportDocx" | "exportMarkdown" | "exportPdf" | "exportEpub", () => Promise<Answer>>>;
}

function mockWorkspace(setup: Setup = {}) {
  const order: string[] = [];
  const detail = () => ({
    book: bookSchema.parse({ id: BOOK, title: "Exported", createdAt: NOW, updatedAt: NOW }),
    chapters: [CHAPTER],
    chapterReadIssues: []
  });
  const exporter = (name: "exportDocx" | "exportMarkdown" | "exportPdf" | "exportEpub", file: string) =>
    mock((_bookId: string) => {
      order.push(name);
      return setup.answers?.[name]?.() ?? Promise.resolve<Answer>({ ok: true, data: `/tmp/exports/${file}` });
    });
  const exports = {
    exportDocx: exporter("exportDocx", "exported.docx"),
    exportMarkdown: exporter("exportMarkdown", "exported.md"),
    exportPdf: exporter("exportPdf", "exported.pdf"),
    exportEpub: exporter("exportEpub", "exported.epub")
  };
  const save = mock((_input: unknown) => {
    order.push("save");
    return setup.save?.() ?? Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTER } });
  });
  const onNotice = mock((_error: unknown) => {});
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: setup.platform ?? "darwin",
    books: {
      open: mock(() => Promise.resolve({ ok: true, data: detail() })),
      update: mock(() => Promise.resolve({ ok: true, data: detail().book })),
      ...exports
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTER })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: [CHAPTER] } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
    drafts: { set: mock(() => Promise.resolve({ ok: true, data: null })), clear: mock(() => Promise.resolve({ ok: true, data: null })), onFlushRequest: mock(() => () => {}) },
    recovery: { list: mock(() => Promise.resolve({ ok: true, data: [] })) },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: {
      onEvent: mock(() => () => {}),
      ambient: mock(() =>
        Promise.resolve({
          ok: true,
          data: ambientStatus({
            book: { id: BOOK, title: "Exported", stage: "drafting" },
            chapters: [{ id: CHAPTER.id, title: "First", order: 1, wordCount: 2 }]
          })
        })
      )
    },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({ ok: true, data: { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] } }))
    }
  };
  testing.render(
    React.createElement(WorkspaceView, {
      bookId: BOOK,
      theme: { choice: "light" as const, set: () => {}, cycle: () => {} },
      libraryRoot: "/tmp/studio-library",
      libraryStorage: undefined,
      onBack: () => {},
      onNotice,
      onSchemaRefusal: () => {}
    })
  );
  return { order, save, onNotice, ...exports };
}

async function openFormat() {
  const view = testing.within(document.body);
  await testing.waitFor(() => {
    expect(view.getByTestId("manuscript-text")).toBeTruthy();
  });
  testing.fireEvent.click(view.getByTestId("format-book"));
  await testing.waitFor(() => {
    expect(view.getByTestId("format-preview")).toBeTruthy();
  });
  return view;
}

function choose(view: ReturnType<typeof testing.within>, target: string): void {
  testing.fireEvent.click(view.getByRole("radio", { name: target }));
}

describe("format dialog export", () => {
  test("PDF saves the open chapter first, then exports and names the saved file", async () => {
    const mocks = mockWorkspace();
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });
    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "First line, edited.\n" } });
    testing.fireEvent.click(view.getByTestId("format-book"));
    await testing.waitFor(() => {
      expect(view.getByTestId("format-preview")).toBeTruthy();
    });

    choose(view, "PDF");
    expect(view.getByTestId("format-export").textContent).toBe("Export PDF");
    expect(view.getByTestId("format-target-note").textContent).toContain("each chapter on a new page");
    testing.fireEvent.click(view.getByTestId("format-export"));

    await testing.waitFor(() => {
      expect(view.getByTestId("format-export-note").textContent).toBe("Saved exported.pdf");
    });
    // The note reads like the header's; the full destination is on the note itself.
    expect(view.getByTestId("format-export-note").getAttribute("title")).toBe("/tmp/exports/exported.pdf");
    expect(mocks.exportPdf).toHaveBeenCalledTimes(1);
    expect(mocks.exportPdf.mock.calls[0]?.[0]).toBe(BOOK);
    expect(mocks.order.indexOf("save")).toBeGreaterThan(-1);
    expect(mocks.order.indexOf("save")).toBeLessThan(mocks.order.indexOf("exportPdf"));
    expect(mocks.exportDocx).not.toHaveBeenCalled();
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("each target exports through its own channel", async () => {
    const mocks = mockWorkspace();
    const view = await openFormat();
    const cases = [
      { target: "EPUB", label: "Export EPUB", note: "Saved exported.epub", call: mocks.exportEpub },
      { target: "DOCX", label: "Export Word document", note: "Saved exported.docx", call: mocks.exportDocx },
      { target: "Markdown", label: "Export Markdown", note: "Saved exported.md", call: mocks.exportMarkdown }
    ];
    for (const { target, label, note, call } of cases) {
      choose(view, target);
      expect(view.getByTestId("format-export").textContent).toBe(label);
      testing.fireEvent.click(view.getByTestId("format-export"));
      await testing.waitFor(() => {
        expect(view.getByTestId("format-export-note").textContent).toBe(note);
      });
      expect(call).toHaveBeenCalledTimes(1);
    }
    expect(mocks.exportPdf).not.toHaveBeenCalled();
  });

  test("a cancelled picker says nothing and the action is ready again", async () => {
    const mocks = mockWorkspace({ answers: { exportEpub: () => Promise.resolve({ ok: true, data: null }) } });
    const view = await openFormat();
    choose(view, "EPUB");
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => {
      expect(mocks.exportEpub).toHaveBeenCalledTimes(1);
      expect((view.getByTestId("format-export") as HTMLButtonElement).disabled).toBe(false);
    });
    expect(view.getByTestId("format-export-note").textContent).toBe("");
    expect(view.queryByTestId("format-export-error")).toBeNull();
  });

  test("a refused export says why in the dialog and claims nothing was saved", async () => {
    const refusal =
      "That location is inside the open library. Choose another folder so the export cannot overwrite the book's own files.";
    const mocks = mockWorkspace({
      answers: { exportPdf: () => Promise.resolve({ ok: false, error: { code: "invalid", message: refusal } }) }
    });
    const view = await openFormat();
    choose(view, "PDF");
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => {
      expect(view.getByTestId("format-export-error").textContent).toBe(refusal);
    });
    expect(view.getByTestId("format-export-error").getAttribute("role")).toBe("alert");
    expect(view.getByTestId("format-export-note").textContent).toBe("");
    expect(mocks.onNotice).not.toHaveBeenCalled();
  });

  test("a chapter that cannot be saved stops the export before it starts", async () => {
    const mocks = mockWorkspace({
      save: () => Promise.resolve({ ok: false, error: { code: "io", message: "The disk is full." } })
    });
    const view = testing.within(document.body);
    await testing.waitFor(() => {
      expect(view.getByTestId("manuscript-text")).toBeTruthy();
    });
    testing.fireEvent.change(view.getByTestId("manuscript-text"), { target: { value: "Unsaved words.\n" } });
    testing.fireEvent.click(view.getByTestId("format-book"));
    await testing.waitFor(() => {
      expect(view.getByTestId("format-preview")).toBeTruthy();
    });
    choose(view, "PDF");
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => {
      // The same words the workspace header export uses for the same failed save.
      expect(view.getByTestId("format-export-error").textContent).toBe(
        "Your latest change couldn't be saved, so nothing was exported. The disk is full."
      );
    });
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.exportPdf).not.toHaveBeenCalled();
  });

  test("the dialog stays open until a running export finishes", async () => {
    let finish!: (answer: Answer) => void;
    const mocks = mockWorkspace({
      answers: { exportPdf: () => new Promise<Answer>((resolve) => (finish = resolve)) }
    });
    const view = await openFormat();
    choose(view, "PDF");
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => {
      expect(mocks.exportPdf).toHaveBeenCalledTimes(1);
    });
    expect(view.getByTestId("format-export").textContent).toBe("Exporting…");
    expect((view.getByTestId("format-export") as HTMLButtonElement).disabled).toBe(true);
    testing.fireEvent.keyDown(document, { key: "Escape" });
    expect(view.getByTestId("format-preview")).toBeTruthy();

    finish({ ok: true, data: "/tmp/exports/exported.pdf" });
    await testing.waitFor(() => {
      expect(view.getByTestId("format-export-note").textContent).toBe("Saved exported.pdf");
    });
    testing.fireEvent.keyDown(document, { key: "Escape" });
    await testing.waitFor(() => {
      expect(view.queryByTestId("format-preview")).toBeNull();
    });
  });

  test("reopening the dialog starts again at DOCX with no old note", async () => {
    mockWorkspace();
    const view = await openFormat();
    choose(view, "EPUB");
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => {
      expect(view.getByTestId("format-export-note").textContent).toBe("Saved exported.epub");
    });
    testing.fireEvent.keyDown(document, { key: "Escape" });
    await testing.waitFor(() => {
      expect(view.queryByTestId("format-preview")).toBeNull();
    });
    testing.fireEvent.click(view.getByTestId("format-book"));
    await testing.waitFor(() => {
      expect(view.getByTestId("format-preview")).toBeTruthy();
    });
    expect((view.getByRole("radio", { name: "DOCX" }) as HTMLInputElement).checked).toBe(true);
    expect(view.getByTestId("format-export").textContent).toBe("Export Word document");
    expect(view.getByTestId("format-export-note").textContent).toBe("");
  });

  test("the browser build explains that exporting is a desktop feature", async () => {
    const mocks = mockWorkspace({ platform: "web" });
    const view = await openFormat();
    const action = view.getByTestId("format-export") as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(view.getByTestId("format-export-note").textContent).toBe("Exporting is available in the desktop app.");
    testing.fireEvent.click(action);
    expect(mocks.exportDocx).not.toHaveBeenCalled();
  });
});
