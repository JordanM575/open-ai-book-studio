import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Tailwind 4 decides what an untyped arbitrary value means from its shape. A `var()` carries no unit,
 * so `text-[var(--text-caption-size)]` compiles to `color: var(--text-caption-size)`, an invalid colour
 * the browser ignores, and the text inherits the body size; `font-[var(--font-code)]` compiles to a
 * font weight. The typed forms compile to what the author should see:
 * `text-(length:--text-caption-size)` to `font-size` and `font-(family-name:--font-code)` to
 * `font-family`. This test keeps the untyped forms out of the interface source.
 */
const root = resolve(import.meta.dir, "../../..");
const tokens = readFileSync(join(root, "packages/ui/src/styles/tokens.generated.css"), "utf8");
const SOURCE = /\.(?:[cm]?[jt]sx?|css|html)$/;
// Build output is generated from the sources this test reads; the check gallery builds to gallery-dist.
const SKIP = new Set(["node_modules", "dist", "out", "gallery-dist"]);

const AMBIGUOUS = [
  {
    pattern: /(?<![\w-])text-(?:\[var\(|\()--text-[\w-]+\)\]?/g,
    fix: "Tailwind 4 compiles it to a colour; write the size as text-(length:--text-…-size)"
  },
  {
    pattern: /(?<![\w-])font-(?:\[var\(|\()--font-(?![\w-]*weight)[\w-]+\)\]?/g,
    fix: "Tailwind 4 compiles it to a font weight; write the family as font-(family-name:--font-…)"
  }
];

function sourceRoots(): string[] {
  const apps = readdirSync(join(root, "apps")).map((app) => join("apps", app, "src"));
  return ["packages/app/src", "packages/ui/src", ...apps, "apps/web/check"].filter((dir) =>
    existsSync(join(root, dir))
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

const files = sourceRoots().flatMap((dir) => sourceFiles(join(root, dir)));

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

describe("type sizes in the interface source", () => {
  test("covers the shared app, the primitives and every app", () => {
    const scanned = new Set(files.map((file) => relative(root, file).split("/").slice(0, 3).join("/")));
    for (const dir of ["packages/app/src", "packages/ui/src", "apps/desktop/src", "apps/web/src"]) {
      expect(scanned.has(dir)).toBe(true);
    }
  });

  test("no type size or font family is written in a form Tailwind 4 misreads", () => {
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, fix } of AMBIGUOUS) {
        for (const match of text.matchAll(pattern)) {
          found.push(`${relative(root, file)}:${lineOf(text, match.index)} ${match[0]}: ${fix}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  test("every type token the source names exists in the design tokens", () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/--text-[a-z0-9-]+?-(?:size|leading|weight|tracking)\b/g)) {
        if (!tokens.includes(`${match[0]}:`)) {
          missing.push(`${relative(root, file)}:${lineOf(text, match.index)} ${match[0]} is not in tokens.generated.css`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
