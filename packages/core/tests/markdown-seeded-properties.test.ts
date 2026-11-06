import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { parse as parseYaml } from "yaml";
import { chapterPath } from "../src/library/paths";
import { LibraryService } from "../src/library/service";
import {
  chapterFileName,
  FormatError,
  normalizeBody,
  parseChapterFile,
  serializeChapter,
  slugify
} from "../src/markdown";
import type { ChapterMeta } from "../src/schema";
import { InMemoryLibraryPort } from "./support/in-memory-port";

// Fixed seeds and case indexes are reported on failure, so every synthetic case is reproducible.
const SEEDS = [0x1a2b3c4d, 0x51a7e123, 0x9e3779b9, 0xc0ffee12];
const CASES_PER_SEED = 128;
const LINES = [
  "Synthetic prose.",
  "# Heading: punctuation # stays",
  "---",
  "```markdown",
  "  indented text  ",
  "\ttext with tabs\t",
  "café and cafe\u0301",
  "漢字 · العربية · שלום",
  "👩‍🚀 and 🧪",
  "line separator\u2028paragraph separator\u2029",
  "embedded\0character",
  "[link](../synthetic)  "
];
const META_TEXT = [
  "plain synthetic text",
  "colon: # comment?",
  "---",
  "null",
  "2026-01-02",
  "quotes ' \" and \\ slash",
  "  surrounding spaces  ",
  "first line\nsecond line",
  "tab\tand carriage\rreturn",
  "café / cafe\u0301 / 漢字 / 👩‍🚀",
  "control\0character"
];
const FALLBACK: ChapterMeta = {
  id: "ch_fallback123",
  title: "Fallback",
  order: 9999,
  arc: "end",
  purpose: "fallback purpose",
  synopsis: "fallback synopsis",
  notes: "fallback notes",
  isPrologue: false,
  color: null,
  version: 9999,
  createdAt: "2001-01-01T00:00:00.000Z",
  updatedAt: "2001-01-01T00:00:00.000Z"
};

function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[random() % items.length]!;
}

function context(seed: number, index: number): string {
  return `seed 0x${seed.toString(16)}, case ${index}`;
}

function bodyCase(random: () => number, index: number): {
  raw: string;
  expected: string;
  leadingBlankLines: number;
} {
  const lineEnding = ["\n", "\r\n", "\r"][index % 3]!;
  const leadingBlankLines = random() % 4;
  const trailingBlankLines = random() % 4;
  const lines = [LINES[index % LINES.length]!];
  for (let i = 0, count = random() % 6; i < count; i++) {
    lines.push(random() % 3 === 0 ? "" : pick(LINES, random));
  }
  lines.push(pick(LINES, random));
  return {
    raw: [
      ...Array<string>(leadingBlankLines).fill(""),
      ...lines,
      ...Array<string>(trailingBlankLines).fill("")
    ].join(lineEnding),
    // The generator builds logical lines first; this expected value does not call the formatter.
    expected: `${lines.join("\n")}\n`,
    leadingBlankLines
  };
}

function metadataCase(random: () => number, index: number): ChapterMeta {
  const text = () => `${pick(META_TEXT, random)} ${pick(META_TEXT, random)}`;
  return {
    id: `ch_fixture${index.toString().padStart(6, "0")}`,
    title: META_TEXT[index % META_TEXT.length]!,
    order: 1 + random() % 9999,
    arc: pick(["beginning", "middle", "end"] as const, random),
    purpose: text(),
    synopsis: text(),
    notes: text(),
    isPrologue: random() % 2 === 0,
    color: random() % 2 === 0 ? null : text(),
    version: random() % 1000,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-02-03T04:05:06.000Z",
    // Unknown JSON-compatible fields must survive older app versions.
    extraFixture: { text: text(), values: [null, true, random() % 100, text()] }
  };
}

