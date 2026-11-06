/**
 * Open-source attribution generated from the build (D-186).
 *
 * A Vite plugin records every package whose code ends up in a bundle: module ids under node_modules,
 * the packages a stylesheet imports (Tailwind's compiler inlines those outside the module graph) and
 * the bundler's own runtime helpers. The desktop adds the production dependency closure that
 * electron-vite leaves external, because the packaged app ships it, and Electron itself.
 *
 * Packages are read from their real roots (Bun's isolated layout keeps each one at
 * `node_modules/.bun/<name>@<version>/node_modules/<name>`) and de-duplicated by name and version.
 * The studio's own workspace packages are left out; its Apache-2.0 LICENSE and NOTICE head the report
 * instead. Each build writes one `licenses.json` and regenerates its own section of
 * THIRD_PARTY_NOTICES.md. Nothing records a path, a time or a commit, so one install always writes
 * the same files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOW_FILE, findException } from "./license-gate.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where each build writes its report, relative to the repository. */
export const REPORT_FILES = {
  desktop: "apps/desktop/out/main/licenses.json",
  web: "apps/web/dist/licenses.json"
};

export const NOTICES_FILE = "THIRD_PARTY_NOTICES.md";

const TARGETS = {
  // The packaged app ships the production dependencies beside the bundles, and Electron.
  desktop: { app: "apps/desktop", title: "Desktop app", build: "build", shipsDependencies: true, extras: ["electron"] },
  web: { app: "apps/web", title: "Web app", build: "build:web", shipsDependencies: false, extras: [] }
};

/** Electron's Chromium credits are one large file that ships beside it, so the entry points there. */
const NOTES = {
  electron:
    "Electron includes Chromium and other open-source projects. Their licenses ship with this app in LICENSES.chromium.html: in Contents/Resources on macOS, and next to the app's executable on Windows and Linux."
};

const LICENSE_FILE = /^(?:third[-_]?party[-_]?)?(?:licen[cs]es?|notices?|copying)(?:$|[.\-_])/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json|map)$/i;
const NODE_MODULES = "/node_modules/";

function posix(path) {
  return path.replaceAll("\\", "/");
}

function cleanId(id) {
  return posix(id.replace(/^\0/, "").split("?")[0]);
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trimEnd();
}

function isThirdParty(root) {
  return posix(root).includes(NODE_MODULES);
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The root of the package a bundled module belongs to, or null for the studio's own files. */
export function packageRootOf(id) {
  const path = cleanId(id);
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const [first, second] = path.slice(at + NODE_MODULES.length).split("/");
  if (!first || first.startsWith(".")) return null;
  const name = first.startsWith("@") ? (second ? `${first}/${second}` : null) : first;
  return name ? path.slice(0, at + NODE_MODULES.length) + name : null;
}

/** A dependency found the way Node finds it: the nearest `node_modules/<name>` above `from`. */
export function findPackage(from, name) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The declared license: the SPDX `license` field, or the legacy object and `licenses` forms. */
export function declaredLicense(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.trim()) return license.trim();
  if (typeof license?.type === "string" && license.type.trim()) return license.type.trim();
  const legacy = (Array.isArray(licenses) ? licenses : [licenses])
    .map((entry) => (typeof entry === "string" ? entry : entry?.type))
    .filter((type) => typeof type === "string" && type.trim())
    .map((type) => type.trim());
  if (legacy.length === 0) return null;
  return legacy.length === 1 ? legacy[0] : `(${legacy.join(" OR ")})`;
}

