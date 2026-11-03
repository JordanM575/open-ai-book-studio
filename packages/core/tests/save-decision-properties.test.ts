import { describe, expect, test } from "bun:test";
import { normalizeBody } from "../src/markdown";
import { LibraryService } from "../src/library/service";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Deterministic save-decision properties (spec 012 T007). Seeded synthetic
 * bodies drive the real service over the in-memory port: versions move by
 * exactly one, rejected text never lands, and the conflict reason follows the
 * version/hash comparison every time.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "lighthouse", "keeper", "counted", "gulls", "evening", "Élodie", "⛵",
  "salt", "stone", "wrong", "again", "light", "margin", "number"
];

function bodySample(rand: () => number): string {
  const parts = 2 + Math.floor(rand() * 12);
  const words: string[] = [];
  for (let i = 0; i < parts; i += 1) words.push(WORDS[Math.floor(rand() * WORDS.length)] ?? "x");
  return `${words.join(" ")}\n`;
}

async function openLibrary() {
  const port = new InMemoryLibraryPort();
  const service = await LibraryService.open({ storage: port, runtime: port });
  return { port, service };
}

describe("save-decision properties", () => {
  test("sequential saves move the version by exactly one and keep exact bytes", async () => {
    const rand = mulberry32(0x029011);
    const { service } = await openLibrary();
    const book = await service.createBook({ title: "Properties" });
    const first = bodySample(rand);
    let chapter = await service.createChapter(book.id, { title: "C1", content: first });
    expect(chapter.version).toBe(1);

    for (let round = 0; round < 8; round += 1) {
      const next = bodySample(rand);
      const saved = await service.saveChapter(book.id, chapter.id, next, {
        baseVersion: chapter.version,
        baseHash: chapter.hash
      });
      if (saved.status !== "saved") throw new Error("a clean save must save");
      chapter = saved.chapter;
      expect(chapter.version).toBe(2 + round);
      expect(chapter.content).toBe(normalizeBody(next));
      expect((await service.readChapter(book.id, chapter.id)).content).toBe(chapter.content);
    }
  });

  test("a wrong hash always conflicts as external-edit and never lands", async () => {
    const rand = mulberry32(0x029012);
    const { service } = await openLibrary();
    for (let round = 0; round < 10; round += 1) {
      const book = await service.createBook({ title: `Properties ${round}` });
      const kept = bodySample(rand);
      let chapter = await service.createChapter(book.id, { title: "C1", content: kept });
      const rejected = bodySample(rand);
      const result = await service.saveChapter(book.id, chapter.id, rejected, {
        baseVersion: chapter.version,
        baseHash: "0".repeat(64)
      });
      if (result.status !== "conflict") throw new Error("a wrong hash must conflict");
      expect(result.conflict.reason).toBe("external-edit");
      expect(result.conflict.localVersion).toBe(chapter.version + 1);
      const disk = await service.readChapter(book.id, chapter.id);
      expect(disk.content).toBe(normalizeBody(kept));
      expect(disk.version).toBe(chapter.version);
      chapter = disk;
    }
  });

  test("a stale version after another save always conflicts as newer-version", async () => {
    const rand = mulberry32(0x029013);
    const { service } = await openLibrary();
    for (let round = 0; round < 10; round += 1) {
      const book = await service.createBook({ title: `Properties ${round}` });
      const chapter = await service.createChapter(book.id, { title: "C1", content: bodySample(rand) });
      const stale = { baseVersion: chapter.version, baseHash: chapter.hash };
      const bumped = await service.saveChapter(book.id, chapter.id, bodySample(rand), stale);
      if (bumped.status !== "saved") throw new Error("the first save must save");
      const late = await service.saveChapter(book.id, chapter.id, bodySample(rand), stale);
      if (late.status !== "conflict") throw new Error("a stale version must conflict");
      expect(late.conflict.reason).toBe("newer-version");
      expect(late.conflict.localVersion).toBe(stale.baseVersion + 1);
    }
  });

  test("two saves on the same base leave exactly one winner", async () => {
    const rand = mulberry32(0x029014);
    const { service } = await openLibrary();
    for (let round = 0; round < 10; round += 1) {
      const book = await service.createBook({ title: `Properties ${round}` });
      const chapter = await service.createChapter(book.id, { title: "C1", content: bodySample(rand) });
      const base = { baseVersion: chapter.version, baseHash: chapter.hash };
      const first = await service.saveChapter(book.id, chapter.id, bodySample(rand), base);
      const second = await service.saveChapter(book.id, chapter.id, bodySample(rand), base);
      expect(first.status).toBe("saved");
      expect(second.status).toBe("conflict");
      if (second.status !== "conflict") throw new Error("the second same-base save must conflict");
      expect(second.conflict.reason).toBe("newer-version");
    }
  });
});
