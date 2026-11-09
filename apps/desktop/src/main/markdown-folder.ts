import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bookSchema, SCHEMA_VERSION } from "@ai-book-studio/core/schema";
import { compareChapterFileNames, isConflictCopyName, parseChapterFile, parseOrderFromFileName } from "@ai-book-studio/core/markdown";
import { readMatter } from "@ai-book-studio/core/matter";
import {
  IMAGE_SCHEMA_VERSION,
  imageManifestSchema,
  inspectImage,
  type ImageRecord
} from "@ai-book-studio/core/images";
import {
  createMarkdownFolderBundle,
  planMarkdownFolderExport,
  retrieveMarkdownFolderFile,
  type MarkdownFolderBundle,
  type MarkdownFolderImageOutcomeInput,
  type MarkdownFolderPlan,
  type MarkdownFolderPolicy
} from "@ai-book-studio/core/markdown-folder";
import type { LibraryPort } from "@ai-book-studio/core/library/port";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import {
  bookFilePath,
  chapterPath,
  chaptersPath,
  imageFilePath,
  imageManifestPath,
  imagesPath
} from "@ai-book-studio/core/library/paths";
import { writeFileAtomic } from "./library/atomic";
import { safeJoin } from "./library/paths";

/*
 * Markdown folder host service (spec 035 T014-Q, D-202/D-203, docs/formats/markdown-folder-host.md).
 *
 * Main-process only. No IPC channel and no UI live here; the mounted journey is T014-U.
 * Capture reads only through the LibraryPort of the already-open library, never writes to the
 * library, and hands the planner a bundle built fresh from validated saved data through its
 * trusted-construction seam. Publication is desktop-folder only, with genuine no-replace commit:
 * replacing an existing folder is named successor work and is refused, never implemented.
 */

export const MARKDOWN_FOLDER_POLICY_LABEL = "Q0 production policy v1";

/** Q0 production policy v1, exactly as recorded in the host contract section 4. */
export const Q0_PRODUCTION_POLICY_V1: MarkdownFolderPolicy = {
  maxInputStringCodeUnits: 26_214_400,
  maxInputStringUtf8Bytes: 78_643_200,
  maxPerImageBytes: 20_971_520,
  maxTotalImageBytes: 134_217_728,
  maxGeneratedUtf8Bytes: 104_857_600,
  maxTotalOutputBytes: 239_075_328,
  maxRegularFiles: 4_091,
  maxDirectoryEntries: 4_092,
  maxRetrievalRequests: 4_091,
  maxRetrievalBytes: 239_075_328,
  maxAccountedPayloadBytes: 769_654_784,
  maxInputCollectionItems: 4_096
};

export const MARKDOWN_FOLDER_READ_CAPS = {
  bookBytes: 16_777_216,
  chapterBytes: 83_886_080,
  manifestBytes: 16_777_216,
  imageBytes: 20_971_520
} as const;

export const MARKDOWN_FOLDER_COMPONENT_MAXIMA = {
  chapters: 2_000,
  matterSections: 40,
  selectedImageOutcomes: 1_024,
  legacyPairs: 1_000,
  listWarnings: 1
} as const;

/**
 * The change-and-change-back disclosure (host contract section 2.3). It is carried in consent
 * wording and never denied: wording must not claim a simultaneous snapshot or that nothing changed.
 */
export const MARKDOWN_FOLDER_CONSENT_DISCLOSURE =
  "This export is saved data collected over an interval whose start and end samples agreed. " +
  "It is not the book at a single instant and not a simultaneous snapshot. " +
  "A change that left and returned to identical bytes between or within the samples cannot be told apart from no change, " +
  "a change outside a sampled interval is outside this evidence, and changes after collection are not included.";

export function markdownFolderConsentWording(bookId: string, captureSequence: number): string {
  return (
    `Export the saved book ${bookId} (collection ${captureSequence}) as a Markdown folder under ${MARKDOWN_FOLDER_POLICY_LABEL}. ` +
    MARKDOWN_FOLDER_CONSENT_DISCLOSURE
  );
}

export type MarkdownFolderCaptureErrorCode =
  | "book-unreadable"
  | "book-invalid"
  | "book-newer-schema"
  | "book-identity-mismatch"
  | "unreadable-matter"
  | "chapter-set-incomplete"
  | "chapter-unreadable"
  | "chapter-count-exceeded"
  | "duplicate-chapter-id"
  | "invalid-chapter-id"
  | "invalid-book-id"
  | "manifest-newer-schema"
  | "selected-image-count-exceeded"
  | "duplicate-image-id"
  | "legacy-count-exceeded"
  | "source-too-large"
  | "source-changed-during-capture"
  | "substituted-record"
  | "invalid-bundle-input"
  | "bundle-construction-failed"
  | "consent-superseded"
  | "capture-failed";

export class MarkdownFolderCaptureError extends Error {
  constructor(
    readonly code: MarkdownFolderCaptureErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MarkdownFolderCaptureError";
  }
}

function captureRefusal(code: MarkdownFolderCaptureErrorCode, message: string): never {
  throw new MarkdownFolderCaptureError(code, message);
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const textDecoder = new TextDecoder();

/** Build a bundle only through the planner trusted-construction seam; no fallback construction. */
export function constructMarkdownFolderBundle(input: unknown): MarkdownFolderBundle {
  try {
    return createMarkdownFolderBundle(input);
  } catch {
    return captureRefusal(
      "invalid-bundle-input",
      "The Markdown folder bundle could only be built from fresh validated saved data. Nothing was exported."
    );
  }
}

/* ------------------------------------------------------------------ image verification */

export type ImageRecordLike = Pick<
  ImageRecord,
  "id" | "chapterId" | "fileName" | "mimeType" | "width" | "height" | "bytes" | "sha256"
>;

const MIME_FORMAT: Record<string, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
const FORMAT_MIME: Record<"png" | "jpg" | "webp", string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp"
};

