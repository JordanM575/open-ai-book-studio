import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  Packer,
  Paragraph,
  SimpleField,
  Table,
  TableCell,
  TableRow,
  Textbox,
  TextRun,
  WidthType
} from "docx";
import type { Paragraph as DocxParagraph, Table as DocxTable, Textbox as DocxTextbox } from "docx";
import { strToU8, unzipSync, zipSync } from "fflate";
import { LibraryService } from "@ai-book-studio/core/library/service";
import {
  describeLoss,
  importManuscriptInputSchema,
  previewImport,
  type ImportLossItem,
  type ValidatedSource
} from "@ai-book-studio/core/manuscript-import";
import { MAX_DOCX_XML_BYTES, openDocxPackage } from "@ai-book-studio/core/manuscript-import/docx";
import { readImportSource } from "../src/main/import";
import { readDocxSource } from "../src/main/docx-import";
import { createFileSystemEnvironment } from "../src/main/library/fs-port";
import { Library } from "../src/main/library/store";

/**
 * Word (DOCX) manuscript import, end to end in the main process (D-183, spec 029).
 *
 * Every document is synthesized here with the `docx` package — no real manuscript, no
 * network. The checks follow what the author meets: headings become chapters with their
 * titles, emphasis and lists become Markdown, everything the bodies cannot carry is in the
 * loss report with a count and a place, anything that is not a readable Word document is
 * refused in plain words, and publishing goes through the same staged atomic book write as
 * text imports.
 */

const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop() as string, { recursive: true, force: true });
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function pack(
  children: Array<DocxParagraph | DocxTable | DocxTextbox>,
  extras: { header?: string; footer?: string; footnote?: string; comment?: string } = {}
): Promise<Uint8Array> {
  const doc = new Document({
    styles: { paragraphStyles: [{ id: "Quote", name: "Quote", basedOn: "Normal", run: { italics: true } }] },
    numbering: {
      config: [
        {
          reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }]
        }
      ]
    },
    ...(extras.footnote ? { footnotes: { 1: { children: [new Paragraph(extras.footnote)] } } } : {}),
    ...(extras.comment
      ? {
          comments: {
            children: [
              { id: 0, author: "Reader", initials: "RD", date: new Date(0), children: [new Paragraph(extras.comment)] }
            ]
          }
        }
      : {}),
    sections: [
      {
        ...(extras.header ? { headers: { default: new Header({ children: [new Paragraph(extras.header)] }) } } : {}),
        ...(extras.footer ? { footers: { default: new Footer({ children: [new Paragraph(extras.footer)] }) } } : {}),
        children
      }
    ]
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function stageFile(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "studio-docx-"));
  cleanups.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

async function convert(name: string, bytes: Uint8Array): Promise<ValidatedSource> {
  const read = await readImportSource(await stageFile(name, bytes));
  if (read.status !== "ready") throw new Error(`expected a readable document, got ${read.reason}: ${read.message}`);
  return read.validation;
}

/** Chapters as the preview proposes them: split at the top-level headings. */
function proposed(source: ValidatedSource) {
  return previewImport(source, source.docx?.proposedSplits ?? []);
}

function lossOf(source: ValidatedSource, kind: ImportLossItem["kind"]): ImportLossItem | undefined {
  return source.docx?.loss.find((item) => item.kind === kind);
}

/** 1-based line of the converted text that equals `content`. */
function lineOf(source: ValidatedSource, content: string): number {
  const index = source.text.split("\n").indexOf(content);
  if (index === -1) throw new Error(`no line ${JSON.stringify(content)} in ${JSON.stringify(source.text)}`);
  return index + 1;
}

async function chaptersDocument(): Promise<Uint8Array> {
  return pack([
    new Paragraph({ text: "A Synthetic Voyage", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "Chapter One", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [new TextRun("Plain. "), new TextRun({ text: "Bold.", bold: true }), new TextRun({ text: " Italic.", italics: true })]
    }),
    new Paragraph({ children: [new TextRun("Line one"), new TextRun({ text: "Line two", break: 1 })] }),
    new Paragraph({ text: "Bullet A", bullet: { level: 0 } }),
    new Paragraph({ text: "Bullet B", bullet: { level: 1 } }),
    new Paragraph({ text: "Number A", numbering: { reference: "numbers", level: 0 } }),
    new Paragraph({ text: "Number B", numbering: { reference: "numbers", level: 0 } }),
    new Paragraph({ text: "Quoted words.", style: "Quote" }),
    new Paragraph({ text: "* * *", alignment: AlignmentType.CENTER }),
    new Paragraph({ text: "After the break." }),
    new Paragraph({ text: "Chapter Two", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: "Second body." }),
    new Paragraph({ text: "A smaller heading", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: "Still chapter two." })
  ]);
}

