import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  MAX_LOSS_PLACES,
  MAX_SOURCE_BYTES,
  type DocxRefusalReason,
  type ImportLossItem,
  type ImportLossKind,
  type ImportLossPlace,
  type ValidatedSource
} from "./index";

/**
 * Word (DOCX) manuscript intake (D-183; spec 029 T014).
 *
 * Pure and browser-safe, but imported only by the desktop main process, which runs
 * mammoth between the two halves here:
 *
 * 1. `openDocxPackage` sniffs the container (zip magic, `[Content_Types].xml` declaring
 *    the WordprocessingML main part, `word/document.xml`) and decompresses only the XML
 *    parts, within a stated cap. `mammothInput` re-packs those parts as a stored zip, so
 *    mammoth never inflates anything this module has not already bounded.
 * 2. `convertDocxHtml` turns mammoth's HTML into canonical Markdown text, proposes
 *    chapter boundaries at the top-level headings, and lists everything the chapter
 *    bodies cannot carry. `scanDocxPackage` finds what mammoth drops without a word:
 *    tracked changes, text boxes, fields, charts, equations, headers and footers.
 *
 * Nothing is inferred: each Word paragraph is one block, empty paragraphs stay blank
 * lines, and the text of every block is kept verbatim. Images are never read.
 */

/** XML parts may expand to at most ten times the source limit (50 MiB). */
export const MAX_DOCX_XML_BYTES = 10 * MAX_SOURCE_BYTES;

/** The most chapters one import may create; the IPC contract accepts no more. */
export const MAX_IMPORT_CHAPTERS = 200;

/**
 * Mammoth's style map for the intake. Title and quote styles gain structure, comment
 * references become visible so they can be located, and underline becomes visible so it
 * can be reported. Mammoth's own defaults cover headings, lists and emphasis.
 */
export const DOCX_STYLE_MAP: readonly string[] = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "comment-reference => sup",
  "u => u"
];

export interface DocxRefusal {
  status: "refused";
  reason: DocxRefusalReason;
  /** Actionable copy; never includes a host path. */
  message: string;
}

export interface DocxPackage {
  status: "ok";
  /** XML and relationship parts, decompressed within `MAX_DOCX_XML_BYTES`. Binary parts are never inflated. */
  parts: Record<string, Uint8Array>;
  /** Every entry name in the package, binaries included. */
  names: string[];
}

/** One item `scanDocxPackage` found in the package rather than in mammoth's HTML. */
export interface ScannedLoss {
  kind: ImportLossKind;
  place: ImportLossPlace;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const WORD_MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const WORD_MACRO_TYPE = "application/vnd.ms-word.document.macroenabled.main+xml";
const MAIN_PART = "word/document.xml";

const LOSS_ORDER: readonly ImportLossKind[] = [
  "table",
  "image",
  "footnote",
  "endnote",
  "comment",
  "tracked-insertion",
  "tracked-deletion",
  "text-box",
  "field",
  "chart",
  "equation",
  "header",
  "footer",
  "link",
  "underline",
  "strikethrough",
  "checkbox",
  "symbol",
  "other"
];

function refuse(reason: DocxRefusalReason, message: string): DocxRefusal {
  return { status: "refused", reason, message };
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);
}

