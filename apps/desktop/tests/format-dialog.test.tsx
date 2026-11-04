/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema, manuscriptSettingsSchema } from "@ai-book-studio/core/schema";
import type { Chapter, ManuscriptSettings } from "@ai-book-studio/core/schema";
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
 * Spec 035 T003: Format journey contract tests with synthetic content. The
 * dialog binds the saved `settings.manuscript` values (no duplicate profile),
 * the Approximate disclosure is always visible, every target with a renderer
 * (all four since D-108) can be chosen, and opening the dialog causes no
 * provider request or source write. Exporting is covered in
 * format-dialog-export.test.tsx.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK = "book_fm000001";

function chapter(id: string, title: string, order: number, content: string): Chapter {
  return {
    ...chapterMetaSchema.parse({ id, title, order, createdAt: NOW, updatedAt: NOW }),
    content,
    path: `000${order}-x.md`,
    wordCount: content.trim().split(/\s+/u).length,
    hash: "c".repeat(64)
  };
}

const CHAPTERS = [
  chapter("ch_fm000001", "First", 1, "First line.\nSecond line.\n"),
  chapter("ch_fm000002", "Second", 2, "Another chapter.\n")
];

const SAVED_MANUSCRIPT: ManuscriptSettings = {
  ...manuscriptSettingsSchema.parse({}),
  bodyFont: "Georgia",
  bodyFontSize: 13
};

function detail() {
  return {
    book: bookSchema.parse({
      id: BOOK,
      title: "Formatted",
      createdAt: NOW,
      updatedAt: NOW,
      settings: {
        manuscript: SAVED_MANUSCRIPT,
        agent: { disabledTools: ["web_search"], skillsEnabled: false },
        cache: { prefixMode: "auto" }
      }
    }),
    chapters: CHAPTERS,
    chapterReadIssues: []
  };
}

function mockWorkspace(overrides: { update?: (bookId: string, patch: unknown) => Promise<unknown> } = {}) {
  const onNotice = mock((_error: unknown) => {});
  const update =
    overrides.update ??
    ((_bookId: string, patch: unknown) =>
      Promise.resolve({
        ok: true,
        data: { ...detail().book, ...(patch as Record<string, unknown>), updatedAt: NOW }
      }));
  const save = mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapter: CHAPTERS[0] } }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      open: mock(() => Promise.resolve({ ok: true, data: detail() })),
      update: mock(update),
      exportDocx: mock(() => Promise.resolve({ ok: true, data: null }))
    },
    chapters: {
      create: mock(() => Promise.resolve({ ok: true, data: CHAPTERS[0] })),
      reorder: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: CHAPTERS } })),
      move: mock(() => Promise.resolve({ ok: true, data: { status: "saved", chapters: CHAPTERS } })),
      delete: mock(() => Promise.resolve({ ok: true, data: null })),
      save
    },
    conflicts: { list: mock(() => Promise.resolve({ ok: true, data: [] })), reveal: mock(() => Promise.resolve({ ok: true, data: null })) },
    drafts: { set: mock(() => Promise.resolve({ ok: true, data: null })), clear: mock(() => Promise.resolve({ ok: true, data: null })), onFlushRequest: mock(() => () => {}) },
    images: { list: mock(() => Promise.resolve({ ok: true, data: { manifest: { images: [] } } })) },
    library: { onChange: mock(() => () => {}) },
    agent: {
      onEvent: mock(() => () => {}),
      ambient: mock(() =>
        Promise.resolve({
          ok: true,
          data: ambientStatus({
            book: { id: BOOK, title: "Formatted", stage: "drafting" },
            chapters: [{ id: "ch_fm000001", title: "First", order: 1, wordCount: 4 }]
          })
        })
      )
    },
    voice: {
      connections: mock(async () => ({ ok: true, data: [] })),
      speakers: mock(async () => ({ available: false, connectionLabel: null, endpoint: null, model: null, voices: [] }))
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
  return { onNotice, save };
}

async function openFormat() {
  const view = testing.within(document.body);
  await testing.waitFor(() => {
    expect(view.getByTestId("format-book")).toBeTruthy();
  });
  testing.fireEvent.click(view.getByTestId("format-book"));
  await testing.waitFor(() => {
    expect(view.getByTestId("format-preview")).toBeTruthy();
  });
  return view;
}

