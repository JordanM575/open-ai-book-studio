#!/usr/bin/env bun
/**
 * Spec 012 T018 performance gate. Synthetic, isolated and credentials-free: it builds a
 * throwaway 120-chapter / 250,000-word library in a temp dir, times book open, chapter reads
 * and saves through the real filesystem port, measures the built web bundle and the welcome
 * render in headless Chromium, then compares against the committed baseline.
 *
 * Fail conditions come from SC-009 only: book-open time at least doubles, or the initial web
 * bundle grows by more than 20%. Every other number is reported, never gated.
 *
 *   bun run perf                measure and gate against scripts/perf-baseline.json
 *   bun run perf --update-baseline
 *                                 measure and rewrite the baseline (review the diff as code)
 */
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileSystemEnvironment } from "../apps/desktop/src/main/library/fs-port";
import { LibraryService } from "../packages/core/src/library/service";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "web", "dist");

export interface PerfBaseline {
  openMs: number;
  switchMs: number;
  saveMs: number;
  bundleBytes: number;
  bundleGzipBytes: number;
  welcomeMs: number;
}

export interface PerfActual extends PerfBaseline {
  words: number;
  chapters: number;
}

/** SC-009: fail when book-open time doubles or the initial bundle grows by more than 20%. */
export function exceedsRegression(actual: PerfActual, baseline: PerfBaseline): {
  open: boolean;
  bundle: boolean;
} {
  return {
    open: actual.openMs >= 2 * baseline.openMs,
    bundle: actual.bundleBytes > 1.2 * baseline.bundleBytes
  };
}

