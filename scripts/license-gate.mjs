/**
 * The license gate (D-186): which licenses a shipped package may carry.
 *
 * A package passes when its declared license is a permissive SPDX expression. Anything else fails:
 * no license, `UNLICENSED`, a value the gate does not know (such as "SEE LICENSE IN LICENSE"), or a
 * copyleft license. The one way through is an exception in `scripts/license-allow.json` that names
 * the package, its exact declared license and the builds that ship it, with a reason. An exception
 * that matches nothing shipped fails too, so the list never outlives its reasons.
 */

export const ALLOW_FILE = "scripts/license-allow.json";

/** Licenses a shipped package may carry without an exception, as lower-case SPDX ids. */
const PERMISSIVE = new Set(
  [
    "0BSD",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC-BY-3.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MIT-0",
    "Python-2.0",
    "Unlicense",
    "Zlib"
  ].map((id) => id.toLowerCase())
);

/** Copyleft families, strong and weak. Shipping one takes an explicit exception. */
const COPYLEFT = /^(?:agpl|gpl|lgpl|mpl|epl|eupl|cddl|cpl|osl|rpl|sspl|cc-by-sa|cc-by-nc-sa|ms-rl)(?:-|$)/;

const RANK = { permissive: 0, copyleft: 1, unknown: 2 };

function classifyId(token) {
  const id = token.replace(/\+$/, "").toLowerCase();
  if (PERMISSIVE.has(id)) return "permissive";
  if (COPYLEFT.test(id)) return "copyleft";
  return "unknown";
}

/**
 * Classify a declared license. An SPDX expression takes the best branch of an `OR` and the worst
 * part of an `AND`; `WITH` keeps the license's own class. A value that does not parse is unknown.
 */
export function classifyLicense(declared) {
  if (typeof declared !== "string" || !declared.trim()) return "none";
  if (declared.trim().toUpperCase() === "UNLICENSED") return "unlicensed";
  const tokens = declared.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  const peek = () => tokens[index]?.toUpperCase();
  const term = () => {
    const token = tokens[index++];
    if (token === undefined || /^(?:AND|OR|WITH|\))$/i.test(token)) throw new Error("expected a license");
    if (token === "(") {
      const inner = either();
      if (tokens[index++] !== ")") throw new Error("unclosed parenthesis");
      return inner;
    }
    if (peek() === "WITH") {
      index += 1;
      if (tokens[index++] === undefined) throw new Error("expected an exception");
    }
    return classifyId(token);
  };
  const both = () => {
    let verdict = term();
    while (peek() === "AND") {
      index += 1;
      const next = term();
      if (RANK[next] > RANK[verdict]) verdict = next;
    }
    return verdict;
  };
  const either = () => {
    let verdict = both();
    while (peek() === "OR") {
      index += 1;
      const next = both();
      if (RANK[next] < RANK[verdict]) verdict = next;
    }
    return verdict;
  };
  try {
    const verdict = either();
    return index === tokens.length ? verdict : "unknown";
  } catch {
    return "unknown";
  }
}

function wellFormed(exception) {
  return (
    exception !== null &&
    typeof exception === "object" &&
    typeof exception.name === "string" &&
    exception.name.length > 0 &&
    typeof exception.license === "string" &&
    exception.license.length > 0 &&
    Array.isArray(exception.builds) &&
    exception.builds.length > 0 &&
    exception.builds.every((build) => build === "desktop" || build === "web") &&
    typeof exception.reason === "string" &&
    exception.reason.trim().length > 0 &&
    (exception.label === undefined || typeof exception.label === "string")
  );
}

function exceptionsOf(allow) {
  return Array.isArray(allow?.exceptions) ? allow.exceptions : [];
}

/** The allow-list entry that lets this build ship this package as declared, if there is one. */
export function findException(allow, target, pkg) {
  return exceptionsOf(allow).find(
    (exception) =>
      wellFormed(exception) &&
      exception.name === pkg.name &&
      exception.license === pkg.license &&
      exception.builds.includes(target)
  );
}

function describe(target, pkg, verdict) {
  const id = `${target} ships ${pkg.name}@${pkg.version}`;
  if (verdict === "none") return `${id}, which declares no license`;
  if (verdict === "unlicensed") return `${id}, which is UNLICENSED`;
  if (verdict === "copyleft") {
    return `${id} under copyleft ${pkg.license}; ${ALLOW_FILE} must allow it with a reason`;
  }
  return `${id} under "${pkg.license}", which is not a license the gate knows; ${ALLOW_FILE} must allow it with a reason`;
}

/**
 * Every shipped package the policy refuses, plus allow-list entries that are malformed or match
 * nothing the given builds ship. An entry is only judged unused when every build it names was checked.
 */
export function licenseProblems(reports, allow) {
  const problems = [];
  const exceptions = exceptionsOf(allow);
  for (const [index, exception] of exceptions.entries()) {
    if (!wellFormed(exception)) {
      problems.push(`${ALLOW_FILE}: exception ${index + 1} needs a name, a license, its builds and a reason`);
    }
  }
  const used = new Set();
  for (const report of reports) {
    for (const pkg of report.packages) {
      const verdict = classifyLicense(pkg.license);
      if (verdict === "permissive") continue;
      const exception = findException(allow, report.target, pkg);
      if (exception) {
        used.add(exception);
        continue;
      }
      problems.push(describe(report.target, pkg, verdict));
    }
  }
  const checked = new Set(reports.map((report) => report.target));
  for (const exception of exceptions) {
    if (!wellFormed(exception) || used.has(exception)) continue;
    if (!exception.builds.every((build) => checked.has(build))) continue;
    problems.push(`${ALLOW_FILE}: the exception for ${exception.name} matches nothing the builds ship; remove it`);
  }
  return problems;
}
