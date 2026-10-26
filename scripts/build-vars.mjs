import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [
  "package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "apps/mobile/package.json",
  "packages/app/package.json",
  "packages/core/package.json",
  "packages/ui/package.json"
];

/**
 * The version and commit shared by every build. The root package.json is the version source;
 * the workspace copies must agree.
 */
export function buildVars() {
  const versions = manifests.map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    return { path, version: manifest.version };
  });
  const distinct = [...new Set(versions.map((entry) => entry.version))];
  if (distinct.length !== 1 || typeof distinct[0] !== "string") {
    const detail = versions.map((entry) => `  ${entry.path}: ${entry.version}`).join("\n");
    throw new Error(`The workspace versions do not agree:\n${detail}`);
  }

  let commit = process.env.GIT_COMMIT ?? "";
  try {
    commit ||= execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    // A source archive without .git is a valid build input; the commit is then unknown.
  }

  return { version: distinct[0], commit: commit || "unknown" };
}
