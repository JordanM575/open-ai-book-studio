import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { licenseProblems } from "../../../scripts/license-gate.mjs";
import {
  authorName,
  createReport,
  dependencyClosure,
  licenseCollector,
  noticesTable,
  packageRootOf,
  readNoticeSections,
  readPackage,
  renderNotices,
  repositoryUrl,
  stylesheetPackages
} from "../../../scripts/licenses.mjs";
import { licenseGate } from "../../../scripts/submission-check";
import { createLicenseReader } from "../src/main/licenses";

/*
 * D-186: the license collector against a synthetic install laid out the way Bun lays one out. Every
 * package lives once in `node_modules/.bun/<name>@<version>/node_modules/<name>`, its dependencies are
 * symlinked beside it, and each workspace links what it declares. The tree is built in a temporary
 * folder because `node_modules` is ignored by git, and every license text is a single synthetic line.
 */

let root = "";
let store = "";
let app = "";

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function text(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

/** One package in Bun's store, with its own files. */
async function stored(entry: string, name: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): Promise<string> {
  const pkg = join(store, entry, "node_modules", name);
  await json(join(pkg, "package.json"), { name, ...manifest });
  await text(join(pkg, "index.js"), "export default 1;\n");
  for (const [file, body] of Object.entries(files)) await text(join(pkg, file), body);
  return pkg;
}

async function link(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, "dir");
}

