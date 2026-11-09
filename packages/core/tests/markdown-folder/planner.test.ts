import { describe, expect, test } from "bun:test";
import {
  createMarkdownFolderBundle,
  markdownFolderRetrievalAccounting,
  planMarkdownFolderExport,
  retrieveMarkdownFolderFile,
  type MarkdownFolderPolicy
} from "../../src/markdown-folder/planner";
import { encodeMarkdownFolderMetadata } from "../../src/markdown-folder/escape";

/*
 * Spec 035 T014-P / D-202: the pure Markdown folder planner. Synthetic fixtures only.
 * The planner owns no Library, host, IPC or interface behaviour.
 */

const GENEROUS: MarkdownFolderPolicy = {
  maxInputStringCodeUnits: Number.MAX_SAFE_INTEGER,
  maxInputStringUtf8Bytes: Number.MAX_SAFE_INTEGER,
  maxInputCollectionItems: Number.MAX_SAFE_INTEGER,
  maxPerImageBytes: Number.MAX_SAFE_INTEGER,
  maxTotalImageBytes: Number.MAX_SAFE_INTEGER,
  maxGeneratedUtf8Bytes: Number.MAX_SAFE_INTEGER,
  maxTotalOutputBytes: Number.MAX_SAFE_INTEGER,
  maxRegularFiles: Number.MAX_SAFE_INTEGER,
  maxDirectoryEntries: Number.MAX_SAFE_INTEGER,
  maxRetrievalRequests: Number.MAX_SAFE_INTEGER,
  maxRetrievalBytes: Number.MAX_SAFE_INTEGER,
  maxAccountedPayloadBytes: Number.MAX_SAFE_INTEGER
};

function policy(overrides: Partial<MarkdownFolderPolicy> = {}): MarkdownFolderPolicy {
  return { ...GENEROUS, ...overrides };
}

type AnyRecord = Record<string, unknown>;

function matter(overrides: AnyRecord = {}): AnyRecord {
  return {
    version: 1,
    titlePage: true,
    author: " Ana Reyes ",
    subtitle: " A tidewater tale ",
    sections: [
      { id: "mat_front001", kind: "dedication", position: "front", title: "Dedication", text: "For Ana.\n" },
      { id: "mat_back0001", kind: "about-the-author", position: "back", title: "", text: "About the author body." }
    ],
    ...overrides
  };
}

function bundleInput(overrides: AnyRecord = {}): AnyRecord {
  return {
    bookId: "book_plan001",
    bookTitle: "The Salt Road",
    description: "A crossing tale.",
    includeTableOfContents: true,
    matter: matter(),
    chapters: [
      {
        id: "ch_first001",
        title: "The Door",
        order: 2,
        parsedBody: "The door was shut.\n",
        images: [
          { status: "captured", recordId: "img_first001", format: "png", bytes: new Uint8Array([0x89, 0x50, 1]) },
          { status: "omitted", recordId: "img_miss0001", code: "image-missing" },
          { status: "captured", recordId: "img_second01", format: "jpg", bytes: new Uint8Array([0xff, 0xd8, 2, 3]) }
        ]
      },
      {
        id: "ch_second01",
        title: "",
        order: 5,
        parsedBody: "",
        images: [{ status: "captured", recordId: "img_third001", format: "webp", bytes: new Uint8Array([0x52, 0x49, 4]) }]
      }
    ],
    legacy: [] as unknown[],
    listWarnings: [] as unknown[],
    ...overrides
  };
}

function planned(overrides: AnyRecord = {}, policyOverrides: Partial<MarkdownFolderPolicy> = {}) {
  const result = planMarkdownFolderExport(createMarkdownFolderBundle(bundleInput(overrides)), policy(policyOverrides));
  if (result.status !== "planned") throw new Error(`Expected a plan, refused: ${result.code} ${result.dimension ?? ""}`);
  return result.plan;
}

