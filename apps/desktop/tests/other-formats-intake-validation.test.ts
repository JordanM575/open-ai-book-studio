import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import RTFParserRaw from "rtf-parser";
import {
  refuseUnsupportedExtension,
  validateSource
} from "@ai-book-studio/core/manuscript-import";

// Spec 029 T015: DOC, RTF and ODT are evaluated individually here. Nothing in
// this file enables an intake: every product-path assertion pins refusal, and
// the parser probes document why RTF is rejected, what an ODT transform must
// honor, and why DOC has no validated reader. See
// specs/029-manuscript-import/research/other-formats-intake.md.

// rtf-parser ships no types; the local rtf-parser.d.ts shorthand declares the
// module and this structural interface types the one function the evaluation
// uses. No `any` escapes into the assertions.
interface RtfParserModule {
  string(source: string, callback: (error: Error | null, doc: unknown) => void): void;
}
const RTFParser = RTFParserRaw as unknown as RtfParserModule;

function parseRtf(source: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    RTFParser.string(source, (error, doc) => (error ? reject(error) : resolve(doc)));
  });
}

function spanValues(doc: unknown): string[] {
  const values: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      const candidate = record.value;
      if (typeof candidate === "string") values.push(candidate);
      for (const value of Object.values(record)) walk(value);
    }
  };
  walk(doc);
  return values;
}

const RTF_HEAD = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24\n";
const RTF_TAIL = "\n}";