/** True when `text` appears in the bytes as UTF-16LE, as stream names do in an OLE container. */
function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) needle[index * 2] = text.charCodeAt(index);
  outer: for (let start = 0; start + needle.length <= bytes.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function isXmlPart(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xml") || lower.endsWith(".rels");
}

function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    if (name) found[name] = match[2] ?? match[3] ?? "";
  }
  return found;
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (entity, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function xmlText(part: Uint8Array | undefined): string {
  return part ? strFromU8(part) : "";
}

/**
 * Open a picked `.docx` file. Refuses, with plain words, anything that is not a Word
 * document this importer can read: an encrypted or older Word file, a macro-enabled
 * document, an OpenDocument or other zip, a damaged zip, or a package that expands past
 * the stated cap. Only XML parts are decompressed; images and other binaries never are.
 */
export function openDocxPackage(fileName: string, bytes: Uint8Array): DocxPackage | DocxRefusal {
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    return refuse("too-large", `“${fileName}” is larger than the 5 MiB import limit. Choose a smaller file.`);
  }
  if (startsWith(bytes, CFB_MAGIC)) {
    return containsUtf16(bytes, "EncryptedPackage")
      ? refuse(
          "encrypted",
          `“${fileName}” is password-protected. Remove the password in Word, save the document and choose it again.`
        )
      : refuse(
          "not-docx",
          `“${fileName}” is an older Word (.doc) file. Save it as a Word document (.docx) and choose it again.`
        );
  }
  const notWord = refuse(
    "not-docx",
    `“${fileName}” is not a Word document. Choose a .docx file saved by Word or another word processor.`
  );
  if (!startsWith(bytes, ZIP_MAGIC)) return notWord;

  const names: string[] = [];
  let expanded = 0;
  let overCap = false;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        if (!isXmlPart(file.name) && file.name !== "mimetype") return false;
        expanded += file.originalSize;
        if (expanded > MAX_DOCX_XML_BYTES) overCap = true;
        return !overCap;
      }
    });
  } catch {
    return refuse(
      "corrupt",
      `“${fileName}” is damaged and cannot be read. Open it in Word, save a new copy and choose that.`
    );
  }
  if (overCap) {
    return refuse(
      "too-large",
      `“${fileName}” expands to more than the 50 MiB of document text the importer reads. Split the document and import each part.`
    );
  }
  const contentTypes = parts["[Content_Types].xml"];
  if (!contentTypes) {
    const mimetype = xmlText(parts.mimetype).trim();
    if (mimetype.startsWith("application/vnd.oasis.opendocument")) {
      return refuse(
        "not-docx",
        `“${fileName}” is an OpenDocument file, not a Word document. Save it as a Word document (.docx) and choose it again.`
      );
    }
    return notWord;
  }
  let mainType: string | null = null;
  for (const match of xmlText(contentTypes).matchAll(/<Override\b([^>]*?)\/?>/g)) {
    const override = attributes(match[1] ?? "");
    if ((override.PartName ?? "").toLowerCase() === `/${MAIN_PART}`) {
      mainType = (override.ContentType ?? "").toLowerCase();
    }
  }
  if (mainType === WORD_MACRO_TYPE || names.some((name) => name.toLowerCase() === "word/vbaproject.bin")) {
    return refuse(
      "macro-enabled",
      `“${fileName}” contains macros. Save a copy as a Word document (.docx) without macros and choose that.`
    );
  }
  if (mainType !== WORD_MAIN_TYPE || !parts[MAIN_PART]) return notWord;
  return { status: "ok", parts, names };
}

/**
 * Run wrappers mammoth does not recognise and would drop with their text: a simple field
 * (`PAGE`, `DATE` and the like, whose shown text is ordinary runs) and the bidirectional
 * `w:dir`/`w:bdo` containers. Mammoth's copy loses only the wrapper; the field itself is
 * still counted from the untouched part.
 */
const UNWRAPPED_FOR_MAMMOTH = ["w:fldSimple", "w:dir", "w:bdo"];

function unwrapForMammoth(xml: string): string {
  let out = xml;
  for (const name of UNWRAPPED_FOR_MAMMOTH) {
    out = out
      .replace(new RegExp(`<${name}(?=[\\s>/])[^>]*?/>`, "g"), "")
      .replace(new RegExp(`<${name}(?=[\\s>/])[^>]*>`, "g"), "")
      .replace(new RegExp(`</${name}>`, "g"), "");
  }
  return out;
}

/** The bounded XML parts re-packed without compression: the only bytes mammoth reads. */
export function mammothInput(pkg: DocxPackage): Uint8Array {
  const stored: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const [name, data] of Object.entries(pkg.parts)) {
    stored[name] = [name === MAIN_PART ? strToU8(unwrapForMammoth(strFromU8(data))) : data, { level: 0 }];
  }
  return zipSync(stored);
}

/** At most 60 characters of single-spaced text, for a loss report line. */
function excerpt(text: string): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

function runText(xml: string, tag: "w:t" | "w:delText" | "w:instrText" | "m:t"): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? "")).join("");
}