function textOf(plan: ReturnType<typeof planned>, path: string): string {
  const got = retrieveMarkdownFolderFile(plan, path);
  if (got.status !== "retrieved") throw new Error(`Expected ${path}, refused: ${got.code}`);
  return new TextDecoder().decode(got.bytes);
}

function bytesOf(plan: ReturnType<typeof planned>, path: string): Uint8Array {
  const got = retrieveMarkdownFolderFile(plan, path);
  if (got.status !== "retrieved") throw new Error(`Expected ${path}, refused: ${got.code}`);
  return got.bytes;
}

describe("markdown folder planner inventory and exact bytes", () => {
  test("complete inventory, dense ordinals, image sidecars and reading order", () => {
    const plan = planned();
    expect(plan.directories).toEqual(["images/"]);
    expect(plan.readingOrder).toEqual([
      "0001-title.md",
      "0002-front.md",
      "0003-contents.md",
      "0004-chapter.md",
      "0005-illustration.md",
      "0006-illustration.md",
      "0007-chapter.md",
      "0008-illustration.md",
      "0009-back.md"
    ]);
    expect(plan.files.map((file) => file.path)).toEqual([
      "README.md",
      "0001-title.md",
      "0002-front.md",
      "0003-contents.md",
      "0004-chapter.md",
      "0005-illustration.md",
      "images/0005.png",
      "0006-illustration.md",
      "images/0006.jpg",
      "0007-chapter.md",
      "0008-illustration.md",
      "images/0008.webp",
      "0009-back.md"
    ]);
    expect(plan.accounting.regularFileCount).toBe(13);
    expect(plan.accounting.directoryEntryCount).toBe(14);
    // The surviving second illustration keeps selected-record position 3 in its label,
    // while its file ordinal stays dense (0006).
    expect(textOf(plan, "0006-illustration.md")).toBe(
      "![Illustration for Chapter 2: The Door (3)](images/0006.jpg)\n"
    );
    // Omitted image creates no file, and its warning names chapter and selected position.
    expect(plan.warnings).toEqual([
      {
        kind: "image-omission",
        code: "image-missing",
        chapterId: "ch_first001",
        selectedPosition: 2,
        recordId: "img_miss0001"
      }
    ]);
  });

  test("exact README, contents, title, chapter, matter and illustration bytes", () => {
    const plan = planned();
    expect(textOf(plan, "README.md")).toBe(
      "# Reading order\n\n" +
        "This folder is a copy, not a backup or a live manuscript. Existing body links are not checked or rewritten. Image copies may contain metadata.\n\n" +
        "Headings and navigation use visible escapes for whitespace and controls. Manuscript bodies keep their captured text.\n\n" +
        "- [Title page](0001-title.md)\n" +
        "- [Front matter 1: Dedication](0002-front.md)\n" +
        "- [Contents](0003-contents.md)\n" +
        "- [Chapter 2: The Door](0004-chapter.md)\n" +
        "- [Illustration for Chapter 2: The Door (1)](0005-illustration.md)\n" +
        "- [Illustration for Chapter 2: The Door (3)](0006-illustration.md)\n" +
        "- [Chapter 5](0007-chapter.md) — Saved title: (empty)\n" +
        "- [Illustration for Chapter 5 (1)](0008-illustration.md) — Saved title: (empty)\n" +
        "- [Back matter 1: About the author](0009-back.md) — Saved title: (empty)\n"
    );
    expect(textOf(plan, "0003-contents.md")).toBe(
      "# Contents\n\n" +
        "- [Chapter 2: The Door](0004-chapter.md)\n" +
        "- [Chapter 5](0007-chapter.md) — Saved title: (empty)\n" +
        "- [Back matter 1: About the author](0009-back.md) — Saved title: (empty)\n"
    );
    expect(textOf(plan, "0001-title.md")).toBe("# The Salt Road\n\nA tidewater tale\n\nAna Reyes\n\n");
    expect(textOf(plan, "0004-chapter.md")).toBe("# The Door\n\nThe door was shut.\n");
    expect(textOf(plan, "0002-front.md")).toBe("# Dedication\n\nFor Ana.\n");
    // Blank matter title: no kind heading is invented, only the exact body.
    expect(textOf(plan, "0009-back.md")).toBe("About the author body.");
    // Empty chapter body adds nothing after the heading separator.
    expect(textOf(plan, "0007-chapter.md")).toBe("# Chapter 5\n\n");
    expect(textOf(plan, "0005-illustration.md")).toBe(
      "![Illustration for Chapter 2: The Door (1)](images/0005.png)\n"
    );
    expect(bytesOf(plan, "images/0005.png")).toEqual(new Uint8Array([0x89, 0x50, 1]));
    expect(bytesOf(plan, "images/0006.jpg")).toEqual(new Uint8Array([0xff, 0xd8, 2, 3]));
  });

  test("parsed-body fidelity keeps CRLF, trailing spaces and a NUL byte, with nothing appended", () => {
    const body = "First\r\nSecond\u0000 tail  \nNo final newline";
    const plan = planned({
      chapters: [{ id: "ch_first001", title: "Exact", order: 1, parsedBody: body, images: [] }],
      includeTableOfContents: false
    });
    const bytes = bytesOf(plan, "0003-chapter.md");
    expect(new TextDecoder().decode(bytes)).toBe(`# Exact\n\n${body}`);
    expect(bytes).toContain(0);
    // Matter bodies are likewise exact.
    const matterPlan = planned({
      matter: matter({
        sections: [{ id: "mat_front001", kind: "other", position: "front", title: "Note", text: body }]
      }),
      chapters: []
    });
    expect(textOf(matterPlan, "0002-front.md")).toBe(`# Note\n\n${body}`);
  });

  test("metadata in headings and labels is encoded, bodies are not", () => {
    const plan = planned({
      chapters: [{ id: "ch_first001", title: "A #tag [x]", order: 1, parsedBody: "# not a heading\n", images: [] }],
      includeTableOfContents: false
    });
    const chapterFile = plan.readingOrder.find((name) => name.endsWith("-chapter.md")) ?? "";
    expect(textOf(plan, chapterFile)).toBe(`# ${encodeMarkdownFolderMetadata("A #tag [x]")}\n\n# not a heading\n`);
    expect(textOf(plan, "README.md")).toContain(encodeMarkdownFolderMetadata("A #tag [x]"));
  });

  test("empty states: no reading files, and a contents file with no entries", () => {
    const noFiles = planned({
      matter: matter({ titlePage: false, author: "", subtitle: "", sections: [] }),
      chapters: [],
      includeTableOfContents: false
    });
    expect(noFiles.readingOrder).toEqual([]);
    expect(textOf(noFiles, "README.md")).toEndWith("No reading files.\n");
    expect(noFiles.files.map((file) => file.path)).toEqual(["README.md"]);

    const contentsOnly = planned({
      matter: matter({ titlePage: false, author: "", subtitle: "", sections: [] }),
      chapters: [],
      includeTableOfContents: true
    });
    expect(contentsOnly.readingOrder).toEqual(["0001-contents.md"]);
    expect(textOf(contentsOnly, "0001-contents.md")).toBe("# Contents\n\nNo entries.\n");
  });

  test("title-page projection follows readMatter/matterPlan semantics", () => {
    // Absent matter: legacy plan, trimmed description as subtitle, no author.
    const legacy = planned({ matter: null, description: "  From description.  ", chapters: [] });
    expect(textOf(legacy, "0001-title.md")).toBe("# The Salt Road\n\nFrom description\\.\n\n");
    // Semantically empty matter is also the legacy plan.
    const empty = planned({
      matter: { version: 0, titlePage: true, author: " ", subtitle: "", sections: [] },
      description: "  From description.  ",
      chapters: []
    });
    expect(textOf(empty, "0001-title.md")).toBe("# The Salt Road\n\nFrom description\\.\n\n");
    // Title page off: no title file or title link is invented.
    const off = planned({ matter: matter({ titlePage: false }), chapters: [] });
    expect(off.readingOrder.some((name) => name.endsWith("-title.md"))).toBe(false);
    expect(textOf(off, "README.md")).not.toContain("Title page");
    // Unreadable required matter refuses.
    const refused = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({ matter: { sections: [{ id: "bad" }] } })),
      policy()
    );
    expect(refused).toMatchObject({ status: "refused", code: "unreadable-matter" });
  });

  test("captured order is kept with duplicate saved orders and duplicate titles", () => {
    const plan = planned({
      includeTableOfContents: false,
      chapters: [
        { id: "ch_first001", title: "Same", order: 2, parsedBody: "one", images: [] },
        { id: "ch_second01", title: "Same", order: 2, parsedBody: "two", images: [] }
      ]
    });
    const chapterFiles = plan.readingOrder.filter((name) => name.endsWith("-chapter.md"));
    expect(chapterFiles).toHaveLength(2);
    expect(textOf(plan, chapterFiles[0] ?? "")).toContain("one");
    expect(textOf(plan, chapterFiles[1] ?? "")).toContain("two");
    expect(textOf(plan, "README.md")).toContain("[Chapter 2: Same]");
  });
});