/** A browsable address from the shorthand, git and object forms npm accepts for `repository`. */
export function repositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  const hosted = value.match(/^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/);
  if (hosted) {
    const host = hosted[1] === "bitbucket" ? "bitbucket.org" : `${hosted[1]}.com`;
    return `https://${host}/${hosted[2].replace(/\.git$/, "")}`;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value.replace(/\.git$/, "")}`;
  const url = value
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:/]+):/, "https://$1/")
    .replace(/\.git$/, "");
  return /^https?:\/\/\S+$/.test(url) ? url : null;
}

function webUrl(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/.test(value.trim()) ? value.trim() : null;
}

/** The author's name, without the email address or URL npm's person format can carry. */
export function authorName(author) {
  const raw = typeof author === "string" ? author : author?.name;
  if (typeof raw !== "string") return null;
  return raw.replace(/<[^>]*>|\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || null;
}

/** Every license and notice file at a package root, in name order. */
export function licenseTexts(root) {
  return readdirSync(root)
    .filter((file) => LICENSE_FILE.test(file) && !CODE_FILE.test(file) && statSync(join(root, file)).isFile())
    .sort()
    .map((file) => ({ file, text: readText(join(root, file)) }));
}

/** One package as the licenses view and the notices show it. */
export function readPackage(root) {
  const manifest = readManifest(root);
  return {
    name: typeof manifest.name === "string" ? manifest.name : posix(root).split(NODE_MODULES).pop(),
    version: typeof manifest.version === "string" ? manifest.version : "unknown",
    license: declaredLicense(manifest),
    repository: repositoryUrl(manifest.repository),
    homepage: webUrl(manifest.homepage),
    author: authorName(manifest.author),
    texts: licenseTexts(root),
    note: null,
    exception: null
  };
}

/**
 * The production dependency closure of a workspace: `dependencies`, plus the `optionalDependencies`
 * that are installed, followed through node_modules. Workspace packages are walked through but not
 * listed, because they are the studio's own code. A required dependency that is not installed is
 * returned as missing rather than guessed at.
 */
export function dependencyClosure(dir) {
  const roots = new Set();
  const missing = [];
  const visited = new Set();
  const visit = (path) => {
    const root = realpathSync(path);
    if (visited.has(root)) return;
    visited.add(root);
    if (isThirdParty(root)) roots.add(root);
    const manifest = readManifest(root);
    const optional = manifest.optionalDependencies ?? {};
    for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(optional)])) {
      const found = findPackage(root, name);
      if (found) visit(found);
      else if (!(name in optional)) missing.push(`${manifest.name} needs ${name}`);
    }
  };
  visit(dir);
  return { roots: [...roots], missing };
}

/** A file inside a workspace package, through its `exports` map when it has one. */
function workspaceFile(root, subpath) {
  const request = `.${subpath}`;
  const { exports } = readManifest(root);
  if (!exports || typeof exports !== "object") return join(root, request);
  for (const [key, value] of Object.entries(exports)) {
    const target = typeof value === "string" ? value : (value?.style ?? value?.default);
    if (typeof target !== "string") continue;
    if (key === request) return join(root, target);
    const star = key.indexOf("*");
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (request.length >= key.length && request.startsWith(prefix) && request.endsWith(suffix)) {
      return join(root, target.replace("*", request.slice(prefix.length, request.length - suffix.length)));
    }
  }
  return null;
}

/**
 * Packages a stylesheet pulls in with `@import`, `@plugin` or `@reference`. Tailwind's compiler
 * inlines them outside the module graph, so no bundle lists them. Relative and workspace
 * stylesheets are followed; a package's own stylesheets are its own.
 */
export function stylesheetPackages(file, fallbacks = []) {
  const roots = new Set();
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, specifier] of css.matchAll(/@(?:import|plugin|reference)\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) {
        visit(resolve(dirname(path), specifier));
        continue;
      }
      if (/^(?:[a-z][\w+.-]*:|\/)/i.test(specifier)) continue;
      const name = packageName(specifier);
      let root = null;
      for (const dir of [dirname(path), ...fallbacks]) {
        root = findPackage(dir, name);
        if (root) break;
      }
      if (!root) continue;
      if (isThirdParty(root)) roots.add(root);
      else {
        const nested = workspaceFile(root, specifier.slice(name.length));
        if (nested) visit(nested);
      }
    }
  };
  visit(file);
  return [...roots];
}

/** Bundler runtime helpers arrive as virtual modules; credit the package that wrote them. */
function virtualOwner(id, appRoot) {
  const owner = ["vite", "rolldown"].find((name) => id.startsWith(`\0${name}/`));
  if (!owner) return null;
  const vite = findPackage(appRoot, "vite");
  return owner === "vite" || !vite ? vite : findPackage(vite, "rolldown");
}

/** The package behind an external import such as `ai` or `@ai-sdk/openai/internal`. */
function externalPackage(specifier, appRoot) {
  if (isBuiltin(specifier) || /^[./]/.test(specifier) || specifier.includes(":")) return null;
  return findPackage(appRoot, packageName(specifier));
}

export function readAllowList(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, ALLOW_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { exceptions: [] };
}

function readProject(repoRoot) {
  const manifest = readManifest(repoRoot);
  return {
    name: "Open Book Studio",
    version: typeof manifest.version === "string" ? manifest.version : "unknown",
    license: declaredLicense(manifest),
    texts: ["LICENSE", "NOTICE"]
      .filter((file) => existsSync(join(repoRoot, file)))
      .map((file) => ({ file, text: readText(join(repoRoot, file)) }))
  };
}

function byNameAndVersion(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  return 0;
}

/**
 * The report for one build: the studio's own license and notice, then each package once by name
 * and version. Notes and allowed exceptions ride along so the view can explain them.
 */
export function createReport({ target, roots, repoRoot = REPO_ROOT, allow = readAllowList(repoRoot) }) {
  const packages = new Map();
  for (const root of roots) {
    const entry = readPackage(root);
    const key = `${entry.name}@${entry.version}`;
    if (packages.has(key)) continue;
    const exception = findException(allow, target, entry);
    packages.set(key, {
      ...entry,
      note: NOTES[entry.name] ?? null,
      exception: exception ? { label: exception.label ?? exception.license, reason: exception.reason } : null
    });
  }
  return {
    schemaVersion: 1,
    target,
    project: readProject(repoRoot),
    packages: [...packages.values()].sort(byNameAndVersion)
  };
}

/** How a package's license reads in the notices: an allowed exception's label, else the declaration. */
export function licenseLabel(pkg) {
  return pkg.exception?.label ?? pkg.license ?? "No license declared";
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").replaceAll("|", "\\|");
}

function packageCount(report) {
  return `${report.packages.length} ${report.packages.length === 1 ? "package" : "packages"}`;
}

/** One build's section of THIRD_PARTY_NOTICES.md: a count and a package, version, license table. */
export function noticesTable(report) {
  return [
    `${packageCount(report)}.`,
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...report.packages.map((pkg) => `| \`${pkg.name}\` | ${cell(pkg.version)} | ${cell(licenseLabel(pkg))} |`)
  ].join("\n");
}