/** Visit each `<name …>` element: its index, opening tag and inner XML (null when self-closing). */
function eachElement(xml: string, name: string, visit: (index: number, open: string, inner: string | null) => void): void {
  const pattern = new RegExp(`<${name}(?=[\\s>/])[^>]*?(/?)>`, "g");
  for (const match of xml.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (match[1] === "/") {
      visit(index, match[0], null);
      continue;
    }
    const close = xml.indexOf(`</${name}>`, index);
    visit(index, match[0], close === -1 ? "" : xml.slice(index + match[0].length, close));
  }
}

/** Paragraph style ids mammoth's default style map turns into headings. */
function headingStyleIds(stylesXml: string): Set<string> {
  const ids = new Set<string>(["Heading", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"]);
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const style = attributes(match[1] ?? "");
    if (style["w:type"] !== "paragraph" || !style["w:styleId"]) continue;
    const name = /<w:name\b[^>]*w:val="([^"]*)"/.exec(match[2] ?? "")?.[1] ?? "";
    if (/^heading( [1-6])?$/i.test(name)) ids.add(style["w:styleId"]);
  }
  return ids;
}

/**
 * Find what mammoth drops or flattens without a message. Locations are the section, the
 * nearest Word heading before the item, because these items have no line in the HTML.
 * Content inside `mc:Choice` is skipped: mammoth reads only the `mc:Fallback` copy, so
 * counting both would double every text box.
 */
export function scanDocxPackage(pkg: DocxPackage): ScannedLoss[] {
  const found: ScannedLoss[] = [];
  const documentXml = xmlText(pkg.parts[MAIN_PART]).replace(/<mc:Choice\b[\s\S]*?<\/mc:Choice>/g, "");
  const headingIds = headingStyleIds(xmlText(pkg.parts["word/styles.xml"]));
  const headings: Array<{ index: number; text: string }> = [];
  for (const match of documentXml.matchAll(/<w:pStyle\b[^>]*?w:val="([^"]*)"[^>]*?\/?>/g)) {
    if (!headingIds.has(match[1] ?? "")) continue;
    const index = match.index ?? 0;
    const end = documentXml.indexOf("</w:p>", index);
    const text = excerpt(runText(documentXml.slice(index, end === -1 ? undefined : end), "w:t"));
    if (text) headings.push({ index, text });
  }
  const sectionAt = (index: number): string | null => {
    let section: string | null = null;
    for (const heading of headings) {
      if (heading.index > index) break;
      section = heading.text;
    }
    return section;
  };
  const add = (kind: ImportLossKind, index: number, detail: string | undefined): void => {
    found.push({ kind, place: { heading: sectionAt(index), ...(detail ? { detail } : {}) } });
  };

  for (const name of ["w:ins", "w:moveTo"]) {
    eachElement(documentXml, name, (index, _open, inner) => {
      add("tracked-insertion", index, inner === null ? undefined : excerpt(runText(inner, "w:t")));
    });
  }
  for (const name of ["w:del", "w:moveFrom"]) {
    eachElement(documentXml, name, (index, _open, inner) => {
      add(
        "tracked-deletion",
        index,
        inner === null ? undefined : excerpt(`${runText(inner, "w:delText")}${runText(inner, "w:t")}`)
      );
    });
  }
  eachElement(documentXml, "w:txbxContent", (index, _open, inner) => {
    add("text-box", index, excerpt(runText(inner ?? "", "w:t")));
  });
  const fieldCode = (instruction: string): string => instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  // A simple field reaches mammoth unwrapped, as plain runs, so a link or checkbox inside one is
  // reported here; mammoth itself turns the complex-field forms into a link and a checkbox.
  eachElement(documentXml, "w:fldSimple", (index, open) => {
    const instruction = decodeXml(attributes(open)["w:instr"] ?? "");
    const code = fieldCode(instruction);
    if (code === "HYPERLINK") {
      const target = /^\s*HYPERLINK\s+(?:\\l\s+)?(?:"([^"]*)"|(\S+))/i.exec(instruction);
      add("link", index, excerpt(target?.[1] ?? target?.[2] ?? ""));
    } else if (code === "FORMCHECKBOX") {
      add("checkbox", index, undefined);
    } else {
      add("field", index, code || undefined);
    }
  });
  for (const match of documentXml.matchAll(/<w:fldChar\b[^>]*?w:fldCharType="begin"[^>]*?\/?>/g)) {
    const index = match.index ?? 0;
    const rest = documentXml.slice(index + match[0].length);
    const stop = rest.search(/w:fldCharType="(?:separate|end)"/);
    const code = fieldCode(runText(stop === -1 ? rest : rest.slice(0, stop), "w:instrText"));
    if (code !== "HYPERLINK" && code !== "FORMCHECKBOX") add("field", index, code || undefined);
  }
  for (const name of ["c:chart", "dgm:relIds"]) {
    eachElement(documentXml, name, (index) => add("chart", index, undefined));
  }
  eachElement(documentXml, "m:oMath", (index, _open, inner) => {
    add("equation", index, excerpt(runText(inner ?? "", "m:t")));
  });

  for (const name of [...pkg.names].sort()) {
    const kind = /^word\/header\d*\.xml$/i.test(name) ? "header" : /^word\/footer\d*\.xml$/i.test(name) ? "footer" : null;
    if (!kind) continue;
    const xml = xmlText(pkg.parts[name]);
    const text = excerpt(runText(xml, "w:t"));
    if (text || /<w:fldSimple\b|<w:fldChar\b/.test(xml)) {
      found.push({ kind, place: text ? { detail: text } : {} });
    }
  }
  return found;
}