describe("markdown folder blank-title annotations", () => {
  test("empty and whitespace-only matter titles annotate outside the link", () => {
    const plan = planned({
      matter: matter({
        sections: [
          { id: "mat_front001", kind: "dedication", position: "front", title: "", text: "x" },
          { id: "mat_front002", kind: "epigraph", position: "front", title: " \t ", text: "y" }
        ]
      }),
      chapters: []
    });
    const readme = textOf(plan, "README.md");
    expect(readme).toContain("[Front matter 1: Dedication](0002-front.md) — Saved title: (empty)\n");
    expect(readme).toContain(
      `[Front matter 2: Epigraph](0003-front.md) — Saved title: ${encodeMarkdownFolderMetadata(" \t ")}\n`
    );
    // The whitespace-titled file has no invented heading either.
    expect(textOf(plan, "0003-front.md")).toBe("y");
  });

  test("blank book title displays as Untitled book and blank chapter as Chapter <saved-order>", () => {
    const plan = planned({
      bookTitle: "  ",
      chapters: [{ id: "ch_first001", title: " ", order: 7, parsedBody: "body", images: [] }]
    });
    expect(textOf(plan, "0001-title.md")).toStartWith("# Untitled book\n\n");
    expect(textOf(plan, "README.md")).toContain(
      `- [Title page](0001-title.md) — Saved title: ${encodeMarkdownFolderMetadata("  ")}\n`
    );
    const chapterFile = plan.readingOrder.find((name) => name.endsWith("-chapter.md")) ?? "";
    expect(textOf(plan, chapterFile)).toBe("# Chapter 7\n\nbody");
  });
});