/** Deterministic prose: the same bytes every run, so timings stay comparable. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "the", "keeper", "lit", "lamp", "and", "stairs", "went", "quiet", "below", "sea",
  "flattened", "itself", "against", "rocks", "patient", "grey", "wind", "rattled", "glass",
  "threw", "shadow", "across", "whitewashed", "wall", "eleven", "winters", "never", "once",
  "flame", "went", "out", "oil", "smelled", "sweet", "sharp", "varnish", "reservoir", "wick",
  "drowned", "dark", "water", "logbook", "open", "desk", "pen", "still", "midnight", "entry",
  "tower", "spare", "hook", "read", "twice", "handwriting", "storm", "hammering", "gull",
  "crying", "ledge", "weather", "carefully", "listened", "bell", "roar", "door", "corridor",
  "colder", "night", "watch", "tide", "harbor", "gulls", "counted", "margin", "evening",
  "wrong", "again", "light", "only", "thing", "agreed", "dawn", "came", "grey", "lantern",
  "brass", "high", "head", "winding", "climbed", "before", "recently", "without", "nobody",
  "else", "held", "key", "spare", "hung", "undisturbed", "line", "memory", "writing", "storm",
  "down", "until", "stops", "ringing", "set", "down", "through", "describe", "single", "named"
];

export function chapterText(random: () => number, words: number): string {
  const parts: string[] = [];
  for (let i = 0; i < words; i += 1) {
    parts.push(WORDS[Math.floor(random() * WORDS.length)] ?? "the");
    if (i % 18 === 17) parts.push(".\n\n");
    else if (i % 9 === 8) parts.push(".");
  }
  return `${parts.join(" ")}\n`;
}

async function minOf(rounds: number, work: () => Promise<void>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    await work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

async function bundleBytes(): Promise<{ bytes: number; gzip: number }> {
  const assets = join(dist, "assets");
  let bytes = 0;
  let gzip = 0;
  for (const entry of await readdir(assets)) {
    if (!entry.endsWith(".js")) continue;
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(assets, entry));
    bytes += content.byteLength;
    gzip += gzipSync(content).byteLength;
  }
  const html = await stat(join(dist, "index.html")).then((info) => info.size);
  return { bytes: bytes + html, gzip };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

async function welcomeMs(): Promise<number> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(dist, relative);
    if (!file.startsWith(dist) || !existsSync(file)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const port = (server.address() as { port: number }).port;
  const { chromium } = await import("playwright");
  const { capturePage, createRunDir } = await import("./failure-artifacts.mjs");
  const browser = await chromium.launch();
  const runDir = await createRunDir("perf");
  try {
    const page = await browser.newPage();
    const capture = await capturePage(page);
    try {
      const start = performance.now();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="web-welcome"]', { timeout: 30_000 });
      await capture.discard();
      return performance.now() - start;
    } catch (error) {
      const artifacts = await capture.save(runDir, "perf-welcome");
      console.error(
        `[perf] artifacts: ${artifacts.screenshot}${artifacts.trace ? ` ${artifacts.trace}` : ""} ${artifacts.consoleLog}`
      );
      throw error;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function measure(): Promise<PerfActual> {
  if (!existsSync(join(dist, "index.html"))) {
    console.error("[perf] No web build found. Run `bun run build:web` first.");
    process.exit(2);
  }
  const temp = await mkdtemp(join(tmpdir(), "ai-book-studio-perf-"));
  try {
    const random = mulberry32(0x516013);
    const chapters = 120;
    // Punctuation tokens count as words, so 1875 source words land near 2,083 counted each.
    const wordsPerChapter = 1875;
    const service = await LibraryService.open(createFileSystemEnvironment(temp));
    const book = await service.createBook({ title: "Perf Gate" });
    const ids: string[] = [];
    for (let i = 0; i < chapters; i += 1) {
      const chapter = await service.createChapter(book.id, {
        title: `Chapter ${i + 1}`,
        content: chapterText(random, wordsPerChapter)
      });
      ids.push(chapter.id);
    }
    const detail = await service.readBook(book.id);
    const words = detail.chapters.reduce((total, chapter) => total + chapter.wordCount, 0);

    await service.readBook(book.id);
    const openMs = await minOf(3, async () => {
      const fresh = await LibraryService.open(createFileSystemEnvironment(temp));
      await fresh.readBook(book.id);
    });
    const targets = [ids[0] as string, ids[60] as string, ids[119] as string];
    let pick = 0;
    const switchMs = await minOf(5, async () => {
      await service.readChapter(book.id, targets[pick % targets.length] as string);
      pick += 1;
    });
    let revision = 0;
    const saveMs = await minOf(3, async () => {
      revision += 1;
      const current = await service.readChapter(book.id, ids[0] as string);
      const result = await service.saveChapter(book.id, ids[0] as string, `${current.content}\nRevision ${revision}.\n`, {
        baseVersion: current.version,
        baseHash: current.hash
      });
      if (result.status !== "saved") throw new Error(`save did not commit: ${result.status}`);
    });

    const bundle = await bundleBytes();
    const welcome = await welcomeMs();
    return {
      openMs,
      switchMs,
      saveMs,
      bundleBytes: bundle.bytes,
      bundleGzipBytes: bundle.gzip,
      welcomeMs: welcome,
      words,
      chapters: detail.chapters.length
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const BASELINE_PATH = join(root, "scripts", "perf-baseline.json");

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update-baseline");
  const measured = await measure();
  const actual: PerfActual = {
    ...measured,
    openMs: round2(measured.openMs),
    switchMs: round2(measured.switchMs),
    saveMs: round2(measured.saveMs),
    welcomeMs: round2(measured.welcomeMs)
  };
  if (update) {
    const { words: _words, chapters: _chapters, ...baseline } = actual;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log("[perf] baseline rewritten — review the diff as code");
  }
  const { readFile } = await import("node:fs/promises");
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as PerfBaseline;
  const gate = exceedsRegression(actual, baseline);
  for (const [name, value, reference] of [
    ["open      ", actual.openMs, baseline.openMs],
    ["switch    ", actual.switchMs, baseline.switchMs],
    ["save      ", actual.saveMs, baseline.saveMs],
    ["bundle    ", actual.bundleBytes, baseline.bundleBytes],
    ["bundlegzip", actual.bundleGzipBytes, baseline.bundleGzipBytes],
    ["welcome   ", actual.welcomeMs, baseline.welcomeMs]
  ] as Array<[string, number, number]>) {
    const ratio = reference > 0 ? value / reference : 0;
    console.log(`[perf] ${name} ${value.toFixed(value < 100 ? 2 : 0)} (baseline ${reference}, x${ratio.toFixed(2)})`);
  }
  console.log(`[perf] book ${actual.chapters} chapters, ${actual.words} words`);
  if (update) return;
  if (gate.open || gate.bundle) {
    if (gate.open) console.error(`[perf] FAIL book open x${(actual.openMs / baseline.openMs).toFixed(2)} (limit x2.00)`);
    if (gate.bundle) {
      console.error(`[perf] FAIL bundle x${(actual.bundleBytes / baseline.bundleBytes).toFixed(2)} (limit x1.20)`);
    }
    process.exit(1);
  }
  console.log("[perf] within the SC-009 regression thresholds");
}

if (import.meta.main) {
  await main();
}