// ── Mammoth's HTML ───────────────────────────────────────────────────────────────────
//
// Mammoth writes a small, regular dialect: balanced tags, self-closing void elements,
// and text escaped as &amp; &lt; &gt; (attributes add &quot;). This reader handles
// exactly that and recovers from a stray close tag by unwinding to its opener.

type HtmlNode =
  | { type: "element"; tag: string; attrs: Record<string, string>; children: HtmlNode[] }
  | { type: "text"; value: string };
type HtmlElement = Extract<HtmlNode, { type: "element" }>;

const VOID_TAGS = new Set(["br", "img", "input", "hr"]);
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "table", "dl", "div", "hr"]);

function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1] ?? root;
  const addText = (raw: string): void => {
    if (raw === "") return;
    const value = decodeXml(raw).replace(/\r\n?/g, "\n");
    top().children.push({ type: "text", value });
  };
  let last = 0;
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    const index = match.index ?? 0;
    addText(html.slice(last, index));
    last = index + match[0].length;
    const tag = (match[2] ?? "").toLowerCase();
    if (match[1] === "/") {
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth]?.tag === tag) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const element: HtmlElement = { type: "element", tag, attrs: attributes(match[3] ?? ""), children: [] };
    top().children.push(element);
    if (match[4] !== "/" && !VOID_TAGS.has(tag)) stack.push(element);
  }
  addText(html.slice(last));
  return root.children;
}

function isElement(node: HtmlNode, ...tags: string[]): node is HtmlElement {
  return node.type === "element" && (tags.length === 0 || tags.includes(node.tag));
}

interface PendingLoss {
  kind: ImportLossKind;
  detail?: string | undefined;
  /** For a note or comment reference, the id of the body mammoth appended at the end. */
  target?: string;
}

const NOTE_ID = /^(footnote|endnote)-/;

/** Wrap emphasis markers around the words only; edge spaces stay outside, as Markdown requires. */
function emphasize(content: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  if (!match || match[2] === "") return content;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

/**
 * Render inline content. `plain` drops emphasis markers (titles and note excerpts);
 * `heading` turns line breaks into spaces, since a heading is one line.
 */
function renderInline(nodes: HtmlNode[], pending: PendingLoss[], options: { plain?: boolean; heading?: boolean } = {}): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += options.heading ? node.value.replace(/\n/g, " ") : node.value;
      continue;
    }
    const inner = (): string => renderInline(node.children, pending, options);
    switch (node.tag) {
      case "strong":
        out += options.plain ? inner() : emphasize(inner(), "**");
        break;
      case "em":
        out += options.plain ? inner() : emphasize(inner(), "*");
        break;
      case "u":
        pending.push({ kind: "underline" });
        out += inner();
        break;
      case "s":
        pending.push({ kind: "strikethrough" });
        out += inner();
        break;
      case "br":
        out += options.heading ? " " : "\n";
        break;
      case "img":
        pending.push({ kind: "image", detail: excerpt(node.attrs.alt ?? "") });
        break;
      case "input":
        pending.push({ kind: "checkbox" });
        break;
      case "a": {
        const href = node.attrs.href ?? "";
        const id = node.attrs.id ?? "";
        // The ↑ link mammoth adds inside an appended note or comment body.
        if (/^#(footnote|endnote|comment)-ref-/.test(href)) break;
        const reference = /^#(footnote|endnote|comment)-(.+)$/.exec(href);
        if (reference && id === `${reference[1]}-ref-${reference[2]}`) {
          pending.push({ kind: reference[1] as ImportLossKind, target: href.slice(1) });
          break;
        }
        if (href !== "") {
          pending.push({ kind: "link", detail: /^(https?|mailto):/i.test(href) ? excerpt(href) : undefined });
        }
        out += inner();
        break;
      }
      default:
        out += inner();
    }
  }
  return out;
}