describe("markdown folder legacy exclusion (D1)", () => {
  function legacyPlan(legacy: unknown[], overrides: AnyRecord = {}) {
    return planned({ legacy, ...overrides });
  }

  test("a value represented only by exact section body, for any key, including two keys sharing one body", () => {
    const plan = legacyPlan([
      { key: "anything", value: "For Ana.\n" },
      { key: "other-key", value: "For Ana.\n" },
      { key: "anything", value: "For Ana." }
    ]);
    // Only the third differs (missing final newline) and is excluded.
    expect(plan.excludedLegacy.map((entry) => entry.key)).toEqual(["anything"]);
    expect(plan.excludedLegacy[0]?.position).toBe(3);
  });

  test("paired D1 fixtures: Kelvin-sign author excluded, ordinary authorname represented, title-page-off excluded", () => {
    const kelvin = legacyPlan([{ key: "\u212Aauthor", value: "Ana Reyes" }]);
    expect(kelvin.excludedLegacy).toHaveLength(1);
    expect(kelvin.excludedLegacy[0]?.key).toBe("\u212Aauthor");

    const ordinary = legacyPlan([{ key: "authorname", value: "Ana Reyes" }]);
    expect(ordinary.excludedLegacy).toEqual([]);

    const off = legacyPlan([{ key: "authorname", value: "Ana Reyes" }], {
      matter: matter({ titlePage: false })
    });
    expect(off.excludedLegacy).toHaveLength(1);
    expect(off.excludedLegacy[0]?.reason).toBe("title-page-off");
  });

  test("subtitle classification, deliberate trim acknowledgment, whitespace and empty controls", () => {
    // Surrounding whitespace on the raw value is acknowledged against the trimmed projection.
    expect(legacyPlan([{ key: "Sub Title!", value: "  A tidewater tale  " }]).excludedLegacy).toEqual([]);
    // Whitespace-only values stay excluded unless a section body matches exactly.
    expect(legacyPlan([{ key: "notes", value: "   " }]).excludedLegacy).toHaveLength(1);
    const exactWhitespace = planned({
      matter: matter({
        sections: [{ id: "mat_front001", kind: "other", position: "front", title: "W", text: "   " }]
      }),
      legacy: [{ key: "notes", value: "   " }]
    });
    expect(exactWhitespace.excludedLegacy).toEqual([]);
    // Empty raw strings are ignored, and exclusion keeps capture order without values.
    const plan = legacyPlan([
      { key: "first", value: "unrepresented one" },
      { key: "empty", value: "" },
      { key: "second", value: "unrepresented two" }
    ]);
    expect(plan.excludedLegacy.map((entry) => [entry.position, entry.key])).toEqual([
      [1, "first"],
      [3, "second"]
    ]);
    expect(JSON.stringify(plan.excludedLegacy)).not.toContain("unrepresented");
  });

  test("a malformed key is identified by a bounded ordinal fallback", () => {
    const plan = legacyPlan([{ key: "bad\u0001key", value: "unrepresented" }]);
    expect(plan.excludedLegacy[0]?.key).toBe("legacy entry 1");
    expect(plan.excludedLegacy[0]?.keyIsFallback).toBe(true);
  });
});

