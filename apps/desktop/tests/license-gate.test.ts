import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyLicense, findException, licenseProblems, type LicenseAllowList } from "../../../scripts/license-gate.mjs";

/*
 * D-186: the license policy a shipped package must pass. SPDX expressions take the best branch of an
 * OR and the worst part of an AND; anything else needs an exception with a reason.
 */

const pkg = (name: string, license: string | null, version = "1.0.0") => ({ name, version, license });

describe("license classification", () => {
  test("permissive licenses and expressions pass", () => {
    for (const declared of ["MIT", "ISC", "0BSD", "Apache-2.0", "BlueOak-1.0.0", "(MIT AND Zlib)", "(AFL-2.1 OR BSD-3-Clause)", "Apache-2.0 WITH LLVM-exception", "mit"]) {
      expect(classifyLicense(declared)).toBe("permissive");
    }
  });

  test("an OR with a permissive branch passes; an AND with a copyleft part does not", () => {
    expect(classifyLicense("(MIT OR GPL-3.0-or-later)")).toBe("permissive");
    expect(classifyLicense("MIT AND GPL-2.0-only")).toBe("copyleft");
    expect(classifyLicense("(LGPL-2.1-only OR MPL-2.0)")).toBe("copyleft");
    expect(classifyLicense("GPL-2.0-only WITH Classpath-exception-2.0")).toBe("copyleft");
    expect(classifyLicense("AGPL-3.0-or-later")).toBe("copyleft");
  });

  test("missing, UNLICENSED and unparseable declarations are told apart", () => {
    expect(classifyLicense(null)).toBe("none");
    expect(classifyLicense("  ")).toBe("none");
    expect(classifyLicense("UNLICENSED")).toBe("unlicensed");
    expect(classifyLicense("SEE LICENSE IN LICENSE")).toBe("unknown");
    expect(classifyLicense("Custom-Proprietary")).toBe("unknown");
    expect(classifyLicense("(MIT")).toBe("unknown");
    expect(classifyLicense("MIT OR")).toBe("unknown");
    expect(classifyLicense("MIT AND Custom-Proprietary")).toBe("unknown");
  });
});

describe("the license gate", () => {
  const sam: LicenseAllowList = {
    exceptions: [
      { name: "custom-parser", license: "SEE LICENSE IN LICENSE", builds: ["desktop"], label: "Custom license", reason: "Synthetic reason." }
    ]
  };

  test("names each refused package and why", () => {
    const problems = licenseProblems(
      [
        {
          target: "web",
          packages: [pkg("fine", "MIT"), pkg("bare", null), pkg("closed", "UNLICENSED"), pkg("odd", "Custom-Proprietary"), pkg("shared", "GPL-3.0-only")]
        }
      ],
      { exceptions: [] }
    );
    expect(problems).toEqual([
      "web ships bare@1.0.0, which declares no license",
      "web ships closed@1.0.0, which is UNLICENSED",
      'web ships odd@1.0.0 under "Custom-Proprietary", which is not a license the gate knows; scripts/license-allow.json must allow it with a reason',
      "web ships shared@1.0.0 under copyleft GPL-3.0-only; scripts/license-allow.json must allow it with a reason"
    ]);
  });

  test("an exception covers only its package, its exact declared license and its builds", () => {
    expect(licenseProblems([{ target: "desktop", packages: [pkg("custom-parser", "SEE LICENSE IN LICENSE")] }], sam)).toEqual([]);
    expect(licenseProblems([{ target: "web", packages: [pkg("custom-parser", "SEE LICENSE IN LICENSE")] }], sam)).toHaveLength(1);
    expect(licenseProblems([{ target: "desktop", packages: [pkg("custom-parser", "SEE LICENSE IN COPYING")] }], sam)).toEqual([
      'desktop ships custom-parser@1.0.0 under "SEE LICENSE IN COPYING", which is not a license the gate knows; scripts/license-allow.json must allow it with a reason',
      "scripts/license-allow.json: the exception for custom-parser matches nothing the builds ship; remove it"
    ]);
  });

  test("an exception that matches nothing shipped is stale only once its builds were checked", () => {
    expect(licenseProblems([{ target: "desktop", packages: [pkg("fine", "MIT")] }], sam)).toEqual([
      "scripts/license-allow.json: the exception for custom-parser matches nothing the builds ship; remove it"
    ]);
    expect(licenseProblems([{ target: "web", packages: [pkg("fine", "MIT")] }], sam)).toEqual([]);
  });

  test("a malformed exception is refused and allows nothing", () => {
    const malformed = { exceptions: [{ name: "bare", license: "", builds: ["desktop"], reason: "" }] } as unknown as LicenseAllowList;
    expect(licenseProblems([{ target: "desktop", packages: [pkg("bare", "")] }], malformed)).toEqual([
      "scripts/license-allow.json: exception 1 needs a name, a license, its builds and a reason",
      "desktop ships bare@1.0.0, which declares no license"
    ]);
  });

  test("the committed allow-list has no exception, so the retired SAM parser could not ship again unnoticed", () => {
    const allow = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../scripts/license-allow.json"), "utf8")) as LicenseAllowList;
    expect(allow.exceptions).toEqual([]);
    // The parser left the build with the SAM cutout (D-158). Bringing it back fails the gate.
    const parser = pkg("@meta-sam/parser", "SEE LICENSE IN LICENSE", "0.1.0");
    expect(findException(allow, "desktop", parser)).toBeUndefined();
    expect(licenseProblems([{ target: "desktop", packages: [parser] }], allow)).toEqual([
      'desktop ships @meta-sam/parser@0.1.0 under "SEE LICENSE IN LICENSE", which is not a license the gate knows; scripts/license-allow.json must allow it with a reason'
    ]);
  });
});
