#!/usr/bin/env node
/**
 * Spec 009 T001. Writes the machine-readable release record for the artifacts that are
 * actually served, and refuses a record whose file set does not match the artifact directory.
 *
 * Only names, sizes and hashes reach the record and the log — never file contents, prose or
 * credentials. Signing stays "unsigned" until D-115 is accepted; claiming "signed" without an
 * identity fails closed.
 *
 *   node scripts/release/record.mjs --dir release --out releases/record.json \
 *     --version 0.1.0 --commit abc123 --schema 1 --gates typecheck,test,smoke
 *
 * A record that already exists is never replaced: the run is refused and the old record is left
 * as it was. A new record is written to a temporary file next to it and linked into place, so the
 * final path never holds a half-written record.
 *
 * Exit codes: 0 wrote the record; 2 the arguments are unusable; 3 the artifact directory, its
 * file set or the output path is refused; 4 the record failed its own schema check.
 */
import { createHash } from "node:crypto";
import { link, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECORD_SCHEMA_VERSION = 1;

/**
 * The authoritative release-record shape. `notarization` is present only for signed
 * artifacts; `unsigned` is always explicit so no reader can mistake silence for signing.
 */
export const RECORD_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Open Book Studio release record",
  type: "object",
  required: ["schemaVersion", "version", "commit", "schema", "platform", "arch", "artifacts", "gates", "signing", "unsigned"],
  properties: {
    schemaVersion: { type: "integer", const: RECORD_SCHEMA_VERSION },
    version: { type: "string", minLength: 1 },
    commit: { type: "string", minLength: 1 },
    schema: { type: "integer", minimum: 1 },
    platform: { type: "string", enum: ["mac", "win", "linux"] },
    arch: { type: "string", enum: ["arm64", "x64"] },
    artifacts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "sha256", "bytes"],
        properties: {
          name: { type: "string", minLength: 1 },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          bytes: { type: "integer", minimum: 0 }
        }
      }
    },
    gates: { type: "array", items: { type: "string", minLength: 1 } },
    signing: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["unsigned", "signed"] },
        identity: { type: "string" },
        teamId: { type: "string" }
      }
    },
    notarization: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["accepted"] },
        staple: { type: "string", enum: ["valid"] }
      }
    },
    unsigned: { type: "boolean" }
  }
};

function fail(code, message) {
  process.stderr.write(`[record] ${message}\n`);
  process.exit(code);
}

/** The failure the library itself cannot produce is a schema failure; keep it loud. */
export function validateRecord(record) {
  const problems = [];
  const schema = RECORD_JSON_SCHEMA;
  if (typeof record !== "object" || record === null) return ["the record is not an object"];
  for (const key of schema.required) {
    if (!(key in record)) problems.push(`missing required field: ${key}`);
  }
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${RECORD_SCHEMA_VERSION}`);
  }
  for (const key of ["version", "commit"]) {
    if (key in record && (typeof record[key] !== "string" || record[key].length === 0)) {
      problems.push(`${key} must be a non-empty string`);
    }
  }
  if ("schema" in record && (!Number.isInteger(record.schema) || record.schema < 1)) {
    problems.push("schema must be a positive integer");
  }
  if ("platform" in record && !schema.properties.platform.enum.includes(record.platform)) {
    problems.push(`platform must be one of ${schema.properties.platform.enum.join(", ")}`);
  }
  if ("arch" in record && !schema.properties.arch.enum.includes(record.arch)) {
    problems.push(`arch must be one of ${schema.properties.arch.enum.join(", ")}`);
  }
  if ("artifacts" in record) {
    if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
      problems.push("artifacts must be a non-empty array");
    } else {
      for (const artifact of record.artifacts) {
        if (typeof artifact?.name !== "string" || artifact.name.length === 0) {
          problems.push("every artifact needs a non-empty name");
        }
        if (typeof artifact?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
          problems.push(`artifact ${artifact?.name ?? "?"} needs a 64-character lowercase hex sha256`);
        }
        if (!Number.isInteger(artifact?.bytes) || artifact.bytes < 0) {
          problems.push(`artifact ${artifact?.name ?? "?"} needs a non-negative integer byte count`);
        }
      }
    }
  }
  if ("gates" in record && (!Array.isArray(record.gates) || record.gates.some((gate) => typeof gate !== "string"))) {
    problems.push("gates must be an array of strings");
  }
  const signing = record.signing;
  if (signing !== undefined) {
    if (!["unsigned", "signed"].includes(signing?.status)) {
      problems.push('signing.status must be "unsigned" or "signed"');
    }
    if (signing?.status === "signed" && (typeof signing.identity !== "string" || signing.identity.length === 0)) {
      problems.push('a "signed" record needs a signing identity');
    }
  }
  if (record.unsigned !== (record.signing?.status === "unsigned")) {
    problems.push('unsigned must be true exactly when signing.status is "unsigned"');
  }
  if (record.notarization !== undefined && record.signing?.status !== "signed") {
    problems.push("notarization must not appear on an unsigned record");
  }
  return problems;
}

export function hashFile(path) {
  return new Promise((promiseResolve, promiseReject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("end", () => promiseResolve({ sha256: hash.digest("hex"), bytes }));
    stream.on("error", promiseReject);
  });
}

/**
 * Hashes every regular file directly inside the artifact directory, sorted by name.
 * Subdirectories are refused: the record must describe exactly the served file set.
 */
export async function hashArtifacts(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read artifact directory ${dir}: ${error.message}`);
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const dirs = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name);
  if (dirs.length > 0) {
    throw new Error(`artifact directory must be flat, found entries: ${dirs.join(", ")}`);
  }
  if (files.length === 0) {
    throw new Error(`artifact directory ${dir} holds no files; refusing an empty record`);
  }
  const artifacts = [];
  for (const name of files) {
    const path = join(dir, name);
    const snapshot = await stat(path).catch((error) => {
      throw new Error(`cannot stat artifact ${name}: ${error.message}`);
    });
    if (!snapshot.isFile()) throw new Error(`artifact ${name} is not a regular file`);
    const { sha256, bytes } = await hashFile(path).catch((error) => {
      throw new Error(`cannot hash artifact ${name}: ${error.message}`);
    });
    if (bytes !== snapshot.size) throw new Error(`artifact ${name} changed while hashing`);
    artifacts.push({ name, sha256, bytes });
  }
  return artifacts;
}

