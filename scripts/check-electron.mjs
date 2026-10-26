#!/usr/bin/env node
/**
 * Bun skips lifecycle scripts it does not trust. Electron needs its postinstall to download the
 * binary, so tell the author exactly what to run when it is missing. Never fail the install: the
 * rest of the workspace is still usable for tests.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "node_modules", "electron"),
  join(root, "apps", "desktop", "node_modules", "electron")
];
const electronDir = candidates.find((dir) => existsSync(dir));

if (!electronDir) process.exit(0);

if (!existsSync(join(electronDir, "dist"))) {
  console.warn(
    "\n[studio] Electron's binary is not installed yet. Run:\n" +
      `  node ${join(electronDir, "install.js").replace(`${root}/`, "")}\n` +
      "then `bun run dev`.\n"
  );
}
