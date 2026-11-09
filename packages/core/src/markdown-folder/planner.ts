import { isEmptyMatter, kindLabel, matterPlan, readMatter, type MatterSection } from "../matter";
import type { BookMeta } from "../schema";
import {
  encodeMarkdownFolderMetadata,
  inMarkdownFolderEscapeRange,
  isWellFormedScalarText,
  markdownFolderUtf8ByteLength
} from "./escape";

/*
 * The pure planner for the Markdown folder export (spec 035 T014-P, D-202, docs/formats/
 * markdown-folder.md). It consumes one frozen saved-source bundle handle built by
 * `createMarkdownFolderBundle` plus an explicit policy, and returns one complete
 * deterministic plan or one structured refusal. It performs no I/O, Library access,
 * capture, provider call, path lookup, decoding or publication, and it never returns a
 * partial book, trims input to fit, drops an image to fit, approves exclusions or
 * permits publication.
 *
 * Temporary-payload strategy (contract §6): the planner builds each generated text file
 * once as a string and then encodes it once as UTF-8 bytes. The accounted payload charges
 * that second materialization as its declared temporary payload (the generated UTF-8
 * byte count), alongside retained input strings at 2 x UTF-16 code units, captured
 * images, the materialized output and every issued retrieval copy, with overlaps charged
 * even where storage could be shared. The accounted payload is a logical envelope, not
 * measured heap use.
 */

export class MarkdownFolderPlannerError extends Error {
  constructor(
    readonly code: string,
    readonly dimension: string | null = null,
    readonly field: string | null = null
  ) {
    super(`Markdown folder planner refused: ${code}.`);
    this.name = "MarkdownFolderPlannerError";
  }
}

function refuse(code: string, dimension: string | null = null, field: string | null = null): never {
  throw new MarkdownFolderPlannerError(code, dimension, field);
}

/* ------------------------------------------------------------------ input types */

export type MarkdownFolderImageFormat = "png" | "jpg" | "webp";

export interface MarkdownFolderCapturedImageInput {
  status: "captured";
  recordId: string;
  format: MarkdownFolderImageFormat;
  bytes: Uint8Array;
}

export interface MarkdownFolderOmittedImageInput {
  status: "omitted";
  recordId: string;
  code: string;
}

export type MarkdownFolderImageOutcomeInput = MarkdownFolderCapturedImageInput | MarkdownFolderOmittedImageInput;

export interface MarkdownFolderChapterInput {
  id: string;
  title: string;
  order: number;
  parsedBody: string;
  images: MarkdownFolderImageOutcomeInput[];
}

export interface MarkdownFolderLegacyPairInput {
  key: string;
  value: string;
}

export interface MarkdownFolderListWarningInput {
  code: string;
}

/** The complete trusted narrow projection the capturing side hands to the planner. */
export interface MarkdownFolderBundleInput {
  bookId: string;
  bookTitle: string;
  description: string;
  /** The one canonical manuscript setting this folder consults. */
  includeTableOfContents: boolean;
  /** The raw saved `matter` value, read with `readMatter`/`matterPlan` semantics. */
  matter: unknown;
  chapters: MarkdownFolderChapterInput[];
  legacy: MarkdownFolderLegacyPairInput[];
  listWarnings: MarkdownFolderListWarningInput[];
}

export interface MarkdownFolderBundle {
  readonly brand: "markdown-folder-bundle";
}

/* ------------------------------------------------------------------ policy */

export interface MarkdownFolderPolicy {
  maxInputStringCodeUnits: number;
  maxInputStringUtf8Bytes: number;
  maxInputCollectionItems: number;
  maxPerImageBytes: number;
  maxTotalImageBytes: number;
  maxGeneratedUtf8Bytes: number;
  maxTotalOutputBytes: number;
  maxRegularFiles: number;
  maxDirectoryEntries: number;
  maxRetrievalRequests: number;
  maxRetrievalBytes: number;
  maxAccountedPayloadBytes: number;
}

const POLICY_FIELDS: ReadonlyArray<keyof MarkdownFolderPolicy> = [
  "maxInputStringCodeUnits",
  "maxInputStringUtf8Bytes",
  "maxInputCollectionItems",
  "maxPerImageBytes",
  "maxTotalImageBytes",
  "maxGeneratedUtf8Bytes",
  "maxTotalOutputBytes",
  "maxRegularFiles",
  "maxDirectoryEntries",
  "maxRetrievalRequests",
  "maxRetrievalBytes",
  "maxAccountedPayloadBytes"
];

/* ------------------------------------------------------------------ plan types */

export type MarkdownFolderFileKind =
  | "readme"
  | "title"
  | "front"
  | "contents"
  | "chapter"
  | "illustration"
  | "back"
  | "image";