describe("markdown folder budgets", () => {
  test("every dimension accepts its exact boundary and refuses one beyond it", () => {
    const base = planned();
    const acc = base.accounting;
    const dimensions: Array<[keyof MarkdownFolderPolicy, number]> = [
      ["maxInputStringCodeUnits", acc.inputStringCodeUnits],
      ["maxInputStringUtf8Bytes", acc.inputStringUtf8Bytes],
      ["maxInputCollectionItems", acc.inputCollectionItems],
      ["maxPerImageBytes", acc.largestImageBytes],
      ["maxTotalImageBytes", acc.totalImageBytes],
      ["maxGeneratedUtf8Bytes", acc.generatedUtf8Bytes],
      ["maxTotalOutputBytes", acc.totalOutputBytes],
      ["maxRegularFiles", acc.regularFileCount],
      ["maxDirectoryEntries", acc.directoryEntryCount],
      ["maxRetrievalRequests", acc.regularFileCount],
      ["maxRetrievalBytes", acc.totalOutputBytes],
      ["maxAccountedPayloadBytes", acc.accountedPayloadWithOneFullRetrievalBytes]
    ];
    for (const [dimension, exact] of dimensions) {
      const accepted = planMarkdownFolderExport(
        createMarkdownFolderBundle(bundleInput()),
        policy({ [dimension]: exact })
      );
      expect(accepted.status).toBe("planned");
      const refused = planMarkdownFolderExport(
        createMarkdownFolderBundle(bundleInput()),
        policy({ [dimension]: exact - 1 })
      );
      expect(refused).toMatchObject({ status: "refused", code: "budget-exceeded", dimension });
    }
  });

  test("policy maxima must be explicit finite nonnegative safe integers", () => {
    const bundle = createMarkdownFolderBundle(bundleInput());
    expect(planMarkdownFolderExport(bundle, policy({ maxRegularFiles: -1 }))).toMatchObject({
      status: "refused",
      code: "invalid-policy"
    });
    expect(planMarkdownFolderExport(bundle, policy({ maxRegularFiles: 1.5 }))).toMatchObject({
      status: "refused",
      code: "invalid-policy"
    });
    const missing = { ...GENEROUS } as AnyRecord;
    delete missing.maxRegularFiles;
    expect(planMarkdownFolderExport(bundle, missing as unknown as MarkdownFolderPolicy)).toMatchObject({
      status: "refused",
      code: "invalid-policy"
    });
  });

  test("a complete once-per-file retrieval fits under all budgets together, then repeats are charged", () => {
    const base = planned();
    const acc = base.accounting;
    const exactPolicy: Partial<MarkdownFolderPolicy> = {
      maxInputStringCodeUnits: acc.inputStringCodeUnits,
      maxInputStringUtf8Bytes: acc.inputStringUtf8Bytes,
      maxInputCollectionItems: acc.inputCollectionItems,
      maxPerImageBytes: acc.largestImageBytes,
      maxTotalImageBytes: acc.totalImageBytes,
      maxGeneratedUtf8Bytes: acc.generatedUtf8Bytes,
      maxTotalOutputBytes: acc.totalOutputBytes,
      maxRegularFiles: acc.regularFileCount,
      maxDirectoryEntries: acc.directoryEntryCount,
      maxRetrievalRequests: acc.regularFileCount,
      maxRetrievalBytes: acc.totalOutputBytes,
      maxAccountedPayloadBytes: acc.accountedPayloadWithOneFullRetrievalBytes
    };
    const plan = planned({}, exactPolicy);
    for (const file of plan.files) {
      expect(retrieveMarkdownFolderFile(plan, file.path).status).toBe("retrieved");
    }
    expect(markdownFolderRetrievalAccounting(plan)).toEqual({
      requests: acc.regularFileCount,
      bytes: acc.totalOutputBytes,
      accountedPayloadBytes: acc.accountedPayloadWithOneFullRetrievalBytes
    });
    // A repeat is a new charge, not a refund, so the next retrieval is refused.
    expect(retrieveMarkdownFolderFile(plan, "README.md")).toMatchObject({
      status: "refused",
      code: "budget-exceeded"
    });
  });

  test("retrieval charges repeats of the same file and rejects unknown names", () => {
    const plan = planned();
    expect(retrieveMarkdownFolderFile(plan, "README.md").status).toBe("retrieved");
    expect(retrieveMarkdownFolderFile(plan, "README.md").status).toBe("retrieved");
    const state = markdownFolderRetrievalAccounting(plan);
    expect(state.requests).toBe(2);
    expect(state.bytes).toBe(2 * (plan.files[0]?.byteLength ?? 0));
    expect(retrieveMarkdownFolderFile(plan, "../README.md")).toMatchObject({ status: "refused", code: "unknown-file" });
    expect(retrieveMarkdownFolderFile(plan, "images/")).toMatchObject({ status: "refused", code: "unknown-file" });
  });

  test("identical image bytes in distinct records are counted separately", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const input = bundleInput({
      chapters: [
        {
          id: "ch_first001",
          title: "One",
          order: 1,
          parsedBody: "",
          images: [
            { status: "captured", recordId: "img_first001", format: "png", bytes },
            { status: "captured", recordId: "img_second01", format: "png", bytes }
          ]
        }
      ]
    });
    const accepted = planMarkdownFolderExport(createMarkdownFolderBundle(input), policy({ maxTotalImageBytes: 6 }));
    expect(accepted.status).toBe("planned");
    const refused = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [
          {
            id: "ch_first001",
            title: "One",
            order: 1,
            parsedBody: "",
            images: [
              { status: "captured", recordId: "img_first001", format: "png", bytes: new Uint8Array([1, 2, 3]) },
              { status: "captured", recordId: "img_second01", format: "png", bytes: new Uint8Array([1, 2, 3]) }
            ]
          }
        ]
      })),
      policy({ maxTotalImageBytes: 5 })
    );
    expect(refused).toMatchObject({ status: "refused", dimension: "maxTotalImageBytes" });
  });
});