function extensionFormat(fileName: string): "png" | "jpg" | "webp" | null {
  const match = /\.([^.]+)$/.exec(fileName);
  if (!match) return null;
  const extension = (match[1] ?? "").toLowerCase();
  if (extension === "png") return "png";
  if (extension === "jpg") return "jpg";
  if (extension === "webp") return "webp";
  return null;
}

/**
 * Verify one selected image against the single manifest snapshot (host contract section 3.2).
 * A record that is not exactly the manifest snapshot's record is a substitution and refuses the
 * whole capture; every other disagreement is the bounded `image-mismatch` omission.
 */
export function verifySelectedImage(input: {
  record: ImageRecordLike;
  manifestRecord: ImageRecordLike | null | undefined;
  bytes: Uint8Array | null;
  snapshotSha256?: string | null;
  readFailure?: "missing" | "unreadable" | "too-large" | null;
}): MarkdownFolderImageOutcomeInput {
  const { record, manifestRecord } = input;
  if (
    !manifestRecord ||
    manifestRecord.id !== record.id ||
    manifestRecord.chapterId !== record.chapterId ||
    manifestRecord.fileName !== record.fileName ||
    manifestRecord.mimeType !== record.mimeType ||
    manifestRecord.width !== record.width ||
    manifestRecord.height !== record.height ||
    manifestRecord.bytes !== record.bytes ||
    manifestRecord.sha256 !== record.sha256
  ) {
    return captureRefusal(
      "substituted-record",
      "A selected image record does not match the captured image list. Nothing was exported."
    );
  }
  if (input.readFailure === "missing") return { status: "omitted", recordId: record.id, code: "image-missing" };
  if (input.readFailure === "unreadable") return { status: "omitted", recordId: record.id, code: "image-unreadable" };
  if (input.readFailure === "too-large") return { status: "omitted", recordId: record.id, code: "image-mismatch" };
  const bytes = input.bytes;
  if (!bytes) return { status: "omitted", recordId: record.id, code: "image-missing" };
  const mismatch: MarkdownFolderImageOutcomeInput = { status: "omitted", recordId: record.id, code: "image-mismatch" };
  if (bytes.byteLength === 0 || bytes.byteLength !== record.bytes) return mismatch;
  const digest = sha256Hex(bytes);
  if (digest !== record.sha256) return mismatch;
  if (input.snapshotSha256 != null && input.snapshotSha256 !== digest) return mismatch;
  const inspection = inspectImage(bytes);
  if (!inspection) return mismatch;
  const detected = inspection.format === "jpeg" ? "jpg" : inspection.format;
  if (MIME_FORMAT[record.mimeType] !== detected) return mismatch;
  if (extensionFormat(record.fileName) !== detected) return mismatch;
  if (record.mimeType !== FORMAT_MIME[detected] || record.mimeType !== inspection.mimeType) return mismatch;
  if (!(inspection.width > 0) || !(inspection.height > 0)) return mismatch;
  if (inspection.width !== record.width || inspection.height !== record.height) return mismatch;
  return { status: "captured", recordId: record.id, format: detected, bytes: new Uint8Array(bytes) };
}

/* ------------------------------------------------------------------ capture */

export interface MarkdownFolderAcquisitionCounts {
  fileReads: number;
  listings: number;
  protocolFileReads: number;
  protocolListings: number;
}

export interface MarkdownFolderCapture {
  bookId: string;
  captureSequence: number;
  bundle: MarkdownFolderBundle;
  bookSha256: string;
  chapters: ReadonlyArray<{ id: string; fileName: string; sha256: string }>;
  manifestState: "read" | "known-empty" | "unreadable";
  manifestSha256: string | null;
  images: ReadonlyArray<{ recordId: string; sha256: string | null; code: string | null }>;
  listWarningCodes: readonly string[];
  acquisition: MarkdownFolderAcquisitionCounts;
  consentDisclosure: string;
  consentWording: string;
  policyLabel: string;
}

export interface MarkdownFolderConsentBinding {
  bookId: string;
  captureSequence: number;
  tuple: string;
  policyLabel: string;
  warnings: MarkdownFolderPlan["warnings"];
  excludedLegacy: MarkdownFolderPlan["excludedLegacy"];
}

interface CapturedChapter {
  id: string;
  title: string;
  order: number;
  parsedBody: string;
  fileName: string;
  sha256: string;
  images: MarkdownFolderImageOutcomeInput[];
}

const isTooLarge = (error: unknown): boolean => error instanceof LibraryPortError && error.code === "too-large";
const ICLOUD_PLACEHOLDER = /^\..+\.md\.icloud$/i;

function fallbackChapterMeta(fileName: string): { id: string; title: string; order: number } {
  const order = parseOrderFromFileName(fileName) ?? 1;
  const slug = fileName.replace(/^\d+-/, "").replace(/\.md$/, "");
  const title = slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || `Chapter ${order}`;
  return { id: `ch_${sha256Hex(new TextEncoder().encode(fileName)).slice(0, 16)}`, title, order };
}