export interface MarkdownFolderPlannedFile {
  readonly path: string;
  readonly kind: MarkdownFolderFileKind;
  readonly ordinal: number | null;
  readonly byteLength: number;
}

export interface MarkdownFolderWarning {
  readonly kind: "list" | "image-omission";
  readonly code: string;
  readonly chapterId: string | null;
  readonly selectedPosition: number | null;
  readonly recordId: string | null;
}

export type MarkdownFolderLegacyReason = "not-represented" | "title-page-off" | "projected-value-not-emitted";

export interface MarkdownFolderExcludedLegacy {
  readonly position: number;
  readonly key: string;
  readonly keyIsFallback: boolean;
  readonly reason: MarkdownFolderLegacyReason;
}

export interface MarkdownFolderAccounting {
  readonly inputStringCodeUnits: number;
  readonly inputStringUtf8Bytes: number;
  readonly inputCollectionItems: number;
  readonly largestImageBytes: number;
  readonly totalImageBytes: number;
  readonly generatedUtf8Bytes: number;
  readonly totalOutputBytes: number;
  readonly regularFileCount: number;
  readonly directoryEntryCount: number;
  readonly retainedInputStringCharge: number;
  readonly temporaryPayloadBytes: number;
  readonly accountedPayloadBytes: number;
  readonly accountedPayloadWithOneFullRetrievalBytes: number;
}

export interface MarkdownFolderPlan {
  readonly bookId: string;
  readonly directories: readonly string[];
  readonly readingOrder: readonly string[];
  readonly files: readonly MarkdownFolderPlannedFile[];
  readonly warnings: readonly MarkdownFolderWarning[];
  readonly excludedLegacy: readonly MarkdownFolderExcludedLegacy[];
  readonly accounting: MarkdownFolderAccounting;
}

export interface MarkdownFolderRefusal {
  readonly status: "refused";
  readonly code: string;
  readonly dimension: string | null;
  readonly field: string | null;
  readonly message: string;
}

export type MarkdownFolderPlanResult =
  | { readonly status: "planned"; readonly plan: MarkdownFolderPlan }
  | MarkdownFolderRefusal;

export type MarkdownFolderRetrievalResult =
  | { readonly status: "retrieved"; readonly path: string; readonly bytes: Uint8Array }
  | MarkdownFolderRefusal;

export interface MarkdownFolderRetrievalAccounting {
  readonly requests: number;
  readonly bytes: number;
  readonly accountedPayloadBytes: number;
}

/* ------------------------------------------------------------------ private state */

type PrivateImage =
  | { status: "captured"; recordId: string; format: string; bytes: Uint8Array | null; storageInvalid: boolean }
  | { status: "omitted"; recordId: string; code: string };

interface PrivateChapter {
  id: string;
  title: string;
  order: number;
  parsedBody: string;
  images: PrivateImage[];
}

interface PrivateBundle {
  bookId: string;
  bookTitle: string;
  description: string;
  includeTableOfContents: boolean;
  matter: unknown;
  chapters: PrivateChapter[];
  legacy: MarkdownFolderLegacyPairInput[];
  listWarnings: MarkdownFolderListWarningInput[];
}

interface PrivatePlan {
  policy: MarkdownFolderPolicy;
  bytesByPath: Map<string, Uint8Array>;
  accountedFresh: number;
  requests: number;
  retrievalBytes: number;
}

const bundleSnapshots = new WeakMap<MarkdownFolderBundle, PrivateBundle>();
const planStates = new WeakMap<MarkdownFolderPlan, PrivatePlan>();

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (value instanceof Uint8Array || value instanceof Map) return value;
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function refusalResult(error: MarkdownFolderPlannerError): MarkdownFolderRefusal {
  return freezeDeep({
    status: "refused" as const,
    code: error.code,
    dimension: error.dimension,
    field: error.field,
    message: error.message
  });
}

/* ------------------------------------------------- trusted construction (no getters) */

/*
 * Construction is a trusted-code seam (contract §6). Private own-data records are built
 * from validated saved data without invoking caller callbacks, coercion, iterators or
 * getters: every property is reached through its own-data descriptor, accessor
 * descriptors refuse, and partially built state is never exposed. The returned handle
 * is privately registered; the planner checks that registration before reading any
 * property of the object it is given, so unregistered objects and wrappers are refused
 * untouched. This does not claim to detect every proxy or make a hostile producer
 * authentic.
 */

function dataEntries(value: unknown, code: string): Array<[string, unknown]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse(code);
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value as object)) {
    if (typeof key !== "string") refuse(code);
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) refuse(code);
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function dataArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(code);
  const items: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") refuse(code);
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) refuse(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) refuse(code);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) refuse(code);
    items.push(descriptor.value);
  }
  return items;
}

