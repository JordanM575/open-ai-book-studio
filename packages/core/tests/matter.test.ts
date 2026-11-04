import { describe, expect, test } from "bun:test";
import {
  MATTER_KINDS,
  MATTER_LIMITS,
  NO_MATTER,
  convertLegacyMatter,
  isEmptyMatter,
  kindLabel,
  kindPosition,
  matterHash,
  matterPlan,
  matterSchema,
  matterTemplate,
  newMatterSection,
  orderSections,
  pendingLegacyMatter,
  readMatter,
  sectionName,
  type BookMatter
} from "../src/matter";
import { LibraryService } from "../src/library/service";
import { LibraryError } from "../src/library/errors";
import { bookFilePath, conflictsPath } from "../src/library/paths";
import { bookSchema, type BookMeta } from "../src/schema";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/*
 * Spec 035 T007/T009/T010, D-169: the ordered `matter` value in book.json. Its schema and limits,
 * the tolerant read that never stops a book from opening, the export plan (where an absent or
 * empty value means the book exports exactly as it always has), the explicit conversion of the
 * older `frontMatter` record, and the checked save with its version, hash and conflict copy.
 */

const NOW = "2026-11-04T08:00:00.000Z";

function book(fields: Record<string, unknown> = {}): BookMeta {
  return bookSchema.parse({ id: "book_matter001", title: "The Salt Road", description: "A crossing.", createdAt: NOW, updatedAt: NOW, ...fields });
}

const DEDICATION = newMatterSection("dedication", "mat_dedic001", "For Ana.");
const ABOUT = newMatterSection("about-the-author", "mat_about001", "Ana lives by the sea.");
const COPYRIGHT = newMatterSection("copyright", "mat_copyr001", matterTemplate("copyright", "Ana Reyes", 2026));

const MATTER: BookMatter = matterSchema.parse({
  version: 2,
  titlePage: true,
  author: "Ana Reyes",
  subtitle: "A tidewater tale",
  sections: [ABOUT, COPYRIGHT, DEDICATION]
});

describe("matter schema", () => {
  test("round-trips through JSON with its order and unknown fields intact", () => {
    const withExtra = { ...MATTER, futureField: { kept: true }, sections: [{ ...DEDICATION, style: "small caps" }] };
    const once = matterSchema.parse(JSON.parse(JSON.stringify(withExtra)));
    const twice = matterSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(once.futureField).toEqual({ kept: true });
    expect(once.sections[0]?.style).toBe("small caps");
  });

  test("fills defaults so a hand-written value reads", () => {
    const parsed = matterSchema.parse({ sections: [{ id: "mat_hand0001", kind: "epigraph", position: "front" }] });
    expect(parsed).toMatchObject({ version: 0, titlePage: true, author: "", subtitle: "" });
    expect(parsed.sections[0]).toMatchObject({ title: "", text: "" });
  });

  test("refuses bad ids, kinds, positions, sizes and repeated ids", () => {
    const section = { id: "mat_good0001", kind: "dedication", position: "front", title: "", text: "" };
    const bad: unknown[] = [
      { sections: [{ ...section, id: "ch_good0001" }] },
      { sections: [{ ...section, id: "mat_x" }] },
      { sections: [{ ...section, kind: "foreword" }] },
      { sections: [{ ...section, position: "middle" }] },
      { sections: [{ ...section, title: "x".repeat(MATTER_LIMITS.title + 1) }] },
      { sections: [{ ...section, text: "x".repeat(MATTER_LIMITS.text + 1) }] },
      { author: "x".repeat(MATTER_LIMITS.name + 1) },
      { sections: Array.from({ length: MATTER_LIMITS.sections + 1 }, (_, index) => ({ ...section, id: `mat_many${String(index).padStart(4, "0")}` })) },
      { sections: [section, { ...section }] },
      { version: -1 }
    ];
    for (const value of bad) expect(matterSchema.safeParse(value).success).toBe(false);
    expect(matterSchema.safeParse({ sections: [section] }).success).toBe(true);
  });
});