export class MarkdownFolderHostService {
  private admittedSequences = new Map<string, number>();
  private latestAdmitted = new Map<string, number>();
  private captureStartEpochs = new Map<string, number>();
  private consentEpochs = new WeakMap<MarkdownFolderConsentBinding, number>();

  constructor(private readonly host: { libraryRoot: string; storage: LibraryPort }) {}

  get libraryRoot(): string {
    return this.host.libraryRoot;
  }

  async capture(bookId: string): Promise<MarkdownFolderCapture> {
    if (!/^book_[A-Za-z0-9-]{6,}$/.test(bookId)) {
      captureRefusal("invalid-book-id", "That book identity cannot be collected. Nothing was exported.");
    }
    // Starting a new capture supersedes any pending consent for this book (section 2.4).
    this.captureStartEpochs.set(bookId, (this.captureStartEpochs.get(bookId) ?? 0) + 1);
    const storage = this.host.storage;
    const counts = { fileReads: 0, listings: 0 };
    const read = async (path: Parameters<LibraryPort["readFile"]>[0], maxBytes: number) => {
      counts.fileReads += 1;
      return storage.readFile(path, { maxBytes });
    };
    const list = async (path: Parameters<LibraryPort["listDirectory"]>[0]) => {
      counts.listings += 1;
      return storage.listDirectory(path);
    };
    const inspect = async (path: Parameters<LibraryPort["listDirectory"]>[0]) => {
      if (!storage.inspectDirectory) return null;
      counts.listings += 1;
      return storage.inspectDirectory(path);
    };

    try {
      return await this.captureInner(bookId, read, list, inspect, counts);
    } catch (error) {
      if (error instanceof MarkdownFolderCaptureError) throw error;
      if (isTooLarge(error)) {
        captureRefusal("source-too-large", "A saved source file is larger than this export can collect. Nothing was exported.");
      }
      captureRefusal("capture-failed", "The saved book could not be collected. Nothing was exported.");
    }
  }