const CHAPTER_ONE_BODY = [
  "Plain. **Bold.** *Italic.*",
  "",
  "Line one",
  "Line two",
  "",
  "- Bullet A",
  "  - Bullet B",
  "",
  "1. Number A",
  "2. Number B",
  "",
  "> Quoted words.",
  "",
  "* * *",
  "",
  "After the break.",
  ""
].join("\n");

const CHAPTER_TWO_BODY = "Second body.\n\n## A smaller heading\n\nStill chapter two.\n";

async function lossesDocument(): Promise<Uint8Array> {
  return pack(
    [
      new Paragraph({ text: "Chapter One", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun("Noted"), new FootnoteReferenceRun(1), new TextRun(" here.")] }),
      new Paragraph({
        children: [
          new TextRun("Before the picture."),
          new ImageRun({
            type: "png",
            data: TINY_PNG,
            transformation: { width: 10, height: 10 },
            altText: { name: "dot", description: "A tiny dot", title: "dot" }
          })
        ]
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("north")] }),
              new TableCell({ children: [new Paragraph("south")] })
            ]
          })
        ]
      }),
      new Paragraph({
        children: [
          new CommentRangeStart(0),
          new TextRun("Commented words."),
          new CommentRangeEnd(0),
          new TextRun({ children: [new CommentReference(0)] })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun("Kept "),
          new InsertedTextRun({ text: "added", id: 1, author: "Reader", date: "2020-01-01T00:00:00Z" }),
          new DeletedTextRun({ text: "removed", id: 2, author: "Reader", date: "2020-01-01T00:00:00Z" })
        ]
      }),
      new Paragraph({ children: [new ExternalHyperlink({ link: "https://example.com/a", children: [new TextRun("a link")] })] }),
      new Paragraph({
        children: [new TextRun({ text: "under", underline: {} }), new TextRun(" and "), new TextRun({ text: "struck", strike: true })]
      }),
      new Paragraph({ children: [new TextRun("Page "), new SimpleField("PAGE", "7")] }),
      new Textbox({
        style: { width: "200pt", height: "50pt" },
        children: [new Paragraph("Boxed words.")]
      }),
      new Paragraph({ text: "Chapter Two", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "Second." })
    ],
    {
      header: "Running head",
      footer: "Page foot",
      footnote: "A footnote body.",
      comment: "A comment body."
    }
  );
}

