#!/usr/bin/env node
/**
 * Assemble the product film from video/edit/film.json with ffmpeg.
 *
 *   node video/edit/assemble.mjs              the 3:00 master and its .srt
 *   node video/edit/assemble.mjs --cut30      the 0:30 cut
 *   node video/edit/assemble.mjs --check      planned and built durations and loudness; fails over 3:00
 *
 * Options: --version=v1 --date=YYYY-MM-DD --footage=<dir> --out=<dir> --film=<edit list> --keep (keep
 * the per-segment intermediates).
 *
 * Footage comes from video/footage/ (git-ignored). A missing clip becomes a slate that says
 * "Footage pending", so a build with no footage is a timing preview, never a fake. Plates and caption
 * cards that are missing or stale are rendered first through video/motion/render.mjs and
 * video/cards/render.mjs. Each segment's picture is fitted to its slot (trimmed, or its last frame
 * held), and its line is the same slice of video/footage/narration.wav, or silence. A clip with a
 * `sound` gain also plays its own audio under its picture. The finished sound is normalized to about
 * −14 LUFS integrated with a true peak under −1 dBTP (spec 021 FR-010).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beats,
  cardSpecs,
  cardStamp,
  clock,
  compareWithScript,
  FPS,
  frames,
  HEIGHT,
  loadFilm,
  MAX_SECONDS,
  pageHash,
  paths,
  root,
  seconds,
  slot,
  stem,
  tagCardId,
  WIDTH
} from "./film.mjs";

const RATE = 48_000;
const SAMPLES_PER_FRAME = RATE / FPS;
const AAC_FRAME = 1024;
const FADE = 0.3;
const PLATE_SECONDS = 3;
/**
 * FR-010: about −14 LUFS integrated, true peak at or under −1 dBTP. loudnorm aims 0.5 dB lower, because
 * the AAC encode adds a little peak. --check accepts −15 to −13 LUFS and a true peak up to −0.5 dBTP.
 */
const LOUDNESS = { integrated: -14, truePeak: -1.5, range: 11 };
const LOUDNESS_LIMITS = { low: -15, high: -13, truePeak: -0.5 };
const LOUDNORM = `loudnorm=I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const entry = args.find((arg) => arg.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};

if (flag("help")) {
  console.log("Usage: node video/edit/assemble.mjs [--cut30] [--check] [--version=v1] [--date=YYYY-MM-DD] [--footage=dir] [--out=dir] [--film=file] [--keep]");
  process.exit(0);
}

const filmPath = value("film", paths.film);
const film = loadFilm(filmPath);
const mode = flag("cut30") ? "cut30" : "master";
const footageDir = value("footage", paths.footage);
const outDir = value("out", paths.renders);
const version = value("version", film.version);
const today = new Date();
const date = value("date", `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
const base = `ai-book-studio-film-${version}-${date}`;
const output = join(outDir, `${base}-${mode === "cut30" ? "30s" : "master"}.mp4`);
const subtitles = join(outDir, `${base}.srt`);
const workDir = join(outDir, "edit", mode);
const buildRecord = join(workDir, "build.json");

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs.map(String), { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(`${label} failed (exit ${result.status ?? result.signal}):\n${tail}`);
  }
  return result;
}

function probe(file) {
  const json = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], `ffprobe ${file}`).stdout);
  const video = json.streams.find((stream) => stream.codec_type === "video");
  const audio = json.streams.find((stream) => stream.codec_type === "audio");
  return { duration: Number(json.format.duration), video, audio, streams: json.streams };
}