describe("reading matter", () => {
  test("an older book has none, and its record is not read as matter", () => {
    const old = book({ frontMatter: { dedication: "For those who wait." } });
    expect(old.matter).toBeUndefined();
    expect(readMatter(old)).toEqual({ matter: null, issue: null });
    expect(readMatter(book({ matter: null }))).toEqual({ matter: null, issue: null });
  });

  test("a value the schema cannot read is reported, and the book still parses", () => {
    const broken = book({ matter: { sections: [{ id: "mat_bad00001", kind: "foreword", position: "front" }] } });
    const read = readMatter(broken);
    expect(read.matter).toBeNull();
    expect(read.issue).toContain("sections.0.kind");
    expect(readMatter(book({ matter: "nonsense" })).issue).toMatch(/^matter: /);
  });
});

describe("the export plan", () => {
  test("no matter keeps the original title page and adds nothing", () => {
    expect(matterPlan(book(), null)).toEqual({ titlePage: true, subtitle: "A crossing.", author: "", front: [], back: [], present: false });
  });

  test("empty matter exports exactly as no matter", () => {
    expect(isEmptyMatter(NO_MATTER)).toBe(true);
    expect(matterPlan(book(), { ...NO_MATTER, version: 4 })).toEqual(matterPlan(book(), null));
    expect(isEmptyMatter({ ...NO_MATTER, titlePage: false })).toBe(false);
    expect(isEmptyMatter({ ...NO_MATTER, author: " A " })).toBe(false);
    expect(isEmptyMatter({ ...NO_MATTER, subtitle: "S" })).toBe(false);
    expect(isEmptyMatter({ ...NO_MATTER, sections: [DEDICATION] })).toBe(false);
  });

  test("matter puts its title page, front and back sections in the author's order", () => {
    const plan = matterPlan(book(), MATTER);
    expect(plan).toMatchObject({ titlePage: true, subtitle: "A tidewater tale", author: "Ana Reyes", present: true });
    expect(plan.front.map((section) => section.id)).toEqual(["mat_copyr001", "mat_dedic001"]);
    expect(plan.back.map((section) => section.id)).toEqual(["mat_about001"]);
    expect(matterPlan(book(), { ...MATTER, titlePage: false }).titlePage).toBe(false);
  });

  test("sections are named by their heading or their kind", () => {
    expect(sectionName(DEDICATION)).toBe("Dedication");
    expect(sectionName(ABOUT)).toBe("About the author");
    expect(sectionName({ ...ABOUT, title: "  The author  " })).toBe("The author");
  });

  test("new sections start in their kind's place with editable starting text", () => {
    expect(MATTER_KINDS.map(kindLabel)).toEqual(["Copyright", "Disclaimer", "Dedication", "Epigraph", "Acknowledgements", "About the author", "Other page"]);
    expect(MATTER_KINDS.filter((kind) => kindPosition(kind) === "back")).toEqual(["acknowledgements", "about-the-author"]);
    for (const kind of MATTER_KINDS) {
      const section = newMatterSection(kind, "mat_kind0001");
      expect(section.position).toBe(kindPosition(kind));
      expect(section.title).toBe(section.position === "back" ? kindLabel(kind) : "");
    }
    expect(matterTemplate("copyright", " Ana Reyes ", 2026)).toBe("Copyright © 2026 Ana Reyes\nAll rights reserved.");
    expect(matterTemplate("copyright", "", 2027)).toBe("Copyright © 2027\nAll rights reserved.");
    expect(matterTemplate("disclaimer", "", 2026)).toContain("work of fiction");
    expect(matterTemplate("dedication", "Ana", 2026)).toBe("");
    for (const kind of MATTER_KINDS) expect(matterTemplate(kind, "Ana", 2026)).not.toMatch(/legal advice|guarantee|KDP|Kindle/i);
  });

  test("sections are written front first, then back, each in order", () => {
    expect(orderSections([ABOUT, COPYRIGHT, DEDICATION]).map((section) => section.id)).toEqual(["mat_copyr001", "mat_dedic001", "mat_about001"]);
  });
});

