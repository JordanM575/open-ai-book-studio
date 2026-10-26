#!/usr/bin/env bun
/**
 * Build the deterministic film fixture: one original short book, Story Bible, two chapters, a
 * chapter illustration and a transparent character cutout. The library is written through the real
 * `Library`/`ImageStore`, so it is the same format the app reads. It is a fixture, not author data.
 *
 *   bun run film:fixture                 # writes video/fixture/library
 *   bun scripts/film-fixture.ts /tmp/lib # writes another empty folder
 */
import { deflateSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Library } from "../apps/desktop/src/main/library/store";

export interface FilmFixture {
  root: string;
  bookId: string;
  chapterIds: string[];
  illustrationId: string;
  cutoutId: string;
  characterId: string;
}

const CHARACTER_ID = "char_film0001";

/**
 * Build the fixture in an empty folder. The caller can point this at a throwaway directory for a
 * test or at `video/fixture/library` for a capture session.
 */
export async function buildFilmFixture(root: string): Promise<FilmFixture> {
  const target = resolve(root);
  if (existsSync(target)) {
    const entries = await readdir(target);
    if (entries.length > 0) {
      throw new Error(`The fixture folder is not empty: ${target}. Choose a new folder or remove it first.`);
    }
  }
  await mkdir(target, { recursive: true });
  const library = await Library.open(target);
  const book = await library.createBook({
    title: "The Salt Road",
    description: "A lighthouse keeper keeps a light for a ship that may never come.",
    outline:
      "1. Mara keeps the light through a storm.\n2. A door under the stairs opens onto a colder shore.\n3. The ship answers."
  });
  await library.updateBook(book.id, {
    genres: ["literary fiction", "coastal"],
    stage: "drafting",
    storyArc: {
      beginning: {
        overview: "Mara keeps the light and counts the ships that do not come.",
        keyMoments: "The storm arrives; the lamp will not turn.",
        openQuestions: "Who is the ship for?"
      },
      middle: {
        overview: "A door under the stairs opens onto a shore that should not be there.",
        keyMoments: "Mara steps through and finds the keeper's log from a future year.",
        openQuestions: "Is the other shore a memory or a warning?"
      },
      end: {
        overview: "The ship answers the light, and Mara chooses what to keep.",
        keyMoments: "The lamp turns; the door closes.",
        openQuestions: "What does she leave on the other shore?"
      }
    },
    characters: [
      {
        id: CHARACTER_ID,
        name: "Mara Venn",
        role: "Lighthouse keeper",
        description: "Practical, salt-weathered, keeps a ledger of every ship she has not seen.",
        motivations: "Keep the light turning and finish her father's log.",
        notes: "Left-handed. Wears a red wool hat."
      }
    ],
    memories: [
      {
        id: "mem_film0001",
        text: "The lamp turns clockwise; the door under the stairs opens the other way.",
        importance: "high",
        createdAt: new Date("2026-10-01T09:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-10-01T09:00:00.000Z").toISOString()
      }
    ]
  });

  const first = await library.createChapter(book.id, {
    title: "The Light That Would Not Turn",
    content: [
      "The storm came in low over the water, and the lamp would not turn.",
      "",
      "Mara climbed the tower twice before midnight. The first time she found the gear choked with salt. The second time she found her father's ledger open on the step, its pages warm.",
      "",
      "She read the last line he had written: *The ship is not lost. It is waiting for the light to agree.*",
      "",
      "Outside, the sea broke against the rocks and the beam stood still, a white finger pointing at nothing."
    ].join("\n")
  });
  const second = await library.createChapter(book.id, {
    title: "The Door Under the Stairs",
    content: [
      "The door under the stairs had been painted shut for as long as Mara could remember.",
      "",
      "At three in the morning it was open.",
      "",
      "Beyond it was a shore she did not know: black sand, a green sky, and a second lighthouse with no light in it. A figure stood at the rail, wearing her red hat.",
      "",
      "Mara put one hand on the frame. The wood was warm. Somewhere behind her the lamp began, at last, to turn."
    ].join("\n")
  });

  const illustration = await library.addImage(book.id, {
    bytes: illustrationPng(),
    kind: "chapter",
    prompt: "A lighthouse in a storm, warm lantern light against a cold sea, ink and wash",
    provider: "fixture",
    model: "film-fixture",
    size: "1024x1024",
    source: "imported"
  });
  await library.attachImage(book.id, illustration.id, first.id);

  const cutout = await library.addImage(book.id, {
    bytes: cutoutPng(),
    kind: "character",
    prompt: "Mara Venn, lighthouse keeper",
    provider: "fixture",
    model: "film-fixture",
    size: "512x512",
    source: "cutout",
    cutoutOf: illustration.id,
    characterId: CHARACTER_ID
  });

  return {
    root: target,
    bookId: book.id,
    chapterIds: [first.id, second.id],
    illustrationId: illustration.id,
    cutoutId: cutout.id,
    characterId: CHARACTER_ID
  };
}

