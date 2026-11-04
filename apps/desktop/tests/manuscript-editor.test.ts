/// <reference types="bun" />
import { afterAll, beforeAll, afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { Chapter, ChapterConflict } from "@ai-book-studio/core/schema";
import { countWords as studioCountWords } from "@ai-book-studio/core/words";
import type { EditorHandle, SaveStatus } from "@ai-book-studio/app/components/ManuscriptEditor";
import { runAfterReviewSave } from "@ai-book-studio/app/lib/review-save-gate";

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

  test("paste normalises line endings and quotes before the text lands", async () => {
    mockStudio({ ok: true, data: null });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, { bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
    testing.fireEvent.paste(textarea, {
      clipboardData: { getData: () => "Pasted.\r\n“Quoted.”\n\n\nVerse.\nVerse.  \n" }
    });

    expect(textarea.value).toBe("Original.\nPasted.\n\"Quoted.\"\n\nVerse.\nVerse.  \n");
  });

  test("flush returns a conflict instead of claiming the edit was saved", async () => {
    const conflict: ChapterConflict = {
      bookId: BOOK,
      chapterId: CHAPTER.id,
      chapterTitle: "One",
      savedAs: "books/book_ui000001/conflicts/0001-one.conflict-external-edit.md",
      reason: "external-edit",
      diskVersion: 2,
      localVersion: 2
    };
    const { save, setDraft } = mockStudio({ ok: true, data: { status: "conflict", conflict } });
    const onSaved = mock(() => {});
    const onStatus = mock(() => {});
    const editor = React.createRef<EditorHandle>();

    testing.render(
      React.createElement(ManuscriptEditor, { ref: editor, bookId: BOOK, chapter: CHAPTER, ordinal: 1, onSaved, onStatus })
    );
    const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "New text.\n" } });
    await testing.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1), { timeout: 1000 });

    let flushStatus: SaveStatus | undefined;
    await testing.act(async () => {
      flushStatus = await editor.current!.flush();
    });

    expect(flushStatus).toEqual({ kind: "conflict", conflict });
    expect(onStatus).toHaveBeenCalledWith({ kind: "conflict", conflict });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(textarea.value).toBe("New text.\n");
  });

  test("flush returns a failed save outcome and keeps the author's text", async () => {
    const { save, setDraft } = mockStudio({ ok: false, error: { code: "io", message: "Synthetic save failure." } });
    const editor = React.createRef<EditorHandle>();
    const textarea = "New text.\n";

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus: () => {}
      })
    );
    testing.fireEvent.change(testing.within(document.body).getByTestId("manuscript-text"), { target: { value: textarea } });
    await testing.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1), { timeout: 1000 });

    let flushStatus: SaveStatus | undefined;
    await testing.act(async () => {
      flushStatus = await editor.current!.flush();
    });

    expect(flushStatus).toEqual({ kind: "error", message: "Synthetic save failure." });
    expect(save).toHaveBeenCalledTimes(1);
    expect((testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement).value).toBe(textarea);
  });

  test("typing and then undoing back to the saved text reads as saved, so an export can run", async () => {
    const { save, clear } = mockStudio({ ok: true, data: null });
    const editor = React.createRef<EditorHandle>();
    const onStatus = mock((_status: SaveStatus) => {});

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved: () => {},
        onStatus
      })
    );
    const textarea = testing.within(document.body).getByTestId("manuscript-text") as HTMLTextAreaElement;
    testing.fireEvent.change(textarea, { target: { value: "Original, changed.\n" } });
    testing.fireEvent.change(textarea, { target: { value: CHAPTER.content } });
    expect(onStatus).toHaveBeenLastCalledWith({ kind: "dirty" });

    let flushStatus: SaveStatus | undefined;
    await testing.act(async () => {
      flushStatus = await editor.current!.flush();
    });

    expect(flushStatus?.kind).toBe("saved");
    expect(onStatus.mock.calls.at(-1)?.[0]?.kind).toBe("saved");
    expect(save).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith(BOOK, CHAPTER.id);
    expect(textarea.value).toBe(CHAPTER.content);
  });

  test("flush confirms the saved chapter returned by the normal save path", async () => {
    const saved: Chapter = {
      ...CHAPTER,
      version: 2,
      content: "Confirmed text.\n",
      hash: "d".repeat(64)
    };
    const { save, setDraft } = mockStudio({ ok: true, data: { status: "saved", chapter: saved } });
    const editor = React.createRef<EditorHandle>();
    const onSaved = mock(() => {});

    testing.render(
      React.createElement(ManuscriptEditor, {
        ref: editor,
        bookId: BOOK,
        chapter: CHAPTER,
        ordinal: 1,
        onSaved,
        onStatus: () => {}
      })
    );
    testing.fireEvent.change(testing.within(document.body).getByTestId("manuscript-text"), {
      target: { value: saved.content }
    });
    await testing.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1), { timeout: 1000 });

    let flushStatus: SaveStatus | undefined;
    await testing.act(async () => {
      flushStatus = await editor.current!.flush();
    });

    expect(flushStatus?.kind).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(saved);
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

  test("the live header count agrees with the studio counter", () => {
    mockStudio({ ok: true, data: { status: "saved", chapter: CHAPTER } });
    const tricky = { ...CHAPTER, content: "one — two ...\n", wordCount: 4 };
    testing.render(
      React.createElement(ManuscriptEditor, {
        bookId: BOOK,
        chapter: tricky,
        ordinal: 1,
        onSaved: () => {},
        onStatus: () => {}
      })
    );
    // The expected number comes from the shared core counter, so a divergence
    // between the editor display and every saved count fails here (FR-016).
    expect(studioCountWords(tricky.content)).toBe(4);
    expect(testing.within(document.body).getByTestId("manuscript-editor").textContent).toContain("4 words");
  });
});

