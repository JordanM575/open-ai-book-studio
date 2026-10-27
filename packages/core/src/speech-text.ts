/**
 * Words for the voice, from Markdown.
 *
 * A speech engine reads every symbol it is given, so `**bold**` is heard as "asterisk asterisk" and a
 * link as its address. This keeps the words and drops the markup. It is a speech rule, not a Markdown
 * renderer: it never changes the stored text, and it handles the forms an author or the agent writes.
 */

/** Opening code fence, up to three spaces in, as CommonMark allows. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HORIZONTAL_RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])\s+/;
const TASK_BOX = /^\[[ xX]\]\s+/;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:\s*/;
const TABLE_DELIMITER = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const ENDS_A_SENTENCE = /[.!?…:;]["'”’)\]]*$/;

/** Markers for text held back from the inline rules. Private-use characters never occur in prose. */
const HOLD_OPEN = "";
const HOLD_CLOSE = "";

export function toSpeechText(markdown: string): string {
  const lines = withoutFrontMatter(markdown.replace(/\r\n?/g, "\n")).split("\n");
  const spoken: string[] = [];
  let closing: RegExp | null = null;

  for (const line of lines) {
    if (closing) {
      // Code is not read aloud, so the lines inside a fence are dropped whole.
      if (closing.test(line)) closing = null;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "";
      closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
      continue;
    }
    const said = speakLine(line);
    if (said !== null) spoken.push(said);
  }

  return spoken.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function withoutFrontMatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
}

/**
 * What one source line is said as. `""` is a pause between paragraphs, and `null` is a line that is
 * only markup, which is left out so that the rows of a table still read as one block.
 */
function speakLine(source: string): string | null {
  let line = source.trim();
  if (HORIZONTAL_RULE.test(line)) return "";
  if (FOOTNOTE_DEFINITION.test(line)) line = line.replace(FOOTNOTE_DEFINITION, "");

  while (line.startsWith(">")) line = line.replace(/^>\s?/, "").trim();

  const heading = HEADING.exec(line);
  if (heading) return sentence(inline(heading[1] ?? ""));

  line = line.replace(LIST_MARKER, "").replace(TASK_BOX, "");
  if (isTableRow(line)) return TABLE_DELIMITER.test(line) ? null : tableCells(line);
  return inline(line);
}

function isTableRow(line: string): boolean {
  return line.split("|").length >= 3;
}

function tableCells(line: string): string {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => inline(cell.trim()))
    .filter((cell) => cell.length > 0)
    .join(", ");
}

/** A heading is said as a sentence, so the voice pauses after it. */
function sentence(text: string): string {
  if (!text) return "";
  return ENDS_A_SENTENCE.test(text) ? text : `${text}.`;
}

function inline(text: string): string {
  const held: string[] = [];
  const hold = (value: string) => {
    held.push(value);
    return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
  };

  const withheld = text
    .replace(/`+([^`]+?)`+/g, (_, code: string) => hold(code))
    .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, char: string) => hold(char));

  const plain = withheld
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<(?:https?:\/\/|mailto:)[^>\s]+>/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\*\*\*(?=\S)([^*]*?\S)\*\*\*/g, "$1")
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, "$1")
    .replace(/(^|[^\w])__(?=\S)([^_]*?\S)__(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([^~]*?\S)~~/g, "$1")
    .replace(/(^|[^*\w])\*(?![\s*])([^*]*?[^\s*])\*(?![*\w])/g, "$1$2")
    .replace(/(^|[^\w])_(?![\s_])([^_]*?[^\s_])_(?!\w)/g, "$1$2");

  return plain
    .replace(new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g"), (_, index: string) => held[Number(index)] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