describe("markdown folder trust, unicode and mutation isolation", () => {
  test("unregistered bundle objects are refused without touching their properties", () => {
    let touched = 0;
    const wrapper = {};
    Object.defineProperty(wrapper, "bookId", {
      enumerable: true,
      get() {
        touched += 1;
        return "book_plan001";
      }
    });
    const result = planMarkdownFolderExport(wrapper as never, policy());
    expect(result).toMatchObject({ status: "refused", code: "untrusted-bundle" });
    expect(touched).toBe(0);
  });

  test("lone surrogates refuse only in emitted fields, with a bounded field reason", () => {
    const badTitle = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [{ id: "ch_first001", title: "Bad\ud800Title", order: 1, parsedBody: "", images: [] }]
      })),
      policy()
    );
    expect(badTitle).toMatchObject({ status: "refused", code: "invalid-unicode", field: "chapters[0].title" });
    // A legacy value is never emitted in a file, so its lone surrogate alone does not refuse.
    const legacyOnly = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({ legacy: [{ key: "notes", value: "bad\ud800value" }] })),
      policy()
    );
    expect(legacyOnly.status).toBe("planned");
    // With the title page off the book title is never emitted.
    const titleOff = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({ bookTitle: "Bad\ud800Book", matter: matter({ titlePage: false }) })),
      policy()
    );
    expect(titleOff.status).toBe("planned");
  });

  test("duplicate chapter and image identities refuse; duplicate titles do not", () => {
    const dupChapter = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [
          { id: "ch_first001", title: "A", order: 1, parsedBody: "", images: [] },
          { id: "ch_first001", title: "B", order: 2, parsedBody: "", images: [] }
        ]
      })),
      policy()
    );
    expect(dupChapter).toMatchObject({ status: "refused", code: "duplicate-chapter-id" });
    const dupImage = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [
          {
            id: "ch_first001",
            title: "A",
            order: 1,
            parsedBody: "",
            images: [
              { status: "captured", recordId: "img_first001", format: "png", bytes: new Uint8Array([1]) },
              { status: "captured", recordId: "img_first001", format: "png", bytes: new Uint8Array([2]) }
            ]
          }
        ]
      })),
      policy()
    );
    expect(dupImage).toMatchObject({ status: "refused", code: "duplicate-image-id" });
  });

  test("caller mutation after construction and output mutation after retrieval do not affect the plan", () => {
    const input = bundleInput();
    const bundle = createMarkdownFolderBundle(input);
    // Mutate every caller-owned container the construction was given.
    const chapters = input.chapters as AnyRecord[];
    const first = chapters[0] as AnyRecord;
    first.title = "Changed title";
    first.parsedBody = "changed body";
    const images = first.images as AnyRecord[];
    const captured = images[0] as AnyRecord;
    (captured.bytes as Uint8Array)[0] = 0x00;
    chapters.push({ id: "ch_extra001", title: "Extra", order: 9, parsedBody: "extra", images: [] });
    (input.matter as AnyRecord).author = "Changed Author";

    const planResult = planMarkdownFolderExport(bundle, policy());
    if (planResult.status !== "planned") throw new Error("Expected a plan");
    const plan = planResult.plan;
    expect(textOf(plan, "0004-chapter.md")).toBe("# The Door\n\nThe door was shut.\n");
    expect(textOf(plan, "0001-title.md")).toContain("Ana Reyes");
    expect(bytesOf(plan, "images/0005.png")).toEqual(new Uint8Array([0x89, 0x50, 1]));
    expect(plan.readingOrder).toHaveLength(9);

    const firstCopy = bytesOf(plan, "images/0005.png");
    firstCopy[0] = 0x00;
    expect(bytesOf(plan, "images/0005.png")).toEqual(new Uint8Array([0x89, 0x50, 1]));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.files)).toBe(true);
  });

  test("construction refuses accessor properties without invoking them", () => {
    let touched = 0;
    const input = bundleInput();
    const chapters = input.chapters as AnyRecord[];
    const first = { ...(chapters[0] as AnyRecord) };
    Object.defineProperty(first, "title", {
      enumerable: true,
      get() {
        touched += 1;
        return "x";
      }
    });
    chapters[0] = first;
    expect(() => createMarkdownFolderBundle(input)).toThrow();
    expect(touched).toBe(0);
  });

  test("shared or resizable image storage refuses at planning", () => {
    const shared = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [{
          id: "ch_first001",
          title: "One",
          order: 1,
          parsedBody: "",
          images: [{ status: "captured", recordId: "img_first001", format: "png", bytes: new Uint8Array(new SharedArrayBuffer(3)) }]
        }]
      })),
      policy()
    );
    expect(shared).toMatchObject({ status: "refused", code: "unsupported-image-storage" });
    const resizable = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [{
          id: "ch_first001",
          title: "One",
          order: 1,
          parsedBody: "",
          images: [{
            status: "captured",
            recordId: "img_first001",
            format: "png",
            bytes: new Uint8Array(new ArrayBuffer(3, { maxByteLength: 9 }))
          }]
        }]
      })),
      policy()
    );
    expect(resizable).toMatchObject({ status: "refused", code: "unsupported-image-storage" });
    const detachable = new ArrayBuffer(3);
    const detachedBytes = new Uint8Array(detachable);
    detachedBytes.set([1, 2, 3]);
    (detachable as unknown as { transfer: () => ArrayBuffer }).transfer();
    const detached = planMarkdownFolderExport(
      createMarkdownFolderBundle(bundleInput({
        chapters: [{
          id: "ch_first001",
          title: "One",
          order: 1,
          parsedBody: "",
          images: [{ status: "captured", recordId: "img_first001", format: "png", bytes: detachedBytes }]
        }]
      })),
      policy()
    );
    expect(detached).toMatchObject({ status: "refused", code: "unsupported-image-storage" });
  });

  test("planning is deterministic and accounting follows the declared envelope", () => {
    const bundle = createMarkdownFolderBundle(bundleInput({ legacy: [{ key: "notes", value: "left out" }] }));
    const first = planMarkdownFolderExport(bundle, policy());
    const second = planMarkdownFolderExport(bundle, policy());
    expect(first).toEqual(second);
    if (first.status !== "planned") throw new Error("Expected a plan");
    const acc = first.plan.accounting;
    expect(acc.retainedInputStringCharge).toBe(2 * acc.inputStringCodeUnits);
    expect(acc.temporaryPayloadBytes).toBe(acc.generatedUtf8Bytes);
    expect(acc.accountedPayloadBytes).toBe(
      acc.retainedInputStringCharge + acc.totalImageBytes + acc.totalOutputBytes + acc.temporaryPayloadBytes
    );
    expect(acc.accountedPayloadWithOneFullRetrievalBytes).toBe(acc.accountedPayloadBytes + acc.totalOutputBytes);
    const textBytes = first.plan.files
      .filter((file) => file.kind !== "image")
      .reduce((sum, file) => sum + file.byteLength, 0);
    expect(textBytes).toBe(acc.generatedUtf8Bytes);
    expect(first.plan.files.reduce((sum, file) => sum + file.byteLength, 0)).toBe(acc.totalOutputBytes);
  });

  test("list-level warnings stay first, then omission warnings in chapter and position order", () => {
    const plan = planned({ listWarnings: [{ code: "image-list-unreadable" }] });
    expect(plan.warnings.map((warning) => warning.code)).toEqual(["image-list-unreadable", "image-missing"]);
    expect(plan.warnings[0]).toMatchObject({ kind: "list", chapterId: null, selectedPosition: null });
  });
});
