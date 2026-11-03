#!/usr/bin/env node
/**
 * Spec 009 T004. Verifies a served artifact and the About values a tester reads
 * against the machine-readable release record. Passes only when the bytes, the
 * version, the commit and (when given) the signing status all agree.
 *
 * Nothing secret is involved: the record and About both show these values openly,
 * and a mismatch names the field, never file contents.
 *
 *   node scripts/release/check.mjs --record releases/record.json \
 *     --artifact release/ai-book-studio-web-0.1.0-abc123.tar.gz \
 *     --version 0.1.0 --commit abc123
 *
 * Exit codes: 0 everything agrees; 1 a comparison fails (the publication is
 * suspect); 2 the arguments are unusable; 3 the record or artifact cannot be
 * read or the record fails its own schema check.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, validateRecord } from "./record.mjs";

/**
 * @typedef {object} CheckInput
 * @property {unknown} record
 * @property {string} artifactName
 * @property {string} artifactSha256
 * @property {number} artifactBytes
 * @property {{ version?: string; commit?: string; signingStatus?: string }} [about]
 *
 * @typedef {object} CheckResult
 * @property {string} name
 * @property {boolean} ok
 * @property {string} detail
 */

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Compares already-read inputs so tests can exercise the whole matrix without
 * touching the filesystem. Every detail is safe to print: names, hashes and
 * the mismatched field — never file contents or secrets.
 */
export function checkRelease(input) {
  const problems = validateRecord(input.record);
  const record = input.record ?? {};




  
  const results = [];
  if (problems.length > 0) {
    return [{ name: "record", ok: false, detail: `the record fails its own schema check: ${problems.join("; ")}` }];
  }
  const entry = (record.artifacts ?? []).find((artifact) => artifact?.name === input.artifactName);
  if (!entry) {
    results.push({
      name: "artifact",
      ok: false,
      detail: `${input.artifactName} is not listed in the record`
    });
    return results;
  }
  results.push(
    entry.sha256 === input.artifactSha256
      ? { name: "sha256", ok: true, detail: `${input.artifactName} matches ${input.artifactSha256.slice(0, 12)}…` }
      : { name: "sha256", ok: false, detail: `${input.artifactName} does not match the recorded hash` },
    entry.bytes === input.artifactBytes
      ? { name: "bytes", ok: true, detail: `${input.artifactBytes} bytes` }
      : { name: "bytes", ok: false, detail: `served ${input.artifactBytes} bytes, record says ${entry.bytes}` }
  );
  if (input.about?.version !== undefined) {
    results.push(
      text(record.version) === input.about.version
        ? { name: "version", ok: true, detail: input.about.version }
        : {
            name: "version",
            ok: false,
            detail: `About shows ${input.about.version}, record says ${text(record.version)}`
          }
    );
  }
  if (input.about?.commit !== undefined) {
    results.push(
      text(record.commit) === input.about.commit
        ? { name: "commit", ok: true, detail: input.about.commit }
        : {
            name: "commit",
            ok: false,
            detail: `About shows ${input.about.commit}, record says ${text(record.commit)}`
          }
    );
  }
  if (input.about?.signingStatus !== undefined) {
    const status = record.signing === undefined || record.signing === null ? undefined : record.signing.status;
    results.push(
      status === input.about.signingStatus
        ? { name: "signing", ok: true, detail: String(status) }
        : { name: "signing", ok: false, detail: `About shows ${input.about.signingStatus}, record says ${String(status)}` }
    );
  }
  return results;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function fail(code, message) {
  process.stderr.write(`[release-check] ${message}\n`);
  process.exit(code);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(2, error && error.message ? error.message : String(error));
  }
  const recordPath = args["record"];
  const artifactPath = args["artifact"];
  if (!recordPath || !artifactPath) fail(2, "missing required --record and --artifact");
  const raw = await readFile(resolve(recordPath), "utf8").catch((error) => fail(3, `cannot read the record: ${error.message}`));
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    fail(3, "the record is not valid JSON");
  }
  const absolute = resolve(artifactPath);
  const snapshot = await stat(absolute).catch(() => null);
  if (!snapshot || !snapshot.isFile()) fail(3, `cannot read the artifact: ${artifactPath}`);
  const { sha256, bytes } = await hashFile(absolute).catch((error) =>
    fail(3, `cannot hash the artifact: ${error instanceof Error ? error.message : String(error)}`)
  );
  const results = checkRelease({
    record,
    artifactName: basename(absolute),
    artifactSha256: sha256,
    artifactBytes: bytes,
    about: {
      ...(args["version"] === undefined ? {} : { version: args["version"] }),
      ...(args["commit"] === undefined ? {} : { commit: args["commit"] }),
      ...(args["signing-status"] === undefined ? {} : { signingStatus: args["signing-status"] })
    }
  });
  for (const result of results) {
    process.stdout.write(`[release-check] ${result.ok ? "match" : "MISMATCH"} ${result.name}: ${result.detail}\n`);
  }
  if (results.some((result) => !result.ok)) {
    process.stderr.write("[release-check] the served artifact or About disagrees with the record\n");
    process.exit(1);
  }
  process.stdout.write("[release-check] the served artifact and About agree with the record\n");
}

const invokedAsScript = (() => {
  try {
    return resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  await main();
}
