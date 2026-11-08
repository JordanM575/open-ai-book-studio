/** Standalone incremental bundle measurement; not the existing whole-app bundle gate. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const directory = dirname(fileURLToPath(import.meta.url));
const app = resolve(directory, "../../../..");
const temporary = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "inline-editor-bundle-"));
try {
  const output = join(temporary, "inline.js");
  execFileSync("bun", ["build", join(directory, "../InlineTextSurface.tsx"), "--target=browser", "--format=esm", "--minify", "--external=react", "--external=react/jsx-runtime", `--outfile=${output}`], { cwd: app, stdio: "pipe" });
  const bytes = await readFile(output);
  console.log(JSON.stringify({
    tool: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
    entry: "InlineTextSurface.tsx", external: ["react", "react/jsx-runtime"],
    minifiedBytes: bytes.length, gzipBytes: gzipSync(bytes).length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  }, null, 2));
  const licenses = new Map();
  async function inspect(name, from) {
    if (licenses.has(name)) return;
    const require = createRequire(join(from, "package.json"));
    const entry = await realpath(require.resolve(name));
    let location = dirname(entry);
    let metadata;
    for (;;) {
      try { metadata = JSON.parse(await readFile(join(location, "package.json"), "utf8")); if (metadata.name === name) break; } catch {}
      const parent = dirname(location);
      if (parent === location) throw new Error(`Package metadata missing: ${name}`);
      location = parent;
    }
    const text = await readFile(join(location, "LICENSE"), "utf8");
    licenses.set(name, { name, version: metadata.version, license: metadata.license, licenseSha256: createHash("sha256").update(text).digest("hex"), text });
    for (const dependency of Object.keys(metadata.dependencies ?? {})) await inspect(dependency, location);
  }
  for (const name of ["@codemirror/commands", "@codemirror/state", "@codemirror/view"]) await inspect(name, app);
  for (const license of [...licenses.values()].sort((a, b) => a.name.localeCompare(b.name))) console.log(JSON.stringify(license));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