const HEADER = [
  "# Third-party notices",
  "",
  "Open Book Studio is licensed under Apache-2.0; see `LICENSE` and `NOTICE`. It is built on the",
  "open-source packages below.",
  "",
  "This file is generated by `bun run build` (desktop) and `bun run build:web` (web). Do not edit it",
  "by hand: each build rewrites its own section from the packages whose code it ships, with the license",
  "each package declares. The full license and notice texts ship with each build in `licenses.json`,",
  "and the app shows them under Settings → About → Show open-source licenses. Electron's Chromium",
  "credits ship with the desktop app in `LICENSES.chromium.html`.",
  "",
  "`bun run submission:check` fails when a shipped package has no license, an unknown license,",
  "`UNLICENSED` or a copyleft license, unless an exception with its reason is recorded in",
  `\`${ALLOW_FILE}\`.`
];

function mark(target, edge) {
  return `<!-- licenses:${target}:${edge} -->`;
}

function pending(target) {
  return `Not generated yet. Run \`bun run ${TARGETS[target].build}\`.`;
}

/** The whole notices file from each build's section; a build that has not run says so. */
export function renderNotices(sections) {
  const lines = [...HEADER];
  for (const [target, { title }] of Object.entries(TARGETS)) {
    lines.push("", `## ${title}`, "", mark(target, "start"), sections[target] ?? pending(target), mark(target, "end"));
  }
  return `${lines.join("\n")}\n`;
}

/** The generated sections of an existing notices file, by build. */
export function readNoticeSections(text) {
  const sections = {};
  for (const target of Object.keys(TARGETS)) {
    const start = text.indexOf(mark(target, "start"));
    const end = text.indexOf(mark(target, "end"));
    if (start < 0 || end < start) continue;
    const body = text.slice(start + mark(target, "start").length, end).trim();
    if (body && body !== pending(target)) sections[target] = body;
  }
  return sections;
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

/** Rewrite this build's section of the notices file, keeping the other build's. True when it changed. */
export function updateNotices(file, report) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = renderNotices({ ...readNoticeSections(current), [report.target]: noticesTable(report) });
  if (next === current) return false;
  writeAtomic(file, next);
  return true;
}

/**
 * The license collector for one build target. electron-vite runs the main, preload and renderer
 * builds in one process, so the desktop shares one collector across all three and writes once each
 * has written its bundle. Dev servers never run it, and watch rebuilds leave the notices alone.
 */
export function licenseCollector({ target, builds, repoRoot = REPO_ROOT, appRoot, reportFile, noticesFile }) {
  const config = TARGETS[target];
  const app = appRoot ?? join(repoRoot, config.app);
  const reportPath = reportFile ?? join(repoRoot, REPORT_FILES[target]);
  const noticesPath = noticesFile ?? join(repoRoot, NOTICES_FILE);
  const roots = new Set();
  const written = new Set();

  const add = (root) => {
    if (root && existsSync(join(root, "package.json"))) roots.add(realpathSync(root));
  };

  const finish = (watching) => {
    const closure = config.shipsDependencies ? dependencyClosure(app) : { roots: [], missing: [] };
    for (const root of closure.roots) add(root);
    for (const name of config.extras) add(findPackage(app, name));
    const report = createReport({ target, roots: [...roots], repoRoot });
    writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const changed = !watching && updateNotices(noticesPath, report);
    const updated = changed ? `; ${relative(repoRoot, noticesPath)} updated` : "";
    console.log(`[licenses] ${target}: ${packageCount(report)} in ${relative(repoRoot, reportPath)}${updated}`);
    for (const line of closure.missing) console.warn(`[licenses] ${line}, which is not installed, so it is not listed`);
  };

  return {
    plugin(build) {
      return {
        name: `studio-licenses:${build}`,
        apply: "build",
        generateBundle(_options, bundle) {
          for (const file of Object.values(bundle)) {
            if (file.type !== "chunk") continue;
            for (const id of file.moduleIds) {
              add(packageRootOf(id) ?? virtualOwner(id, app));
              const path = cleanId(id);
              if (path.endsWith(".css") && !path.includes(NODE_MODULES)) {
                for (const root of stylesheetPackages(path, [app])) add(root);
              }
            }
            for (const specifier of [...file.imports, ...file.dynamicImports]) {
              if (!(specifier in bundle)) add(externalPackage(specifier, app));
            }
          }
        },
        writeBundle() {
          written.add(build);
          if (builds.every((name) => written.has(name))) finish(Boolean(this.meta?.watchMode));
        }
      };
    }
  };
}
