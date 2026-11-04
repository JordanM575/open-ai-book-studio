import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_ONLY_MODULES, desktopOnlyModules, desktopOnlyStub } from "../src/desktop-only/modules";
import * as manuscriptImport from "../src/desktop-only/manuscript-import";
import * as processors from "../src/desktop-only/zod-json-schema-processors";
import * as toJsonSchema from "../src/desktop-only/zod-to-json-schema";
import { MANUSCRIPT_IMPORT_DESKTOP_ONLY } from "../src/runtime/browser-api";

/**
 * D-188: the web build swaps modules the browser never runs for stubs, so their bytes leave the
 * bundle the perf gate counts (SC-009). Each stub must stand in for the whole module it replaces
 * and refuse plainly if anything reaches it. A missing named import already fails the build, but
 * zod reads its processors through a namespace, where a missing name would only be `undefined`.
 */

const stubs = fileURLToPath(new URL("../src/desktop-only/", import.meta.url));
// zod is the core package's dependency, so it resolves from there, as it does in the build.
const zodRoot = dirname(
  Bun.resolveSync("zod/package.json", fileURLToPath(new URL("../../../packages/core/", import.meta.url)))
);
const ZOD_PREFIX = "/zod/";

describe("desktop-only modules in the web build", () => {
  test("each zod stub exports every name of the zod module it replaces", async () => {
    const replaced = Object.keys(DESKTOP_ONLY_MODULES).filter((suffix) => suffix.startsWith(ZOD_PREFIX));
    expect(replaced.length).toBe(2);
    for (const suffix of replaced) {
      const realPath = join(zodRoot, suffix.slice(ZOD_PREFIX.length));
      const stubPath = desktopOnlyStub(realPath);
      expect(stubPath).not.toBeNull();
      const real = Object.keys(await import(realPath));
      const stub = Object.keys(await import(stubPath ?? ""));
      expect(real.length).toBeGreaterThan(0);
      expect(real.filter((name) => !stub.includes(name))).toEqual([]);
    }
  });

  test("the zod stubs refuse JSON Schema output, and the factories hand back a refusing method", () => {
    const message = toJsonSchema.JSON_SCHEMA_DESKTOP_ONLY;
    for (const factory of [toJsonSchema.createToJSONSchemaMethod, toJsonSchema.createStandardJSONSchemaMethod]) {
      const method = factory();
      expect(typeof method).toBe("function");
      expect(() => method()).toThrow(message);
    }
    for (const step of [
      toJsonSchema.initializeContext,
      toJsonSchema.handleUnrepresentable,
      toJsonSchema.processSchema,
      toJsonSchema.process,
      toJsonSchema.extractDefs,
      toJsonSchema.finalize
    ]) {
      expect(() => step()).toThrow(message);
    }
    for (const [name, value] of Object.entries(processors)) {
      if (name === "allProcessors") continue;
      expect(() => (value as () => unknown)()).toThrow(message);
    }
    expect(() => Reflect.get(processors.allProcessors, "string")).toThrow(message);
  });

  test("the manuscript import stubs refuse with the browser's import copy", () => {
    expect(Object.keys(manuscriptImport).sort()).toEqual(["ImportPreviewDialog", "ImportResultDialog", "buildImportReport"]);
    for (const stand of Object.values(manuscriptImport)) {
      expect(() => stand()).toThrow(MANUSCRIPT_IMPORT_DESKTOP_ONLY);
    }
  });

  test("only the listed modules are replaced, whatever the path style", () => {
    const bun = "/repo/node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core";
    expect(desktopOnlyStub(`${bun}/to-json-schema.js`)).toBe(join(stubs, "zod-to-json-schema.ts"));
    expect(desktopOnlyStub(`${bun}/json-schema-processors.js?v=1`)).toBe(join(stubs, "zod-json-schema-processors.ts"));
    expect(desktopOnlyStub("C:\\repo\\packages\\app\\src\\components\\ImportResultDialog.tsx")).toBe(
      join(stubs, "manuscript-import.ts")
    );
    expect(desktopOnlyStub("/repo/packages/core/src/manuscript-import/index.ts")).toBe(join(stubs, "manuscript-import.ts"));
    for (const kept of [
      `${bun}/index.js`,
      "/repo/packages/core/src/manuscript-import/docx.ts",
      "/repo/packages/app/src/components/ImportLossList.tsx",
      "/repo/packages/app/src/views/LibraryView.tsx"
    ]) {
      expect(desktopOnlyStub(kept)).toBeNull();
    }
  });

  test("the plugin resolves a listed import to its stub and leaves every other import alone", async () => {
    const resolveId = desktopOnlyModules().resolveId as unknown as (
      this: { resolve: (source: string) => Promise<{ id: string } | null> },
      source: string,
      importer: string | undefined,
      options: object
    ) => Promise<string | null>;
    const asked: string[] = [];
    const context = {
      resolve: async (source: string) => {
        asked.push(source);
        return source.includes("Missing") ? null : { id: `/repo/packages/app/src/components/${source.slice(14)}.tsx` };
      }
    };
    const importer = "/repo/packages/app/src/views/LibraryView.tsx";
    expect(await resolveId.call(context, "../components/ImportPreviewDialog", importer, {})).toBe(
      join(stubs, "manuscript-import.ts")
    );
    expect(await resolveId.call(context, "../components/MissingImportResultDialog", importer, {})).toBeNull();
    expect(await resolveId.call(context, "../components/ImportLossList", importer, {})).toBeNull();
    expect(await resolveId.call(context, "../components/ImportResultDialog", undefined, {})).toBeNull();
    // Only candidate specifiers with an importer reach the resolver.
    expect(asked).toEqual(["../components/ImportPreviewDialog", "../components/MissingImportResultDialog"]);
  });
});
