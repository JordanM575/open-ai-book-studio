/// <reference types="bun" />
import { afterAll, beforeAll, afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
// Loaded in beforeAll, once the DOM exists.
let ManuscriptEditor!: typeof import("@ai-book-studio/app/components/ManuscriptEditor").ManuscriptEditor;
let IllustrationDialog!: typeof import("@ai-book-studio/app/components/IllustrationDialog").IllustrationDialog;
let ModelPickerDialog!: typeof import("@ai-book-studio/app/components/ModelPickerDialog").ModelPickerDialog;

beforeAll(async () => {
  testing = await mountDom();
  // The dialogs reach react-dom through Radix, and react-dom checks for a DOM the first time it loads.
  // So the components load here, after the DOM exists, and not at module scope.
  ({ ManuscriptEditor } = await import("@ai-book-studio/app/components/ManuscriptEditor"));
  ({ IllustrationDialog } = await import("@ai-book-studio/app/components/IllustrationDialog"));
  ({ ModelPickerDialog } = await import("@ai-book-studio/app/components/ModelPickerDialog"));
});
afterAll(async () => {
  await unmountDom();
});

const BOOK = "book_ui000001";
const CHARACTER = {
  id: "char_test0001",
  name: "Mara",
  role: "protagonist",
  description: "",
  motivations: "",
  notes: ""
};
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
    const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
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
    const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
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
    expect(testing.within(document.body).getByTestId("chapter-illustration")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
});

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
  const attachCharacter = mock((_bookId: string, imageId: string, characterId: string) => {
    images = images.map((entry) => (entry.id === imageId ? { ...entry, characterId } : entry));
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
      ),
      attachCharacter
    },
    segmentation: { segment }
  };
  return { generate, attach, segment, attachCharacter };
}