  private async captureInner(
    bookId: string,
    read: (path: Parameters<LibraryPort["readFile"]>[0], maxBytes: number) => ReturnType<LibraryPort["readFile"]>,
    list: (path: Parameters<LibraryPort["listDirectory"]>[0]) => ReturnType<LibraryPort["listDirectory"]>,
    inspect: (
      path: Parameters<LibraryPort["listDirectory"]>[0]
    ) => Promise<Awaited<ReturnType<NonNullable<LibraryPort["inspectDirectory"]>>> | null>,
    counts: { fileReads: number; listings: number }
  ): Promise<MarkdownFolderCapture> {
    const storageHasInspect = Boolean(this.host.storage.inspectDirectory);

    /* 1. Book record: one bounded snapshot; every book field comes from it. */
    const bookSnapshot = await read(bookFilePath(bookId), MARKDOWN_FOLDER_READ_CAPS.bookBytes);
    if (!bookSnapshot) captureRefusal("book-unreadable", "The saved book record could not be read. Nothing was exported.");
    let rawBook: unknown;
    try {
      rawBook = JSON.parse(textDecoder.decode(bookSnapshot.bytes));
    } catch {
      captureRefusal("book-invalid", "The saved book record is not readable. Nothing was exported.");
    }
    if (!rawBook || typeof rawBook !== "object" || Array.isArray(rawBook)) {
      captureRefusal("book-invalid", "The saved book record is not readable. Nothing was exported.");
    }
    const rawRecord = rawBook as Record<string, unknown>;
    const rawVersion = rawRecord.schemaVersion;
    if (typeof rawVersion === "number" && rawVersion > SCHEMA_VERSION) {
      captureRefusal("book-newer-schema", "This book was saved by a newer version. Nothing was exported.");
    }
    const parsedBook = bookSchema.safeParse(rawBook);
    if (!parsedBook.success) captureRefusal("book-invalid", "The saved book record is not readable. Nothing was exported.");
    const book = parsedBook.data;
    if (book.id !== bookId) captureRefusal("book-identity-mismatch", "The saved book record names a different book. Nothing was exported.");
    const matterCheck = readMatter({ matter: rawRecord.matter });
    if (matterCheck.issue) captureRefusal("unreadable-matter", "The saved front and back matter could not be read. Nothing was exported.");
    const legacyPairs = Object.entries(book.frontMatter).map(([key, value]) => ({ key, value }));
    if (legacyPairs.length > MARKDOWN_FOLDER_COMPONENT_MAXIMA.legacyPairs) {
      captureRefusal("legacy-count-exceeded", "The book has more legacy entries than this export can collect. Nothing was exported.");
    }

    /* 2. Chapter membership: complete candidate set, refused rather than silently dropped. */
    const chapterEntries = async () => {
      const inspected = await inspect(chaptersPath(bookId));
      const listed = await list(chaptersPath(bookId));
      return { inspected, listed, entries: inspected ?? listed };
    };
    const candidateSetOf = (entries: ReadonlyArray<{ name: string; kind: string }>): string[] =>
      entries
        .filter((e) => (e.name.endsWith(".md") && !isConflictCopyName(e.name)) || ICLOUD_PLACEHOLDER.test(e.name))
        .map((e) => `${e.name}:${e.kind}`)
        .sort();
    const firstListing = await chapterEntries();
    for (const entry of firstListing.entries) {
      if (ICLOUD_PLACEHOLDER.test(entry.name)) {
        captureRefusal("chapter-set-incomplete", "A chapter file is an online-only placeholder. Nothing was exported.");
      }
      if (entry.name.endsWith(".md") && !isConflictCopyName(entry.name) && entry.kind !== "file") {
        captureRefusal("chapter-set-incomplete", "A chapter file is not a readable regular file. Nothing was exported.");
      }
    }
    const candidateNames = firstListing.entries
      .filter((e) => e.kind === "file" && e.name.endsWith(".md") && !isConflictCopyName(e.name))
      .map((e) => e.name)
      .sort(compareChapterFileNames);
    if (firstListing.inspected) {
      for (const name of candidateNames) {
        if (!firstListing.listed.some((e) => e.name === name && e.kind === "file")) {
          captureRefusal("chapter-set-incomplete", "The complete saved chapter set is unavailable. Nothing was exported.");
        }
      }
    }
    if (candidateNames.length > MARKDOWN_FOLDER_COMPONENT_MAXIMA.chapters) {
      captureRefusal("chapter-count-exceeded", "The book has more chapters than this export can collect. Nothing was exported.");
    }

    /* 3. Chapter files: each read once in ranked order; canonical order is never re-sorted. */
    const readChapters: CapturedChapter[] = [];
    const chapterHashByName = new Map<string, string>();
    const seenChapterIds = new Set<string>();
    for (const fileName of candidateNames) {
      let snapshot: Awaited<ReturnType<LibraryPort["readFile"]>>;
      try {
        snapshot = await read(chapterPath(bookId, fileName), MARKDOWN_FOLDER_READ_CAPS.chapterBytes);
      } catch (error) {
        if (isTooLarge(error)) throw error;
        captureRefusal("chapter-unreadable", "A chapter file could not be read. Nothing was exported.");
      }
      if (!snapshot) captureRefusal("chapter-unreadable", "A chapter file could not be read. Nothing was exported.");
      chapterHashByName.set(fileName, snapshot.sha256);
      let parsed: ReturnType<typeof parseChapterFile>;
      try {
        const fallback = fallbackChapterMeta(fileName);
        parsed = parseChapterFile(textDecoder.decode(snapshot.bytes), `books/${bookId}/chapters/${fileName}`, {
          id: fallback.id,
          title: fallback.title,
          order: fallback.order,
          arc: "middle",
          purpose: "",
          synopsis: "",
          notes: "",
          isPrologue: false,
          color: null,
          version: 1,
          createdAt: snapshot.createdAt ?? new Date(0).toISOString(),
          updatedAt: snapshot.modifiedAt ?? snapshot.createdAt ?? new Date(0).toISOString()
        });
      } catch {
        captureRefusal("chapter-unreadable", "A chapter file could not be read. Nothing was exported.");
      }
      if (!/^ch_[A-Za-z0-9-]{6,}$/.test(parsed.meta.id)) {
        captureRefusal("invalid-chapter-id", "A chapter identity cannot be collected. Nothing was exported.");
      }
      if (seenChapterIds.has(parsed.meta.id)) {
        captureRefusal("duplicate-chapter-id", "Two chapter files carry the same chapter. Nothing was exported.");
      }
      seenChapterIds.add(parsed.meta.id);
      readChapters.push({
        id: parsed.meta.id,
        title: parsed.meta.title,
        order: parsed.meta.order,
        parsedBody: parsed.content,
        fileName,
        sha256: snapshot.sha256,
        images: []
      });
    }
    const chapters = [...readChapters].sort(
      (a, b) => a.order - b.order || (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0)
    );

    /* 4. Image membership: one manifest snapshot plus the images/ name cross-check. */
    const manifestSnapshot = await read(imageManifestPath(bookId), MARKDOWN_FOLDER_READ_CAPS.manifestBytes);
    const imageEntries = await list(imagesPath(bookId));
    const imageNames = imageEntries.map((e) => e.name).sort();
    const imageFileNames = imageEntries.filter((e) => e.kind === "file").map((e) => e.name);
    let manifestState: MarkdownFolderCapture["manifestState"];
    let manifestRecords: ImageRecord[] = [];
    if (manifestSnapshot) {
      let parsedManifest: unknown = null;
      let parseFailed = false;
      try {
        parsedManifest = JSON.parse(textDecoder.decode(manifestSnapshot.bytes));
      } catch {
        parseFailed = true;
      }
      const version =
        !parseFailed && parsedManifest && typeof parsedManifest === "object"
          ? (parsedManifest as { schemaVersion?: unknown }).schemaVersion
          : undefined;
      if (typeof version === "number" && version > IMAGE_SCHEMA_VERSION) {
        captureRefusal("manifest-newer-schema", "The image list was saved by a newer version. Nothing was exported.");
      }
      const shape = parseFailed ? null : imageManifestSchema.safeParse(parsedManifest);
      if (shape?.success) {
        manifestState = "read";
        manifestRecords = shape.data.images;
      } else {
        manifestState = "unreadable";
      }
    } else {
      manifestState = imageFileNames.length > 0 ? "unreadable" : "known-empty";
    }
    const listWarningCodes: string[] = manifestState === "unreadable" ? ["image-list-unreadable"] : [];

    /* 5. Selected images, in captured per-chapter manifest order. */
    const chapterIds = new Set(chapters.map((c) => c.id));
    const selectedByChapter = new Map<string, ImageRecord[]>();
    let selectedCount = 0;
    for (const chapter of chapters) {
      const records = manifestRecords.filter((r) => r.chapterId === chapter.id && chapterIds.has(r.chapterId));
      selectedByChapter.set(chapter.id, records);
      selectedCount += records.length;
    }
    if (selectedCount > MARKDOWN_FOLDER_COMPONENT_MAXIMA.selectedImageOutcomes) {
      captureRefusal("selected-image-count-exceeded", "The book has more attached images than this export can collect. Nothing was exported.");
    }
    const seenImageIds = new Set<string>();
    for (const chapter of chapters) {
      for (const record of selectedByChapter.get(chapter.id) ?? []) {
        if (seenImageIds.has(record.id)) {
          captureRefusal("duplicate-image-id", "Two selected image records share an identity. Nothing was exported.");
        }
        seenImageIds.add(record.id);
      }
    }
    const manifestById = new Map(manifestRecords.map((r) => [r.id, r]));
    const imageDigestByRecord = new Map<string, { sha256: string | null; code: string | null; marker: string }>();
    const closingImageMarkers: Array<{ record: ImageRecord; marker: string }> = [];
    for (const chapter of chapters) {
      for (const record of selectedByChapter.get(chapter.id) ?? []) {
        let snapshot: Awaited<ReturnType<LibraryPort["readFile"]>> = null;
        let readFailure: "missing" | "unreadable" | "too-large" | null = null;
        try {
          snapshot = await read(imageFilePath(bookId, record.fileName), MARKDOWN_FOLDER_READ_CAPS.imageBytes);
          if (!snapshot) readFailure = "missing";
        } catch (error) {
          if (isTooLarge(error)) readFailure = "too-large";
          else readFailure = "unreadable";
        }
        const outcome = verifySelectedImage({
          record,
          manifestRecord: manifestById.get(record.id),
          bytes: snapshot?.bytes ?? null,
          snapshotSha256: snapshot?.sha256 ?? null,
          readFailure
        });
        chapter.images.push(outcome);
        const marker = readFailure === "too-large" ? "too-large" : readFailure ? readFailure : (snapshot?.sha256 ?? "missing");
        closingImageMarkers.push({ record, marker });
        imageDigestByRecord.set(
          record.id,
          outcome.status === "captured"
            ? { sha256: snapshot?.sha256 ?? null, code: null, marker }
            : { sha256: null, code: outcome.code, marker }
        );
      }
    }

    /* 6. Closing observation: any disagreement discards the whole capture. */
    const changed = (): never =>
      captureRefusal(
        "source-changed-during-capture",
        "The saved book changed while it was being collected. Nothing was frozen; try the export again."
      );
    const closingBook = await read(bookFilePath(bookId), MARKDOWN_FOLDER_READ_CAPS.bookBytes);
    if (!closingBook || closingBook.sha256 !== bookSnapshot.sha256) changed();
    const closingListing = await chapterEntries();
    if (JSON.stringify(candidateSetOf(closingListing.entries)) !== JSON.stringify(candidateSetOf(firstListing.entries))) changed();
    for (const fileName of candidateNames) {
      const snapshot = await read(chapterPath(bookId, fileName), MARKDOWN_FOLDER_READ_CAPS.chapterBytes);
      if (!snapshot || snapshot.sha256 !== chapterHashByName.get(fileName)) changed();
    }
    const closingManifest = await read(imageManifestPath(bookId), MARKDOWN_FOLDER_READ_CAPS.manifestBytes);
    if ((closingManifest?.sha256 ?? null) !== (manifestSnapshot?.sha256 ?? null)) changed();
    const closingImageEntries = await list(imagesPath(bookId));
    if (JSON.stringify(closingImageEntries.map((e) => e.name).sort()) !== JSON.stringify(imageNames)) changed();
    for (const { record, marker } of closingImageMarkers) {
      let closingMarker: string;
      try {
        const snapshot = await read(imageFilePath(bookId, record.fileName), MARKDOWN_FOLDER_READ_CAPS.imageBytes);
        closingMarker = snapshot ? snapshot.sha256 : "missing";
      } catch (error) {
        closingMarker = isTooLarge(error) ? "too-large" : "unreadable";
      }
      if (closingMarker !== marker) changed();
    }

    /* 7. Freeze: construct only through the planner seam, from fresh plain validated data. */
    const sequence = (this.admittedSequences.get(bookId) ?? 0) + 1;
    const bundle = constructMarkdownFolderBundle({
      bookId: book.id,
      bookTitle: book.title,
      description: book.description,
      includeTableOfContents: book.settings.manuscript.includeTableOfContents,
      matter: rawRecord.matter ?? null,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        parsedBody: chapter.parsedBody,
        images: chapter.images.map((image) =>
          image.status === "captured"
            ? { status: "captured", recordId: image.recordId, format: image.format, bytes: new Uint8Array(image.bytes) }
            : { status: "omitted", recordId: image.recordId, code: image.code }
        )
      })),
      legacy: legacyPairs.map((pair) => ({ key: pair.key, value: pair.value })),
      listWarnings: listWarningCodes.map((code) => ({ code }))
    });
    this.admittedSequences.set(bookId, sequence);
    this.latestAdmitted.set(bookId, sequence);
    const protocolFileReads = 2 * (1 + candidateNames.length + 1 + selectedCount);
    return {
      bookId,
      captureSequence: sequence,
      bundle,
      bookSha256: bookSnapshot.sha256,
      chapters: chapters.map((c) => ({ id: c.id, fileName: c.fileName, sha256: c.sha256 })),
      manifestState,
      manifestSha256: manifestSnapshot?.sha256 ?? null,
      images: chapters.flatMap((chapter) =>
        chapter.images.map((image) => {
          const digest = imageDigestByRecord.get(image.recordId);
          return { recordId: image.recordId, sha256: digest?.sha256 ?? null, code: digest?.code ?? null };
        })
      ),
      listWarningCodes,
      acquisition: {
        fileReads: counts.fileReads,
        listings: counts.listings,
        protocolFileReads,
        protocolListings: storageHasInspect ? 6 : 4
      },
      consentDisclosure: MARKDOWN_FOLDER_CONSENT_DISCLOSURE,
      consentWording: markdownFolderConsentWording(bookId, sequence),
      policyLabel: MARKDOWN_FOLDER_POLICY_LABEL
    };
  }

  /** Plan a frozen capture under Q0 production policy v1. Planner refusals stay structured. */
  planCapture(
    capture: MarkdownFolderCapture
  ):
    | { status: "planned"; plan: MarkdownFolderPlan; consent: MarkdownFolderConsentBinding }
    | { status: "refused"; code: string; dimension: string | null; field: string | null; message: string } {
    const result = planMarkdownFolderExport(capture.bundle, { ...Q0_PRODUCTION_POLICY_V1 });
    if (result.status !== "planned") return result;
    const tuple = JSON.stringify({
      bookId: capture.bookId,
      captureSequence: capture.captureSequence,
      bookSha256: capture.bookSha256,
      chapters: capture.chapters.map((c) => [c.id, c.sha256]),
      manifest: [capture.manifestState, capture.manifestSha256],
      images: capture.images.map((i) => [i.recordId, i.sha256 ?? i.code]),
      warnings: result.plan.warnings,
      excludedLegacy: result.plan.excludedLegacy,
      policyLabel: MARKDOWN_FOLDER_POLICY_LABEL
    });
    const consent: MarkdownFolderConsentBinding = {
      bookId: capture.bookId,
      captureSequence: capture.captureSequence,
      tuple,
      policyLabel: MARKDOWN_FOLDER_POLICY_LABEL,
      warnings: result.plan.warnings,
      excludedLegacy: result.plan.excludedLegacy
    };
    this.consentEpochs.set(consent, this.captureStartEpochs.get(capture.bookId) ?? 0);
    return { status: "planned", plan: result.plan, consent };
  }

  /** A consent is current only for the latest admitted capture and only until a new capture starts. */
  isConsentCurrent(consent: MarkdownFolderConsentBinding): boolean {
    return (
      this.latestAdmitted.get(consent.bookId) === consent.captureSequence &&
      this.consentEpochs.get(consent) === (this.captureStartEpochs.get(consent.bookId) ?? 0)
    );
  }

  assertConsentCurrent(consent: MarkdownFolderConsentBinding): void {
    if (!this.isConsentCurrent(consent)) {
      captureRefusal("consent-superseded", "The saved book was collected again after this choice. Nothing was published.");
    }
  }

  /** Publish a planned capture to a new desktop folder. Existing folders refuse (successor work). */
  async publish(
    planned: { plan: MarkdownFolderPlan; consent: MarkdownFolderConsentBinding },
    destinationPath: string,
    overrides: MarkdownFolderPublishOverrides = {}
  ): Promise<MarkdownFolderPublishResult> {
    this.assertConsentCurrent(planned.consent);
    return publishMarkdownFolder(planned.plan, destinationPath, {
      libraryRoot: this.host.libraryRoot,
      protectedPaths: [this.host.libraryRoot, join(this.host.libraryRoot, "books", planned.consent.bookId)],
      overrides
    });
  }
}