class LossList {
  private readonly items = new Map<ImportLossKind, ImportLossItem>();

  add(kind: ImportLossKind, place: ImportLossPlace): void {
    let item = this.items.get(kind);
    if (!item) {
      item = { kind, count: 0, places: [] };
      this.items.set(kind, item);
    }
    item.count += 1;
    if (item.places.length < MAX_LOSS_PLACES) item.places.push(place);
  }

  list(): ImportLossItem[] {
    return LOSS_ORDER.flatMap((kind) => {
      const item = this.items.get(kind);
      return item ? [item] : [];
    });
  }
}

/**
 * Turn mammoth's HTML for one document into the text the preview splits, plus the
 * heading lines, the proposed chapter starts and the loss report.
 *
 * Mapping, block by block: a paragraph is one block whose line breaks stay line breaks;
 * `<strong>` and `<em>` become `**` and `*`; list items become `- ` or `1. ` lines,
 * nested by indentation; quote paragraphs become `> ` lines; a heading becomes a
 * `#` line; a table becomes one line per non-empty cell paragraph. Blocks are separated
 * by one blank line, and each empty Word paragraph adds one more, so the author's own
 * spacing (including a blank-line scene break) survives. Those document-made blank lines
 * are listed apart from the separators, so trimming a chapter's edges reports only them. A Title paragraph at the very
 * start becomes the proposed book title. Footnotes, endnotes and comments that mammoth
 * appends at the end are reported with their reference lines, never imported as text.
 */