function renderIllustration() {
  return testing.render(
    React.createElement(IllustrationDialog, {
      open: true,
      bookId: BOOK,
      chapter: CHAPTER,
      characters: [CHARACTER],
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
    await testing.waitFor(() => testing.within(document.body).getByText("Connect Meta to generate images"));
    expect((testing.within(document.body).getByTestId("generate-illustration") as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows the attached chapter image", async () => {
    mockIllustrationStudio({ initial: [illustrationImage({ chapterId: CHAPTER.id })] });
    renderIllustration();
    await testing.waitFor(() => testing.within(document.body).getByAltText("Illustration: A lighthouse in a storm"));
    expect((testing.within(document.body).getByTestId("attach-illustration") as HTMLButtonElement).disabled).toBe(true);
    expect(testing.within(document.body).getByTestId("attach-illustration").textContent).toBe("Attached");
  });

  test("generates with the chapter id and reports the save", async () => {
    const studio = mockIllustrationStudio();
    renderIllustration();
    const prompt = (await testing.within(document.body).findByTestId("illustration-prompt")) as HTMLTextAreaElement;
    testing.fireEvent.change(prompt, { target: { value: "A storm over the harbor" } });
    testing.fireEvent.click(testing.within(document.body).getByTestId("generate-illustration"));
    await testing.waitFor(() => expect(studio.generate).toHaveBeenCalledTimes(1));
    expect(studio.generate).toHaveBeenCalledWith({
      bookId: BOOK,
      chapterId: CHAPTER.id,
      prompt: "A storm over the harbor",
      size: "1024x1024"
    });
    await testing.waitFor(() => testing.within(document.body).getByText("Illustration saved to this book."));
  });

  test("attaches an existing image to the chapter", async () => {
    const studio = mockIllustrationStudio({ initial: [illustrationImage()] });
    renderIllustration();
    await testing.waitFor(() => testing.within(document.body).getByAltText("Illustration: A lighthouse in a storm"));
    testing.fireEvent.click(testing.within(document.body).getByTestId("attach-illustration"));
    await testing.waitFor(() => expect(studio.attach).toHaveBeenCalledWith(BOOK, "img_ui000001", CHAPTER.id));
    await testing.waitFor(() => testing.within(document.body).getByText("This image is now the chapter illustration."));
  });

  test("shows SAM matches for the selected image", async () => {
    const studio = mockIllustrationStudio({ initial: [illustrationImage({ chapterId: CHAPTER.id })] });
    renderIllustration();
    const prompt = (await testing.within(document.body).findByTestId("cutout-prompt")) as HTMLInputElement;
    testing.fireEvent.change(prompt, { target: { value: "the keeper" } });
    testing.fireEvent.click(testing.within(document.body).getByTestId("find-cutouts"));
    await testing.waitFor(() =>
      expect(studio.segment).toHaveBeenCalledWith({
        bookId: BOOK,
        imageId: "img_ui000001",
        prompt: "the keeper"
      })
    );
    await testing.waitFor(() => testing.within(document.body).getByText("Object 1 · 90%"));
    expect(testing.within(document.body).getByTestId("save-cutout-1")).toBeTruthy();
  });
});

describe("IllustrationDialog character attachment", () => {
  test("attaches a saved cutout to a cast member", async () => {
    const studio = mockIllustrationStudio({
      initial: [
        illustrationImage({
          id: "img_ui000003",
          kind: "character",
          source: "cutout",
          cutoutOf: "img_ui000001",
          prompt: "the keeper"
        })
      ]
    });
    renderIllustration();
    await testing.waitFor(() => testing.within(document.body).getByText("No illustration for this chapter yet."));
    testing.fireEvent.click(testing.within(document.body).getByTitle("the keeper"));
    await testing.waitFor(() => testing.within(document.body).getByAltText("Illustration: the keeper"));
    const select = document.getElementById("cutout-character") as HTMLSelectElement;
    testing.fireEvent.change(select, { target: { value: CHARACTER.id } });
    testing.fireEvent.click(testing.within(document.body).getByTestId("attach-cutout-character"));
    await testing.waitFor(() =>
      expect(studio.attachCharacter).toHaveBeenCalledWith(BOOK, "img_ui000003", CHARACTER.id)
    );
    await testing.waitFor(() => testing.within(document.body).getByText("Character image attached to the cast member."));
  });
});

const { bookSchema } = await import("@ai-book-studio/core/schema");

describe("ModelPickerDialog contributor consent", () => {
  test("requires the training consent before a Contributor model can be used", async () => {
    const parsed = bookSchema.parse({
      id: BOOK,
      title: "The Salt Road",
      createdAt: "2026-10-26T12:00:00.000Z",
      updatedAt: "2026-10-26T12:00:00.000Z"
    });
    const update = mock((_bookId: string, patch: Record<string, unknown>) =>
      Promise.resolve({ ok: true as const, data: { ...parsed, ...patch } })
    );
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      providers: {
        list: mock(() => Promise.resolve({ ok: true as const, data: [] })),
        models: mock(() =>
          Promise.resolve({
            ok: true as const,
            data: {
              fetchedAt: "2026-10-26T12:00:00.000Z",
              models: [
                {
                  id: "muse-spark-1.3-contributor",
                  name: "Muse Spark 1.3 Contributor",
                  contextLength: 1_048_576,
                  supportsTools: true,
                  supportsImages: true,
                  inputPricePerMillion: 0.1,
                  outputPricePerMillion: 0.2,
                  trainingOnData: true
                }
              ]
            }
          })
        )
      },
      connections: {
        list: mock(() =>
          Promise.resolve({
            ok: true as const,
            data: [
              {
                id: "conn_meta0001",
                provider: "meta",
                label: "Meta",
                kind: "api-key",
                createdAt: "2026-10-26T12:00:00.000Z"
              }
            ]
          })
        )
      },
      books: { update }
    };
    const onSaved = mock(() => {});
    testing.render(
      React.createElement(ModelPickerDialog, {
        open: true,
        book: parsed,
        onClose: () => {},
        onSaved
      })
    );

    await testing.waitFor(() => testing.within(document.body).getByText("Muse Spark 1.3 Contributor"));
    testing.fireEvent.click(testing.within(document.body).getByText("Muse Spark 1.3 Contributor"));
    await testing.waitFor(() => testing.within(document.body).getByText("Contributor mode"));
    const use = testing.within(document.body).getByText("Use this model").closest("button") as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    testing.fireEvent.click(testing.within(document.body).getByTestId("allow-contributor"));
    await testing.waitFor(() => expect(use.disabled).toBe(false));
    testing.fireEvent.click(use);
    await testing.waitFor(() =>
      expect(update).toHaveBeenCalledWith(BOOK, {
        defaultProvider: "meta",
        defaultConnectionId: "conn_meta0001",
        defaultModelId: "muse-spark-1.3-contributor",
        allowContributorTraining: true
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