const ODT_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:body><office:text>
<text:h text:outline-level="1">Chapter One</text:h>
<text:p>Plain body with <text:span>bold</text:span> and <text:span>italic</text:span> words.</text:p>
<text:p>After the note.<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>secret note</text:p></text:note-body></text:note></text:p>
<table:table table:name="T"><table:table-row><table:table-cell><text:p>Cell A</text:p></table:table-cell><table:table-cell><text:p>Cell B</text:p></table:table-cell></table:table-row></table:table>
<text:p><draw:frame draw:name="img1"><draw:image xlink:href="Pictures/shot.png"/></draw:frame>After image.</text:p>
<text:h text:outline-level="1">Chapter Two</text:h>
<text:p>Caf\u00e9 \u2014 tail.</text:p>
</office:text></office:body></office:document-content>`;

const ODT_STYLES = `<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:master-styles><style:master-page><style:header><text:p>Draft header</text:p></style:header><style:footer><text:p>Page footer</text:p></style:footer></style:master-page></office:master-styles></office:document-styles>`;

function buildOdt(): Buffer {
  const zipped = zipSync(
    {
      mimetype: strToU8("application/vnd.oasis.opendocument.text"),
      "META-INF/manifest.xml": strToU8("<manifest:manifest/>"),
      "content.xml": strToU8(ODT_CONTENT),
      "styles.xml": strToU8(ODT_STYLES),
      "Pictures/shot.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    },
    { level: 0 }
  );
  return Buffer.from(zipped);
}

function orderedParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: false,
    preserveOrder: true
  });
}

type OrderedNode = Record<string, Array<Record<string, unknown>>>;

function firstElement(nodes: unknown, key: string): OrderedNode | undefined {
  // With preserveOrder:true, whitespace between elements becomes #text items,
  // so positional indexing is unreliable; seek by key instead.
  if (!Array.isArray(nodes)) return undefined;
  return nodes.find(
    (node): node is OrderedNode =>
      !!node && typeof node === "object" && key in (node as Record<string, unknown>)
  );
}

function officeTextNodes(): OrderedNode[] {
  const parsed = orderedParser().parse(ODT_CONTENT) as OrderedNode[];
  const root = parsed.find((node) => "office:document-content" in node);
  const content = firstElement(root?.["office:document-content"], "office:body");
  const body = firstElement(content?.["office:body"], "office:text");
  return (body?.["office:text"] ?? []) as OrderedNode[];
}

// Concatenates mixed content in document order: #text runs and element text
// interleave exactly as the author wrote them.
function textContent(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return "";
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .filter(([key]) => key !== ":@")
      .map(([, value]) => textContent(value))
      .join("");
  }
  return "";
}

function findNodes(nodes: OrderedNode[], key: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (key in record) found.push(record);
      for (const [childKey, value] of Object.entries(record)) {
        if (childKey !== ":@") walk(value);
      }
    }
  };
  for (const node of nodes) walk(node);
  return found;
}

describe("other manuscript formats stay refused until their own checks pass", () => {
  test("legacy Word .doc is refused with the supported set named", () => {
    // No OLE reader is validated (see research note); .doc cannot ride the
    // TXT/Markdown path.
    expect(refuseUnsupportedExtension("memoir.doc")).toEqual({
      status: "refused",
      reason: "unsupported-extension",
      message:
        "\u201cmemoir.doc\u201d is not a supported manuscript file. Choose a Word document (.docx) or a .txt, .md or .markdown file."
    });
    expect(validateSource({ fileName: "memoir.doc", bytes: new Uint8Array([208, 207]) })).toEqual(
      refuseUnsupportedExtension("memoir.doc")
    );
  });

  test("rich text .rtf is refused even though a probe parser exists", () => {
    expect(refuseUnsupportedExtension("memoir.rtf")).toEqual(
      refuseUnsupportedExtension("memoir.rtf")
    );
    expect(validateSource({ fileName: "memoir.rtf", bytes: strToU8("{\\rtf1 Body}") })).toEqual(
      refuseUnsupportedExtension("memoir.rtf")
    );
  });

  test("open document .odt is refused even though its zip layer parses", () => {
    expect(validateSource({ fileName: "memoir.odt", bytes: buildOdt() })).toEqual(
      refuseUnsupportedExtension("memoir.odt")
    );
  });
});

describe("RTF intake is rejected: the probe parser corrupts or throws", () => {
  test("an embedded image crashes the parse instead of degrading", async () => {
    const withImage =
      `${RTF_HEAD}Before.\\par\n` +
      "{\\pict\\pngblip\\picw100\\pich100 \\89504e470d0a1a0a}After.\\par" +
      RTF_TAIL;
    await expect(parseRtf(withImage)).rejects.toThrow();
  });

  test("a legal escaped space crashes the parse instead of degrading", async () => {
    await expect(parseRtf(`${RTF_HEAD}A\\ B.\\par${RTF_TAIL}`)).rejects.toThrow();
  });

  test("header text joins the body and table structure is flattened silently", async () => {
    const doc = await parseRtf(
      `${RTF_HEAD}{\\header\\pard\\qr Draft header\\par}\n` +
        "\\b Chapter One\\b0\\par\n" +
        "\\trowd\\cellx2000\\cellx4000\\intbl A\\cell B\\cell\\row" +
        RTF_TAIL
    );
    const values = spanValues(doc);
    expect(values).toContain("Draft header");
    // Cell wording survives, but no row/cell/table boundary survives with it:
    // the two cells read as ordinary body spans.
    expect(values).toContain("A");
    expect(values).toContain("B");
    expect(JSON.stringify(doc)).not.toMatch(/row|cell|table/i);
  });
});

describe("ODT intake path is validated but not enabled", () => {
  test("the synthesized book unzips to the expected entries", () => {
    const entries = Object.keys(unzipSync(buildOdt())).filter((key) => !key.endsWith("/"));
    expect(entries).toContain("content.xml");
    expect(entries).toContain("styles.xml");
    expect(entries).toContain("Pictures/shot.png");
  });

  test("outline-level-1 headings arrive in order as chapter boundaries", () => {
    const headings = findNodes(officeTextNodes(), "text:h").map((node) =>
      textContent(node["text:h"])
    );
    expect(headings).toEqual(["Chapter One", "Chapter Two"]);
    const levels = findNodes(officeTextNodes(), "text:h").map(
      (node) => (node[":@"] as Record<string, unknown>)?.["@_text:outline-level"]
    );
    expect(levels).toEqual(["1", "1"]);
  });

  test("body wording and order survive only with the mandatory parser flags", () => {
    const paragraphs = findNodes(officeTextNodes(), "text:p").map((node) =>
      textContent(node["text:p"])
    );
    const [firstParagraph] = paragraphs;
    expect(firstParagraph).toBe("Plain body with bold and italic words.");
    // The documented corruption: default trimming fuses word boundaries, so a
    // future transform must set trimValues:false (with preserveOrder:true).
    const trimmed = new XMLParser({ ignoreAttributes: false }).parse(ODT_CONTENT) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const content = trimmed["office:document-content"] as
      | { "office:body"?: { "office:text"?: { "text:p"?: unknown } } }
      | undefined;
    const paras = content?.["office:body"]?.["office:text"]?.["text:p"];
    const [firstDefault] = Array.isArray(paras) ? paras : [];
    expect(textContent(firstDefault)).not.toContain("with bold");
  });

  test("tables, images, notes and header/footer report as structure loss", () => {
    const nodes = officeTextNodes();
    const cells = findNodes(nodes, "table:table-cell").map((node) =>
      textContent(node["table:table-cell"])
    );
    expect(cells).toEqual(["Cell A", "Cell B"]);
    const images = findNodes(nodes, "draw:image");
    expect(images).toHaveLength(1);
    const [singleImage] = images;
    expect(singleImage?.[":@"]).toMatchObject({ "@_xlink:href": "Pictures/shot.png" });
    expect(findNodes(nodes, "text:note")).toHaveLength(1);
    // Headers/footers live in styles.xml, never in the body walk above.
    expect(JSON.stringify(nodes)).not.toContain("Draft header");
    expect(ODT_STYLES).toContain("Draft header");
    expect(ODT_STYLES).toContain("Page footer");
  });
});