describe("seeded Markdown and front-matter properties", () => {
  test("preserves trailing whitespace in the final YAML value (seed 0x51a7e123, case 0)", () => {
    for (const value of [
      "first line\nsecond line   surrounding spaces  ",
      "first line\nsecond line\n\n",
      "first line\nsecond line  \n\n",
      "first line\nsecond line\t"
    ]) {
      const meta = { ...FALLBACK, extraFixture: { values: [value] } };
      const serialized = serializeChapter(meta, "Synthetic body");
      const closing = serialized.indexOf("\n---\n", 4);
      assert.ok(closing >= 4);
      assert.deepStrictEqual(parseYaml(serialized.slice(4, closing + 1)), meta);
      assert.deepStrictEqual(parseChapterFile(serialized, "synthetic/regression.md", FALLBACK).meta, meta);
      const crlfHeader = serialized.slice(0, closing + "\n---\n".length).replace(/\n/g, "\r\n");
      const crlfFile = crlfHeader + serialized.slice(closing + "\n---\n".length);
      assert.deepStrictEqual(parseChapterFile(crlfFile, "synthetic/crlf.md", FALLBACK).meta, meta);
    }
  });

  test("saving prose preserves whitespace in unknown front matter", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "Synthetic book" });
    const chapter = await service.createChapter(book.id, { title: "Synthetic chapter" });
    const path = chapterPath(book.id, chapter.path);
    const original = await port.readFile(path);
    assert.ok(original);

    const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...meta } = chapter;
    const extraFixture = "first line\nsecond line  \n\n";
    const externalFile = `---\n${JSON.stringify({ ...meta, extraFixture })}\n---\nSynthetic body\n`;
    const injected = await port.commitFile(path, new TextEncoder().encode(externalFile), {
      kind: "sha256",
      value: original.sha256
    });
    assert.strictEqual(injected.status, "written");
    const opened = await service.readChapter(book.id, chapter.id);
    assert.strictEqual(opened.extraFixture, extraFixture);
    const saved = await service.saveChapter(book.id, chapter.id, "Synthetic revision", {
      baseVersion: opened.version,
      baseHash: opened.hash
    });
    assert.strictEqual(saved.status, "saved");
    const reopened = await service.readChapter(book.id, chapter.id);
    assert.strictEqual(reopened.content, "Synthetic revision\n");
    assert.strictEqual(reopened.extraFixture, extraFixture);
  });

  test("canonical bodies preserve generated interior lines and are idempotent", () => {
    for (const raw of ["", "\n", "\r", "\r\n", "\n\n", "\r\n\r\n"]) {
      assert.strictEqual(normalizeBody(raw), "");
      const serialized = serializeChapter(FALLBACK, raw);
      assert.ok(serialized.endsWith("\n---\n\n"));
      assert.strictEqual(parseChapterFile(serialized, "synthetic/empty.md", FALLBACK).content, "");
    }
    assert.strictEqual(normalizeBody("\r\n\nFirst  \rSecond\t\r\n\r\nThird\n\n"), "First  \nSecond\t\n\nThird\n");
    for (const seed of SEEDS) {
      const random = randomFrom(seed);
      for (let index = 0; index < CASES_PER_SEED; index++) {
        const body = bodyCase(random, index);
        const label = context(seed, index);
        assert.strictEqual(normalizeBody(body.raw), body.expected, label);
        assert.strictEqual(normalizeBody(body.expected), body.expected, label);
      }
    }
  });

  test("front matter and bodies round-trip independently constructed inputs", () => {
    for (const seed of SEEDS) {
      const random = randomFrom(seed);
      for (let index = 0; index < CASES_PER_SEED; index++) {
        const meta = metadataCase(random, index);
        const body = bodyCase(random, index);
        const label = context(seed, index);

        // JSON objects are valid YAML: this input does not use the studio serializer.
        const separator = index % 2 === 0 ? "\n" : "\r\n";
        const externalFile = `---${separator}${JSON.stringify(meta)}${separator}---${separator}${body.raw}`;
        const parsed = parseChapterFile(externalFile, "synthetic/external.md", FALLBACK);
        assert.strictEqual(parsed.hadFrontMatter, true, label);
        assert.deepStrictEqual(parsed.meta, meta, label);
        assert.strictEqual(parsed.content, body.expected, label);

        const serialized = serializeChapter(meta, body.raw);
        assert.ok(serialized.startsWith("---\n"), label);
        const closing = serialized.indexOf("\n---\n", 4);
        assert.ok(closing >= 4, label);
        assert.deepStrictEqual(parseYaml(serialized.slice(4, closing + 1)), meta, label);
        assert.strictEqual(serialized.slice(closing + "\n---\n".length), `\n${body.expected}`, label);
        const reparsed = parseChapterFile(serialized, "synthetic/saved.md", FALLBACK);
        assert.deepStrictEqual(reparsed.meta, meta, label);
        assert.strictEqual(reparsed.content, body.expected, label);
        assert.strictEqual(serializeChapter(reparsed.meta, reparsed.content), serialized, label);
      }
    }
  });

  test("plain generated prose uses fallback metadata without losing its interior", () => {
    for (const seed of SEEDS) {
      const random = randomFrom(seed);
      for (let index = 0; index < CASES_PER_SEED; index++) {
        const body = bodyCase(random, index);
        const parsed = parseChapterFile(`Synthetic introduction\n${body.raw}`, "synthetic/plain.md", FALLBACK);
        const label = context(seed, index);
        assert.strictEqual(parsed.hadFrontMatter, false, label);
        assert.deepStrictEqual(parsed.meta, FALLBACK, label);
        assert.strictEqual(
          parsed.content,
          `Synthetic introduction\n${"\n".repeat(body.leadingBlankLines)}${body.expected}`,
          label
        );
      }
    }
  });

  test("invalid front matter fails with its path and leaves later parses unaffected", () => {
    for (const seed of SEEDS) {
      const random = randomFrom(seed);
      for (let index = 0; index < CASES_PER_SEED; index++) {
        const meta = metadataCase(random, index);
        const body = bodyCase(random, index);
        const label = context(seed, index);
        const goodFile = `---\n${JSON.stringify(meta)}\n---\n${body.raw}`;
        const fallbackBefore = structuredClone(FALLBACK);
        const invalidFiles = [
          "---\ntitle: [unterminated\n---\nSynthetic body",
          `---\n${JSON.stringify({ ...meta, order: 0 })}\n---\nSynthetic body`,
          `---\n${JSON.stringify({ ...meta, id: "../invalid" })}\n---\nSynthetic body`
        ];
        for (const raw of invalidFiles) {
          assert.throws(
            () => parseChapterFile(raw, "synthetic/damaged.md", FALLBACK),
            (error: unknown) => error instanceof FormatError && error.path === "synthetic/damaged.md",
            label
          );
        }
        const parsed = parseChapterFile(goodFile, "synthetic/healthy.md", FALLBACK);
        assert.deepStrictEqual(parsed.meta, meta, label);
        assert.strictEqual(parsed.content, body.expected, label);
        assert.deepStrictEqual(FALLBACK, fallbackBefore, label);
      }
    }
  });
});

