/// <reference types="bun" />
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";

GlobalRegistrator.register({ url: "http://localhost" });
const testing = await import("@testing-library/react");
const { ManuscriptEditor } = await import("@ai-book-studio/app/components/ManuscriptEditor");

const BOOK = "book_ui000001";
const CHAPTER: Chapter = {
  id: "ch_ui00000001",
  title: "One",
  order: 1,
  arc: "middle",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 1,
  createdAt: "2026-10-25T12:00:00.000Z",
  updatedAt: "2026-10-25T12:00:00.000Z",
  content: "Original.\n",
  path: "0001-one.md",
  wordCount: 1,
  hash: "a".repeat(64)
};

function mockStudio(result: unknown) {
  const save = mock(() => Promise.resolve(result));
  const updateMeta = mock(() => Promise.resolve(result));
  const clear = mock(() => Promise.resolve({ ok: true, data: null }));
  const setDraft = mock(() => Promise.resolve({ ok: true, data: null }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    chapters: { save, updateMeta },
    drafts: { set: setDraft, clear }
  };
  return { save, clear, setDraft };
}

afterEach(() => testing.cleanup());
afterAll(() => GlobalRegistrator.unregister());

describe("ManuscriptEditor", () => {
  test("waits for the debounce before saving typed text", async () => {
    const saved: Chapter = {
      ...CHAPTER,
      version: 2,
      content: "New text.\n",
      hash: "b".repeat(64),
      updatedAt: "2026-10-25T12:01:00.000Z"
    };
    const { save } = mockStudio({ ok: true, data: { status: "saved", chapter: saved } });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, { bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.screen.getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "New text.\n" } });

    expect(save).not.toHaveBeenCalled();
    await testing.waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(save).toHaveBeenCalledWith({
      bookId: BOOK,
      chapterId: CHAPTER.id,
      content: "New text.\n",
      baseVersion: 1,
      baseHash: CHAPTER.hash
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  test("keeps the typed text and reports a conflict", async () => {    const conflict: ChapterConflict = {
      bookId: BOOK,
      chapterId: CHAPTER.id,
      chapterTitle: "One",
      savedAs: "books/book_ui000001/conflicts/0001-one.conflict-external-edit.md",
      reason: "external-edit",
      diskVersion: 2,
      localVersion: 2
    };
    const { save } = mockStudio({ ok: true, data: { status: "conflict", conflict } });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, { bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.screen.getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "New text.\n" } });

    await testing.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ kind: "conflict", conflict }), { timeout: 2500 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(textarea.value).toBe("New text.\n");
  });

  test("shows an attached illustration below the manuscript", () => {
    const { save } = mockStudio({ ok: true, data: { status: "saved", chapter: CHAPTER } });
    testing.render(
      React.createElement(ManuscriptEditor, {
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus: () => {},
        illustration: {
          id: "img_ui000001",
          kind: "chapter",
          chapterId: CHAPTER.id,
          characterId: null,
          fileName: "img_ui000001.png",
          mimeType: "image/png",
          width: 1,
          height: 1,
          bytes: 68,
          sha256: "c".repeat(64),
          prompt: "A lighthouse in a storm",
          provider: "meta",
          model: "muse-image-1.0",
          size: "1024x1024",
          source: "generated",
          createdAt: "2026-10-26T12:00:00.000Z",
          cutoutOf: null,
          costUsd: 0.01,
          revisedPrompt: null,
          confidence: null
        },
        illustrationData: "data:image/png;base64,iVBORw0KGgo="
      })
    );
    expect(testing.screen.getByTestId("chapter-illustration")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});

const { IllustrationDialog } = await import("@ai-book-studio/app/components/IllustrationDialog");
type IllustrationRecord = import("@ai-book-studio/core/images/schema").ImageRecord;

function illustrationImage(overrides: Partial<IllustrationRecord> = {}): IllustrationRecord {
  return {
    id: "img_ui000001",
    kind: "chapter",
    chapterId: null,
    characterId: null,
    fileName: "img_ui000001.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    bytes: 68,
    sha256: "b".repeat(64),
    prompt: "A lighthouse in a storm",
    provider: "meta",
    model: "muse-image-1.0",
    size: "1024x1024",
    source: "generated",
    createdAt: "2026-10-26T12:00:00.000Z",
    cutoutOf: null,
    costUsd: 0.01,
    revisedPrompt: null,
    confidence: null,
    ...overrides
  };
}

function mockIllustrationStudio(options: { connections?: unknown[]; initial?: IllustrationRecord[] } = {}) {
  let images = [...(options.initial ?? [])];
  const list = mock(() =>
    Promise.resolve({
      ok: true as const,
      data: { manifest: { schemaVersion: 1, images }, warning: null }
    })
  );
  const read = mock((_bookId: string, imageId: string) =>
    Promise.resolve({
      ok: true as const,
      data: {
        record: images.find((entry) => entry.id === imageId) ?? illustrationImage(),
        dataUrl: "data:image/png;base64,iVBORw0KGgo="
      }
    })
  );
  const generate = mock((input: { prompt: string; chapterId?: string }) => {
    const created = illustrationImage({
      id: "img_ui000002",
      prompt: input.prompt,
      chapterId: input.chapterId ?? null
    });
    images = [...images, created];
    return Promise.resolve({ ok: true as const, data: created });
  });
  const attach = mock((_bookId: string, imageId: string) => {
    images = images.map((entry) => ({ ...entry, chapterId: entry.id === imageId ? CHAPTER.id : null }));
    return Promise.resolve({
      ok: true as const,
      data: images.find((entry) => entry.id === imageId) ?? illustrationImage()
    });
  });
  const segment = mock(() =>
    Promise.resolve({
      ok: true as const,
      data: {
        prompt: "the keeper",
        model: "sam-3.1",
        costUsd: null,
        matches: [
          {
            objectId: "1",
            confidence: 0.9,
            width: 1,
            height: 1,
            bounds: { left: 0, top: 0, right: 1, bottom: 1 },
            raster: new Uint8Array([1])
          }
        ]
      }
    })
  );
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    connections: {
      list: mock(() =>
        Promise.resolve({
          ok: true as const,
          data: options.connections ?? [{ id: "conn_meta0001", provider: "meta", label: "Meta" }]
        })
      )
    },
    images: {
      list,
      read,
      generate,
      attach,
      remove: mock(() => Promise.resolve({ ok: true as const, data: null })),
      saveCutout: mock(() =>
        Promise.resolve({ ok: true as const, data: illustrationImage({ id: "img_ui000003", kind: "character" }) })
      )
    },
    segmentation: { segment }
  };
  return { generate, attach, segment };
}

function renderIllustration() {
  return testing.render(
    React.createElement(IllustrationDialog, {
      open: true,
      bookId: BOOK,
      chapter: CHAPTER,
      onClose: () => {},
      onChanged: () => {},
      onOpenSettings: () => {}
    })
  );
}

describe("IllustrationDialog", () => {
  test("explains the missing Meta connection and disables generation", async () => {
    mockIllustrationStudio({ connections: [] });
    renderIllustration();
    await testing.waitFor(() => testing.screen.getByText("Connect Meta to generate images"));
    expect((testing.screen.getByTestId("generate-illustration") as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows the attached chapter image", async () => {
    mockIllustrationStudio({ initial: [illustrationImage({ chapterId: CHAPTER.id })] });
    renderIllustration();
    await testing.waitFor(() => testing.screen.getByAltText("Illustration: A lighthouse in a storm"));
    expect((testing.screen.getByTestId("attach-illustration") as HTMLButtonElement).disabled).toBe(true);
    expect(testing.screen.getByTestId("attach-illustration").textContent).toBe("Attached");
  });

  test("generates with the chapter id and reports the save", async () => {
    const studio = mockIllustrationStudio();
    renderIllustration();
    const prompt = (await testing.screen.findByTestId("illustration-prompt")) as HTMLTextAreaElement;
    testing.fireEvent.change(prompt, { target: { value: "A storm over the harbor" } });
    testing.fireEvent.click(testing.screen.getByTestId("generate-illustration"));
    await testing.waitFor(() => expect(studio.generate).toHaveBeenCalledTimes(1));
    expect(studio.generate).toHaveBeenCalledWith({
      bookId: BOOK,
      chapterId: CHAPTER.id,
      prompt: "A storm over the harbor",
      size: "1024x1024"
    });
    await testing.waitFor(() => testing.screen.getByText("Illustration saved to this book."));
  });

  test("attaches an existing image to the chapter", async () => {
    const studio = mockIllustrationStudio({ initial: [illustrationImage()] });
    renderIllustration();
    await testing.waitFor(() => testing.screen.getByAltText("Illustration: A lighthouse in a storm"));
    testing.fireEvent.click(testing.screen.getByTestId("attach-illustration"));
    await testing.waitFor(() => expect(studio.attach).toHaveBeenCalledWith(BOOK, "img_ui000001", CHAPTER.id));
    await testing.waitFor(() => testing.screen.getByText("This image is now the chapter illustration."));
  });

  test("shows SAM matches for the selected image", async () => {
    const studio = mockIllustrationStudio({ initial: [illustrationImage({ chapterId: CHAPTER.id })] });
    renderIllustration();
    const prompt = (await testing.screen.findByTestId("cutout-prompt")) as HTMLInputElement;
    testing.fireEvent.change(prompt, { target: { value: "the keeper" } });
    testing.fireEvent.click(testing.screen.getByTestId("find-cutouts"));
    await testing.waitFor(() =>
      expect(studio.segment).toHaveBeenCalledWith({
        bookId: BOOK,
        imageId: "img_ui000001",
        prompt: "the keeper"
      })
    );
    await testing.waitFor(() => testing.screen.getByText("Object 1 · 90%"));
    expect(testing.screen.getByTestId("save-cutout-1")).toBeTruthy();
  });
});