function entryMap(value: unknown, required: readonly string[], code: string): Map<string, unknown> {
  const entries = dataEntries(value, code);
  const map = new Map(entries);
  if (map.size !== entries.length) refuse(code);
  for (const key of map.keys()) if (!required.includes(key)) refuse(code);
  for (const key of required) if (!map.has(key)) refuse(code);
  return map;
}

function stringField(map: Map<string, unknown>, key: string, code: string): string {
  const value = map.get(key);
  if (typeof value !== "string") refuse(code);
  return value as string;
}

function cloneJsonValue(value: unknown, active: Set<object>, depth: number): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse("invalid-bundle");
    return value;
  }
  if (typeof value !== "object" || depth > 32) refuse("invalid-bundle");
  if (active.has(value)) refuse("invalid-bundle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return dataArray(value, "invalid-bundle").map((item) => cloneJsonValue(item, active, depth + 1));
    }
    const entries = dataEntries(value, "invalid-bundle").map(
      ([key, item]) => [key, cloneJsonValue(item, active, depth + 1)] as [string, unknown]
    );
    return Object.fromEntries(entries);
  } finally {
    active.delete(value);
  }
}

function snapshotImageBytes(value: unknown): { bytes: Uint8Array | null; storageInvalid: boolean } {
  if (!(value instanceof Uint8Array)) refuse("invalid-bundle");
  if (Object.getPrototypeOf(value) !== Uint8Array.prototype) return { bytes: null, storageInvalid: true };
  const buffer = value.buffer;
  if (buffer instanceof SharedArrayBuffer) return { bytes: null, storageInvalid: true };
  const arrayBuffer = buffer as { detached?: unknown; resizable?: unknown };
  if (arrayBuffer.detached === true || arrayBuffer.resizable === true) {
    return { bytes: null, storageInvalid: true };
  }
  // A fixed private copy: no caller keeps a mutable alias to the admitted bytes.
  return { bytes: new Uint8Array(value), storageInvalid: false };
}

function snapshotBundle(input: unknown): PrivateBundle {
  const code = "invalid-bundle";
  const top = entryMap(
    input,
    ["bookId", "bookTitle", "description", "includeTableOfContents", "matter", "chapters", "legacy", "listWarnings"],
    code
  );
  if (typeof top.get("includeTableOfContents") !== "boolean") refuse(code);
  const matterRaw = top.get("matter");
  const matter = matterRaw === undefined ? undefined : cloneJsonValue(matterRaw, new Set(), 0);

  const chapters: PrivateChapter[] = dataArray(top.get("chapters"), code).map((chapterValue) => {
    const chapter = entryMap(chapterValue, ["id", "title", "order", "parsedBody", "images"], code);
    if (typeof chapter.get("order") !== "number") refuse(code);
    const images: PrivateImage[] = dataArray(chapter.get("images"), code).map((imageValue) => {
      const image = dataEntries(imageValue, code);
      const status = new Map(image).get("status");
      if (status === "captured") {
        const captured = entryMap(imageValue, ["status", "recordId", "format", "bytes"], code);
        const { bytes, storageInvalid } = snapshotImageBytes(captured.get("bytes"));
        return {
          status: "captured" as const,
          recordId: stringField(captured, "recordId", code),
          format: stringField(captured, "format", code),
          bytes,
          storageInvalid
        };
      }
      if (status === "omitted") {
        const omitted = entryMap(imageValue, ["status", "recordId", "code"], code);
        return {
          status: "omitted" as const,
          recordId: stringField(omitted, "recordId", code),
          code: stringField(omitted, "code", code)
        };
      }
      return refuse(code);
    });
    return {
      id: stringField(chapter, "id", code),
      title: stringField(chapter, "title", code),
      order: chapter.get("order") as number,
      parsedBody: stringField(chapter, "parsedBody", code),
      images
    };
  });

  const legacy: MarkdownFolderLegacyPairInput[] = dataArray(top.get("legacy"), code).map((pairValue) => {
    const pair = entryMap(pairValue, ["key", "value"], code);
    return { key: stringField(pair, "key", code), value: stringField(pair, "value", code) };
  });

  const listWarnings: MarkdownFolderListWarningInput[] = dataArray(top.get("listWarnings"), code).map((warningValue) => {
    const warning = entryMap(warningValue, ["code"], code);
    return { code: stringField(warning, "code", code) };
  });

  return {
    bookId: stringField(top, "bookId", code),
    bookTitle: stringField(top, "bookTitle", code),
    description: stringField(top, "description", code),
    includeTableOfContents: top.get("includeTableOfContents") as boolean,
    matter,
    chapters,
    legacy,
    listWarnings
  };
}