describe("seeded filename slug properties", () => {
  test("known Unicode and adversarial titles have safe readable slugs", () => {
    for (const [title, expected] of [
      ["Café", "cafe"],
      ["Cafe\u0301", "cafe"],
      ["Ｆｕｌｌｗｉｄｔｈ１２", "fullwidth12"],
      ["../../etc/passwd", "etc-passwd"],
      ["King's ‘door’", "kings-door"],
      ["漢字 👩‍🚀", "chapter"]
    ]) {
      assert.strictEqual(slugify(title!), expected);
    }
  });

  test("generated titles produce bounded stable slugs and safe chapter names", () => {
    const fragments = [
      ...META_TEXT, ...LINES, "../..\\escape", "CON", "NUL", "😀", "Ｆｕｌｌｗｉｄｔｈ", "-".repeat(100), "a".repeat(150)
    ];
    for (const seed of SEEDS) {
      const random = randomFrom(seed);
      for (let index = 0; index < CASES_PER_SEED; index++) {
        const title = `${fragments[index % fragments.length]} ${pick(fragments, random)} ${pick(fragments, random)}`;
        const label = context(seed, index);
        const slug = slugify(title);
        const limit = 7 + random() % 54;
        const limited = slugify(title, limit);
        for (const value of [slug, limited]) {
          assert.match(value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, label);
          assert.strictEqual(slugify(value), value, label);
        }
        assert.ok(slug.length <= 60, label);
        assert.ok(limited.length <= limit, label);
        assert.strictEqual(slugify(title.normalize("NFC")), slugify(title.normalize("NFD")), label);
        assert.strictEqual(slugify(title), slug, label);

        const order = 1 + random() % 9999;
        const filename = chapterFileName(order, title);
        assert.match(filename, /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/, label);
        assert.strictEqual(Number(filename.slice(0, 4)), order, label);
        assert.ok(filename.length <= 68, label);
      }
    }
  });
});
