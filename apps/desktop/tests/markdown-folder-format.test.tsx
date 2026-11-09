/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import { bookSchema, chapterMetaSchema, manuscriptSettingsSchema } from "@ai-book-studio/core/schema";
import type { BookMeta, Chapter } from "@ai-book-studio/core/schema";

let testing!: typeof import("@testing-library/react/pure");
let FormatDialog!: typeof import("@ai-book-studio/app/components/FormatDialog").FormatDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ FormatDialog } = await import("@ai-book-studio/app/components/FormatDialog"));
});
afterAll(async () => {
  await unmountDom();
});
afterEach(() => testing.cleanup());

/*
 * Spec 035 T014-U: the Format dialog Markdown folder journey. Consent is bound to the
 * frozen collection, a new collection supersedes it in words, picker cancel returns to
 * the same consent, cancelling while publishing settles as cancelled, and an
 * unconfirmed publication is never shown as success. Synthetic content only.
 */

const NOW = "2026-11-09T00:00:00.000Z";
const BOOK = "book_mdf00001";
const ATTEMPT_ONE = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_TWO = "22222222-2222-4222-8222-222222222222";
const DISCLOSURE =
  "This export is saved data collected over an interval whose start and end samples agreed. " +
  "It is not the book at a single instant and not a simultaneous snapshot. " +
  "A change that left and returned to identical bytes between or within the samples cannot be told apart from no change, " +
  "a change outside a sampled interval is outside this evidence, and changes after collection are not included.";

const CHAPTERS: Chapter[] = [
  {
    ...chapterMetaSchema.parse({ id: "ch_mdf00001", title: "The Door", order: 1, createdAt: NOW, updatedAt: NOW }),
    content: "The hall was cold.\n",
    path: "0001-the-door.md",
    wordCount: 4,
    hash: "b".repeat(64)
  }
];

function ready(attemptId: string, sequence: number) {
  return {
    ok: true,
    data: {
      status: "ready",
      attemptId,
      bookId: BOOK,
      captureSequence: sequence,
      consentDisclosure: DISCLOSURE,
      consentWording: `Export the saved book ${BOOK} (collection ${sequence}) as a Markdown folder under Q0 production policy v1. ${DISCLOSURE}`,
      policyLabel: "Q0 production policy v1",
      warnings: [
        { kind: "image-omission", code: "image-missing", chapterId: "ch_mdf00001", selectedPosition: 1, recordId: "img_first001" }
      ],
      excludedLegacy: [{ position: 1, key: "notes", keyIsFallback: false, reason: "not-represented" }],
      files: ["README.md", "0001-title.md", "0002-chapter.md", "images/0003.png"],
      readingOrder: ["0001-title.md", "0002-chapter.md"]
    }
  };
}

interface FolderMocks {
  capture: ReturnType<typeof mock>;
  publish: ReturnType<typeof mock>;
  cancel: ReturnType<typeof mock>;
}

function renderBook(options: {
  capture?: () => Promise<unknown>;
  publish?: (input: { bookId: string; attemptId: string }) => Promise<unknown>;
  cancel?: (input: { bookId: string; attemptId: string }) => Promise<unknown>;
} = {}): FolderMocks & { view: ReturnType<typeof testing.within> } {
  const book: BookMeta = bookSchema.parse({ id: BOOK, title: "The Salt Road", createdAt: NOW, updatedAt: NOW });
  const capture = mock(options.capture ?? (async () => ready(ATTEMPT_ONE, 1)));
  const publish = mock(
    options.publish ??
      (async () => ({
        ok: true,
        data: {
          status: "published",
          destinationPath: "/tmp/exports/the-salt-road-markdown",
          files: ["README.md", "0001-title.md", "0002-chapter.md"],
          warnings: [
            { kind: "image-omission", code: "image-missing", chapterId: "ch_mdf00001", selectedPosition: 1, recordId: "img_first001" }
          ]
        }
      }))
  );
  const cancel = mock(options.cancel ?? (async () => ({ ok: true, data: { status: "accepted", attemptId: ATTEMPT_ONE } })));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: "darwin",
    books: {
      saveMatter: mock(async () => ({ ok: true, data: { status: "saved", book } })),
      exportMarkdownFolderCapture: capture,
      exportMarkdownFolderPublish: publish,
      exportMarkdownFolderCancel: cancel
    },
    conflicts: { reveal: mock(async () => ({ ok: true, data: null })) }
  };
  testing.render(
    React.createElement(FormatDialog, {
      open: true,
      onClose: () => {},
      bookId: BOOK,
      bookTitle: book.title,
      book,
      onBookSaved: () => {},
      onNotice: () => {},
      settings: manuscriptSettingsSchema.parse({}),
      chapters: CHAPTERS,
      onSaveSettings: async () => {},
      onFlush: async () => null
    })
  );
  return { view: testing.within(document.body), capture, publish, cancel };
}

async function openConsent(view: ReturnType<typeof testing.within>): Promise<void> {
  testing.fireEvent.click(view.getByRole("radio", { name: "Markdown folder" }));
  testing.fireEvent.click(view.getByTestId("format-export"));
  await testing.waitFor(() => expect(view.getByTestId("markdown-folder-consent")).toBeTruthy());
}