describe("chapters and Markdown from a Word document", () => {
  test("each top-level heading starts a chapter titled by its text, and a Title paragraph names the book", async () => {
    const source = await convert("Voyage.docx", await chaptersDocument());
    expect(source.proposedTitle).toBe("A Synthetic Voyage");
    const preview = proposed(source);
    expect(preview.format).toBe("docx");
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(source.docx?.headings.map((heading) => [heading.level, heading.text])).toEqual([
      [1, "Chapter One"],
      [1, "Chapter Two"],
      [2, "A smaller heading"]
    ]);
  });

  test("emphasis, line breaks, lists, quotes and scene breaks become canonical Markdown", async () => {
    const preview = proposed(await convert("Voyage.docx", await chaptersDocument()));
    expect(preview.chapters[0]?.body).toBe(CHAPTER_ONE_BODY);
    expect(preview.chapters[1]?.body).toBe(CHAPTER_TWO_BODY);
    // The separators the conversion writes are not reported as removed blank lines.
    expect(preview.normalization.edgeBlankLines).toEqual([
      { order: 1, leadingRemoved: 0, trailingRemoved: 0 },
      { order: 2, leadingRemoved: 0, trailingRemoved: 0 }
    ]);
    expect(preview.loss).toEqual([]);
  });

  test("removing a proposed split returns that heading to the body, so no words are lost", async () => {
    const source = await convert("Voyage.docx", await chaptersDocument());
    const whole = previewImport(source, []);
    expect(whole.chapters).toHaveLength(1);
    expect(whole.chapters[0]?.title).toBe("Chapter One");
    expect(whole.chapters[0]?.body).toBe(`${CHAPTER_ONE_BODY}\n# Chapter Two\n\n${CHAPTER_TWO_BODY}`);
  });

  test("every nonblank line lands in exactly one body or is one chapter's title, for any splits", async () => {
    const source = await convert("Voyage.docx", await chaptersDocument());
    const lines = source.text.split("\n");
    const headingLines = new Set(source.docx?.headings.map((heading) => heading.line));
    for (const splits of [[], [12], [5, 20], [3, 9, 14, 24]]) {
      const preview = previewImport(source, splits);
      const seen: string[] = [];
      for (const chapter of preview.chapters) {
        const span = lines.slice(chapter.startLine - 1, chapter.endLine);
        const firstIndex = span.findIndex((line) => line.trim() !== "");
        if (firstIndex !== -1 && headingLines.has(chapter.startLine + firstIndex)) seen.push(span[firstIndex] ?? "");
        seen.push(...chapter.body.split("\n").filter((line) => line.trim() !== ""));
      }
      expect(seen).toEqual(lines.filter((line) => line.trim() !== ""));
    }
  });

  test("a document with no headings stays one chapter, the whole-file default", async () => {
    const source = await convert(
      "Notes.docx",
      await pack([new Paragraph("First paragraph."), new Paragraph(""), new Paragraph("Second paragraph.")])
    );
    expect(source.proposedTitle).toBe("Notes");
    expect(source.docx?.proposedSplits).toEqual([]);
    const preview = proposed(source);
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1"]);
    // An empty Word paragraph is the author's spacing and stays one extra blank line.
    expect(preview.chapters[0]?.body).toBe("First paragraph.\n\n\nSecond paragraph.\n");
  });

  test("an empty paragraph at a chapter edge is reported as a removed blank line", async () => {
    const source = await convert(
      "Edges.docx",
      await pack([
        new Paragraph({ text: "One", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("Body one."),
        new Paragraph(""),
        new Paragraph({ text: "Two", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("Body two.")
      ])
    );
    const preview = proposed(source);
    expect(preview.chapters.map((chapter) => chapter.body)).toEqual(["Body one.\n", "Body two.\n"]);
    expect(preview.normalization.edgeBlankLines).toEqual([
      { order: 1, leadingRemoved: 0, trailingRemoved: 1 },
      { order: 2, leadingRemoved: 0, trailingRemoved: 0 }
    ]);
  });
});

describe("the loss report", () => {
  test("a table, an image and a footnote are each listed with a count and a line", async () => {
    const source = await convert("Losses.docx", await lossesDocument());
    const table = lossOf(source, "table");
    const image = lossOf(source, "image");
    const footnote = lossOf(source, "footnote");
    expect(table).toEqual({ kind: "table", count: 1, places: [{ line: lineOf(source, "north") }] });
    expect(image).toEqual({ kind: "image", count: 1, places: [{ line: lineOf(source, "Before the picture."), detail: "A tiny dot" }] });
    expect(footnote).toEqual({
      kind: "footnote",
      count: 1,
      places: [{ line: lineOf(source, "Noted here."), detail: "A footnote body." }]
    });
    // Table text stays as plain lines in document order; the note and its mark do not leak in.
    expect(source.text).toContain("north\nsouth");
    expect(source.text).not.toContain("A footnote body.");
    expect(source.text).not.toContain("[1]");
  });

  test("comments, tracked changes, text boxes, fields, links, styling and page furniture are listed too", async () => {
    const source = await convert("Losses.docx", await lossesDocument());
    const kinds = source.docx?.loss.map((item) => item.kind);
    expect(kinds).toEqual([
      "table",
      "image",
      "footnote",
      "comment",
      "tracked-insertion",
      "tracked-deletion",
      "text-box",
      "field",
      "header",
      "footer",
      "link",
      "underline",
      "strikethrough"
    ]);
    expect(lossOf(source, "comment")?.places).toEqual([{ line: lineOf(source, "Commented words."), detail: "A comment body." }]);
    expect(lossOf(source, "tracked-insertion")?.places).toEqual([{ heading: "Chapter One", detail: "added" }]);
    expect(lossOf(source, "tracked-deletion")?.places).toEqual([{ heading: "Chapter One", detail: "removed" }]);
    expect(lossOf(source, "text-box")?.places).toEqual([{ heading: "Chapter One", detail: "Boxed words." }]);
    expect(lossOf(source, "field")?.places).toEqual([{ heading: "Chapter One", detail: "PAGE" }]);
    expect(lossOf(source, "header")?.places).toEqual([{ detail: "Running head" }]);
    expect(lossOf(source, "footer")?.places).toEqual([{ detail: "Page foot" }]);
    expect(lossOf(source, "link")?.places).toEqual([{ line: lineOf(source, "a link"), detail: "https://example.com/a" }]);
    // Accepted wording stays, deleted wording and comment marks do not; box text is kept as a paragraph.
    expect(source.text).toContain("Kept added");
    expect(source.text).not.toContain("removed");
    expect(source.text).not.toContain("[RD1]");
    expect(source.text).not.toContain("A comment body.");
    expect(source.text).toContain("Boxed words.");
    expect(source.text).toContain("Page 7");
    expect(source.text).not.toContain("Running head");
  });

  test("images are never embedded: no base64 or data URL reaches the text", async () => {
    const source = await convert("Losses.docx", await lossesDocument());
    expect(source.text).not.toContain("data:");
    expect(source.text).not.toContain("base64");
    expect(source.text).not.toContain(TINY_PNG.toString("base64").slice(0, 16));
  });

  test("the report reads in the author's words", () => {
    expect(describeLoss({ kind: "table", count: 2, places: [] })).toEqual({
      label: "2 tables",
      outcome: "Cell text kept as plain lines; the table layout was not."
    });
    expect(describeLoss({ kind: "footnote", count: 1, places: [] }).label).toBe("1 footnote");
  });

  test("a clean document has no loss report", async () => {
    const source = await convert("Voyage.docx", await chaptersDocument());
    expect(source.docx?.loss).toEqual([]);
  });
});

/** Rewrite one part of a zip, keeping every other entry. */
function withPart(bytes: Uint8Array, name: string, content: string | null): Uint8Array {
  const entries = unzipSync(bytes);
  if (content === null) delete entries[name];
  else entries[name] = strToU8(content);
  return zipSync(entries);
}

/** Set the declared uncompressed size of one entry in the central directory. */
function declareSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  const target = strToU8(name);
  for (let offset = 0; offset + 46 < copy.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const candidate = copy.subarray(offset + 46, offset + 46 + nameLength);
    if (candidate.length === target.length && candidate.every((byte, index) => byte === target[index])) {
      view.setUint32(offset + 24, size, true);
      return copy;
    }
  }
  throw new Error(`no central directory entry for ${name}`);
}

function utf16(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) out[index * 2] = text.charCodeAt(index);
  return out;
}

function oleContainer(streamName: string): Uint8Array {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const body = new Uint8Array(1024);
  body.set(magic, 0);
  body.set(utf16(streamName), 512);
  return body;
}

async function refusal(name: string, bytes: Uint8Array) {
  const read = await readImportSource(await stageFile(name, bytes));
  if (read.status !== "refused") throw new Error("expected a refusal");
  expect(read.message).toContain(`“${name}”`);
  expect(read.message).not.toContain(tmpdir());
  return read;
}

describe("refusing what is not a readable Word document", () => {
  test("a corrupt zip is refused as damaged", async () => {
    const whole = await chaptersDocument();
    const read = await refusal("Broken.docx", whole.subarray(0, Math.floor(whole.length / 2)));
    expect(read.reason).toBe("corrupt");
    expect(read.message).toBe(
      "“Broken.docx” is damaged and cannot be read. Open it in Word, save a new copy and choose that."
    );
  });

  test("a zip that is not Word is refused, naming an OpenDocument file when it is one", async () => {
    const plain = await refusal("Archive.docx", zipSync({ "notes.txt": strToU8("Not a manuscript.") }));
    expect(plain.reason).toBe("not-docx");
    expect(plain.message).toBe(
      "“Archive.docx” is not a Word document. Choose a .docx file saved by Word or another word processor."
    );
    const odt = await refusal(
      "Draft.docx",
      zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text"), "content.xml": strToU8("<office:document-content/>") })
    );
    expect(odt.reason).toBe("not-docx");
    expect(odt.message).toContain("is an OpenDocument file, not a Word document.");
  });

  test("a package without the Word main part or without word/document.xml is refused", async () => {
    const whole = await chaptersDocument();
    const template = withPart(
      whole,
      "[Content_Types].xml",
      new TextDecoder()
        .decode(unzipSync(whole)["[Content_Types].xml"])
        .replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")
    );
    expect((await refusal("Template.docx", template)).reason).toBe("not-docx");
    expect((await refusal("Hollow.docx", withPart(whole, "word/document.xml", null))).reason).toBe("not-docx");
  });

  test("a file over the 5 MiB limit is refused before it is read", async () => {
    let reads = 0;
    const read = await readImportSource("/Users/author/Big.docx", {
      stat: async () => ({ size: 5 * 1024 * 1024 + 1 }),
      readFile: async () => {
        reads += 1;
        return new Uint8Array();
      }
    });
    expect(read).toEqual({
      status: "refused",
      reason: "too-large",
      message: "“Big.docx” is larger than the 5 MiB import limit. Choose a smaller file."
    });
    expect(reads).toBe(0);
    expect(openDocxPackage("Big.docx", new Uint8Array(5 * 1024 * 1024 + 1))).toMatchObject({ reason: "too-large" });
  });

  test("a package whose XML would expand past the 50 MiB cap is refused without inflating it", async () => {
    const bomb = declareSize(await chaptersDocument(), "word/document.xml", MAX_DOCX_XML_BYTES + 1);
    const read = await refusal("Bomb.docx", bomb);
    expect(read.reason).toBe("too-large");
    expect(read.message).toContain("50 MiB");
  });

  test("password-protected, older Word and macro-enabled documents are refused plainly", async () => {
    const encrypted = await refusal("Locked.docx", oleContainer("EncryptedPackage"));
    expect(encrypted.reason).toBe("encrypted");
    expect(encrypted.message).toContain("is password-protected");
    const legacy = await refusal("Old.docx", oleContainer("WordDocument"));
    expect(legacy.reason).toBe("not-docx");
    expect(legacy.message).toContain("is an older Word (.doc) file");
    const whole = await chaptersDocument();
    const macros = withPart(whole, "word/vbaProject.bin", "binary macro project");
    const macro = await refusal("Macros.docx", macros);
    expect(macro.reason).toBe("macro-enabled");
    expect(macro.message).toContain("contains macros");
  });

  test("a document with no words is refused as empty", async () => {
    const read = await refusal("Blank.docx", await pack([new Paragraph(""), new Paragraph("")]));
    expect(read.reason).toBe("empty");
  });

  test("a style map embedded in the document never reaches mammoth", async () => {
    const whole = await chaptersDocument();
    // Mammoth reads this part to reshape a document; here it would drop every Normal paragraph.
    // Two guards keep it out: the stored re-pack carries only XML and relationship parts, so
    // this extensionless part is left behind, and the conversion turns embedded maps off.
    const rigged = withPart(whole, "mammoth/style-map", "p[style-name='Normal'] => !");
    const source = await readDocxSource("Rigged.docx", rigged);
    if (source.status !== "validated") throw new Error(source.message);
    expect(source.text).toContain("Second body.");
  });
});

describe("publishing a converted Word document", () => {
  async function openLibrary(): Promise<{ root: string; library: Library }> {
    const root = await mkdtemp(join(tmpdir(), "studio-docx-library-"));
    cleanups.push(root);
    return { root, library: await Library.open(root) };
  }

  function mapping(source: ValidatedSource) {
    const preview = proposed(source);
    return importManuscriptInputSchema.parse({
      bookTitle: preview.bookTitle,
      chapters: preview.chapters.map((chapter) => ({ title: chapter.title, content: chapter.body }))
    });
  }

  test("the exact previewed chapter bodies and titles are published, and the source is untouched", async () => {
    const bytes = await chaptersDocument();
    const path = await stageFile("Voyage.docx", bytes);
    const before = createHash("sha256").update(await readFile(path)).digest("hex");
    const read = await readImportSource(path);
    if (read.status !== "ready") throw new Error(read.message);
    const { library } = await openLibrary();

    const detail = await library.importManuscript(mapping(read.validation));

    expect(detail.book.title).toBe("A Synthetic Voyage");
    expect(detail.chapters.map((chapter) => [chapter.title, chapter.content])).toEqual([
      ["Chapter One", CHAPTER_ONE_BODY],
      ["Chapter Two", CHAPTER_TWO_BODY]
    ]);
    const reopened = await (await Library.open(library.root)).readBook(detail.book.id);
    expect(reopened.chapters.map((chapter) => chapter.content)).toEqual([CHAPTER_ONE_BODY, CHAPTER_TWO_BODY]);
    expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(before);
  });

  test("a failed publication leaves no partial book and cleans its staging area", async () => {
    const source = await convert("Voyage.docx", await chaptersDocument());
    const { root, library } = await openLibrary();
    const existing = await library.createBook({ title: "Already here" });
    const environment = createFileSystemEnvironment(root);
    const failing = new Proxy(environment.storage, {
      get(target, property, receiver) {
        if (property === "moveDirectory") {
          return async () => {
            throw new Error("The disk went away.");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const service = await LibraryService.open({ storage: failing, runtime: environment.runtime });

    await expect(service.importManuscript(mapping(source))).rejects.toThrow();

    const books = await (await Library.open(root)).listBooks();
    expect(books.map((book) => book.id)).toEqual([existing.id]);
    expect(await readdir(join(root, ".studio", "staging")).catch(() => [])).toEqual([]);
  });
});