/** A clip named in film.json, or the same name with another movie extension. */
function findClip(name) {
  for (const candidate of [name, ...["mov", "mp4", "m4v"].map((ext) => `${stem(name)}.${ext}`)]) {
    const path = join(footageDir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

function footage() {
  const clips = new Map();
  for (const segment of film.segments) {
    for (const source of segment.picture) {
      if (!source.clip || clips.has(source.clip)) continue;
      const path = findClip(source.clip);
      clips.set(source.clip, path ? { path, ...probe(path) } : null);
    }
  }
  return clips;
}

function audioFile(name) {
  const path = name ? join(footageDir, name) : null;
  if (!path || !existsSync(path)) return null;
  const info = probe(path);
  return { path, duration: info.duration, channels: info.audio?.channels ?? 0 };
}

/** Seconds of narration after the last segment's end, which no segment plays. */
function narrationOverrun(narration) {
  if (!narration) return 0;
  return Math.max(0, narration.duration - seconds(film.segments.at(-1).end));
}

/** The last loudnorm print_format=json report in an ffmpeg log, with "-inf" read as -Infinity. */
function loudnormReport(log, label) {
  const json = log.match(/\{[^{}]*"input_i"[^{}]*\}/g)?.at(-1);
  if (!json) throw new Error(`${label}: loudnorm printed no report`);
  const report = JSON.parse(json);
  const number = (key) => Number(String(report[key]).replace("inf", "Infinity"));
  return {
    integrated: number("input_i"),
    truePeak: number("input_tp"),
    range: number("input_lra"),
    threshold: number("input_thresh"),
    offset: number("target_offset"),
    output: { integrated: number("output_i"), truePeak: number("output_tp") },
    type: report.normalization_type
  };
}

/** The loudness of a graph's [mix] output (LUFS, dBTP and LU), measured by loudnorm's first pass. */
function measure(inputs, graph) {
  const { stderr } = run(
    "ffmpeg",
    ["-hide_banner", "-nostats", ...inputs, "-filter_complex", `${graph};[mix]${LOUDNORM}:print_format=json[measured]`, "-map", "[measured]", "-f", "null", "-"],
    "loudness measurement"
  );
  return loudnormReport(stderr, "loudness measurement");
}

/**
 * Integrated loudness (LUFS) and true peak (dBTP) of a file's sound, from ffmpeg's EBU R128 meter, so
 * --check does not grade loudnorm with loudnorm's own meter. Silence reads -70 LUFS, peaking at -Infinity.
 */
function meter(file) {
  const { stderr } = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], `loudness of ${file}`);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const read = (pattern) => Number(pattern.exec(summary)?.[1].replace("inf", "Infinity"));
  return { integrated: read(/\sI:\s+(\S+) LUFS/), truePeak: read(/Peak:\s+(\S+) dBFS/) };
}

/**
 * loudnorm's second pass, from the first pass's measurement: a linear gain when the peak and range
 * allow it, otherwise its dynamic mode with the true-peak limiter. Null for silence, or for a
 * measurement outside loudnorm's option ranges.
 */
function normalizer(level) {
  const { integrated, truePeak, range, threshold, offset } = level;
  const usable = integrated >= -99 && integrated <= 0 && truePeak >= -99 && truePeak <= 99 && range >= 0 && range <= 99 && threshold >= -99 && threshold <= 0 && offset >= -99 && offset <= 99;
  if (!usable) return null;
  return `${LOUDNORM}:measured_I=${integrated}:measured_TP=${truePeak}:measured_LRA=${range}:measured_thresh=${threshold}:offset=${offset}:linear=true:print_format=json`;
}

/** How many seconds of picture a source supplies before the segment is fitted to its slot. */
function supplied(source, clips) {
  if (!source.clip) return source.duration;
  const clip = clips.get(source.clip);
  if (!clip) return source.duration;
  const end = Math.min(source.out ?? clip.duration, clip.duration);
  return Math.max(0, end - (source.in ?? 0));
}

/** In and out points that do not fit the recorded clip. */
function clipProblems(clips) {
  const problems = [];
  for (const segment of film.segments) {
    for (const source of segment.picture) {
      const clip = source.clip ? clips.get(source.clip) : null;
      if (!clip) continue;
      if ((source.in ?? 0) >= clip.duration) {
        problems.push(`${source.clip}: in is ${source.in} s, but the clip is ${clip.duration.toFixed(2)} s long`);
      }
    }
  }
  return problems;
}

/**
 * Frames each source plays in its slot. When the recorded clips run long, the excess comes off the
 * clips, last clip first, so a plate or card after a clip (the close card, the end slate) survives.
 */
function fitted(segment, clips) {
  const counts = segment.picture.map((source) => frames(supplied(source, clips)));
  let excess = counts.reduce((sum, count) => sum + count, 0) - frames(slot(segment));
  for (let index = counts.length - 1; index >= 0 && excess > 0; index -= 1) {
    const source = segment.picture[index];
    if (!source.clip || !clips.get(source.clip)) continue;
    const cut = Math.min(excess, counts[index]);
    counts[index] -= cut;
    excess -= cut;
  }
  return counts;
}

/** The sources a beat actually shows: the 0:30 cut plays only part of each segment. */
function onScreen(beat, clips) {
  const counts = fitted(beat.segment, clips);
  let at = 0;
  return beat.segment.picture.filter((_, index) => {
    const from = at;
    at += counts[index] / FPS;
    return counts[index] > 0 && from < beat.from + beat.duration && at > beat.from;
  });
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const frameCount = (folder) => readdirSync(folder).filter((file) => /^frame-\d{4}\.png$/.test(file)).length;

/** Render the plates these beats use, unless their frames and stamp are current. */
function ensurePlates(list) {
  const scenes = new Set(list.flatMap((beat) => beat.segment.picture.filter((source) => source.plate).map((source) => source.plate)));
  const stamp = { mode: "ambient", fps: FPS, seconds: PLATE_SECONDS, page: pageHash(paths.motionPage) };
  for (const scene of scenes) {
    const folder = join(paths.motion, scene);
    const current = readJson(join(folder, "film-stamp.json"));
    if (current && JSON.stringify(current) === JSON.stringify(stamp) && frameCount(folder) === FPS * PLATE_SECONDS) continue;
    console.log(`[film] rendering the ${scene} plate`);
    run("node", ["video/motion/render.mjs", "--all", "--ambient", `--scene=${scene}`, `--fps=${FPS}`, `--seconds=${PLATE_SECONDS}`], `plate ${scene}`);
    writeFileSync(join(folder, "film-stamp.json"), `${JSON.stringify(stamp, null, 2)}\n`);
  }
}

/** Render the cards these beats use, unless their frames and stamp are current. */
function ensureCards(list, clips) {
  const wanted = new Set(["backdrop"]);
  for (const beat of list) {
    if (beat.segment.tag) wanted.add(tagCardId(beat.segment.tag));
    if (beat.lowerThird) wanted.add(`lower-${beat.segment.id}`);
    for (const source of beat.segment.picture) {
      if (source.card) wanted.add(source.card);
      if (source.clip && !clips.get(source.clip)) wanted.add(`slate-${stem(source.clip)}`);
    }
  }
  const stale = cardSpecs(film)
    .filter((spec) => wanted.has(spec.id))
    .filter((spec) => {
      const current = readJson(join(paths.cards, spec.id, "spec.json"));
      return !current || JSON.stringify(current) !== JSON.stringify(cardStamp(spec));
    })
    .map((spec) => spec.id);
  if (stale.length === 0) return;
  console.log(`[film] rendering ${stale.length} caption card${stale.length === 1 ? "" : "s"}`);
  run("node", ["video/cards/render.mjs", `--only=${stale.join(",")}`, `--film=${filmPath}`], "caption cards");
}

/** The ffmpeg arguments for one beat: picture fitted to the slot, tag, lower third, line and clip sound. */
function beatArgs(beat, clips, narration, file) {
  const inputs = [];
  const graph = [];
  let count = 0;
  const input = (...list) => {
    inputs.push(...list);
    count += 1;
    return count - 1;
  };
  const { segment } = beat;
  const counts = fitted(segment, clips);
  const sounds = [];
  const parts = segment.picture.flatMap((source, index) => {
    const label = `s${index}`;
    const clip = source.clip ? clips.get(source.clip) : null;
    const n = counts[index];
    if (n === 0) return [];
    if (source.plate || source.card) {
      const folder = source.plate ? join(paths.motion, source.plate) : join(paths.cards, source.card);
      const at = input("-framerate", FPS, "-i", join(folder, "frame-%04d.png"));
      graph.push(`[${at}:v]format=rgba,setsar=1,tpad=stop_mode=clone:stop=${n},trim=end_frame=${n},setpts=PTS-STARTPTS[${label}]`);
    } else if (clip) {
      const backdrop = input("-loop", 1, "-framerate", FPS, "-i", join(paths.cards, "backdrop", "frame-0000.png"));
      const at = input("-ss", (source.in ?? 0).toFixed(3), "-t", (n / FPS).toFixed(3), "-i", clip.path);
      graph.push(`[${at}:v]fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,format=rgba[c${index}]`);
      graph.push(`[${backdrop}:v]format=rgba,setsar=1[b${index}]`);
      graph.push(
        `[b${index}][c${index}]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1:format=rgb,format=rgba,tpad=stop_mode=clone:stop=${n},trim=end_frame=${n},setpts=PTS-STARTPTS[${label}]`
      );
      if (source.sound > 0 && clip.audio) {
        sounds.push({ at, channels: clip.audio.channels, gain: source.sound, start: counts.slice(0, index).reduce((sum, count) => sum + count, 0), n });
      }
    } else {
      const at = input("-loop", 1, "-framerate", FPS, "-i", join(paths.cards, `slate-${stem(source.clip)}`, "frame-0000.png"));
      graph.push(`[${at}:v]format=rgba,setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${label}]`);
    }
    return [{ label, n }];
  });
  const slotFrames = frames(slot(segment));
  const pad = Math.max(0, slotFrames - parts.reduce((sum, part) => sum + part.n, 0));
  const first = frames(beat.from);
  const length = frames(beat.duration);
  graph.push(
    `${parts.map((part) => `[${part.label}]`).join("")}concat=n=${parts.length}:v=1:a=0,tpad=stop_mode=clone:stop=${pad},trim=start_frame=${first}:end_frame=${first + length},setpts=PTS-STARTPTS[pic]`
  );

  let last = "pic";
  if (segment.tag) {
    const folder = join(paths.cards, tagCardId(segment.tag));
    const settled = beat.tagIn ? [] : ["-start_number", frameCount(folder) - 1];
    const at = input("-framerate", FPS, ...settled, "-i", join(folder, "frame-%04d.png"));
    graph.push(`[${at}:v]format=rgba,setsar=1,tpad=stop_mode=clone:stop=${length},trim=end_frame=${length},setpts=PTS-STARTPTS[tag]`);
    graph.push(`[${last}][tag]overlay=0:0:format=rgb,format=rgba[tagged]`);
    last = "tagged";
  }
  if (beat.lowerThird) {
    const { start, end } = beat.lowerThird;
    const shown = frames(end - start);
    const at = input("-framerate", FPS, "-i", join(paths.cards, `lower-${segment.id}`, "frame-%04d.png"));
    graph.push(
      `[${at}:v]format=rgba,setsar=1,tpad=stop_mode=clone:stop=${shown},trim=end_frame=${shown},fade=t=out:st=${(shown / FPS - FADE).toFixed(3)}:d=${FADE}:alpha=1,setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[lower]`
    );
    graph.push(`[${last}][lower]overlay=0:0:eof_action=pass:format=rgb,format=rgba[captioned]`);
    last = "captioned";
  }
  graph.push(`[${last}]scale=${WIDTH}:${HEIGHT}:out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);

  const samples = length * SAMPLES_PER_FRAME;
  // A clip's sound runs with its picture: from its in point, after the sources before it, inside the beat.
  const mixed = sounds.flatMap(({ at, channels, gain, start, n }, index) => {
    const on = Math.max(start, first);
    const off = Math.min(start + n, first + length);
    if (off <= on) return [];
    const pan = channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
    const delay = (on - first) * SAMPLES_PER_FRAME;
    graph.push(
      `[${at}:a:0]${pan}aresample=${RATE}:async=1:first_pts=0,aformat=sample_fmts=flt:channel_layouts=stereo,apad,atrim=start_sample=${(on - start) * SAMPLES_PER_FRAME}:end_sample=${(off - start) * SAMPLES_PER_FRAME},asetpts=N/SR/TB,volume=${gain}${delay > 0 ? `,adelay=delays=${delay}S:all=1` : ""}[k${index}]`
    );
    return [`[k${index}]`];
  });
  const line = mixed.length > 0 ? "line" : "aout";
  const from = seconds(segment.start) + beat.from;
  if (mode === "master" && narration && narration.duration > from + 0.01) {
    const at = input("-ss", from.toFixed(3), "-t", beat.duration.toFixed(3), "-i", narration.path);
    const pan = narration.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
    graph.push(`[${at}:a]${pan}aresample=${RATE},aformat=sample_fmts=flt:channel_layouts=stereo,apad,atrim=end_sample=${samples},asetpts=N/SR/TB[${line}]`);
  } else {
    const at = input("-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=stereo`);
    graph.push(`[${at}:a]atrim=end_sample=${samples},asetpts=N/SR/TB[${line}]`);
  }
  if (mixed.length > 0) {
    // normalize=0 keeps every input at its own gain; amix would otherwise divide them by the input count.
    graph.push(`[line]${mixed.join("")}amix=inputs=${mixed.length + 1}:duration=first:normalize=0,apad,atrim=end_sample=${samples},asetpts=N/SR/TB[aout]`);
  }

  return [
    "-y",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-frames:v",
    length,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-qp",
    0,
    "-c:a",
    // Float, so a line and a clip that add up past full scale do not clip before the loudness pass.
    "pcm_f32le",
    file
  ];
}

/** Split a line of narration into caption chunks of at most two 42-character lines. */
function captionChunks(text) {
  const chunks = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= 84) {
      chunks.push(sentence);
      continue;
    }
    let current = "";
    for (const piece of sentence.split(/(?<=[,:;])\s+/)) {
      const joined = current ? `${current} ${piece}` : piece;
      if (joined.length <= 84 || !current) current = joined;
      else {
        chunks.push(current);
        current = piece;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

/** One line if it fits in 42 characters, else the most balanced two-line break. */
function wrap(chunk) {
  if (chunk.length <= 42) return [chunk];
  let best = null;
  for (let index = chunk.indexOf(" "); index > 0; index = chunk.indexOf(" ", index + 1)) {
    const split = [chunk.slice(0, index), chunk.slice(index + 1)];
    const worst = Math.max(split[0].length, split[1].length);
    if (!best || worst < best.worst) best = { worst, split };
  }
  return best ? best.split : [chunk];
}

const timestamp = (value) => {
  const ms = Math.round(value * 1000);
  const pad = (number, width = 2) => String(number).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** The voiceover as captions, each segment's line spread across its slot by length. */
function srt(list) {
  const cues = [];
  for (const beat of list) {
    const chunks = captionChunks(beat.segment.voiceover);
    const start = beat.start + 0.2;
    const span = beat.duration - 0.5;
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    let at = start;
    for (const chunk of chunks) {
      const length = (span * chunk.length) / total;
      cues.push({ from: at, to: at + length - 0.04, lines: wrap(chunk) });
      at += length;
    }
  }
  return cues.map((cue, index) => `${index + 1}\n${timestamp(cue.from)} --> ${timestamp(cue.to)}\n${cue.lines.join("\n")}\n`).join("\n");
}

function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows.map((row) => row.map((cell, column) => String(cell).padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

function plan(clips) {
  const rows = [["#", "segment", "script", "slot", "picture", "footage", "note"]];
  let total = 0;
  film.segments.forEach((segment, index) => {
    const length = slot(segment);
    const picture = segment.picture.reduce((sum, source) => sum + supplied(source, clips), 0);
    const named = segment.picture.filter((source) => source.clip);
    const present = named.filter((source) => clips.get(source.clip)).length;
    const gap = picture - length;
    const counts = fitted(segment, clips);
    const trimmed = segment.picture
      .map((source, index) => ({ source, lost: supplied(source, clips) - counts[index] / FPS }))
      .filter(({ lost }) => lost > 0.017)
      .map(({ source, lost }) => `${lost.toFixed(2)} s off ${source.clip}`);
    let note = "";
    if (segment.cut) note = "cut: picture and line dropped";
    else if (trimmed.length > 0) note = `trims ${trimmed.join(", ")}`;
    else if (gap > 0.017) note = `${gap.toFixed(2)} s trimmed from the end`;
    else if (gap < -0.017) note = `last frame held ${(-gap).toFixed(2)} s`;
    if (!segment.cut) total += length;
    rows.push([
      index + 1,
      segment.id,
      `${segment.start}–${segment.end}`,
      `${length.toFixed(2)} s`,
      `${picture.toFixed(2)} s`,
      named.length === 0 ? "none" : `${present}/${named.length}`,
      note
    ]);
  });
  return { rows, total };
}

function check() {
  const clips = footage();
  const { problems, notes } = compareWithScript(film);
  const failures = [...problems.map((problem) => `script: ${problem}`), ...clipProblems(clips)];
  const overrun = narrationOverrun(audioFile(film.narration));
  if (overrun > 0.05) failures.push(`${film.narration} runs ${overrun.toFixed(2)} s past the last segment's end, and those seconds would be dropped; lock the times to the narration`);
  const { rows, total } = plan(clips);
  const record = readJson(join(outDir, "edit", "master", "build.json"));
  rows[0].push("in master");
  for (const row of rows.slice(1)) {
    const built = record?.beats.find((beat) => beat.id === row[1]);
    row.push(built ? `${built.measured.toFixed(3)} s` : "");
  }
  console.log(`AI Book Studio film · ${film.version} · edit list against video/script.md\n`);
  console.log(table(rows));
  console.log(`\nPlanned master: ${total.toFixed(2)} s (${clock(total)}) of ${MAX_SECONDS} s.`);
  if (total > MAX_SECONDS + 1e-6) {
    const next = film.cutOrder.find((entry) => entry.segment && !film.segments.find((segment) => segment.id === entry.segment).cut);
    failures.push(`the planned master is ${(total - MAX_SECONDS).toFixed(2)} s over 3:00${next ? `; the script cuts ${next.segment} next` : ""}`);
  }
  for (const note of notes) console.log(`note: ${note}`);
  const pending = [...clips].filter(([, clip]) => !clip).map(([name]) => name);
  if (pending.length > 0) console.log(`Footage pending (${pending.length} of ${clips.size}): ${pending.join(", ")}`);

  for (const [kind, built] of [
    ["master", record],
    ["0:30 cut", readJson(join(outDir, "edit", "cut30", "build.json"))]
  ]) {
    const path = built?.output;
    if (!path || !existsSync(path)) {
      console.log(`${kind}: not built yet`);
      continue;
    }
    const info = probe(path);
    const limit = kind === "master" ? MAX_SECONDS : 30;
    const longest = Math.max(info.duration, ...info.streams.map((stream) => Number(stream.duration) || 0));
    const v = info.video;
    console.log(
      `${kind}: ${path.replace(`${root}/`, "")}\n  ${v.width}×${v.height} · ${v.r_frame_rate} (avg ${v.avg_frame_rate}) fps · ${v.codec_name} ${v.profile} · ${info.audio ? `${info.audio.codec_name} ${info.audio.sample_rate} Hz` : "no audio"} · ${info.duration.toFixed(3)} s (longest stream ${longest.toFixed(3)} s)`
    );
    if (longest > limit + 1e-6) failures.push(`the ${kind} is ${longest.toFixed(3)} s, over ${clock(limit, 0)}`);
    if (v.width !== WIDTH || v.height !== HEIGHT || v.r_frame_rate !== `${FPS}/1`) failures.push(`the ${kind} is not ${WIDTH}×${HEIGHT} at ${FPS} fps`);
    if (!info.audio) continue;
    // A build without narration is a preview, so its loudness is reported but not held to FR-010.
    const level = meter(path);
    const heard = level.integrated > -70 ? `${level.integrated.toFixed(1)} LUFS integrated · true peak ${level.truePeak.toFixed(1)} dBTP` : "silent";
    console.log(`  ${heard}${built.narration ? "" : " · not checked: built without narration"}`);
    if (!built.narration) continue;
    if (!(level.integrated >= LOUDNESS_LIMITS.low && level.integrated <= LOUDNESS_LIMITS.high)) {
      failures.push(`the ${kind} is ${level.integrated.toFixed(1)} LUFS integrated, outside ${LOUDNESS_LIMITS.low} to ${LOUDNESS_LIMITS.high} LUFS`);
    }
    if (!(level.truePeak <= LOUDNESS_LIMITS.truePeak)) failures.push(`the ${kind}'s true peak is ${level.truePeak.toFixed(1)} dBTP, above ${LOUDNESS_LIMITS.truePeak} dBTP`);
  }
  if (failures.length > 0) {
    console.error(`\nFAIL\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nPASS: the edit list matches the script and the film is 3:00 or shorter.");
}

function build() {
  const { problems } = compareWithScript(film);
  for (const problem of problems) console.warn(`[film] warning: film.json differs from video/script.md: ${problem}`);
  const clips = footage();
  const unusable = clipProblems(clips);
  if (unusable.length > 0) throw new Error(`fix the in and out points in film.json:\n- ${unusable.join("\n- ")}`);
  const list = beats(film, mode);
  const narration = audioFile(mode === "cut30" ? film.cut30.narration : film.narration);
  const overrun = mode === "master" ? narrationOverrun(narration) : 0;
  if (overrun > 0.05) console.warn(`[film] warning: ${film.narration} runs ${overrun.toFixed(2)} s past the last segment's end; that part is not in the master`);
  ensurePlates(list);
  ensureCards(list, clips);

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const built = [];
  for (const beat of list) {
    const file = join(workDir, `${String(beat.index + 1).padStart(2, "0")}-${beat.segment.id}.mov`);
    const started = Date.now();
    run("ffmpeg", beatArgs(beat, clips, narration, file), `segment ${beat.segment.id}`);
    const measured = probe(file).duration;
    built.push({ id: beat.segment.id, start: beat.start, frames: frames(beat.duration), measured, file });
    console.log(`[film] ${beat.segment.id}: ${clock(beat.start)} +${beat.duration.toFixed(2)} s (${((Date.now() - started) / 1000).toFixed(1)} s to build)`);
  }

  const segmentList = join(workDir, "segments.txt");
  writeFileSync(segmentList, built.map((entry) => `file '${entry.file.replaceAll("'", "'\\''")}'`).join("\n"));
  const totalFrames = built.reduce((sum, entry) => sum + entry.frames, 0);
  // End the audio on a whole AAC frame inside the last video frame, so no stream runs past the picture.
  const audioSamples = Math.floor((totalFrames * SAMPLES_PER_FRAME) / AAC_FRAME) * AAC_FRAME;
  const inputs = ["-f", "concat", "-safe", "0", "-i", segmentList];
  // [mix] is the sound before loudness: each beat's line and clip sound, and the 0:30 cut's own narration.
  let mix = `[0:a]atrim=end_sample=${audioSamples}[mix]`;
  if (mode === "cut30" && narration) {
    inputs.push("-i", narration.path);
    const pan = narration.channels === 1 ? "pan=stereo|c0=c0|c1=c0," : "";
    mix = `[1:a]${pan}aresample=${RATE},aformat=sample_fmts=flt:channel_layouts=stereo,apad,atrim=end_sample=${audioSamples}[line];[0:a][line]amix=inputs=2:duration=first:normalize=0,apad,atrim=end_sample=${audioSamples}[mix]`;
  }
  // Measure first, so the second pass can use one linear gain where the peak allows it.
  const level = measure(inputs, mix);
  const loudnorm = normalizer(level);
  if (!loudnorm && Number.isFinite(level.integrated)) {
    console.warn(`[film] warning: loudnorm cannot use its measurement (${level.integrated} LUFS, ${level.truePeak} dBTP), so the sound is not normalized`);
  }
  // loudnorm's dynamic mode runs at 192 kHz; the trim after it still ends the sound inside the picture.
  const audio = `${mix};[mix]${loudnorm ? `${loudnorm},` : ""}aresample=${RATE},apad,atrim=end_sample=${audioSamples},asetpts=N/SR/TB[a]`;
  mkdirSync(outDir, { recursive: true });
  const encoded = run(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-nostats",
      ...inputs,
      "-filter_complex",
      audio,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      18,
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      RATE,
      "-ac",
      2,
      "-movflags",
      "+faststart",
      "-metadata",
      `title=${film.title}`,
      output
    ],
    "final encode"
  );
  if (mode === "master") writeFileSync(subtitles, srt(list));
  writeFileSync(
    buildRecord,
    `${JSON.stringify({ mode, output, srt: mode === "master" ? subtitles : null, narration: narration ? narration.path : null, frames: totalFrames, beats: built.map(({ file, ...entry }) => entry) }, null, 2)}\n`
  );
  if (!flag("keep")) for (const entry of built) rmSync(entry.file, { force: true });

  const pending = new Set(list.flatMap((beat) => onScreen(beat, clips).filter((source) => source.clip && !clips.get(source.clip)).map((source) => source.clip)));
  const voiced = new Set(list.flatMap((beat) => onScreen(beat, clips).filter((source) => source.sound > 0 && clips.get(source.clip)?.audio).map((source) => source.clip)));
  const info = probe(output);
  console.log(`\n[film] ${mode === "cut30" ? "0:30 cut" : "master"} → ${output.replace(`${root}/`, "")} (${info.duration.toFixed(3)} s)`);
  if (mode === "master") console.log(`[film] captions → ${subtitles.replace(`${root}/`, "")}`);
  console.log(`[film] narration: ${narration ? narration.path.replace(`${root}/`, "") : "none"}`);
  console.log(`[film] clip sound: ${voiced.size > 0 ? [...voiced].join(", ") : "none"}`);
  if (loudnorm) {
    const { output: result, type } = loudnormReport(encoded.stderr, "final encode");
    console.log(`[film] loudness: ${level.integrated.toFixed(1)} → ${result.integrated.toFixed(1)} LUFS integrated, true peak ${result.truePeak.toFixed(1)} dBTP (${type})`);
  } else if (!Number.isFinite(level.integrated)) {
    console.log("[film] loudness: silence, so nothing to normalize");
  }
  if (pending.size > 0) {
    console.log(`[film] preview: ${pending.size} clip${pending.size === 1 ? " is" : "s are"} a footage-pending slate. Do not upload this file.`);
  }
}

try {
  if (flag("check")) check();
  else build();
} catch (error) {
  console.error(`[film] ${error.message}`);
  process.exit(1);
}