/* ------------------------------------------------------------------ publication */

export type MarkdownFolderPublishErrorCode =
  | "destination-invalid"
  | "destination-aliases-source"
  | "destination-exists"
  | "destination-appeared"
  | "staging-failed"
  | "staging-write-failed"
  | "staging-close-failed"
  | "permission-failed"
  | "commit-failed"
  | "cleanup-failed"
  | "retrieval-refused";

export class MarkdownFolderPublishError extends Error {
  constructor(
    readonly code: MarkdownFolderPublishErrorCode,
    message: string,
    readonly cleanupLeftover: string | null = null,
    readonly originalCode: string | null = null
  ) {
    super(message);
    this.name = "MarkdownFolderPublishError";
  }
}

export interface MarkdownFolderPublishOverrides {
  writeFile?: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdir?: (path: string) => Promise<unknown>;
  rename?: (from: string, to: string) => Promise<void>;
  rm?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  lstat?: (path: string) => Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean; dev: number; ino: number }>;
  realpath?: (path: string) => Promise<string>;
  syncDirectory?: (path: string) => Promise<void>;
  createDestinationDirectory?: (path: string) => Promise<void>;
  randomToken?: () => string;
  onStaging?: (event: {
    stage: "staging-created" | "file-written" | "staging-complete" | "commit-started";
    stagingPath: string;
    destinationPath: string;
    filesWritten: number;
  }) => Promise<void> | void;
}