export function convertDocxHtml(input: {
  fileName: string;
  html: string;
  messages: ReadonlyArray<{ type: string; message: string }>;
  scanned: readonly ScannedLoss[];
}): ValidatedSource | DocxRefusal {
  const nodes = parseHtml(input.html);
  const loss = new LossList();

  // Note and comment bodies come last in mammoth's HTML; read them first for excerpts.
  const bodies = new Map<string, string>();
  for (const node of nodes) {
    if (isElement(node, "ol")) {
      for (const item of node.children) {
        const id = isElement(item, "li") ? item.attrs.id : undefined;
        if (id && NOTE_ID.test(id) && item.type === "element") {
          bodies.set(id, excerpt(renderInline(item.children, [], { plain: true, heading: true })) ?? "");
        }
      }
    }
    if (isElement(node, "dl")) {
      let current: string | null = null;
      for (const item of node.children) {
        if (isElement(item, "dt")) current = item.attrs.id ?? null;
        if (isElement(item, "dd") && current) {
          bodies.set(current, excerpt(renderInline(item.children, [], { plain: true, heading: true })) ?? "");
        }
      }
    }
  }

  const lines: string[] = [];
  const blankLines: number[] = [];
  const headings: Array<{ line: number; level: number; text: string; title: boolean }> = [];
  let hasContent = false;
  let bookTitle: string | null = null;

  const assign = (pending: PendingLoss[], line: number): void => {
    for (const item of pending) {
      const detail = item.target !== undefined ? bodies.get(item.target) || undefined : item.detail;
      loss.add(item.kind, { line, ...(detail ? { detail } : {}) });
    }
  };
  const placeEmpty = (blockLines: string[], pending: PendingLoss[]): void => {
    const first = lines.length + 1;
    for (const line of blockLines) {
      lines.push(line);
      blankLines.push(lines.length);
    }
    assign(pending, first);
  };
  const placeContent = (blockLines: string[], pending: PendingLoss[]): number => {
    if (hasContent) lines.push("");
    const first = lines.length + 1;
    for (const line of blockLines) {
      lines.push(line);
      if (line.trim() === "") blankLines.push(lines.length);
    }
    hasContent = true;
    assign(pending, first);
    return first;
  };
  const placeParagraph = (children: HtmlNode[]): void => {
    const pending: PendingLoss[] = [];
    const text = renderInline(children, pending);
    if (text.trim() === "") placeEmpty(text.split("\n"), pending);
    else placeContent(text.split("\n"), pending);
  };

  const renderList = (list: HtmlElement, indent: string, pending: PendingLoss[], plain: boolean): string[] => {
    const out: string[] = [];
    let number = 0;
    for (const item of list.children) {
      if (!isElement(item, "li") || NOTE_ID.test(item.attrs.id ?? "")) continue;
      number += 1;
      const marker = plain ? "" : list.tag === "ol" ? `${number}. ` : "- ";
      const nested = item.children.filter((child): child is HtmlElement => isElement(child, "ul", "ol"));
      const own = item.children.filter((child) => !isElement(child, "ul", "ol"));
      const text = renderInline(own, pending);
      const [head = "", ...rest] = text.split("\n");
      if (!plain || head.trim() !== "") out.push(head === "" ? `${indent}${marker}`.trimEnd() : `${indent}${marker}${head}`);
      const hang = `${indent}${" ".repeat(marker.length)}`;
      for (const line of rest) out.push(line === "" ? line : `${hang}${line}`);
      for (const child of nested) out.push(...renderList(child, hang, pending, plain));
    }
    return out;
  };

  const renderQuote = (quote: HtmlElement, pending: PendingLoss[]): string[] => {
    const paragraphs: string[][] = [];
    let inline: HtmlNode[] = [];
    const flush = (): void => {
      if (inline.length > 0) paragraphs.push(renderInline(inline, pending).split("\n"));
      inline = [];
    };
    for (const child of quote.children) {
      if (child.type !== "element" || !["blockquote", "ul", "ol", "p"].includes(child.tag)) {
        inline.push(child);
        continue;
      }
      flush();
      if (child.tag === "blockquote") paragraphs.push(renderQuote(child, pending));
      else if (child.tag === "p") paragraphs.push(renderInline(child.children, pending).split("\n"));
      else paragraphs.push(renderList(child, "", pending, false));
    }
    flush();
    return paragraphs
      .flatMap((paragraph, index) => (index === 0 ? paragraph : ["", ...paragraph]))
      .map((line) => (line === "" ? ">" : `> ${line}`));
  };

  /** Cell text in document order, one line per non-empty cell paragraph. */
  const renderTable = (table: HtmlElement, pending: PendingLoss[]): string[] => {
    pending.push({ kind: "table" });
    const out: string[] = [];
    const walk = (children: HtmlNode[]): void => {
      let inline: HtmlNode[] = [];
      const flush = (): void => {
        for (const line of renderInline(inline, pending, {}).split("\n")) if (line.trim() !== "") out.push(line);
        inline = [];
      };
      for (const child of children) {
        if (child.type !== "element") {
          inline.push(child);
        } else if (child.tag === "table") {
          flush();
          out.push(...renderTable(child, pending));
        } else if (child.tag === "ul" || child.tag === "ol") {
          flush();
          out.push(...renderList(child, "", pending, true).filter((line) => line.trim() !== ""));
        } else if (["tr", "td", "th", "thead", "tbody", "blockquote", "div"].includes(child.tag)) {
          flush();
          walk(child.children);
        } else if (/^(p|h[1-6])$/.test(child.tag)) {
          flush();
          inline = child.children;
          flush();
        } else {
          inline.push(child);
        }
      }
      flush();
    };
    walk(table.children);
    return out;
  };

  const renderBlock = (node: HtmlElement): void => {
    const heading = /^h([1-6])$/.exec(node.tag);
    if (heading) {
      const pending: PendingLoss[] = [];
      const markdown = renderInline(node.children, pending, { heading: true }).trim();
      const text = renderInline(node.children, [], { plain: true, heading: true }).replace(/\s+/g, " ").trim();
      const isTitle = (node.attrs.class ?? "").split(/\s+/).includes("title");
      if (text === "") {
        placeEmpty([""], pending);
        return;
      }
      if (isTitle && !hasContent && bookTitle === null && pending.length === 0) {
        bookTitle = text;
        return;
      }
      const level = Number(heading[1]);
      const line = placeContent([`${"#".repeat(level)} ${markdown}`], pending);
      headings.push({ line, level, text, title: isTitle });
      return;
    }
    switch (node.tag) {
      case "p":
        placeParagraph(node.children);
        return;
      case "ul":
      case "ol": {
        if (node.children.every((child) => !isElement(child, "li") || NOTE_ID.test(child.attrs.id ?? ""))) return;
        const pending: PendingLoss[] = [];
        const listLines = renderList(node, "", pending, false);
        if (listLines.length > 0) placeContent(listLines, pending);
        else assign(pending, lines.length + 1);
        return;
      }
      case "blockquote": {
        const pending: PendingLoss[] = [];
        const quoteLines = renderQuote(node, pending);
        if (quoteLines.some((line) => line !== ">")) placeContent(quoteLines, pending);
        else placeEmpty([""], pending);
        return;
      }
      case "table": {
        const pending: PendingLoss[] = [];
        const tableLines = renderTable(node, pending);
        if (tableLines.length > 0) placeContent(tableLines, pending);
        else placeEmpty([""], pending);
        return;
      }
      case "dl":
      case "hr":
        return;
      default:
        renderBlocks(node.children);
    }
  };

  const renderBlocks = (children: HtmlNode[]): void => {
    let inline: HtmlNode[] = [];
    const flush = (): void => {
      if (inline.length === 0) return;
      const pending: PendingLoss[] = [];
      const text = renderInline(inline, pending);
      inline = [];
      if (text.trim() !== "") placeContent(text.split("\n"), pending);
      else if (pending.length > 0) assign(pending, lines.length + 1);
    };
    for (const node of children) {
      if (node.type === "element" && BLOCK_TAGS.has(node.tag)) {
        flush();
        renderBlock(node);
      } else {
        inline.push(node);
      }
    }
    flush();
  };

  renderBlocks(nodes);

  for (const message of input.messages) {
    const text = message.message;
    if (/^Unrecognised (paragraph|run|table) style/.test(text) || /unlikely to display in web browsers/.test(text)) continue;
    const element = /^An unrecognised element was ignored: (.+)$/.exec(text)?.[1];
    // Equations are counted from the package, one by one.
    if (element?.startsWith("m:")) continue;
    const detail = text.startsWith("A w:sym element") ? excerpt(text.replace(/^.*ignored: /, "")) : (element ?? excerpt(text));
    loss.add(text.startsWith("A w:sym element") ? "symbol" : "other", detail ? { detail } : {});
  }
  for (const item of input.scanned) loss.add(item.kind, item.place);

  const text = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  if (text.trim() === "") {
    return refuse("empty", `“${input.fileName}” has no readable text. Choose a document with manuscript content.`);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) {
    return refuse(
      "too-large",
      `“${input.fileName}” holds more than the 5 MiB of text one import accepts. Split the document and import each part.`
    );
  }

  // Chapters start at the top-level headings; a Title paragraph never starts one.
  const chapterHeadings = headings.filter((heading) => !heading.title);
  const top = Math.min(...chapterHeadings.map((heading) => heading.level));
  const firstContentLine = lines.findIndex((line) => line.trim() !== "") + 1;
  const proposedSplits = chapterHeadings
    .filter((heading) => heading.level === top && heading.line !== firstContentLine)
    .map((heading) => heading.line);
  if (proposedSplits.length + 1 > MAX_IMPORT_CHAPTERS) {
    return refuse(
      "too-many-chapters",
      `“${input.fileName}” has ${(proposedSplits.length + 1).toLocaleString("en-US")} chapters by its headings. One import creates at most ${MAX_IMPORT_CHAPTERS}; split the document and import each part.`
    );
  }

  const dot = input.fileName.lastIndexOf(".");
  return {
    status: "validated",
    fileName: input.fileName,
    proposedTitle: bookTitle ?? (dot === -1 ? input.fileName : input.fileName.slice(0, dot)),
    text,
    strippedBom: false,
    docx: {
      headings: headings.map(({ line, level, text: headingText }) => ({ line, level, text: headingText })),
      proposedSplits,
      blankLines,
      loss: loss.list()
    }
  };
}
