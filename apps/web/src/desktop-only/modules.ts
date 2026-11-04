import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Modules the browser build never runs, by the end of their resolved path, and the stub in this
 * folder that replaces each one (D-188). The perf gate counts every byte the build ships
 * (SC-009), so code the browser cannot reach has to leave the build, not just a chunk. Every stub
 * refuses plainly if anything reaches it.
 */
export const DESKTOP_ONLY_MODULES: Readonly<Record<string, string>> = {
  // zod hangs JSON Schema output on every schema it builds; only the desktop agent's tool
  // definitions ask for it.
  "/zod/v4/core/to-json-schema.js": "zod-to-json-schema.ts",
  "/zod/v4/core/json-schema-processors.js": "zod-json-schema-processors.ts",
  // The library offers manuscript import on the macOS desktop only (spec 029 T004, T016).
  "/packages/core/src/manuscript-import/index.ts": "manuscript-import.ts",
  "/packages/app/src/components/ImportPreviewDialog.tsx": "manuscript-import.ts",
  "/packages/app/src/components/ImportResultDialog.tsx": "manuscript-import.ts"
};

/** Import specifiers that can resolve to one of the modules above; anything else skips the plugin. */
const CANDIDATE = /to-json-schema|json-schema-processors|manuscript-import|ImportPreviewDialog|ImportResultDialog/;

/** The stub that replaces a resolved module id, or null when the browser build keeps the module. */
export function desktopOnlyStub(id: string): string | null {
  const path = (id.split("?")[0] ?? id).replaceAll("\\", "/");
  for (const [suffix, stub] of Object.entries(DESKTOP_ONLY_MODULES)) {
    if (path.endsWith(suffix)) return fileURLToPath(new URL(`./${stub}`, import.meta.url));
  }
  return null;
}

/** Resolves each desktop-only module to its stub, in the web build only. */
export function desktopOnlyModules(): Plugin {
  return {
    name: "studio:desktop-only-modules",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !CANDIDATE.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved ? desktopOnlyStub(resolved.id) : null;
    }
  };
}
