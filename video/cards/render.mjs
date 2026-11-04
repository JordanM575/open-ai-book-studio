#!/usr/bin/env node
/**
 * Render the film's caption cards frame-exactly with Playwright.
 *
 *   node video/cards/render.mjs                      every card film.json needs
 *   node video/cards/render.mjs --only=lower-strip,end
 *   node video/cards/render.mjs --preview            one settled still per card, over the wash
 *
 * Cards are lower thirds, event tags, footage-pending slates, the end slate and the backdrop behind
 * fitted footage. Frames land in video/renders/cards/<id>/ as transparent PNGs, which git ignores.
 * The page is deterministic: window.renderAt(ms) sets every reveal, so a frame never depends on
 * wall-clock animation. Each folder gets a spec.json stamp; the assembler re-renders a card whose
 * stamp no longer matches film.json or the page.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { cardSpecs, cardStamp, FPS, HEIGHT, loadFilm, paths, WIDTH } from "../edit/film.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const entry = args.find((arg) => arg.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};

if (flag("help")) {
  console.log("Usage: node video/cards/render.mjs [--only=id,id] [--preview] [--film=edit list]");
  process.exit(0);
}

const film = loadFilm(value("film", paths.film));
const only = value("only", "")
  .split(",")
  .filter(Boolean);
const specs = cardSpecs(film).filter((spec) => only.length === 0 || only.includes(spec.id));
const unknown = only.filter((id) => !specs.some((spec) => spec.id === id));
if (unknown.length > 0) {
  console.error(`[cards] unknown card: ${unknown.join(", ")}`);
  process.exit(1);
}

const preview = flag("preview");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await context.newPage();

try {
  await page.goto(`${pathToFileURL(paths.cardsPage).href}${preview ? "?preview" : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.cardsReady === true);
  for (const spec of specs) {
    await page.evaluate((card) => window.setCard(card), spec);
    await page.evaluate(() => document.fonts.ready);
    const length = await page.evaluate(() => window.cardLength());
    const count = length === 0 ? 1 : Math.ceil((length / 1000) * FPS) + 1;

    if (preview) {
      const folder = join(paths.cards, "previews");
      await mkdir(folder, { recursive: true });
      await page.evaluate((ms) => window.renderAt(ms), length);
      const path = join(folder, `${spec.id}.png`);
      await page.screenshot({ path });
      console.log(`[cards] ${spec.id} → ${path}`);
      continue;
    }

    const folder = join(paths.cards, spec.id);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    for (let frame = 0; frame < count; frame += 1) {
      await page.evaluate((ms) => window.renderAt(ms), Math.round((frame / FPS) * 1000));
      await page.screenshot({ path: join(folder, `frame-${String(frame).padStart(4, "0")}.png`), omitBackground: true });
    }
    await writeFile(join(folder, "spec.json"), `${JSON.stringify(cardStamp(spec), null, 2)}\n`);
    console.log(`[cards] ${spec.id}: ${count} frame${count === 1 ? "" : "s"} → ${folder}`);
  }
} finally {
  await browser.close();
}
