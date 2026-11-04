/**
 * The film's edit list: load and check video/edit/film.json, compare it with the approved script and
 * lay out the beats that the caption-card renderer and the assembler share.
 *
 * Times in film.json are "m:ss" strings (or "m:ss.s" once the narration locks them). They are the
 * narration's timeline: a segment's picture is fitted to its slot, and its line is the same slice of
 * the narration, so a cut segment drops its picture and its line together.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const paths = {
  film: join(root, "video", "edit", "film.json"),
  script: join(root, "video", "script.md"),
  footage: join(root, "video", "footage"),
  renders: join(root, "video", "renders"),
  motion: join(root, "video", "renders", "motion"),
  cards: join(root, "video", "renders", "cards"),
  motionPage: join(root, "video", "motion", "index.html"),
  cardsPage: join(root, "video", "cards", "index.html"),
  tokens: join(root, "packages", "ui", "src", "styles", "tokens.generated.css")
};

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const MAX_SECONDS = 180;
/** FR-016 and the storyboard: on-screen text stays at least 1.5 s. */
export const MIN_TEXT_SECONDS = 1.5;
const LOWER_THIRD_IN = 0.5;
const LOWER_THIRD_OUT = 0.5;

/** "1:45", "1:45.5" or a number of seconds → seconds. */
export function seconds(value) {
  if (typeof value === "number") return value;
  const match = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) throw new Error(`Not a time: ${JSON.stringify(value)} (use "m:ss")`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Seconds → "m:ss.s" for reports and slates. */
export function clock(value, decimals = 1) {
  const minutes = Math.floor(value / 60);
  const rest = (value - minutes * 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return `${minutes}:${rest}`;
}

export const frames = (value) => Math.round(value * FPS);
export const slot = (segment) => seconds(segment.end) - seconds(segment.start);
export const stem = (file) => basename(file, extname(file));
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Motion plate scenes, read from the plate page so a typo fails before anything renders. */
export function motionScenes() {
  const html = readFileSync(paths.motionPage, "utf8");
  return [...html.matchAll(/data-scene="([a-z0-9-]+)"/g)].map((match) => match[1]);
}

export function loadFilm(path = paths.film) {
  const film = JSON.parse(readFileSync(path, "utf8"));
  const problems = validate(film);
  if (problems.length > 0) throw new Error(`film.json is not valid:\n- ${problems.join("\n- ")}`);
  return film;
}

export function validate(film) {
  const problems = [];
  const scenes = new Set(motionScenes());
  const tags = new Set(Object.values(film.tags ?? {}));
  const ids = new Set();
  let previousEnd = 0;
  if (!Array.isArray(film.segments) || film.segments.length === 0) return ["segments is empty"];
  for (const segment of film.segments) {
    const where = `segment ${segment.id ?? "?"}`;
    if (!/^[a-z0-9-]+$/.test(segment.id ?? "")) problems.push(`${where}: id must be lower-case words and dashes`);
    if (ids.has(segment.id)) problems.push(`${where}: duplicate id`);
    ids.add(segment.id);
    let start = 0;
    let end = 0;
    try {
      start = seconds(segment.start);
      end = seconds(segment.end);
    } catch (error) {
      problems.push(`${where}: ${error.message}`);
      continue;
    }
    if (Math.abs(start - previousEnd) > 1e-6) problems.push(`${where}: starts at ${segment.start}, the previous segment ends at ${clock(previousEnd)}`);
    if (end <= start) problems.push(`${where}: ends before it starts`);
    previousEnd = end;
    if (typeof segment.voiceover !== "string" || segment.voiceover.length === 0) problems.push(`${where}: voiceover is empty`);
    if (!Array.isArray(segment.onScreen)) problems.push(`${where}: onScreen must be a list of lines`);
    if (segment.tag !== null && !tags.has(segment.tag)) problems.push(`${where}: tag must be one of film.tags or null`);
    if (!Array.isArray(segment.picture) || segment.picture.length === 0) problems.push(`${where}: picture is empty`);
    for (const source of segment.picture ?? []) {
      const kinds = ["plate", "clip", "card"].filter((kind) => kind in source);
      if (kinds.length !== 1) problems.push(`${where}: a picture source names exactly one of plate, clip or card`);
      if (source.plate && !scenes.has(source.plate)) problems.push(`${where}: unknown plate ${source.plate}`);
      if (source.card && source.card !== "end") problems.push(`${where}: unknown card ${source.card}`);
      if (source.clip && !/^[a-z0-9-]+\.(mov|mp4|m4v)$/.test(source.clip)) problems.push(`${where}: clip names are lower-case .mov, .mp4 or .m4v files`);
      if (!(source.duration > 0)) problems.push(`${where}: every source needs a planned duration in seconds`);
      if (source.in !== undefined && !(source.in >= 0)) problems.push(`${where}: in must be 0 or more seconds`);
      if (source.out !== undefined && !(source.out > (source.in ?? 0))) problems.push(`${where}: out must be after in`);
    }
    const third = segment.lowerThird;
    if (third !== false && (typeof third !== "object" || third === null)) problems.push(`${where}: lowerThird is false or an object`);
    if (third) {
      const window = lowerThirdWindow(segment, { from: 0, duration: end - start });
      if (!window) problems.push(`${where}: the lower third is on screen for less than ${MIN_TEXT_SECONDS} s`);
      if (third.position && !["bottom", "top"].includes(third.position)) problems.push(`${where}: lowerThird.position is bottom or top`);
    }
    if (typeof segment.cut !== "boolean") problems.push(`${where}: cut must be true or false`);
  }
  for (const entry of film.cutOrder ?? []) {
    if (entry.segment && !ids.has(entry.segment)) problems.push(`cutOrder: unknown segment ${entry.segment}`);
  }
  let cutTotal = 0;
  for (const beat of film.cut30?.beats ?? []) {
    const segment = film.segments.find((candidate) => candidate.id === beat.segment);
    if (!segment) {
      problems.push(`cut30: unknown segment ${beat.segment}`);
      continue;
    }
    if (!(beat.duration > 0) || (beat.from ?? 0) < 0 || (beat.from ?? 0) + beat.duration > slot(segment) + 1e-6) {
      problems.push(`cut30: beat ${beat.segment} must sit inside its segment`);
    }
    cutTotal += beat.duration;
  }
  if (film.cut30 && Math.abs(cutTotal - 30) > 1e-6) problems.push(`cut30: beats add up to ${cutTotal} s, not 30 s`);
  return problems;
}

/** The beats a mode plays, in order: the master plays every segment that is not cut. */
export function beats(film, mode = "master") {
  const list =
    mode === "cut30"
      ? film.cut30.beats.map((beat) => ({
          segment: film.segments.find((candidate) => candidate.id === beat.segment),
          from: beat.from ?? 0,
          duration: beat.duration
        }))
      : film.segments.filter((segment) => !segment.cut).map((segment) => ({ segment, from: 0, duration: slot(segment) }));
  let at = 0;
  return list.map((beat, index) => {
    const previous = list[index - 1];
    const placed = {
      ...beat,
      index,
      start: at,
      tagIn: Boolean(beat.segment.tag) && previous?.segment.tag !== beat.segment.tag,
      lowerThird: lowerThirdWindow(beat.segment, beat)
    };
    at += beat.duration;
    return placed;
  });
}

/**
 * When the lower third is on screen inside a beat, in seconds from the beat's start. A beat that
 * shows less than MIN_TEXT_SECONDS of it shows none.
 */
export function lowerThirdWindow(segment, beat) {
  const third = segment.lowerThird;
  if (!third) return null;
  const length = slot(segment);
  const from = Math.max(third.from ?? LOWER_THIRD_IN, beat.from + (beat.from > 0 ? LOWER_THIRD_IN : 0));
  const to = Math.min(third.to ?? length - LOWER_THIRD_OUT, beat.from + beat.duration - LOWER_THIRD_OUT);
  if (to - from < MIN_TEXT_SECONDS) return null;
  return { start: from - beat.from, end: to - beat.from };
}

/** Every caption card film.json needs, with the content the card page draws. */
export function cardSpecs(film) {
  const cards = [{ id: "backdrop", kind: "backdrop" }];
  for (const text of Object.values(film.tags)) {
    cards.push({ id: tagCardId(text), kind: "tag", text, event: text === film.tags.during });
  }
  for (const segment of film.segments) {
    if (segment.lowerThird) {
      cards.push({
        id: `lower-${segment.id}`,
        kind: "lower",
        lines: segment.lowerThird.lines ?? segment.onScreen,
        position: segment.lowerThird.position ?? "bottom"
      });
    }
    for (const source of segment.picture) {
      if (!source.clip) continue;
      cards.push({
        id: `slate-${stem(source.clip)}`,
        kind: "slate",
        clip: source.clip,
        time: `${segment.start}–${segment.end}`,
        shows: source.shows ?? "",
        needs: segment.live?.needs ?? ""
      });
    }
  }
  cards.push({ id: "end", kind: "end", ...film.endSlate });
  return cards;
}

export const tagCardId = (text) => `tag-${slug(text)}`;

/** The stamp a rendered card folder carries; the assembler compares it before reusing frames. */
export function cardStamp(spec) {
  return { spec, page: pageHash(paths.cardsPage), fps: FPS };
}

/** A fingerprint of a page and the tokens it loads, so a changed page re-renders its frames. */
export function pageHash(page) {
  return createHash("sha256").update(readFileSync(page)).update(readFileSync(paths.tokens)).digest("hex").slice(0, 16);
}

const strip = (cell) => cell.replace(/\*\*/g, "").trim();

/** Read the approved script's shot table, capture table and cut order. */
export function readScript(path = paths.script) {
  const lines = readFileSync(path, "utf8").split("\n");
  const table = (header) => {
    const at = lines.findIndex((line) => line.startsWith(header));
    if (at < 0) throw new Error(`video/script.md has no table starting "${header}"`);
    const rows = [];
    for (let index = at + 2; index < lines.length && lines[index].startsWith("|"); index += 1) {
      rows.push(lines[index].slice(1, -1).split("|").map((cell) => cell.trim()));
    }
    return rows;
  };
  const shots = table("| Time | Picture | Voiceover |").map(([time, picture, voiceover, onScreen, built, live]) => {
    const [start, end] = time.split("–");
    return {
      start,
      end,
      picture,
      voiceover,
      onScreen: [...onScreen.matchAll(/“([^”]*)”/g)].map((match) => match[1]),
      built: strip(built),
      live: strip(live)
    };
  });
  const capture = table("| # | Shot | Needs | If it fails |").map(([order, shot, needs, ifItFails]) => ({
    order: Number(order),
    shot,
    starts: [...shot.matchAll(/\b(\d+:\d{2})\b/g)].map((match) => match[1]),
    needs,
    ifItFails
  }));
  const cutAt = lines.findIndex((line) => line.startsWith("**If time runs short, cut in this order:**"));
  const paragraph = [];
  for (let index = cutAt; cutAt >= 0 && index < lines.length && lines[index].trim() !== ""; index += 1) {
    paragraph.push(lines[index].trim());
  }
  const cutOrder = strip(paragraph.join(" ").replace(/^\*\*If time runs short, cut in this order:\*\*/, ""));
  return { shots, capture, cutOrder };
}

/**
 * Where film.json and the approved script disagree. Problems are words, tags and providers; notes are
 * times, which may move off the script's targets once the narration locks them.
 */
export function compareWithScript(film, script = readScript()) {
  const problems = [];
  const notes = [];
  if (film.segments.length !== script.shots.length) {
    problems.push(`film.json has ${film.segments.length} segments; the script has ${script.shots.length} rows`);
  }
  if (film.cutOrderScript !== script.cutOrder) problems.push("cutOrderScript differs from the script's cut order");
  const tagFor = { "Before the event": film.tags.before, During: film.tags.during, Close: null };
  script.shots.forEach((shot, index) => {
    const segment = film.segments[index];
    if (!segment) return;
    const where = `segment ${index + 1} (${segment.id})`;
    if (segment.start !== shot.start || segment.end !== shot.end) notes.push(`${where}: ${segment.start}–${segment.end}; the script's target is ${shot.start}–${shot.end}`);
    if (segment.voiceover !== shot.voiceover) problems.push(`${where}: the voiceover differs from the script`);
    if (JSON.stringify(segment.onScreen) !== JSON.stringify(shot.onScreen)) problems.push(`${where}: the on-screen text differs from the script`);
    if (!(shot.built in tagFor)) problems.push(`${where}: the script's Built column says "${shot.built}"`);
    else if (segment.tag !== tagFor[shot.built]) problems.push(`${where}: the tag should be ${JSON.stringify(tagFor[shot.built])}`);
    if (segment.live?.provider !== shot.live) problems.push(`${where}: live.provider should be "${shot.live}"`);
  });
  return { problems, notes };
}