// A tiny deterministic PNG encoder: no native image library, no network.
function illustrationPng(width = 1024, height = 1024): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  };
  const mix = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

  // Sky and sea.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (y < 660) {
        const t = y / 660;
        set(x, y, mix(22, 242, t), mix(38, 180, t), mix(74, 116, t));
      } else {
        const t = (y - 660) / (height - 660);
        const band = Math.sin(y * 0.09) * 6;
        set(x, y, mix(22, 9, t) + band, mix(45, 24, t) + band, mix(62, 40, t) + band);
      }
    }
  }
  // Sun and its reflection.
  for (let y = -110; y <= 110; y += 1) {
    for (let x = -110; x <= 110; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= 92) set(790 + x, 500 + y, 255, 196, 116);
      else if (distance <= 130) {
        const a = Math.round(40 * (1 - (distance - 92) / 38));
        set(790 + x, 500 + y, 255, 196, 116, a);
      }
    }
  }
  for (let y = 660; y < 900; y += 1) {
    const spread = 30 + (y - 660) * 0.18;
    for (let x = Math.round(790 - spread); x <= 790 + spread; x += 1) {
      set(x, y, 220, 138, 78, 90);
    }
  }
  // Lighthouse tower: a white banded trapezoid.
  for (let y = 300; y < 790; y += 1) {
    const t = (y - 300) / 490;
    const half = 42 + t * 34;
    const band = Math.floor((y - 300) / 64) % 2 === 0;
    for (let x = Math.round(318 - half); x <= 318 + half; x += 1) {
      set(x, y, band ? 238 : 180, band ? 233 : 64, band ? 218 : 58);
    }
  }
  // Gallery, lantern room and roof.
  for (let x = 246; x <= 390; x += 1) {
    for (let y = 286; y <= 300; y += 1) set(x, y, 42, 46, 58);
  }
  for (let y = 238; y < 286; y += 1) {
    for (let x = 278; x <= 358; x += 1) set(x, y, 255, 218, 134);
  }
  for (let y = 214; y < 244; y += 1) {
    const half = 44 - (y - 214) * 0.7;
    for (let x = Math.round(318 - half); x <= 318 + half; x += 1) set(x, y, 36, 40, 50);
  }
  // Two light beams.
  for (let step = 0; step < 260; step += 1) {
    const spread = 8 + step * 0.9;
    const alpha = Math.max(0, 90 - step * 0.3);
    for (let offset = -spread; offset <= spread; offset += 1) {
      set(318 - step, 260 + Math.round(offset * 0.3), 255, 228, 160, alpha);
      set(318 + step, 260 + Math.round(offset * 0.3), 255, 228, 160, alpha);
    }
  }
  // Rocks in the foreground.
  for (let y = 810; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ridge = 812 + Math.sin(x * 0.02) * 16 + Math.sin(x * 0.007 + 1) * 22;
      if (y > ridge) set(x, y, 18, 22, 30);
    }
  }
  return encodePng(width, height, pixels);
}

function cutoutPng(width = 512, height = 512): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    if (a === 0 || a < (pixels[o + 3] ?? 0)) return;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  };
  const disc = (cx: number, cy: number, radius: number, r: number, g: number, b: number): void => {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (x * x + y * y <= radius * radius) set(cx + x, cy + y, r, g, b);
      }
    }
  };
  // Coat.
  for (let y = 196; y < 450; y += 1) {
    const half = 78 + (y - 196) * 0.24;
    for (let x = Math.round(256 - half); x <= 256 + half; x += 1) set(x, y, 30, 40, 56);
  }
  // Head and red hat.
  disc(256, 142, 54, 236, 196, 168);
  for (let x = 176; x <= 336; x += 1) {
    for (let y = 94; y <= 110; y += 1) set(x, y, 150, 44, 42);
  }
  for (let y = 58; y < 96; y += 1) {
    const half = 44 - (y - 58) * 0.55;
    for (let x = Math.round(256 - half); x <= 256 + half; x += 1) set(x, y, 150, 44, 42);
  }
  // Buttons and lantern.
  for (const y of [236, 280, 324, 368]) disc(256, y, 6, 226, 174, 86);
  disc(374, 314, 34, 42, 46, 58);
  disc(374, 314, 22, 255, 210, 120);
  for (let y = 336; y <= 350; y += 1) {
    for (let x = 366; x <= 382; x += 1) set(x, y, 42, 46, 58);
  }
  // Boots.
  for (let y = 446; y <= 486; y += 1) {
    for (let x = 176; x <= 248; x += 1) set(x, y, 24, 28, 36);
    for (let x = 264; x <= 336; x += 1) set(x, y, 24, 28, 36);
  }
  return encodePng(width, height, pixels);
}

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

if (import.meta.main) {
  const root = process.argv[2] ?? join(process.cwd(), "video", "fixture", "library");
  const result = await buildFilmFixture(root);
  console.log(`Film fixture written to ${result.root}`);
  console.log(`  book ${result.bookId}`);
  console.log(`  chapters ${result.chapterIds.join(", ")}`);
  console.log(`  illustration ${result.illustrationId}, cutout ${result.cutoutId}`);
}