describe("manuscript review save gate", () => {
  test("requires an explicit choice for unsaved text and does not start analysis", async () => {
    let started = false;
    const result = await runAfterReviewSave({ kind: "dirty" }, undefined, async () => ({ kind: "saved", at: 1 }), () => {
      started = true;
    });

    expect(result).toEqual({ status: "choice-required" });
    expect(started).toBe(false);
  });

  test("runs only after the explicit save path confirms saved", async () => {
    const flush = mock(async () => ({ kind: "saved", at: 1 } as const));
    const run = mock(async () => "synthetic report");

    const result = await runAfterReviewSave({ kind: "dirty" }, "save", flush, run);

    expect(result).toEqual({ status: "ready", value: "synthetic report" });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("keeps review blocked after a save conflict or failure", async () => {
    const conflict: Exclude<SaveStatus, { kind: "saved" }> = {
      kind: "conflict",
      conflict: {
        bookId: BOOK,
        chapterId: CHAPTER.id,
        chapterTitle: CHAPTER.title,
        savedAs: "books/book_ui000001/conflicts/0001-one.conflict-external-edit.md",
        reason: "external-edit",
        diskVersion: 2,
        localVersion: 2
      }
    };
    const outcomes: Exclude<SaveStatus, { kind: "saved" }>[] = [
      conflict,
      { kind: "error", message: "Synthetic save failure." },
      { kind: "saving" }
    ];

    for (const saveStatus of outcomes) {
      const run = mock(() => "must not run");
      const result = await runAfterReviewSave({ kind: "dirty" }, "save", async () => saveStatus, run);

      expect(result).toEqual({ status: "blocked", saveStatus });
      expect(run).not.toHaveBeenCalled();
    }
  });

  test("cancel leaves pending editor text untouched and does not flush or analyze", async () => {
    const flush = mock(async () => ({ kind: "saved", at: 1 } as const));
    const run = mock(async () => "synthetic report");

    const result = await runAfterReviewSave({ kind: "dirty" }, "cancel", flush, run);

    expect(result).toEqual({ status: "cancelled" });
    expect(flush).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
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

describe("ModelPickerDialog active connection", () => {
  const WORK = {
    id: "conn_work0001",
    provider: "openrouter",
    label: "Work",
    kind: "api-key",
    createdAt: "2026-10-26T12:00:00.000Z"
  };
  const PERSONAL = {
    id: "conn_home0001",
    provider: "openrouter",
    label: "Personal",
    kind: "api-key",
    createdAt: "2026-10-26T12:00:00.000Z"
  };
  const MODEL = {
    id: "m1",
    name: "Model One",
    contextLength: 1_000,
    supportsTools: true,
    supportsImages: false,
    inputPricePerMillion: null,
    outputPricePerMillion: null
  };

  function mockPickerStudio() {
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      providers: {
        list: mock(() =>
          Promise.resolve({ ok: true as const, data: [{ id: "openrouter", name: "OpenRouter" }] })
        ),
        models: mock(() =>
          Promise.resolve({
            ok: true as const,
            data: { fetchedAt: "2026-10-26T12:00:00.000Z", models: [MODEL] }
          })
        )
      },
      connections: {
        list: mock(() => Promise.resolve({ ok: true as const, data: [WORK, PERSONAL] }))
      },
      books: { update: mock(() => Promise.resolve({ ok: true as const, data: {} })) }
    };
  }

  function connectionButton(label: string): HTMLButtonElement {
    return testing.within(document.body).getByText(label).closest("button") as HTMLButtonElement;
  }

  test("marks the book's connection among several accounts, not the one being browsed", async () => {
    mockPickerStudio();
    const parsed = bookSchema.parse({
      id: BOOK,
      title: "The Salt Road",
      createdAt: "2026-10-26T12:00:00.000Z",
      updatedAt: "2026-10-26T12:00:00.000Z",
      defaultConnectionId: "conn_work0001"
    });
    testing.render(
      React.createElement(ModelPickerDialog, {
        open: true,
        book: parsed,
        onClose: () => {},
        onSaved: mock(() => {})
      })
    );

    await testing.waitFor(() => testing.within(document.body).getByText("Personal"));
    const work = connectionButton("Work");
    const personal = connectionButton("Personal");
    expect(testing.within(work).getByTestId("connection-active").textContent).toBe("Book default");
    expect(testing.within(personal).queryByTestId("connection-active")).toBeNull();

    // Browsing the other account must not move the mark; it follows the book default.
    testing.fireEvent.click(personal);
    await testing.waitFor(() => expect(testing.within(personal).queryByTestId("connection-active")).toBeNull());
    expect(testing.within(work).getByTestId("connection-active").textContent).toBe("Book default");
  });

  test("shows capabilities in plain words, naming what the provider does not say", async () => {
    const CONNECTION = {
      id: "conn_cap0001",
      provider: "openrouter",
      label: "OpenRouter",
      kind: "api-key",
      createdAt: "2026-10-26T12:00:00.000Z"
    };
    (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
      providers: {
        list: mock(() =>
          Promise.resolve({ ok: true as const, data: [{ id: "openrouter", name: "OpenRouter" }] })
        ),
        models: mock(() =>
          Promise.resolve({
            ok: true as const,
            data: {
              fetchedAt: "2026-10-26T12:00:00.000Z",
              models: [
                {
                  id: "m-full",
                  name: "Full Model",
                  contextLength: 128_000,
                  supportsTools: true,
                  supportsImages: true,
                  inputPricePerMillion: 3,
                  outputPricePerMillion: 15
                },
                {
                  id: "m-blank",
                  name: "Blank Model",
                  contextLength: null,
                  supportsTools: null,
                  supportsImages: null,
                  inputPricePerMillion: null,
                  outputPricePerMillion: null
                }
              ]
            }
          })
        )
      },
      connections: {
        list: mock(() => Promise.resolve({ ok: true as const, data: [CONNECTION] }))
      },
      books: { update: mock(() => Promise.resolve({ ok: true as const, data: {} })) }
    };
    const parsed = bookSchema.parse({
      id: BOOK,
      title: "The Salt Road",
      createdAt: "2026-10-26T12:00:00.000Z",
      updatedAt: "2026-10-26T12:00:00.000Z",
      defaultConnectionId: "conn_cap0001"
    });
    testing.render(
      React.createElement(ModelPickerDialog, {
        open: true,
        book: parsed,
        onClose: () => {},
        onSaved: mock(() => {})
      })
    );

    const view = testing.within(document.body);
    await testing.waitFor(() => expect(view.getByText("Full Model")).toBeDefined());
    const full = view.getByText("Full Model").closest("button") as HTMLButtonElement;
    expect(full.textContent).toContain("128k context");
    expect(full.textContent).toContain("Uses tools");
    expect(full.textContent).toContain("Reads pictures");
    const blank = view.getByText("Blank Model").closest("button") as HTMLButtonElement;
    expect(blank.textContent).toContain("Context not reported");
    expect(blank.textContent).toContain("Price not reported");
    expect(blank.textContent).toContain("Tools not reported");
    expect(blank.textContent).toContain("Pictures not reported");
  });

  test("names the turn override apart from the book default", async () => {
    mockPickerStudio();
    const parsed = bookSchema.parse({
      id: BOOK,
      title: "The Salt Road",
      createdAt: "2026-10-26T12:00:00.000Z",
      updatedAt: "2026-10-26T12:00:00.000Z",
      defaultConnectionId: "conn_work0001"
    });
    testing.render(
      React.createElement(ModelPickerDialog, {
        open: true,
        book: parsed,
        onClose: () => {},
        onPick: mock(() => {}),
        initial: { connectionId: "conn_home0001", modelId: "m1" }
      })
    );

    await testing.waitFor(() => testing.within(document.body).getByText("Personal"));
    const marks = testing.within(document.body).getAllByTestId("connection-active");
    expect(marks.map((mark) => mark.textContent).sort()).toEqual(["Book default", "This turn"]);
    expect(
      testing.within(connectionButton("Work")).getByTestId("connection-active").textContent
    ).toBe("Book default");
    expect(
      testing.within(connectionButton("Personal")).getByTestId("connection-active").textContent
    ).toBe("This turn");
  });
});
