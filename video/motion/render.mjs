#!/usr/bin/env node
/**
 * Render the motion plates frame-exactly with Playwright.
 *
 *   node video/motion/render.mjs --preview
 *   node video/motion/render.mjs --all
 *   node video/motion/render.mjs --all --scene=background --fps=30 --seconds=3
 *
 * Frames land in video/renders/motion/. They are ignored by git. The page is deterministic: it
 * exposes window.renderAt(ms), so a frame does not depend on wall-clock animation timing.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pagePath = join(root, "video", "motion", "index.html");
const outRoot = join(root, "video", "renders", "motion");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const entry = args.find((arg) => arg.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};

if (flag("help")) {
  console.log("Usage: node video/motion/render.mjs [--preview|--all] [--scene=name] [--fps=30] [--seconds=3] [--ambient] [--mp4]");
  process.exit(0);
}

const preview = flag("preview") || (!flag("all") && !flag("preview"));
const fps = Number(value("fps", "30"));
const seconds = Number(value("seconds", "3"));
const ambient = flag("ambient");
const transparent = flag("transparent") || !ambient;
const encode = flag("mp4");
const requestedScene = value("scene", null);
const frames = Math.max(1, Math.round(fps * seconds));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const scenes = [];

try {
  await page.goto(`${pathToFileURL(pagePath).href}?scene=problem&bg=${transparent ? "transparent" : "ambient"}`, {
    waitUntil: "load"
  });
  await page.waitForFunction(() => window.motionReady === true);
  scenes.push(...(await page.evaluate(() => window.motionScenes)));
  const selected = requestedScene ? scenes.filter((scene) => scene === requestedScene) : scenes;
  if (selected.length === 0) throw new Error(`Unknown scene: ${requestedScene}. Known: ${scenes.join(", ")}`);

  for (const scene of selected) {
    await page.goto(`${pathToFileURL(pagePath).href}?scene=${scene}&bg=${transparent ? "transparent" : "ambient"}`, {
      waitUntil: "load"
    });
    await page.waitForFunction(() => window.motionReady === true);
    const folder = join(outRoot, scene);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });

    if (preview) {
      const at = 1600;
      await page.evaluate((ms) => window.renderAt(ms), at);
      const path = join(folder, "preview.png");
      await page.screenshot({ path, omitBackground: transparent });
      console.log(`[motion] ${scene} → ${path}`);
      continue;
    }

    for (let frame = 0; frame < frames; frame += 1) {
      const ms = Math.round((frame / fps) * 1000);
      await page.evaluate((time) => window.renderAt(time), ms);
      const path = join(folder, `frame-${String(frame).padStart(4, "0")}.png`);
      await page.screenshot({ path, omitBackground: transparent });
    }
    console.log(`[motion] ${scene}: ${frames} frames at ${fps} fps → ${folder}`);

    if (encode) {
      const output = join(outRoot, `${scene}.mp4`);
      const ffmpeg = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-framerate",
          String(fps),
          "-i",
          join(folder, "frame-%04d.png"),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "18",
          output
        ],
        { stdio: "inherit" }
      );
      if (ffmpeg.status !== 0) {
        console.warn(`[motion] ffmpeg failed for ${scene}; the PNG sequence is still available.`);
      } else {
        console.log(`[motion] ${scene} → ${output}`);
      }
    }
  }
} finally {
  await browser.close();
}