describe("format dialog contract", () => {
  test("controls reflect saved settings and the preview shows saved chapters", async () => {
    mockWorkspace();
    const view = await openFormat();

    const font = view.getByLabelText("Font") as HTMLSelectElement;
    expect(font.value).toBe("Georgia");
    const dialog = view.getByTestId("format-preview");
    expect(dialog.textContent).toContain("First line.");
    expect(dialog.textContent).toContain("Another chapter.");
    const article = view.getByTestId("format-preview");
    expect(article.getAttribute("style") ?? "").toContain("Georgia");
  });

  test("a typography change persists a full-settings merge without dropping sections", async () => {
    mockWorkspace();
    const view = await openFormat();

    const font = view.getByLabelText("Font") as HTMLSelectElement;
    testing.fireEvent.change(font, { target: { value: "Arial" } });

    const studio = (globalThis as unknown as { window: { studio: { books: { update: { mock: { calls: unknown[][] } } } } } }).window.studio;
    await testing.waitFor(() => {
      expect(studio.books.update.mock.calls.length).toBe(1);
    });
    const [bookId, patch] = studio.books.update.mock.calls[0] as [string, { settings: Record<string, unknown> }];
    expect(bookId).toBe(BOOK);
    expect(patch.settings).toEqual({
      manuscript: { ...SAVED_MANUSCRIPT, bodyFont: "Arial" },
      agent: {
        disabledTools: ["web_search"],
        skillsEnabled: false,
        tone: "",
        answerLength: "standard",
        perTurnCeilingUsd: null,
        monthlyWarningUsd: null
      },
      cache: { prefixMode: "auto" }
    });
  });

  test("the disclosure stays visible across change and failure", async () => {
    mockWorkspace({
      update: () => Promise.reject(new Error("Disk is full."))
    });
    const view = await openFormat();
    expect(view.getByTestId("format-disclosure").textContent).toContain("Approximate preview");

    testing.fireEvent.change(view.getByLabelText("Font") as HTMLSelectElement, { target: { value: "Arial" } });
    await testing.waitFor(() => {
      expect((view.getByLabelText("Font") as HTMLSelectElement).value).toBe("Georgia");
    });
    expect(view.getByTestId("format-disclosure").textContent).toContain("Approximate preview");
    expect(view.getByTestId("format-preview").getAttribute("style") ?? "").toContain("Georgia");
  });

  test("every target can be chosen, and the copy claims no publisher acceptance", async () => {
    const mocks = mockWorkspace();
    const view = await openFormat();

    for (const name of ["DOCX", "PDF", "EPUB", "Markdown"]) {
      const radio = view.getByRole("radio", { name }) as HTMLInputElement;
      expect(radio.disabled).toBe(false);
    }
    expect(view.queryByText("Planned")).toBeNull();
    expect(view.queryByText(/Only DOCX can be exported today/)).toBeNull();
    expect((view.getByRole("radio", { name: "DOCX" }) as HTMLInputElement).checked).toBe(true);
    expect(view.getByTestId("format-export").textContent).toBe("Export Word document");

    testing.fireEvent.click(view.getByRole("radio", { name: "EPUB" }));
    expect((view.getByRole("radio", { name: "EPUB" }) as HTMLInputElement).checked).toBe(true);
    expect(view.getByTestId("format-export").textContent).toBe("Export EPUB");
    expect(view.getByTestId("format-target-note").textContent).toContain("E-readers may change the font and size");
    expect(view.getByTestId("format-disclosure").textContent).toContain(
      "nothing claims Kindle or publisher acceptance"
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  test("rendered options match the saved schema enums", async () => {
    mockWorkspace();
    const view = await openFormat();

    const base = manuscriptSettingsSchema.parse({});
    const fonts = [...(view.getByLabelText("Font") as HTMLSelectElement).options].map((option) => option.value);
    expect(fonts).toHaveLength(12);
    for (const font of fonts) {
      expect(() => manuscriptSettingsSchema.parse({ ...base, bodyFont: font })).not.toThrow();
    }
    expect(() => manuscriptSettingsSchema.parse({ ...base, bodyFont: "Comic Sans" })).toThrow();
    const sizes = [...(view.getByLabelText("Size") as HTMLSelectElement).options].map((option) => option.value);
    expect(sizes).toHaveLength(5);
    for (const size of sizes) {
      expect(() =>
        manuscriptSettingsSchema.parse({ ...base, bodyFontSize: Number(size) })
      ).not.toThrow();
    }
    expect(view.getByRole("radio", { name: "Left" })).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Table of contents" })).toBeTruthy();
  });
});