export interface MarkdownFolderPublishResult {
  destinationPath: string;
  files: readonly string[];
  retrievalRequests: number;
  retrievalBytes: number;
  stagingName: string;
}

const STAGING_MARKER = ".markdown-folder-staging-owned";

async function defaultSyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function publishRefusal(
  code: MarkdownFolderPublishErrorCode,
  message: string,
  cleanupLeftover: string | null = null,
  originalCode: string | null = null
): never {
  throw new MarkdownFolderPublishError(code, message, cleanupLeftover, originalCode);
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const part = relative(resolve(root), resolve(candidate));
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function errorCodeOf(error: unknown): string | null {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? null;
}

/**
 * Publish one frozen plan to a new author-chosen local folder (desktop target only).
 * Staging is an owned sibling; the commit first creates the destination with an exclusive
 * mkdir, so a destination created by another actor during staging prevents publication.
 * An existence check followed by an ordinary rename is expressly not used.
 */
export async function publishMarkdownFolder(
  plan: MarkdownFolderPlan,
  destinationPath: string,
  options: {
    libraryRoot: string;
    protectedPaths?: readonly string[];
    overrides?: MarkdownFolderPublishOverrides;
  }
): Promise<MarkdownFolderPublishResult> {
  const overrides = options.overrides ?? {};
  const fsWrite = overrides.writeFile ?? ((path: string, bytes: Uint8Array) => writeFileAtomic(path, bytes));
  const fsMkdir = overrides.mkdir ?? ((path: string) => mkdir(path));
  const fsRename = overrides.rename ?? rename;
  const fsRm = overrides.rm ?? rm;
  const fsLstat = overrides.lstat ?? lstat;
  const fsRealpath = overrides.realpath ?? realpath;
  const fsSync = overrides.syncDirectory ?? defaultSyncDirectory;
  const createDestination = overrides.createDestinationDirectory ?? ((path: string) => mkdir(path).then(() => undefined));
  const tokenOf = overrides.randomToken ?? (() => randomBytes(12).toString("hex"));

  if (!destinationPath || !isAbsolute(destinationPath)) {
    publishRefusal("destination-invalid", "Choose a folder for the Markdown export.");
  }
  const requested = resolve(destinationPath);
  const parentRequested = dirname(requested);
  const name = basename(requested);
  if (!name || name === "." || name === "..") publishRefusal("destination-invalid", "Choose a folder for the Markdown export.");
  let parentReal: string;
  let parentIdentity: { dev: number; ino: number };
  try {
    parentReal = await fsRealpath(parentRequested);
    const parentStat = await fsLstat(parentReal);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      publishRefusal("destination-invalid", "The export folder's parent is not an ordinary folder.");
    }
    parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
  } catch (error) {
    if (error instanceof MarkdownFolderPublishError) throw error;
    publishRefusal("destination-invalid", "The export folder's parent could not be checked. Nothing was published.");
  }
  const destination = join(parentReal, name);
  const libraryReal = await fsRealpath(resolve(options.libraryRoot)).catch(() => resolve(options.libraryRoot));
  const protectedPaths = [libraryReal, ...(options.protectedPaths ?? []).map((p) => resolve(p))];
  for (const protectedPath of protectedPaths) {
    if (isInsideOrEqual(protectedPath, destination) || isInsideOrEqual(destination, protectedPath)) {
      publishRefusal(
        "destination-aliases-source",
        "That folder is the book's own library or inside it. Choose another folder so the export cannot overwrite the book's files."
      );
    }
  }
  try {
    await fsLstat(destination);
    publishRefusal(
      "destination-exists",
      "That folder already exists. Replacing an existing folder is not part of this export yet; choose a new folder name."
    );
  } catch (error) {
    if (error instanceof MarkdownFolderPublishError) throw error;
    if (errorCodeOf(error) !== "ENOENT") {
      publishRefusal("destination-invalid", "That destination could not be checked. Nothing was published.");
    }
  }

  /* Owned sibling staging. */
  let stagingPath = "";
  let stagingName = "";
  let stagingToken = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    stagingToken = tokenOf();
    stagingName = `.${name}.markdown-folder-staging-${stagingToken}`;
    stagingPath = join(parentReal, stagingName);
    try {
      await fsMkdir(stagingPath);
      break;
    } catch (error) {
      if (errorCodeOf(error) === "EEXIST" && attempt < 4) continue;
      if (errorCodeOf(error) === "EACCES" || errorCodeOf(error) === "EPERM") {
        publishRefusal("permission-failed", "The export folder could not be created. Nothing was published.", null, errorCodeOf(error));
      }
      publishRefusal("staging-failed", "The export staging folder could not be created. Nothing was published.", null, errorCodeOf(error));
    }
  }

  const cleanupStaging = async (): Promise<string | null> => {
    try {
      const marker = await readFile(join(stagingPath, STAGING_MARKER), "utf8");
      const stat = await fsLstat(stagingPath);
      if (marker !== stagingToken || !stat.isDirectory() || stat.isSymbolicLink()) return stagingName;
      await fsRm(stagingPath, { recursive: true, force: false });
      return null;
    } catch {
      return stagingName;
    }
  };
  const failWithCleanup = async (
    code: MarkdownFolderPublishErrorCode,
    message: string,
    originalCode: string | null = null
  ): Promise<never> => {
    const leftover = await cleanupStaging();
    if (leftover) {
      throw new MarkdownFolderPublishError(
        "cleanup-failed",
        `${message} Temporary staging could not be removed: ${leftover}. Remove that temporary folder when it is no longer needed.`,
        leftover,
        originalCode
      );
    }
    throw new MarkdownFolderPublishError(code, message, null, originalCode);
  };

  let filesWritten = 0;
  let retrievalBytes = 0;
  try {
    await fsWrite(join(stagingPath, STAGING_MARKER), new TextEncoder().encode(stagingToken));
    await overrides.onStaging?.({ stage: "staging-created", stagingPath, destinationPath: destination, filesWritten });
    await fsMkdir(join(stagingPath, "images"));
    for (const file of plan.files) {
      const retrieved = retrieveMarkdownFolderFile(plan, file.path);
      if (retrieved.status !== "retrieved") {
        await failWithCleanup("retrieval-refused", "Part of the frozen export could not be read back. Nothing was published.");
      }
      const bytes = (retrieved as { bytes: Uint8Array }).bytes;
      retrievalBytes += bytes.byteLength;
      const target = safeJoin(stagingPath, ...file.path.split("/"));
      try {
        await fsWrite(target, bytes);
      } catch (error) {
        const code = errorCodeOf(error);
        if (code === "EACCES" || code === "EPERM") {
          await failWithCleanup("permission-failed", "The export could not be written. Nothing was published.", code);
        }
        await failWithCleanup("staging-write-failed", "The export could not be written. Nothing was published.", code);
      }
      filesWritten += 1;
      await overrides.onStaging?.({ stage: "file-written", stagingPath, destinationPath: destination, filesWritten });
    }
    try {
      await fsSync(join(stagingPath, "images"));
      await fsSync(stagingPath);
    } catch (error) {
      await failWithCleanup(
        "staging-close-failed",
        "The export could not be finished in staging. Nothing was published.",
        errorCodeOf(error)
      );
    }
    await overrides.onStaging?.({ stage: "staging-complete", stagingPath, destinationPath: destination, filesWritten });
  } catch (error) {
    if (error instanceof MarkdownFolderPublishError) throw error;
    const code = errorCodeOf(error);
    if (code === "EACCES" || code === "EPERM") {
      await failWithCleanup("permission-failed", "The export could not be written. Nothing was published.", code);
    }
    await failWithCleanup("staging-failed", "The export could not be staged. Nothing was published.", code);
  }

  /* Genuine no-replace commit: exclusive destination creation, then moves into the owned folder. */
  await overrides.onStaging?.({ stage: "commit-started", stagingPath, destinationPath: destination, filesWritten });
  try {
    const parentNow = await fsLstat(parentReal);
    if (parentNow.dev !== parentIdentity.dev || parentNow.ino !== parentIdentity.ino) {
      await failWithCleanup("commit-failed", "The export folder's parent changed. Nothing was published.");
    }
  } catch (error) {
    if (error instanceof MarkdownFolderPublishError) throw error;
    await failWithCleanup("commit-failed", "The export folder's parent could not be rechecked. Nothing was published.");
  }
  let destinationIdentity: { dev: number; ino: number } | null = null;
  try {
    await createDestination(destination);
    const stat = await fsLstat(destination);
    destinationIdentity = { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (errorCodeOf(error) === "EEXIST") {
      const leftover = await cleanupStaging();
      if (leftover) {
        throw new MarkdownFolderPublishError(
          "cleanup-failed",
          `That folder appeared while the export was being prepared, so nothing was published. Temporary staging could not be removed: ${leftover}.`,
          leftover,
          "EEXIST"
        );
      }
      publishRefusal(
        "destination-appeared",
        "That folder appeared while the export was being prepared. Nothing was published; the folder that appeared was left as it was."
      );
    }
    const code = errorCodeOf(error);
    if (code === "EACCES" || code === "EPERM") {
      await failWithCleanup("permission-failed", "The export folder could not be created. Nothing was published.", code);
    }
    await failWithCleanup("commit-failed", "The export folder could not be created. Nothing was published.", code);
  }

  try {
    await fsRename(join(stagingPath, "images"), join(destination, "images"));
    for (const file of plan.files) {
      if (file.path.includes("/")) continue;
      await fsRename(join(stagingPath, file.path), join(destination, file.path));
    }
  } catch (error) {
    // Roll back only the destination this call created, proven by its recorded identity.
    let leftover: string | null = null;
    try {
      const stat = await fsLstat(destination);
      if (
        destinationIdentity &&
        stat.dev === destinationIdentity.dev &&
        stat.ino === destinationIdentity.ino &&
        stat.isDirectory() &&
        !stat.isSymbolicLink()
      ) {
        await fsRm(destination, { recursive: true, force: false });
      } else {
        leftover = name;
      }
    } catch {
      leftover = name;
    }
    const stagingLeftover = await cleanupStaging();
    const shown = leftover ?? stagingLeftover;
    if (shown) {
      throw new MarkdownFolderPublishError(
        "cleanup-failed",
        `The export could not be published and part of its temporary output could not be removed: ${shown}. Nothing is claimed published.`,
        shown,
        errorCodeOf(error)
      );
    }
    publishRefusal("commit-failed", "The export could not be published. Nothing was published.", null, errorCodeOf(error));
  }

  try {
    await fsSync(destination);
    await fsSync(parentReal);
  } catch {
    // Publication already happened; directory-sync support varies by filesystem (atomic.ts).
  }
  const stagingLeftover = await cleanupStaging();
  if (stagingLeftover) {
    // Files are published; report the owned leftover truthfully instead of claiming clean success.
    throw new MarkdownFolderPublishError(
      "cleanup-failed",
      `The export was published, but its temporary staging could not be removed: ${stagingLeftover}. Remove that temporary folder when it is no longer needed.`,
      stagingLeftover
    );
  }
  return {
    destinationPath: destination,
    files: plan.files.map((f) => f.path),
    retrievalRequests: filesWritten,
    retrievalBytes,
    stagingName
  };
}