/**
 * Build the frozen-bundle handle from validated saved data. The snapshot is complete
 * before the handle exists, so partially built state is never exposed. Invalid shapes
 * throw `MarkdownFolderPlannerError`; the planning entry returns structured refusals.
 */
export function createMarkdownFolderBundle(input: unknown): MarkdownFolderBundle {
  const snapshot = snapshotBundle(input);
  const handle = Object.freeze({ brand: "markdown-folder-bundle" as const });
  bundleSnapshots.set(handle, snapshot);
  return handle;
}

/* ------------------------------------------------------------------ planning */

function readPolicy(value: unknown): MarkdownFolderPolicy {
  const code = "invalid-policy";
  const map = entryMap(value, [...POLICY_FIELDS], code);
  const policy = {} as Record<string, number>;
  for (const field of POLICY_FIELDS) {
    const fieldValue = map.get(field);
    if (typeof fieldValue !== "number" || !Number.isSafeInteger(fieldValue) || fieldValue < 0) refuse(code, field);
    policy[field] = fieldValue as number;
  }
  return policy as unknown as MarkdownFolderPolicy;
}

function checkLimit(actual: number, maximum: number, dimension: keyof MarkdownFolderPolicy): void {
  if (actual > maximum) refuse("budget-exceeded", dimension);
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function requireEmitted(value: string, field: string): void {
  if (!isWellFormedScalarText(value)) refuse("invalid-unicode", null, field);
}

function blankAnnotation(original: string): string {
  if (original === "") return " \u2014 Saved title: (empty)";
  return ` \u2014 Saved title: ${encodeMarkdownFolderMetadata(original)}`;
}

function collectMatterStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectMatterStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectMatterStrings(item, out);
  }
}

const WARNING_CODE = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_KEY_MAX = 128;

function safeLegacyKey(key: string, position: number): { key: string; keyIsFallback: boolean } {
  const malformed =
    key.length === 0 ||
    key.length > SAFE_KEY_MAX ||
    !isWellFormedScalarText(key) ||
    [...key].some((scalar) => inMarkdownFolderEscapeRange(scalar.codePointAt(0) as number));
  return malformed ? { key: `legacy entry ${position}`, keyIsFallback: true } : { key, keyIsFallback: false };
}

interface ReadingEntry {
  kind: Exclude<MarkdownFolderFileKind, "readme" | "image">;
  suffix: string;
  label: string;
  annotation: string;
  ordinal: number;
  fileName: string;
  chapter?: PrivateChapter;
  section?: MatterSection;
  sectionSide?: "front" | "back";
  image?: Extract<PrivateImage, { status: "captured" }>;
  imageFormat?: MarkdownFolderImageFormat;
}

export function planMarkdownFolderExport(bundle: unknown, policyValue: unknown): MarkdownFolderPlanResult {
  try {
    // Registration is checked before any property of the given object is read.
    if (bundle === null || (typeof bundle !== "object" && typeof bundle !== "function")) {
      return refusalResult(new MarkdownFolderPlannerError("untrusted-bundle"));
    }
    const snapshot = bundleSnapshots.get(bundle as MarkdownFolderBundle);
    if (!snapshot) return refusalResult(new MarkdownFolderPlannerError("untrusted-bundle"));
    const policy = readPolicy(policyValue);
    return freezeDeep({ status: "planned" as const, plan: buildPlan(snapshot, policy) });
  } catch (error) {
    if (error instanceof MarkdownFolderPlannerError) return refusalResult(error);
    return refusalResult(new MarkdownFolderPlannerError("invalid-bundle"));
  }
}