describe("converting the older front matter record", () => {
  let next = 0;
  const id = (): string => {
    next += 1;
    return `mat_conv${String(next).padStart(4, "0")}`;
  };
  const RECORD = {
    subtitle: "A tidewater tale",
    author: "Ana Reyes",
    dedication: "For those who wait.",
    disclaimer: "Any resemblance is coincidental.",
    aboutAuthor: "Ana lives by the sea.",
    "Acknowledgments": "Thanks to the keepers.",
    colophon: "Set in Garamond.",
    epigraph: "   "
  };

  test("lists what no export includes, in record order, with where each would go", () => {
    expect(pendingLegacyMatter(RECORD, null)).toEqual([
      { key: "subtitle", target: "subtitle" },
      { key: "author", target: "author" },
      { key: "dedication", target: "dedication" },
      { key: "disclaimer", target: "disclaimer" },
      { key: "aboutAuthor", target: "about-the-author" },
      { key: "Acknowledgments", target: "acknowledgements" },
      { key: "colophon", target: null }
    ]);
    expect(pendingLegacyMatter({}, null)).toEqual([]);
  });

  test("places every known entry once, keeps the unknown ones out, and leaves the record alone", () => {
    const before = JSON.stringify(RECORD);
    const converted = convertLegacyMatter(RECORD, null, id);
    expect(JSON.stringify(RECORD)).toBe(before);
    expect(converted).toMatchObject({ titlePage: true, author: "Ana Reyes", subtitle: "A tidewater tale" });
    expect(converted.sections.map((section) => [section.kind, section.position, section.text])).toEqual([
      ["dedication", "front", "For those who wait."],
      ["disclaimer", "front", "Any resemblance is coincidental."],
      ["about-the-author", "back", "Ana lives by the sea."],
      ["acknowledgements", "back", "Thanks to the keepers."]
    ]);
    expect(pendingLegacyMatter(RECORD, converted)).toEqual([{ key: "colophon", target: null }]);
  });

  test("converting twice adds nothing twice", () => {
    const once = convertLegacyMatter(RECORD, null, id);
    const twice = convertLegacyMatter(RECORD, once, id);
    expect(twice.sections).toEqual(once.sections);
  });

  test("an author or subtitle already set is not overwritten, and two keys of one kind both survive", () => {
    const existing: BookMatter = { ...NO_MATTER, author: "A. Reyes", sections: [DEDICATION] };
    const converted = convertLegacyMatter(
      { author: "Ana Reyes", acknowledgements: "Thanks.", acknowledgments: "More thanks.", dedication: "For Ana." },
      existing,
      id
    );
    expect(converted.author).toBe("A. Reyes");
    expect(converted.sections.map((section) => section.text)).toEqual(["For Ana.", "Thanks.", "More thanks."]);
    // Listed, but not placed, so nothing promises a change the conversion will not make.
    expect(pendingLegacyMatter({ author: "Ana Reyes" }, converted)).toEqual([{ key: "author", target: null }]);
    expect(convertLegacyMatter({ author: "Ana Reyes" }, converted, id)).toEqual(converted);
  });
});