const names = (roots: string[]): string[] => roots.map((path) => readPackage(path).name).sort();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-licenses-"));
  store = join(root, "node_modules", ".bun");
  app = join(root, "apps", "app");
  await json(join(root, "package.json"), { name: "fixture-studio", version: "1.2.3", license: "Apache-2.0" });
  await text(join(root, "LICENSE"), "Fixture studio license.\n");
  await text(join(root, "NOTICE"), "Fixture studio notice.\n");
  await json(join(root, "scripts", "license-allow.json"), { exceptions: [] });

  const alpha = await stored("alpha@1.0.0", "alpha", { version: "1.0.0", license: "MIT", dependencies: { "@scope/gamma": "^3.0.0" } }, {
    LICENSE: "Alpha license text.\r\n"
  });
  const gamma = await stored("@scope+gamma@3.0.0", "@scope/gamma", { version: "3.0.0" });
  const beta = await stored("beta@2.0.0", "beta", { version: "2.0.0", licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }, {
    "COPYING.md": "Beta copying text.\n",
    "license.js": "export const notALicense = true;\n"
  });
  const deltaA = await stored("delta@1.0.0+aaa", "delta", { version: "1.0.0", license: "ISC" }, { "LICENSE.txt": "Delta license.\n" });
  await stored("delta@1.0.0+bbb", "delta", { version: "1.0.0", license: "ISC" }, { "LICENSE.txt": "Delta license.\n" });
  const styled = await stored(
    "styled@1.0.0",
    "styled",
    {
      version: "1.0.0",
      license: { type: "BSD-3-Clause" },
      repository: { type: "git", url: "git+https://github.com/example/styled.git", directory: "packages/styled" },
      homepage: "https://styled.example.com",
      author: { name: "Styled Author", email: "styled@example.com" }
    },
    { "index.css": "a {}\n" }
  );
  await link(gamma, join(store, "alpha@1.0.0", "node_modules", "@scope", "gamma"));

  // The app declares alpha and a workspace package; delta is a devDependency the bundle inlines.
  await json(join(app, "package.json"), {
    name: "@fixture/app",
    dependencies: { alpha: "*", "@fixture/shared": "workspace:*" },
    devDependencies: { delta: "*", styled: "*" }
  });
  await link(alpha, join(app, "node_modules", "alpha"));
  await link(deltaA, join(app, "node_modules", "delta"));
  await link(styled, join(app, "node_modules", "styled"));
  await link(join(root, "packages", "shared"), join(app, "node_modules", "@fixture", "shared"));
  await text(join(app, "src", "main.css"), '@import "styled";\n@import "./tokens.css";\n@import "@fixture/shared/styles/base.css";\n');
  await text(join(app, "src", "tokens.css"), '/* @import "commented-out"; */\n:root { --x: 1px; }\n');

  await json(join(root, "packages", "shared", "package.json"), {
    name: "@fixture/shared",
    exports: { "./styles/*": { default: "./src/styles/*" } },
    dependencies: { beta: "*" }
  });
  await link(beta, join(root, "packages", "shared", "node_modules", "beta"));
  await text(join(root, "packages", "shared", "src", "styles", "base.css"), '@plugin "beta";\n');

  await json(join(root, "apps", "broken", "package.json"), {
    name: "@fixture/broken",
    dependencies: { nowhere: "*" },
    optionalDependencies: { "not-for-this-platform": "*" }
  });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("the license collector", () => {
  test("maps a module id in Bun's store to its package root", () => {
    const pkg = join(store, "@scope+gamma@3.0.0", "node_modules", "@scope", "gamma");
    expect(packageRootOf(join(pkg, "dist", "index.js"))).toBe(pkg);
    expect(packageRootOf(`\0${join(pkg, "index.js")}?commonjs-proxy`)).toBe(pkg);
    expect(packageRootOf(join(root, "packages", "shared", "src", "index.ts"))).toBeNull();
    expect(packageRootOf("\0rolldown/runtime.js")).toBeNull();
  });

  test("reads a license string and the text of its license file", () => {
    const alpha = readPackage(join(store, "alpha@1.0.0", "node_modules", "alpha"));
    expect(alpha).toMatchObject({ name: "alpha", version: "1.0.0", license: "MIT" });
    expect(alpha.texts).toEqual([{ file: "LICENSE", text: "Alpha license text." }]);
  });

  test("reads a legacy licenses array, and a COPYING file but never a module named license.js", () => {
    const beta = readPackage(join(store, "beta@2.0.0", "node_modules", "beta"));
    expect(beta.license).toBe("(MIT OR Apache-2.0)");
    expect(beta.texts).toEqual([{ file: "COPYING.md", text: "Beta copying text." }]);
    expect(readPackage(join(store, "styled@1.0.0", "node_modules", "styled")).license).toBe("BSD-3-Clause");
  });

  test("walks dependencies through Bun's layout and the workspace without listing the workspace", () => {
    const closure = dependencyClosure(app);
    expect(names(closure.roots)).toEqual(["@scope/gamma", "alpha", "beta"]);
    expect(closure.missing).toEqual([]);
  });

  test("names a required dependency that is not installed instead of guessing", () => {
    expect(dependencyClosure(join(root, "apps", "broken")).missing).toEqual(["@fixture/broken needs nowhere"]);
  });

  test("follows stylesheet imports the module graph never sees", () => {
    expect(names(stylesheetPackages(join(app, "src", "main.css"), [app]))).toEqual(["beta", "styled"]);
  });

  test("de-duplicates by name and version and puts the studio's own license first", () => {
    const report = createReport({
      target: "web",
      roots: [
        join(store, "delta@1.0.0+aaa", "node_modules", "delta"),
        join(store, "beta@2.0.0", "node_modules", "beta"),
        join(store, "delta@1.0.0+bbb", "node_modules", "delta"),
        join(store, "alpha@1.0.0", "node_modules", "alpha")
      ],
      repoRoot: root
    });
    expect(report.packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(["alpha@1.0.0", "beta@2.0.0", "delta@1.0.0"]);
    expect(report.project).toMatchObject({ name: "Open Book Studio", version: "1.2.3", license: "Apache-2.0" });
    expect(report.project.texts.map((entry) => entry.file)).toEqual(["LICENSE", "NOTICE"]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(realpathSync(root));
  });

  test("the gate flags a shipped package with no license and passes the rest", () => {
    const report = createReport({
      target: "desktop",
      roots: dependencyClosure(app).roots,
      repoRoot: root
    });
    expect(licenseProblems([report], { exceptions: [] })).toEqual([
      "desktop ships @scope/gamma@3.0.0, which declares no license"
    ]);
  });

  test("the plugin writes one report after every build and only its own notices section", () => {
    const reportFile = join(root, "out", "desktop.json");
    const noticesFile = join(root, "NOTICES.md");
    const collector = licenseCollector({ target: "desktop", builds: ["main", "renderer"], repoRoot: root, appRoot: app, reportFile, noticesFile });
    type Hook = (this: unknown, ...args: unknown[]) => void;
    const run = (hook: unknown, ...args: unknown[]): void => (hook as Hook).call({ meta: { watchMode: false } }, ...args);
    const main = collector.plugin("main");
    const renderer = collector.plugin("renderer");

    run(main.generateBundle, {}, {
      "index.cjs": { type: "chunk", moduleIds: [join(store, "delta@1.0.0+aaa", "node_modules", "delta", "index.js")], imports: ["node:fs", "alpha", "chunk.cjs"], dynamicImports: [] },
      "chunk.cjs": { type: "chunk", moduleIds: [], imports: [], dynamicImports: [] }
    });
    run(main.writeBundle);
    expect(existsSync(reportFile)).toBe(false);

    run(renderer.generateBundle, {}, {
      "assets/index.js": {
        type: "chunk",
        moduleIds: [join(store, "delta@1.0.0+bbb", "node_modules", "delta", "index.js"), join(app, "src", "main.css"), "\0rolldown/runtime.js"],
        imports: [],
        dynamicImports: []
      },
      "assets/index.css": { type: "asset" }
    });
    run(renderer.writeBundle);

    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    expect(report.target).toBe("desktop");
    expect(report.packages.map((pkg: { name: string }) => pkg.name)).toEqual(["@scope/gamma", "alpha", "beta", "delta", "styled"]);
    const sections = readNoticeSections(readFileSync(noticesFile, "utf8"));
    expect(sections.desktop).toContain("| `delta` | 1.0.0 | ISC |");
    expect(sections.desktop).toContain("| `@scope/gamma` | 3.0.0 | No license declared |");
    expect(sections.web).toBeUndefined();
    expect(readFileSync(noticesFile, "utf8")).toContain("Not generated yet. Run `bun run build:web`.");

    // The web build fills its own section and keeps the desktop one as it was.
    const web = licenseCollector({ target: "web", builds: ["web"], repoRoot: root, appRoot: app, reportFile: join(root, "out", "web.json"), noticesFile });
    const plugin = web.plugin("web");
    run(plugin.generateBundle, {}, { "index.js": { type: "chunk", moduleIds: [join(store, "alpha@1.0.0", "node_modules", "alpha", "index.js")], imports: [], dynamicImports: [] } });
    run(plugin.writeBundle);
    const both = readNoticeSections(readFileSync(noticesFile, "utf8"));
    expect(both.desktop).toBe(sections.desktop);
    expect(both.web).toContain("| `alpha` | 1.0.0 | MIT |");
  });
});

describe("package metadata", () => {
  test("repository addresses become browsable links from every form npm accepts", () => {
    expect(repositoryUrl("git+https://github.com/example/one.git")).toBe("https://github.com/example/one");
    expect(repositoryUrl("git+ssh://git@github.com/example/two.git")).toBe("https://github.com/example/two");
    expect(repositoryUrl("git@gitlab.com:example/three.git")).toBe("https://gitlab.com/example/three");
    expect(repositoryUrl({ type: "git", url: "git://github.com/example/four.git" })).toBe("https://github.com/example/four");
    expect(repositoryUrl("github:example/five")).toBe("https://github.com/example/five");
    expect(repositoryUrl("bitbucket:example/six")).toBe("https://bitbucket.org/example/six");
    expect(repositoryUrl("example/seven")).toBe("https://github.com/example/seven");
    expect(repositoryUrl("https://example.com/eight/tree/main")).toBe("https://example.com/eight/tree/main");
  });

  test("anything that is not a web address is dropped rather than shown as a link", () => {
    for (const value of ["file:../local", "not a url", "", undefined, null, {}, { url: 42 }]) {
      expect(repositoryUrl(value)).toBeNull();
    }
  });

  test("an author is a name, without the email address or URL npm's person format carries", () => {
    expect(authorName("Jane Example <jane@example.com> (https://example.com)")).toBe("Jane Example");
    expect(authorName({ name: "Jane Example", email: "jane@example.com" })).toBe("Jane Example");
    expect(authorName("<jane@example.com>")).toBeNull();
    expect(authorName(undefined)).toBeNull();
  });

  test("a package's repository, homepage and author reach its entry", () => {
    expect(readPackage(join(store, "styled@1.0.0", "node_modules", "styled"))).toMatchObject({
      repository: "https://github.com/example/styled",
      homepage: "https://styled.example.com",
      author: "Styled Author"
    });
  });
});

describe("the submission license gate", () => {
  test("fails on a missing build, then on stale notices, and passes once they agree", async () => {
    const repo = await mkdtemp(join(tmpdir(), "studio-license-gate-"));
    try {
      const desktop = createReport({ target: "desktop", roots: [join(store, "alpha@1.0.0", "node_modules", "alpha")], repoRoot: root });
      const web = createReport({ target: "web", roots: [join(store, "beta@2.0.0", "node_modules", "beta")], repoRoot: root });
      await json(join(repo, "apps", "desktop", "out", "main", "licenses.json"), desktop);
      const missing = await licenseGate(repo);
      expect(missing.problems).toEqual(["licenses: apps/web/dist/licenses.json is missing; run `bun run build:web` first"]);

      await json(join(repo, "apps", "web", "dist", "licenses.json"), web);
      expect((await licenseGate(repo)).problems).toEqual([
        "licenses: THIRD_PARTY_NOTICES.md does not match the builds; rebuild and commit the regenerated file"
      ]);

      await text(join(repo, "THIRD_PARTY_NOTICES.md"), renderNotices({ desktop: noticesTable(desktop), web: noticesTable(web) }));
      const ready = await licenseGate(repo);
      expect(ready.problems).toEqual([]);
      expect(ready.summary).toBe("desktop 1, web 1 packages; 0 allowed exceptions");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("the desktop license reader", () => {
  test("reads and keeps a valid report", async () => {
    const file = join(root, "reader", "licenses.json");
    await json(file, createReport({ target: "desktop", roots: [join(store, "alpha@1.0.0", "node_modules", "alpha")], repoRoot: root }));
    const read = createLicenseReader(file);
    const report = await read();
    expect(report.packages.map((pkg) => pkg.name)).toEqual(["alpha"]);
    expect(await read()).toBe(report);
  });

  test("a missing or foreign list fails in the author's words without a path", async () => {
    const missing = join(root, "reader", "absent.json");
    const error = await createLicenseReader(missing)().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("This build has no list of open-source licenses. The list is written when the app is built.");
    const foreign = join(root, "reader", "web.json");
    await json(foreign, createReport({ target: "web", roots: [], repoRoot: root }));
    await expect(createLicenseReader(foreign)()).rejects.toThrow("could not be read");
  });
});