describe("markdown folder journey in the Format dialog", () => {
  test("capture shows the bundle-bound consent with the exact disclosure, warnings and excluded legacy", async () => {
    const { view, capture } = renderBook();
    await openConsent(view);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(BOOK);
    expect(view.getByTestId("markdown-folder-disclosure").textContent).toBe(DISCLOSURE);
    expect(view.getByTestId("markdown-folder-consent").textContent).toContain("Collection 1 · Q0 production policy v1");
    expect(view.getByLabelText("Collection warnings").textContent).toContain("An attached image was missing");
    expect(view.getByTestId("markdown-folder-excluded").textContent).toContain("notes");
    expect(view.getByTestId("markdown-folder-excluded").textContent).not.toContain("synthetic legacy text");
    expect(view.getByRole("button", { name: "Continue without them" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  test("continue publishes with only the attempt identity, and success lists the destination, files and warnings", async () => {
    const { view, publish } = renderBook();
    await openConsent(view);
    testing.fireEvent.click(view.getByRole("button", { name: "Continue without them" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-result")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ bookId: BOOK, attemptId: ATTEMPT_ONE });
    const [payload] = publish.mock.calls[0] as [{ bookId: string; attemptId: string }];
    expect(Object.keys(payload).sort()).toEqual(["attemptId", "bookId"]);
    expect(view.getByTestId("markdown-folder-destination").textContent).toBe("/tmp/exports/the-salt-road-markdown");
    expect(view.getByTestId("markdown-folder-files").textContent).toContain("README.md");
    expect(view.getByTestId("markdown-folder-files").textContent).toContain("0002-chapter.md");
    expect(view.getByLabelText("Export warnings").textContent).toContain("An attached image was missing");
    expect(view.getByTestId("markdown-folder-result").textContent).toContain("edits after collection are not included");
  });

  test("picker cancel returns to the same consent as a clean no-op", async () => {
    let calls = 0;
    const { view, publish } = renderBook({
      publish: async () => {
        calls += 1;
        if (calls === 1) return { ok: true, data: null };
        return {
          ok: true,
          data: { status: "published", destinationPath: "/tmp/exports/the-salt-road-markdown", files: ["README.md"], warnings: [] }
        };
      }
    });
    await openConsent(view);
    testing.fireEvent.click(view.getByRole("button", { name: "Continue without them" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-consent")).toBeTruthy());
    expect(view.queryByTestId("markdown-folder-result")).toBeNull();
    expect(view.queryByTestId("markdown-folder-error")).toBeNull();
    testing.fireEvent.click(view.getByRole("button", { name: "Continue without them" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-result")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(2);
  });

  test("cancel in the consent calls the cancel channel and publishes nothing", async () => {
    const { view, publish, cancel } = renderBook();
    await openConsent(view);
    testing.fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-cancelled")).toBeTruthy());
    expect(cancel).toHaveBeenCalledWith({ bookId: BOOK, attemptId: ATTEMPT_ONE });
    expect(publish).not.toHaveBeenCalled();
    expect(view.getByTestId("markdown-folder-cancelled").textContent).toContain("Nothing was published.");
  });

  test("a new capture supersedes the pending consent and says so", async () => {
    let calls = 0;
    const { view } = renderBook({
      capture: async () => {
        calls += 1;
        return ready(calls === 1 ? ATTEMPT_ONE : ATTEMPT_TWO, calls);
      }
    });
    await openConsent(view);
    expect(view.queryByTestId("markdown-folder-superseded")).toBeNull();
    testing.fireEvent.click(view.getByTestId("format-export"));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-superseded")).toBeTruthy());
    expect(view.getByTestId("markdown-folder-superseded").textContent).toContain("A new collection replaced the previous one.");
    expect(view.getByTestId("markdown-folder-consent").textContent).toContain("Collection 2");
  });

  test("cancelling while publishing is accepted and the publish reply settles as cancelled", async () => {
    let settle: ((value: unknown) => void) | null = null;
    const { view, cancel } = renderBook({
      publish: () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    });
    await openConsent(view);
    testing.fireEvent.click(view.getByRole("button", { name: "Continue without them" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-progress")).toBeTruthy());
    testing.fireEvent.click(view.getByRole("button", { name: "Cancel export" }));
    await testing.waitFor(() => expect(cancel).toHaveBeenCalledWith({ bookId: BOOK, attemptId: ATTEMPT_ONE }));
    if (!settle) throw new Error("the publish call never started");
    (settle as (value: unknown) => void)({ ok: true, data: { status: "cancelled", message: "The Markdown folder export was cancelled. Nothing was published." } });
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-cancelled")).toBeTruthy());
    expect(view.queryByTestId("markdown-folder-result")).toBeNull();
  });

  test("an unconfirmed publication is stated as unknown, never as success", async () => {
    const { view } = renderBook({
      publish: async () => ({
        ok: true,
        data: {
          status: "unknown",
          message: "The export could not be published. Whether the folder was published could not be confirmed. Check the destination folder before trying again.",
          destinationPath: "/tmp/exports/the-salt-road-markdown"
        }
      })
    });
    await openConsent(view);
    testing.fireEvent.click(view.getByRole("button", { name: "Continue without them" }));
    await testing.waitFor(() => expect(view.getByTestId("markdown-folder-unknown")).toBeTruthy());
    expect(view.getByTestId("markdown-folder-unknown").textContent).toContain("Publication could not be confirmed");
    expect(view.queryByTestId("markdown-folder-result")).toBeNull();
    expect(view.queryByTestId("markdown-folder-files")).toBeNull();
  });
});