describe("the matter hash", () => {
  test("is the same for the same matter however it was parsed, and differs for any change", async () => {
    const reparsed = readMatter(book({ matter: JSON.parse(JSON.stringify(MATTER)) })).matter;
    expect(await matterHash(reparsed)).toBe(await matterHash(MATTER));
    expect(await matterHash(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(await matterHash({ ...MATTER, version: 3 })).not.toBe(await matterHash(MATTER));
    expect(await matterHash(null)).not.toBe(await matterHash(NO_MATTER));
  });
});

describe("saving matter through the library", () => {
  async function setup(raw: Record<string, unknown> = {}) {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const created = await service.createBook({ title: "The Salt Road", description: "A crossing." });
    if (Object.keys(raw).length > 0) {
      const path = bookFilePath(created.id);
      const current = JSON.parse(new TextDecoder().decode((await port.readFile(path))?.bytes));
      await port.commitFile(path, new TextEncoder().encode(`${JSON.stringify({ ...current, ...raw }, null, 2)}\n`), { kind: "any" });
    }
    const read = async () => JSON.parse(new TextDecoder().decode((await port.readFile(bookFilePath(created.id)))?.bytes));
    return { port, service, id: created.id, read };
  }

  test("an older book opens unchanged and gains no matter from other saves", async () => {
    const { service, id, read } = await setup({ frontMatter: { dedication: "For those who wait." } });
    const detail = await service.readBook(id);
    expect(detail.book.matter).toBeUndefined();
    await service.updateBook(id, { title: "Renamed", matter: MATTER });
    const raw = await read();
    expect(raw.matter).toBeUndefined();
    expect(raw.frontMatter).toEqual({ dedication: "For those who wait." });
  });

  test("a save writes front then back, counts the version and keeps every other field", async () => {
    const { service, id, read } = await setup({ frontMatter: { dedication: "For those who wait." }, someday: [1, 2] });
    const result = await service.saveMatter(id, { ...MATTER, version: 99 }, { baseVersion: 0, baseHash: await matterHash(null) });
    expect(result.status).toBe("saved");
    const raw = await read();
    expect(raw.matter.version).toBe(1);
    expect(raw.matter.sections.map((section: { id: string }) => section.id)).toEqual(["mat_copyr001", "mat_dedic001", "mat_about001"]);
    expect(raw.frontMatter).toEqual({ dedication: "For those who wait." });
    expect(raw.someday).toEqual([1, 2]);
    expect(result.book.matter).toEqual(raw.matter);

    const saved = readMatter(result.book).matter;
    const again = await service.saveMatter(id, { ...MATTER, author: "A. Reyes" }, { baseVersion: 1, baseHash: await matterHash(saved) });
    expect(again.status).toBe("saved");
    expect((await read()).matter).toMatchObject({ version: 2, author: "A. Reyes" });

    // A settings save leaves the matter as it is.
    await service.updateBook(id, { title: "Renamed" });
    expect((await read()).matter).toMatchObject({ version: 2, author: "A. Reyes" });
  });

  test("a stale version or hash keeps the author's copy and writes nothing over the newer matter", async () => {
    const { port, service, id, read } = await setup();
    const first = await service.saveMatter(id, MATTER, { baseVersion: 0, baseHash: await matterHash(null) });
    const before = await read();

    const stale = await service.saveMatter(id, { ...MATTER, author: "Someone else" }, { baseVersion: 0, baseHash: await matterHash(null) });
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.reason).toBe("newer-version");
    expect(stale.book.matter).toEqual(before.matter);
    expect(await read()).toEqual(before);
    const copies = await port.listDirectory(conflictsPath(id));
    expect(copies.map((entry) => entry.name)).toEqual([expect.stringMatching(/^front-and-back-matter\.conflict-newer-version\..+\.json$/)]);
    expect(stale.savedAs).toContain(copies[0]?.name);
    const copy = await port.readFile([...conflictsPath(id), copies[0]?.name ?? ""]);
    expect(JSON.parse(new TextDecoder().decode(copy?.bytes)).matter.author).toBe("Someone else");

    const saved = readMatter(first.status === "saved" ? first.book : before).matter;
    const edited = await service.saveMatter(id, MATTER, { baseVersion: saved?.version ?? 0, baseHash: "0".repeat(64) });
    expect(edited.status === "conflict" && edited.reason).toBe("external-edit");
    expect(await read()).toEqual(before);
  });

  test("unreadable matter in the file is never saved over", async () => {
    const { service, id, read } = await setup({ matter: { sections: "not a list" } });
    const before = await read();
    expect((await service.readBook(id)).book.matter).toEqual({ sections: "not a list" });
    const attempt = service.saveMatter(id, MATTER, { baseVersion: 0, baseHash: await matterHash(null) });
    await expect(attempt).rejects.toBeInstanceOf(LibraryError);
    await expect(attempt).rejects.toMatchObject({ code: "format" });
    expect(await read()).toEqual(before);
    // Other saves carry the value as it is.
    await service.updateBook(id, { title: "Renamed" });
    expect((await read()).matter).toEqual({ sections: "not a list" });
  });

  test("a book.json replaced during the save is refused, not overwritten", async () => {
    const { port, service, id, read } = await setup();
    const commit = port.commitFile.bind(port);
    port.commitFile = async (path, bytes, expected) => {
      if (expected.kind === "sha256") {
        const current = JSON.parse(new TextDecoder().decode((await port.readFile(path))?.bytes));
        await commit(path, new TextEncoder().encode(`${JSON.stringify({ ...current, title: "Changed meanwhile" })}\n`), { kind: "any" });
      }
      return commit(path, bytes, expected);
    };
    await expect(service.saveMatter(id, MATTER, { baseVersion: 0, baseHash: await matterHash(null) })).rejects.toMatchObject({ code: "io" });
    expect((await read()).title).toBe("Changed meanwhile");
    expect((await read()).matter).toBeUndefined();
  });

  test("a missing book is reported", async () => {
    const { service } = await setup();
    await expect(service.saveMatter("book_missing01", MATTER, { baseVersion: 0, baseHash: await matterHash(null) })).rejects.toMatchObject({ code: "not-found" });
  });
});