export function checkFileSet(artifacts, expected) {
  if (expected === undefined) return;
  const actual = new Set(artifacts.map((artifact) => artifact.name));
  const wanted = new Set(expected);
  const missing = [...wanted].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !wanted.has(name));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing from the directory: ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`in the directory but not expected: ${extra.join(", ")}`);
    throw new Error(`file set does not match the artifact directory — ${parts.join("; ")}`);
  }
}

function platformDefault() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "linux";
}

function archDefault() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

export function buildRecordObject({ version, commit, schema, platform, arch, artifacts, gates, signing }) {
  const record = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    version,
    commit,
    schema,
    platform,
    arch,
    artifacts,
    gates,
    signing,
    unsigned: signing.status === "unsigned"
  };
  if (signing.status === "signed") {
    record.notarization = signing.notarization ?? { status: "accepted", staple: "valid" };
  }
  return record;
}

/**
 * Publish `text` at `out` without replacing anything that is already there. The text goes to a
 * temporary file in the same folder first; hard-linking it to `out` fails if `out` exists, so an
 * earlier record is refused rather than overwritten, and `out` only ever appears complete. If the
 * file system cannot hard-link, nothing is published: there is no portable way to create a file
 * atomically without replacing, and a record written in place could be left half-written.
 * `ops.link` is injectable so the refusal can be tested.
 */
export async function publishRecord(out, text, ops = { link }) {
  const temp = join(dirname(out), `.${basename(out)}.${process.pid}.tmp`);
  const handle = await open(temp, "wx", 0o644);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await ops.link(temp, out);
  } catch (error) {
    await unlink(temp).catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(`refusing to replace the existing record ${out}; remove it first or choose another --out`);
    }
    if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(error?.code)) {
      throw new Error(`cannot publish the record atomically in ${dirname(out)}: this file system does not support hard links, so nothing was written; choose another --out folder`);
    }
    throw error;
  }
  await unlink(temp).catch(() => {});
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(2, error.message);
  }
  for (const key of ["dir", "out", "version", "commit", "schema"]) {
    if (!args[key]) fail(2, `missing required --${key}`);
  }
  const schema = Number(args.schema);
  if (!Number.isInteger(schema) || schema < 1) fail(2, "--schema must be a positive integer");
  const signingStatus = args["signing-status"] ?? "unsigned";
  if (!["unsigned", "signed"].includes(signingStatus)) fail(2, '--signing-status must be "unsigned" or "signed"');
  if (signingStatus === "signed" && !args["signing-identity"]) {
    fail(2, 'claiming "signed" needs --signing-identity; refusing a bare signed claim');
  }
  const dir = resolve(args.dir);
  let artifacts;
  try {
    artifacts = await hashArtifacts(dir);
  } catch (error) {
    fail(3, error.message);
  }
  if (args.expect !== undefined) {
    try {
      checkFileSet(
        artifacts,
        args.expect.split(",").map((name) => name.trim()).filter((name) => name.length > 0)
      );
    } catch (error) {
      fail(3, error.message);
    }
  }
  const record = buildRecordObject({
    version: args.version,
    commit: args.commit,
    schema,
    platform: args.platform ?? platformDefault(),
    arch: args.arch ?? archDefault(),
    artifacts,
    gates:
      args.gates === undefined
        ? []
        : args.gates.split(",").map((name) => name.trim()).filter((name) => name.length > 0),
    signing:
      signingStatus === "signed"
        ? { status: "signed", identity: args["signing-identity"], ...(args["signing-team"] ? { teamId: args["signing-team"] } : {}) }
        : { status: "unsigned" }
  });
  const problems = validateRecord(record);
  if (problems.length > 0) fail(4, `the record failed its own schema check: ${problems.join("; ")}`);
  const out = resolve(args.out);
  await mkdir(dirname(out), { recursive: true }).catch((error) => fail(3, `cannot create ${dirname(out)}: ${error.message}`));
  await publishRecord(out, `${JSON.stringify(record, null, 2)}\n`).catch((error) => fail(3, /^(refusing|cannot publish)/.test(error.message) ? error.message : `cannot write ${out}: ${error.message}`));
  for (const artifact of artifacts) {
    process.stdout.write(`[record] ${artifact.name} sha256 ${artifact.sha256}\n`);
  }
  process.stdout.write(`[record] wrote ${out}\n`);
}

const invokedAsScript = (() => {
  try {
    return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  await main();
}
