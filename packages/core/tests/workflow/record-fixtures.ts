import { createHash } from "node:crypto";
import { LibraryService } from "../../src/library/service";
import { InMemoryLibraryPort } from "../support/in-memory-port";

/** Synthetic only: no real manuscript, profile, credential or library is touched. */

export const at = "2026-11-07T12:00:00.000Z";
export const runId = "run_00000001";

export const hash = (n = 1): string => n.toString(16).padStart(64, "0");

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface Clock {
  value: string;
}

export function clockAt(value: string): Clock {
  return { value };
}

export function makeLibrary(clock: Clock = clockAt(at), deviceId = "device_fixture01") {
  const port = new InMemoryLibraryPort(
    { id: deviceId, name: "Synthetic workflow device", createdAt: at },
    () => clock.value
  );
  return { port, open: LibraryService.open({ storage: port, runtime: port }) };
}

export async function makeBook(clock: Clock = clockAt(at), deviceId = "device_fixture01") {
  const { port, open } = makeLibrary(clock, deviceId);
  const library = await open;
  const book = await library.createBook({ title: "Synthetic workflow book" });
  await library.establishBaseline();
  return { port, library, book, clock };
}

export interface Owner {
  libraryRegistration: string;
  bookId: string;
  runId: string;
}

export function ownerFor(
  bookId: string,
  run = runId,
  libraryRegistration = "host_00000001"
): Owner {
  return { libraryRegistration, bookId, runId: run };
}

export function reference(
  kind: string,
  owner: Owner,
  id: string,
  revision = 1
): Record<string, unknown> {
  return { kind, owner: { ...owner }, id, revision, hash: hash(revision + 1) };
}

export function runRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "run",
    owner,
    id: run,
    revision: 1,
    base: { kind: "absent", revision: 0 },
    generation: 1,
    mode: "running",
    phasePlan: reference("phase-plan", owner, "plan_00000001"),
    policy: reference("policy", owner, "policy_00000001"),
    direction: reference("direction", owner, "direction_00000001"),
    queue: [reference("task", owner, "task_00000001")],
    materialized: [],
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

export function taskRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "task",
    owner,
    id: "task_00000001",
    revision: 1,
    base: { kind: "absent", revision: 0 },
    generation: 1,
    plan: reference("phase-plan", owner, "plan_00000001"),
    phase: 1,
    definition: {
      role: "drafter",
      completion: "candidate",
      dependsOn: [],
      impact: { complete: true, keys: ["mara"] }
    },
    direction: reference("direction", owner, "direction_00000001"),
    currentAttempt: null,
    retryAllowed: false,
    needsDirection: false,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

export function attemptRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "attempt",
    owner,
    id: "attempt_00000001",
    revision: 1,
    base: { kind: "absent", revision: 0 },
    generation: 1,
    task: reference("task", owner, "task_00000001"),
    direction: reference("direction", owner, "direction_00000001"),
    context: reference("context", owner, "context_00000001"),
    inputDigest: hash(2),
    revisionOf: null,
    phase: "prepared",
    historical: false,
    noProgress: false,
    outputs: [],
    dispatch: null,
    accounting: {
      calls: 0,
      localReads: 0,
      knownSubtotalMicroUsd: 0,
      unknownCalls: 0,
      partialCalls: 0
    },
    providerReceipts: [],
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

export function effectRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "effect",
    owner,
    id: "effect_00000001",
    revision: 1,
    base: { kind: "absent", revision: 0 },
    generation: 1,
    attempt: reference("attempt", owner, "attempt_00000001"),
    candidate: reference("artifact", owner, "artifact_00000001"),
    phase: "prepared",
    target: { kind: "new-chapter", chapterId: "ch_00000001", path: "chapters/0001-scene.md" },
    intent: null,
    receipt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

export function questionRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "question",
    owner,
    id: "question_00000001",
    revision: 1,
    base: { kind: "absent", revision: 0 },
    generation: 1,
    keys: ["mara"],
    affected: ["task_00000001"],
    characterId: null,
    evidence: [],
    options: [],
    state: "open",
    answer: null,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

export function artifactMetadata(
  bookId: string,
  body: Uint8Array,
  overrides: Record<string, unknown> = {},
  run = runId
) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "artifact",
    owner,
    id: "artifact_00000001",
    revision: 1,
    mediaType: "text/markdown",
    bytes: body.byteLength,
    hash: sha256Hex(body),
    role: "drafter",
    producedBy: reference("attempt", owner, "attempt_00000001"),
    createdAt: at,
    ...overrides
  };
}

export function contextRecord(bookId: string, overrides: Record<string, unknown> = {}, run = runId) {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "context",
    owner,
    id: "context_00000001",
    revision: 1,
    sources: [reference("brief", owner, "brief_00000001")],
    chapters: [],
    envelopeDigest: hash(3),
    bytes: 128,
    createdAt: at,
    ...overrides
  };
}

export const encoderHelper = new TextEncoder();