function buildPlan(snapshot: PrivateBundle, policy: MarkdownFolderPolicy): MarkdownFolderPlan {
  if (!/^book_[A-Za-z0-9-]{6,}$/.test(snapshot.bookId)) refuse("invalid-book-id", null, "bookId");

  const { matter: parsedMatter, issue } = readMatter({ matter: snapshot.matter } as Pick<BookMeta, "matter">);
  if (issue) refuse("unreadable-matter", null, "matter");
  const projected = matterPlan({ description: snapshot.description } as unknown as BookMeta, parsedMatter);
  const legacyProjection = !parsedMatter || isEmptyMatter(parsedMatter);
  const titlePage = projected.titlePage;
  const front = projected.front;
  const back = projected.back;
  const allSections: Array<{ section: MatterSection; side: "front" | "back"; sourceIndex: number }> = [
    ...front.map((section) => ({
      section,
      side: "front" as const,
      sourceIndex: parsedMatter ? parsedMatter.sections.indexOf(section) : -1
    })),
    ...back.map((section) => ({
      section,
      side: "back" as const,
      sourceIndex: parsedMatter ? parsedMatter.sections.indexOf(section) : -1
    }))
  ];

  // Identity and structure: duplicate titles and saved orders are valid, ambiguous IDs refuse.
  const chapterIds = new Set<string>();
  const imageIds = new Set<string>();
  let totalImageOutcomes = 0;
  snapshot.chapters.forEach((chapter, chapterIndex) => {
    if (!/^ch_[A-Za-z0-9-]{6,}$/.test(chapter.id)) refuse("invalid-chapter-id", null, `chapters[${chapterIndex}].id`);
    if (chapterIds.has(chapter.id)) refuse("duplicate-chapter-id", null, `chapters[${chapterIndex}].id`);
    chapterIds.add(chapter.id);
    if (!Number.isSafeInteger(chapter.order) || chapter.order < 1) {
      refuse("invalid-chapter-order", null, `chapters[${chapterIndex}].order`);
    }
    chapter.images.forEach((image, imageIndex) => {
      totalImageOutcomes += 1;
      const field = `chapters[${chapterIndex}].images[${imageIndex}]`;
      if (!/^img_[A-Za-z0-9-]{6,}$/.test(image.recordId)) refuse("invalid-image-id", null, `${field}.recordId`);
      if (imageIds.has(image.recordId)) refuse("duplicate-image-id", null, `${field}.recordId`);
      imageIds.add(image.recordId);
      if (image.status === "captured") {
        if (image.format !== "png" && image.format !== "jpg" && image.format !== "webp") {
          refuse("invalid-image-format", null, `${field}.format`);
        }
        if (image.storageInvalid || !image.bytes) refuse("unsupported-image-storage", null, `${field}.bytes`);
        if (image.bytes.byteLength === 0) refuse("invalid-image-bytes", null, `${field}.bytes`);
      } else if (!WARNING_CODE.test(image.code)) {
        refuse("invalid-warning-code", null, `${field}.code`);
      }
    });
  });
  snapshot.listWarnings.forEach((warning, index) => {
    if (!WARNING_CODE.test(warning.code)) refuse("invalid-warning-code", null, `listWarnings[${index}].code`);
  });

  // Well-formed scalar text is required only for fields this plan actually emits.
  if (titlePage) {
    if (!isBlank(snapshot.bookTitle)) requireEmitted(snapshot.bookTitle, "bookTitle");
    if (projected.subtitle !== "") {
      requireEmitted(projected.subtitle, legacyProjection ? "description" : "matter.subtitle");
    }
    if (projected.author !== "") requireEmitted(projected.author, "matter.author");
  }
  for (const { section, sourceIndex } of allSections) {
    if (!isBlank(section.title)) requireEmitted(section.title, `matter.sections[${sourceIndex}].title`);
    requireEmitted(section.text, `matter.sections[${sourceIndex}].text`);
  }
  snapshot.chapters.forEach((chapter, chapterIndex) => {
    if (!isBlank(chapter.title)) requireEmitted(chapter.title, `chapters[${chapterIndex}].title`);
    requireEmitted(chapter.parsedBody, `chapters[${chapterIndex}].parsedBody`);
  });

  // Input budgets are counted and refused before any output is materialized.
  const retainedStrings: string[] = [snapshot.bookId, snapshot.bookTitle, snapshot.description];
  collectMatterStrings(snapshot.matter, retainedStrings);
  let largestImageBytes = 0;
  let totalImageBytes = 0;
  for (const chapter of snapshot.chapters) {
    retainedStrings.push(chapter.id, chapter.title, chapter.parsedBody);
    for (const image of chapter.images) {
      retainedStrings.push(image.recordId);
      if (image.status === "captured") {
        retainedStrings.push(image.format);
        const length = (image.bytes as Uint8Array).byteLength;
        largestImageBytes = Math.max(largestImageBytes, length);
        totalImageBytes += length;
      } else {
        retainedStrings.push(image.code);
      }
    }
  }
  for (const pair of snapshot.legacy) retainedStrings.push(pair.key, pair.value);
  for (const warning of snapshot.listWarnings) retainedStrings.push(warning.code);

  const inputStringCodeUnits = retainedStrings.reduce((sum, value) => sum + value.length, 0);
  const inputStringUtf8Bytes = retainedStrings.reduce((sum, value) => sum + markdownFolderUtf8ByteLength(value), 0);
  const inputCollectionItems =
    snapshot.chapters.length +
    (parsedMatter ? parsedMatter.sections.length : 0) +
    snapshot.legacy.length +
    totalImageOutcomes +
    snapshot.listWarnings.length;
  checkLimit(inputStringCodeUnits, policy.maxInputStringCodeUnits, "maxInputStringCodeUnits");
  checkLimit(inputStringUtf8Bytes, policy.maxInputStringUtf8Bytes, "maxInputStringUtf8Bytes");
  checkLimit(inputCollectionItems, policy.maxInputCollectionItems, "maxInputCollectionItems");
  checkLimit(largestImageBytes, policy.maxPerImageBytes, "maxPerImageBytes");
  checkLimit(totalImageBytes, policy.maxTotalImageBytes, "maxTotalImageBytes");

  // Reading order and labels. Captured order, including its ties, is never re-sorted.
  const displayBookTitle = isBlank(snapshot.bookTitle) ? "Untitled book" : snapshot.bookTitle;
  const entries: ReadingEntry[] = [];
  const add = (entry: Omit<ReadingEntry, "ordinal" | "fileName">) => {
    entries.push({ ...entry, ordinal: 0, fileName: "" });
  };
  if (titlePage) {
    add({
      kind: "title",
      suffix: "title",
      label: "Title page",
      annotation: isBlank(snapshot.bookTitle) ? blankAnnotation(snapshot.bookTitle) : ""
    });
  }
  front.forEach((section, index) => {
    add({
      kind: "front",
      suffix: "front",
      label: `Front matter ${index + 1}: ${isBlank(section.title) ? kindLabel(section.kind) : encodeMarkdownFolderMetadata(section.title)}`,
      annotation: isBlank(section.title) ? blankAnnotation(section.title) : "",
      section,
      sectionSide: "front"
    });
  });
  if (snapshot.includeTableOfContents) {
    add({ kind: "contents", suffix: "contents", label: "Contents", annotation: "" });
  }
  for (const chapter of snapshot.chapters) {
    const chapterAnnotation = isBlank(chapter.title) ? blankAnnotation(chapter.title) : "";
    add({
      kind: "chapter",
      suffix: "chapter",
      label: isBlank(chapter.title)
        ? `Chapter ${chapter.order}`
        : `Chapter ${chapter.order}: ${encodeMarkdownFolderMetadata(chapter.title)}`,
      annotation: chapterAnnotation,
      chapter
    });
    chapter.images.forEach((image, imageIndex) => {
      if (image.status !== "captured") return;
      const position = imageIndex + 1;
      add({
        kind: "illustration",
        suffix: "illustration",
        label: isBlank(chapter.title)
          ? `Illustration for Chapter ${chapter.order} (${position})`
          : `Illustration for Chapter ${chapter.order}: ${encodeMarkdownFolderMetadata(chapter.title)} (${position})`,
        annotation: chapterAnnotation,
        chapter,
        image,
        imageFormat: image.format as MarkdownFolderImageFormat
      });
    });
  }
  back.forEach((section, index) => {
    add({
      kind: "back",
      suffix: "back",
      label: `Back matter ${index + 1}: ${isBlank(section.title) ? kindLabel(section.kind) : encodeMarkdownFolderMetadata(section.title)}`,
      annotation: isBlank(section.title) ? blankAnnotation(section.title) : "",
      section,
      sectionSide: "back"
    });
  });

  const readingCount = entries.length;
  const width = readingCount === 0 ? 4 : Math.max(4, String(readingCount).length);
  entries.forEach((entry, index) => {
    entry.ordinal = index + 1;
    entry.fileName = `${String(index + 1).padStart(width, "0")}-${entry.suffix}.md`;
  });
  const capturedCount = entries.filter((entry) => entry.kind === "illustration").length;
  const regularFileCount = 1 + readingCount + capturedCount;
  const directoryEntryCount = regularFileCount + 1;
  checkLimit(regularFileCount, policy.maxRegularFiles, "maxRegularFiles");
  checkLimit(directoryEntryCount, policy.maxDirectoryEntries, "maxDirectoryEntries");

  // Exact file contents. Data segments use the escape notation; bodies keep their bytes.
  const linkLine = (entry: ReadingEntry) => `- [${entry.label}](${entry.fileName})${entry.annotation}\n`;
  const readme =
    "# Reading order\n\n" +
    "This folder is a copy, not a backup or a live manuscript. Existing body links are not checked or rewritten. Image copies may contain metadata.\n\n" +
    "Headings and navigation use visible escapes for whitespace and controls. Manuscript bodies keep their captured text.\n\n" +
    (entries.length === 0 ? "No reading files.\n" : entries.map(linkLine).join(""));
  const contentsEntries = entries.filter((entry) => entry.kind === "chapter" || entry.kind === "back");
  const contents = `# Contents\n\n${contentsEntries.length === 0 ? "No entries.\n" : contentsEntries.map(linkLine).join("")}`;

  const textByEntry = new Map<ReadingEntry, string>();
  for (const entry of entries) {
    if (entry.kind === "title") {
      textByEntry.set(
        entry,
        `# ${encodeMarkdownFolderMetadata(displayBookTitle)}\n\n` +
          (projected.subtitle !== "" ? `${encodeMarkdownFolderMetadata(projected.subtitle)}\n\n` : "") +
          (projected.author !== "" ? `${encodeMarkdownFolderMetadata(projected.author)}\n\n` : "")
      );
    } else if (entry.kind === "contents") {
      textByEntry.set(entry, contents);
    } else if (entry.kind === "front" || entry.kind === "back") {
      const section = entry.section as MatterSection;
      textByEntry.set(
        entry,
        isBlank(section.title) ? section.text : `# ${encodeMarkdownFolderMetadata(section.title)}\n\n${section.text}`
      );
    } else if (entry.kind === "chapter") {
      const chapter = entry.chapter as PrivateChapter;
      const display = isBlank(chapter.title) ? `Chapter ${chapter.order}` : chapter.title;
      textByEntry.set(entry, `# ${encodeMarkdownFolderMetadata(display)}\n\n${chapter.parsedBody}`);
    } else {
      const format = entry.imageFormat as MarkdownFolderImageFormat;
      const ordinalText = String(entry.ordinal).padStart(width, "0");
      textByEntry.set(entry, `![${entry.label}](images/${ordinalText}.${format})\n`);
    }
  }

  const textFiles: Array<{ path: string; text: string }> = [
    { path: "README.md", text: readme },
    ...entries.map((entry) => ({ path: entry.fileName, text: textByEntry.get(entry) as string }))
  ];
  const generatedUtf8Bytes = textFiles.reduce((sum, file) => sum + markdownFolderUtf8ByteLength(file.text), 0);
  const totalOutputBytes = generatedUtf8Bytes + totalImageBytes;
  checkLimit(generatedUtf8Bytes, policy.maxGeneratedUtf8Bytes, "maxGeneratedUtf8Bytes");
  checkLimit(totalOutputBytes, policy.maxTotalOutputBytes, "maxTotalOutputBytes");

  // Accounted payload, and the fresh-plan guarantee: retrieving every file once must fit
  // under the retrieval and accounted limits at the same time, not merely under one.
  const retainedInputStringCharge = 2 * inputStringCodeUnits;
  const temporaryPayloadBytes = generatedUtf8Bytes;
  const accountedPayloadBytes = retainedInputStringCharge + totalImageBytes + totalOutputBytes + temporaryPayloadBytes;
  const accountedPayloadWithOneFullRetrievalBytes = accountedPayloadBytes + totalOutputBytes;
  checkLimit(regularFileCount, policy.maxRetrievalRequests, "maxRetrievalRequests");
  checkLimit(totalOutputBytes, policy.maxRetrievalBytes, "maxRetrievalBytes");
  checkLimit(accountedPayloadWithOneFullRetrievalBytes, policy.maxAccountedPayloadBytes, "maxAccountedPayloadBytes");

  // Materialize the private file bytes only after every pre-materialization count passes.
  const encoder = new TextEncoder();
  const bytesByPath = new Map<string, Uint8Array>();
  const files: MarkdownFolderPlannedFile[] = [];
  const addFile = (path: string, kind: MarkdownFolderFileKind, ordinal: number | null, bytes: Uint8Array) => {
    bytesByPath.set(path, bytes);
    files.push({ path, kind, ordinal, byteLength: bytes.byteLength });
  };
  addFile("README.md", "readme", null, encoder.encode(readme));
  for (const entry of entries) {
    addFile(entry.fileName, entry.kind, entry.ordinal, encoder.encode(textByEntry.get(entry) as string));
    if (entry.kind === "illustration" && entry.image) {
      const format = entry.imageFormat as MarkdownFolderImageFormat;
      const ordinalText = String(entry.ordinal).padStart(width, "0");
      // A second fixed private copy, so the plan shares no mutable alias with the bundle.
      addFile(`images/${ordinalText}.${format}`, "image", entry.ordinal, new Uint8Array(entry.image.bytes as Uint8Array));
    }
  }

  // Legacy exclusion (contract §5). The record itself is never converted or changed.
  const includedSectionTexts = new Set(allSections.map(({ section }) => section.text));
  const excludedLegacy: MarkdownFolderExcludedLegacy[] = [];
  snapshot.legacy.forEach((pair, index) => {
    const position = index + 1;
    if (pair.value === "") return;
    if (includedSectionTexts.has(pair.value)) return;
    // Classification is performed exactly as written: lowercase first, then remove
    // every character outside ASCII a-z. No other variant is substituted.
    const classified = pair.key.toLowerCase().replace(/[^a-z]/g, "");
    const role = classified === "author" || classified === "authorname" ? "author" : classified === "subtitle" ? "subtitle" : null;
    if (role !== null) {
      const projectedValue = role === "author" ? projected.author : projected.subtitle;
      if (!titlePage) {
        excludedLegacy.push({ position, ...safeLegacyKey(pair.key, position), reason: "title-page-off" });
        return;
      }
      if (projectedValue !== "" && pair.value.trim() === projectedValue) return;
      if (projectedValue === "") {
        excludedLegacy.push({ position, ...safeLegacyKey(pair.key, position), reason: "projected-value-not-emitted" });
        return;
      }
    }
    excludedLegacy.push({ position, ...safeLegacyKey(pair.key, position), reason: "not-represented" });
  });

  // Frozen warnings: list-level first, then omission warnings in chapter/position order.
  const warnings: MarkdownFolderWarning[] = snapshot.listWarnings.map((warning) => ({
    kind: "list" as const,
    code: warning.code,
    chapterId: null,
    selectedPosition: null,
    recordId: null
  }));
  for (const chapter of snapshot.chapters) {
    chapter.images.forEach((image, imageIndex) => {
      if (image.status !== "omitted") return;
      warnings.push({
        kind: "image-omission",
        code: image.code,
        chapterId: chapter.id,
        selectedPosition: imageIndex + 1,
        recordId: image.recordId
      });
    });
  }

  const plan: MarkdownFolderPlan = {
    bookId: snapshot.bookId,
    directories: ["images/"],
    readingOrder: entries.map((entry) => entry.fileName),
    files,
    warnings,
    excludedLegacy,
    accounting: {
      inputStringCodeUnits,
      inputStringUtf8Bytes,
      inputCollectionItems,
      largestImageBytes,
      totalImageBytes,
      generatedUtf8Bytes,
      totalOutputBytes,
      regularFileCount,
      directoryEntryCount,
      retainedInputStringCharge,
      temporaryPayloadBytes,
      accountedPayloadBytes,
      accountedPayloadWithOneFullRetrievalBytes
    }
  };
  freezeDeep(plan);
  planStates.set(plan, {
    policy: { ...policy },
    bytesByPath,
    accountedFresh: accountedPayloadBytes,
    requests: 0,
    retrievalBytes: 0
  });
  return plan;
}

/* ------------------------------------------------------------------ retrieval */

/**
 * Retrieve one named planned file as a fresh exact-size copy. Each retrieval checks the
 * remaining retrieval and accounted budgets before allocating, and charges the plan for
 * its lifetime, including repeats of the same file, with no refund for a claimed release.
 * Only exact planned regular-file names are accepted; no path is interpreted.
 */
export function retrieveMarkdownFolderFile(plan: unknown, path: unknown): MarkdownFolderRetrievalResult {
  try {
    if (plan === null || (typeof plan !== "object" && typeof plan !== "function")) {
      return refusalResult(new MarkdownFolderPlannerError("untrusted-plan"));
    }
    const state = planStates.get(plan as MarkdownFolderPlan);
    if (!state) return refusalResult(new MarkdownFolderPlannerError("untrusted-plan"));
    if (typeof path !== "string") return refusalResult(new MarkdownFolderPlannerError("unknown-file"));
    const bytes = state.bytesByPath.get(path);
    if (!bytes) return refusalResult(new MarkdownFolderPlannerError("unknown-file"));
    if (state.requests + 1 > state.policy.maxRetrievalRequests) {
      return refusalResult(new MarkdownFolderPlannerError("budget-exceeded", "maxRetrievalRequests"));
    }
    if (state.retrievalBytes + bytes.byteLength > state.policy.maxRetrievalBytes) {
      return refusalResult(new MarkdownFolderPlannerError("budget-exceeded", "maxRetrievalBytes"));
    }
    if (state.accountedFresh + state.retrievalBytes + bytes.byteLength > state.policy.maxAccountedPayloadBytes) {
      return refusalResult(new MarkdownFolderPlannerError("budget-exceeded", "maxAccountedPayloadBytes"));
    }
    state.requests += 1;
    state.retrievalBytes += bytes.byteLength;
    return { status: "retrieved", path, bytes: new Uint8Array(bytes) };
  } catch (error) {
    if (error instanceof MarkdownFolderPlannerError) return refusalResult(error);
    return refusalResult(new MarkdownFolderPlannerError("untrusted-plan"));
  }
}

/** The plan's cumulative retrieval charges so far, as a detached copy. */
export function markdownFolderRetrievalAccounting(plan: MarkdownFolderPlan): MarkdownFolderRetrievalAccounting {
  const state = planStates.get(plan);
  if (!state) throw new MarkdownFolderPlannerError("untrusted-plan");
  return freezeDeep({
    requests: state.requests,
    bytes: state.retrievalBytes,
    accountedPayloadBytes: state.accountedFresh + state.retrievalBytes
  });
}

