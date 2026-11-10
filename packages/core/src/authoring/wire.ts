import {
  DEFAULT_LIMITS, OUTPUT_TOKENS, ROLES, sameOwner, validateGraph, validateOwner,
  type Graph, type Owner, type Role,
} from './contracts';
import {
  AuthoringError, copyValue, digest, freeze, id, integer, requireValue, text,
  type Immutable,
} from './value';

/** Raw schema-1 workflow record codec. No filesystem, Library, provider, clock or timer access. */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export const WORKFLOW_LIMITS = Object.freeze({
  depth: 64,
  runBytes: 2_500_000,
  phasePlanBytes: 2_500_000,
  recordBytes: 262_144,
  artifactBytes: 1_048_576,
  contextEnvelopeBytes: 2_500_000,
  tasksPerPlan: 1_024,
  queuedTaskReferences: 64,
  materializedRequests: 4,
  journalPageSize: 256,
  impactKeysPerTask: 256,
  contextSources: 64,
  attemptOutputs: 64,
  attemptCalls: 4,
  attemptReads: 8,
  questionOptions: 16,
});

export const WORKFLOW_KINDS = [
  'run', 'brief', 'policy', 'phase-plan', 'direction', 'task', 'command', 'journal-page',
  'attempt', 'effect', 'question', 'artifact', 'context', 'reservation', 'observation',
  'accounting',
] as const;
export type WorkflowKind = typeof WORKFLOW_KINDS[number];

const PREFIX: Readonly<Record<WorkflowKind, string>> = Object.freeze({
  run: 'run_', brief: 'brief_', policy: 'policy_', 'phase-plan': 'plan_',
  direction: 'direction_', task: 'task_', command: 'command_', 'journal-page': 'journal_',
  attempt: 'attempt_', effect: 'effect_', question: 'question_', artifact: 'artifact_',
  context: 'context_', reservation: 'reservation_', observation: 'observation_',
  accounting: 'accounting_',
});

export interface WorkflowReference<K extends WorkflowKind = WorkflowKind> {
  readonly kind: K;
  readonly owner: Owner;
  readonly id: string;
  readonly revision: number;
  readonly hash: string;
}

export type WorkflowBase =
  | { readonly kind: 'absent'; readonly revision: 0 }
  | { readonly kind: 'sha256'; readonly value: string; readonly revision: number };

export interface WorkflowRecord {
  readonly schemaVersion: 1;
  readonly kind: WorkflowKind;
  readonly owner: Owner;
  readonly id: string;
  readonly revision: number;
  readonly generation?: number;
  readonly base?: WorkflowBase;
  readonly [key: string]: unknown;
}

export interface WorkflowDecodeOptions<K extends WorkflowKind> {
  kind: K;
  owner: Owner;
  /** Test/recovery override; the record-kind bound still applies unless this is lower. */
  maxBytes?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function fail(code: string): never {
  throw new AuthoringError(code);
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

function wellFormed(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      requireValue(low >= 0xdc00 && low <= 0xdfff, 'invalid-unicode');
    } else requireValue(unit < 0xdc00 || unit > 0xdfff, 'invalid-unicode');
  }
}

/** Exact decimal identity for a JSON number token, without first rounding it through a double. */
function decimalValue(token: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/, '');
  const power = Number(match[4] ?? 0) - fraction.length + digits.length - significant.length;
  if (!Number.isSafeInteger(power)) return null;
  return `${match[1] ?? ''}${significant}e${power}`;
}

function losslessNumber(token: string): number {
  const value = Number(token);
  requireValue(Number.isFinite(value) && !Object.is(value, -0) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER, 'lossy-number');
  requireValue(decimalValue(token) === decimalValue(String(value)), 'lossy-number');
  return value;
}

class Reader {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.space();
    const value = this.value(0);
    this.space();
    requireValue(this.index === this.source.length, 'invalid-json');
    return value;
  }

  private space(): void {
    while (WHITESPACE.has(this.source.charCodeAt(this.index))) this.index++;
  }

  private value(depth: number): unknown {
    requireValue(depth <= WORKFLOW_LIMITS.depth, 'value-depth');
    this.space();
    const code = this.source.charCodeAt(this.index);
    if (code === 0x7b) return this.object(depth);
    if (code === 0x5b) return this.array(depth);
    if (code === 0x22) return this.string();
    if (code === 0x74) { this.literal('true'); return true; }
    if (code === 0x66) { this.literal('false'); return false; }
    if (code === 0x6e) { this.literal('null'); return null; }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return this.number();
    fail('invalid-json');
  }

  private object(depth: number): Record<string, unknown> {
    this.index++;
    this.space();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.source.charCodeAt(this.index) === 0x7d) { this.index++; return result; }
    for (;;) {
      this.space();
      requireValue(this.source.charCodeAt(this.index) === 0x22, 'invalid-json');
      const key = this.string();
      requireValue(!keys.has(key), 'duplicate-key');
      keys.add(key);
      this.space();
      requireValue(this.source.charCodeAt(this.index) === 0x3a, 'invalid-json');
      this.index++;
      const value = this.value(depth + 1);
      Object.defineProperty(result, key, {
        value, enumerable: true, writable: true, configurable: true,
      });
      this.space();
      const code = this.source.charCodeAt(this.index);
      if (code === 0x2c) { this.index++; continue; }
      requireValue(code === 0x7d, 'invalid-json');
      this.index++;
      return result;
    }
  }

  private array(depth: number): unknown[] {
    this.index++;
    this.space();
    const result: unknown[] = [];
    if (this.source.charCodeAt(this.index) === 0x5d) { this.index++; return result; }
    for (;;) {
      result.push(this.value(depth + 1));
      this.space();
      const code = this.source.charCodeAt(this.index);
      if (code === 0x2c) { this.index++; continue; }
      requireValue(code === 0x5d, 'invalid-json');
      this.index++;
      return result;
    }
  }

  private string(): string {
    requireValue(this.source.charCodeAt(this.index) === 0x22, 'invalid-json');
    this.index++;
    let result = '';
    for (;;) {
      requireValue(this.index < this.source.length, 'invalid-json');
      const code = this.source.charCodeAt(this.index++);
      if (code === 0x22) { wellFormed(result); return result; }
      if (code === 0x5c) {
        requireValue(this.index < this.source.length, 'invalid-json');
        const escapeCode = this.source.charCodeAt(this.index++);
        if (escapeCode === 0x22) result += '"';
        else if (escapeCode === 0x5c) result += '\\';
        else if (escapeCode === 0x2f) result += '/';
        else if (escapeCode === 0x62) result += '\b';
        else if (escapeCode === 0x66) result += '\f';
        else if (escapeCode === 0x6e) result += '\n';
        else if (escapeCode === 0x72) result += '\r';
        else if (escapeCode === 0x74) result += '\t';
        else if (escapeCode === 0x75) {
          requireValue(this.index + 4 <= this.source.length, 'invalid-json');
          const hex = this.source.slice(this.index, this.index + 4);
          requireValue(/^[0-9a-fA-F]{4}$/.test(hex), 'invalid-json');
          result += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 4;
        } else fail('invalid-json');
      } else {
        requireValue(code >= 0x20, 'invalid-json');
        result += String.fromCharCode(code);
      }
    }
  }

  private literal(word: string): void {
    requireValue(this.source.startsWith(word, this.index), 'invalid-json');
    this.index += word.length;
  }

  private number(): number {
    const start = this.index;
    if (this.source.charCodeAt(this.index) === 0x2d) this.index++;
    const first = this.source.charCodeAt(this.index);
    if (first === 0x30) this.index++;
    else {
      requireValue(first >= 0x31 && first <= 0x39, 'invalid-json');
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    if (this.source.charCodeAt(this.index) === 0x2e) {
      this.index++;
      requireValue(this.digit(this.source.charCodeAt(this.index)), 'invalid-json');
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    const exponent = this.source.charCodeAt(this.index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.index++;
      const sign = this.source.charCodeAt(this.index);
      if (sign === 0x2b || sign === 0x2d) this.index++;
      requireValue(this.digit(this.source.charCodeAt(this.index)), 'invalid-json');
      while (this.digit(this.source.charCodeAt(this.index))) this.index++;
    }
    const token = this.source.slice(start, this.index);
    const next = this.source.charCodeAt(this.index);
    requireValue(Number.isNaN(next) || WHITESPACE.has(next) || next === 0x2c || next === 0x5d ||
      next === 0x7d, 'invalid-json');
    return losslessNumber(token);
  }

  private digit(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  requireValue(bytes.length > 0, 'invalid-json');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('byte-order-mark');
  }
  let source: string;
  try { source = decoder.decode(bytes); } catch { fail('invalid-utf8'); }
  requireValue(source.charCodeAt(0) !== 0xfeff, 'byte-order-mark');
  return new Reader(source).parse();
}

/** Strict raw JSON admission shared with beside-store codecs; same refusals as the record reader. */
export function parseWorkflowJsonBytes(bytes: Uint8Array): unknown {
  return parseJsonBytes(bytes);
}

export function canonicalWorkflowJson(value: unknown): string {
  const active = new Set<object>();
  const visit = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'number') {
      requireValue(Number.isFinite(input) && !Object.is(input, -0) &&
        Math.abs(input) <= Number.MAX_SAFE_INTEGER, 'lossy-number');
      const encoded = JSON.stringify(input);
      requireValue(encoded !== undefined, 'invalid-value');
      return encoded;
    }
    if (typeof input === 'string') {
      wellFormed(input);
      const encoded = JSON.stringify(input);
      requireValue(encoded !== undefined, 'invalid-value');
      return encoded;
    }
    requireValue(typeof input === 'object' && input !== null, 'non-data-value');
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    requireValue(prototype === (array ? Array.prototype : Object.prototype) || prototype === null,
      'non-plain-value');
    requireValue(!active.has(input), 'cyclic-value');
    active.add(input);
    const keys = Reflect.ownKeys(input);
    let output: string;
    if (array) {
      const length = (input as unknown[]).length;
      requireValue(keys.length === length + 1, 'sparse-or-extended-array');
      const items: string[] = [];
      for (let index = 0; index < length; index++) {
        const property = Object.getOwnPropertyDescriptor(input, String(index));
        requireValue(property && 'value' in property && property.enumerable, 'non-data-property');
        items.push(visit(property.value));
      }
      output = `[${items.join(',')}]`;
    } else {
      const names: string[] = [];
      for (const key of keys) {
        requireValue(typeof key === 'string', 'symbol-property');
        names.push(key);
      }
      names.sort();
      const members: string[] = [];
      for (const key of names) {
        wellFormed(key);
        const property = Object.getOwnPropertyDescriptor(input, key);
        requireValue(property && 'value' in property && property.enumerable, 'non-data-property');
        members.push(`${JSON.stringify(key)}:${visit(property.value)}`);
      }
      output = `{${members.join(',')}}`;
    }
    active.delete(input);
    return output;
  };
  return visit(value);
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, code: string): unknown[] {
  requireValue(Array.isArray(value), code);
  return value;
}

function stringValue(value: unknown, maxUnits: number, maxBytes: number, code: string): string {
  requireValue(typeof value === 'string', code);
  text(value, maxUnits, maxBytes);
  return value;
}

function idValue(value: unknown): string {
  requireValue(typeof value === 'string', 'invalid-id');
  id(value);
  return value;
}

function digestValue(value: unknown): string {
  requireValue(typeof value === 'string', 'invalid-digest');
  digest(value);
  return value;
}

function isoValue(value: unknown): string {
  requireValue(typeof value === 'string', 'invalid-timestamp');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  requireValue(match, 'invalid-timestamp');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59,
  'invalid-timestamp');
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  requireValue(actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    code);
}

function referenceValue(value: unknown, kind: WorkflowKind, owner: Owner, minRevision = 1): void {
  const reference = objectValue(value, 'invalid-reference');
  requireValue(reference.kind === kind, 'invalid-reference-kind');
  validateOwner(reference.owner as Owner);
  requireValue(sameOwner(reference.owner as Owner, owner), 'foreign-reference');
  const referenceId = idValue(reference.id);
  requireValue(referenceId.startsWith(PREFIX[kind]), 'invalid-reference-id');
  integer(reference.revision, minRevision);
  digestValue(reference.hash);
}

function checkBase(record: Record<string, unknown>, checked: boolean, revision: number): void {
  if (!checked) {
    requireValue(!Object.hasOwn(record, 'base'), 'unexpected-base');
    return;
  }
  const base = objectValue(record.base, 'invalid-base');
  if (revision === 1) {
    exactKeys(base, ['kind', 'revision'], 'stale-base');
    requireValue(base.kind === 'absent' && base.revision === 0, 'stale-base');
    return;
  }
  exactKeys(base, ['kind', 'value', 'revision'], 'stale-base');
  requireValue(base.kind === 'sha256', 'stale-base');
  digestValue(base.value);
  integer(base.revision, 0);
  requireValue(base.revision === revision - 1, 'stale-base');
}

const DESTINATION_KEYS = ['connectionId', 'providerId', 'modelId', 'accountKey'] as const;
function validateDestination(value: unknown): void {
  const destination = objectValue(value, 'invalid-destination');
  exactKeys(destination, DESTINATION_KEYS, 'invalid-destination');
  idValue(destination.connectionId);
  idValue(destination.providerId);
  idValue(destination.accountKey);
  const model = stringValue(destination.modelId, 512, 2_048, 'invalid-destination');
  requireValue(model.length > 0, 'invalid-destination');
}

function validateAccounting(value: unknown): void {
  const accounting = objectValue(value, 'invalid-accounting');
  if (accounting.kind === 'reported' || accounting.kind === 'partial') {
    exactKeys(accounting, ['kind', 'microUsd'], 'invalid-accounting');
    integer(accounting.microUsd, 0);
  } else if (accounting.kind === 'unknown') {
    exactKeys(accounting, ['kind'], 'invalid-accounting');
  } else fail(typeof accounting.kind === 'string' ? 'unknown-accounting-kind' : 'invalid-accounting');
}

const RECEIPT_OUTCOMES = new Set(['succeeded', 'failed', 'stopped']);
function validateReservationReceipt(value: unknown): void {
  const receipt = objectValue(value, 'invalid-receipt');
  exactKeys(receipt, ['id', 'outcome', 'accounting'], 'invalid-receipt');
  idValue(receipt.id);
  requireValue(typeof receipt.outcome === 'string' && RECEIPT_OUTCOMES.has(receipt.outcome),
    typeof receipt.outcome === 'string' ? 'unknown-receipt-outcome' : 'invalid-receipt-outcome');
  validateAccounting(receipt.accounting);
}

const RUN_MODES = new Set([
  'running', 'pausing', 'paused', 'cancelling', 'cancelled', 'revoking', 'revoked',
  'finishing', 'finished',
]);
const TASK_STATUSES = new Set([
  'blocked', 'ready', 'preparing', 'executing', 'validating', 'ready-to-publish', 'completed',
  'failed', 'stale', 'uncertain', 'needs-direction',
]);
const ATTEMPT_PHASES = new Set([
  'prepared', 'dispatch-intent', 'receiving', 'output-kept', 'completed', 'failed', 'stopped',
  'uncertain',
]);
const EFFECT_PHASES = new Set([
  'prepared', 'publish-intent', 'confirmed', 'conflict', 'not-published', 'uncertain',
]);
const QUESTION_STATES = new Set(['open', 'answered', 'superseded', 'withdrawn']);
const RESERVATION_PHASES = new Set(['reserved', 'dispatched', 'uncertain', 'settled', 'released']);
const ACTION_TYPES = new Set([
  'pause', 'cancel', 'revoke', 'resume', 'recover', 'finish', 'question', 'close-question',
  'answer', 'direction', 'retry', 'prepare', 'attempt', 'prepare-effect', 'effect',
]);
const DIRECTIONS = new Set(['onboarding', 'outline', 'cast', 'answer', 'author']);
const JOURNAL_KINDS = new Set(['command', 'receipt']);
const OBSERVATION_KINDS = new Set(['dispatch', 'known-unsent', 'uncertain', 'receipt']);

const LIMIT_KEYS = [
  'concurrency', 'calls', 'activeMs', 'lifetimeMs', 'localRevisions', 'globalRevisions',
  'callsPerAttempt', 'readsPerAttempt', 'outputBytes',
] as const;
const LIMIT_MINIMUMS: Readonly<Record<typeof LIMIT_KEYS[number], number>> = Object.freeze({
  concurrency: 1, calls: 1, activeMs: 1, lifetimeMs: 1, localRevisions: 0, globalRevisions: 0,
  callsPerAttempt: 1, readsPerAttempt: 1, outputBytes: 1,
});

function validateRun(record: Record<string, unknown>, owner: Owner): void {
  for (const key of ['attempts', 'effects', 'questions', 'commands', 'artifacts', 'snapshot']) {
    requireValue(!Object.hasOwn(record, key), 'embedded-run-aggregate');
  }
  requireValue(typeof record.mode === 'string' && RUN_MODES.has(record.mode),
    typeof record.mode === 'string' ? 'unknown-mode' : 'invalid-mode');
  referenceValue(record.phasePlan, 'phase-plan', owner);
  referenceValue(record.policy, 'policy', owner);
  referenceValue(record.direction, 'direction', owner);
  const queue = arrayValue(record.queue, 'invalid-queue');
  requireValue(queue.length <= WORKFLOW_LIMITS.queuedTaskReferences, 'record-count');
  const queued = new Set<string>();
  for (const item of queue) {
    referenceValue(item, 'task', owner);
    const taskId = (item as WorkflowReference).id;
    requireValue(!queued.has(taskId), 'duplicate-task');
    queued.add(taskId);
  }
  const materialized = arrayValue(record.materialized, 'invalid-materialized');
  requireValue(materialized.length <= WORKFLOW_LIMITS.materializedRequests, 'record-count');
  const reserved = new Set<string>();
  for (const item of materialized) {
    referenceValue(item, 'reservation', owner);
    const reservationId = (item as WorkflowReference).id;
    requireValue(!reserved.has(reservationId), 'duplicate-reservation');
    reserved.add(reservationId);
  }
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

function validateBrief(record: Record<string, unknown>): void {
  stringValue(record.text, 20_000, 65_536, 'invalid-text');
  idValue(record.goalId);
  integer(record.targetWords, 1);
  for (const key of ['genre', 'audience', 'perspective', 'tone']) {
    if (Object.hasOwn(record, key)) stringValue(record[key], 2_000, 8_192, 'invalid-text');
  }
  if (Object.hasOwn(record, 'constraints')) {
    const constraints = arrayValue(record.constraints, 'invalid-record');
    requireValue(constraints.length <= 64, 'record-count');
    for (const constraint of constraints) stringValue(constraint, 2_000, 8_192, 'invalid-text');
  }
  isoValue(record.createdAt);
}

function validatePolicy(record: Record<string, unknown>): void {
  digestValue(record.policyDigest);
  integer(record.startedAtMs, 0);
  const limits = objectValue(record.limits, 'invalid-limits');
  exactKeys(limits, LIMIT_KEYS, 'invalid-limits');
  for (const key of LIMIT_KEYS) {
    const maximum = key === 'concurrency' ? 4 : DEFAULT_LIMITS[key];
    integer(limits[key], LIMIT_MINIMUMS[key], maximum);
  }
  const routes = arrayValue(record.routes, 'invalid-routes');
  requireValue(routes.length > 0 && routes.length <= ROLES.length, 'invalid-routes');
  const roles = new Set<string>();
  for (const route of routes) {
    const item = objectValue(route, 'invalid-route');
    exactKeys(item, ['role', 'destination'], 'invalid-route');
    requireValue(typeof item.role === 'string' && ROLES.includes(item.role as Role) &&
      !roles.has(item.role), 'invalid-route');
    roles.add(item.role);
    validateDestination(item.destination);
  }
  const cost = objectValue(record.cost, 'invalid-cost');
  if (cost.mode === 'bounded-operations') exactKeys(cost, ['mode'], 'invalid-cost');
  else if (cost.mode === 'strict-money') {
    exactKeys(cost, ['mode', 'capMicroUsd'], 'invalid-cost');
    integer(cost.capMicroUsd, 1);
  } else fail('invalid-cost');
  isoValue(record.createdAt);
}

function validatePhasePlan(record: Record<string, unknown>, owner: Owner): void {
  integer(record.phase, 1);
  if (record.previous !== null) referenceValue(record.previous, 'phase-plan', owner);
  const graphInput = objectValue(record.graph, 'invalid-graph');
  const graph = validateGraph(graphInput as unknown as Graph);
  requireValue(sameOwner(graph.owner, owner), 'foreign-owner');
  requireValue(graph.generation === record.generation, 'stale-generation');
  for (const task of graph.tasks) validateImpact(task.impact);
  // Phase 1 begins the plan; every later phase names its predecessor.
  requireValue((record.phase === 1) === (record.previous === null), 'stale-phase-link');
  isoValue(record.createdAt);
}

function validateDirection(record: Record<string, unknown>, owner: Owner): void {
  stringValue(record.exactText, 262_144, 262_144, 'invalid-text');
  requireValue(typeof record.origin === 'string' && DIRECTIONS.has(record.origin),
    typeof record.origin === 'string' ? 'unknown-direction-origin' : 'invalid-direction-origin');
  if (record.previous === null) {
    requireValue(record.revision === 1, 'stale-direction-link');
  } else {
    referenceValue(record.previous, 'direction', owner);
    requireValue((record.previous as WorkflowReference).revision === (record.revision as number) - 1,
      'stale-direction-link');
    requireValue((record.previous as WorkflowReference).id !== record.id, 'duplicate-direction');
  }
  if (record.question !== null) referenceValue(record.question, 'question', owner);
  requireValue(record.origin === 'answer' ? record.question !== null : record.question === null,
    'invalid-question-link');
  isoValue(record.createdAt);
}

/** FORMAT's impact rule: exactly `complete`+`keys`, at most 256 unique keys, no extra fields. */
function validateImpact(value: unknown): void {
  const impact = objectValue(value, 'invalid-definition');
  exactKeys(impact, ['complete', 'keys'], 'invalid-definition');
  requireValue(typeof impact.complete === 'boolean', 'invalid-definition');
  const keys = arrayValue(impact.keys, 'invalid-definition');
  requireValue(keys.length <= WORKFLOW_LIMITS.impactKeysPerTask, 'record-count');
  const impactKeys = new Set<string>();
  for (const key of keys) {
    const impactKey = idValue(key);
    requireValue(!impactKeys.has(impactKey), 'duplicate-impact');
    impactKeys.add(impactKey);
  }
}

function validateTask(record: Record<string, unknown>, owner: Owner): void {
  referenceValue(record.plan, 'phase-plan', owner);
  integer(record.phase, 1);
  const definition = objectValue(record.definition, 'invalid-definition');
  requireValue(typeof definition.role === 'string' && ROLES.includes(definition.role as Role),
    typeof definition.role === 'string' ? 'unknown-role' : 'invalid-role');
  requireValue(definition.completion === 'candidate' || definition.completion === 'adoption',
    typeof definition.completion === 'string' ? 'unknown-completion' : 'invalid-completion');
  const dependsOn = arrayValue(definition.dependsOn, 'invalid-definition');
  requireValue(dependsOn.length <= WORKFLOW_LIMITS.tasksPerPlan, 'record-count');
  const dependencies = new Set<string>();
  for (const dependency of dependsOn) {
    referenceValue(dependency, 'task', owner);
    const dependencyId = (dependency as WorkflowReference).id;
    requireValue(!dependencies.has(dependencyId), 'duplicate-dependency');
    dependencies.add(dependencyId);
  }
  validateImpact(definition.impact);
  referenceValue(record.direction, 'direction', owner);
  if (record.currentAttempt !== null) referenceValue(record.currentAttempt, 'attempt', owner);
  requireValue(typeof record.retryAllowed === 'boolean', 'invalid-record');
  requireValue(typeof record.needsDirection === 'boolean', 'invalid-record');
  if (Object.hasOwn(record, 'status')) {
    requireValue(typeof record.status === 'string' && TASK_STATUSES.has(record.status),
      typeof record.status === 'string' ? 'unknown-task-status' : 'invalid-task-status');
  }
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

function validateCommand(record: Record<string, unknown>): void {
  integer(record.sequence, 1);
  integer(record.expectedRevision, 0);
  digestValue(record.payloadDigest);
  const action = objectValue(record.action, 'invalid-action');
  requireValue(typeof action.type === 'string' && ACTION_TYPES.has(action.type),
    typeof action.type === 'string' ? 'unknown-action' : 'invalid-action');
  isoValue(record.recordedAt);
}

function validateJournalPage(record: Record<string, unknown>, owner: Owner): void {
  requireValue(typeof record.journal === 'string' && JOURNAL_KINDS.has(record.journal),
    typeof record.journal === 'string' ? 'unknown-journal' : 'invalid-journal');
  const pageSize = integer(record.pageSize, 1, WORKFLOW_LIMITS.journalPageSize);
  const first = integer(record.firstSequence, 1);
  const last = integer(record.lastSequence, first);
  const next = integer(record.nextSequence, 2);
  const total = integer(record.total, 1);
  requireValue(last - first + 1 <= pageSize, 'invalid-journal');
  requireValue(next === last + 1, 'invalid-journal');
  const entries = arrayValue(record.entries, 'invalid-journal');
  requireValue(entries.length > 0 && entries.length <= pageSize, 'invalid-journal');
  requireValue(last === first + entries.length - 1, 'invalid-journal');
  requireValue(total >= last, 'invalid-journal');
  const referenceKind: WorkflowKind = record.journal === 'command' ? 'command' : 'effect';
  for (let index = 0; index < entries.length; index++) {
    const entry = objectValue(entries[index], 'invalid-journal');
    exactKeys(entry, ['sequence', 'ref'], 'invalid-journal');
    requireValue(entry.sequence === first + index, 'invalid-journal');
    referenceValue(entry.ref, referenceKind, owner);
  }
  isoValue(record.createdAt);
}

function validateProviderReceipt(value: unknown, receiptIds: Set<string>): void {
  const receipt = objectValue(value, 'invalid-receipt');
  exactKeys(receipt, ['id', 'reservationId', 'outcome', 'accounting'], 'invalid-receipt');
  const receiptId = idValue(receipt.id);
  requireValue(!receiptIds.has(receiptId), 'duplicate-receipt');
  receiptIds.add(receiptId);
  idValue(receipt.reservationId);
  requireValue(typeof receipt.outcome === 'string' && RECEIPT_OUTCOMES.has(receipt.outcome),
    typeof receipt.outcome === 'string' ? 'unknown-receipt-outcome' : 'invalid-receipt-outcome');
  validateAccounting(receipt.accounting);
}

function validateAttempt(record: Record<string, unknown>, owner: Owner): void {
  referenceValue(record.task, 'task', owner);
  referenceValue(record.direction, 'direction', owner);
  referenceValue(record.context, 'context', owner);
  digestValue(record.inputDigest);
  if (record.revisionOf !== null) referenceValue(record.revisionOf, 'artifact', owner);
  requireValue(typeof record.phase === 'string' && ATTEMPT_PHASES.has(record.phase),
    typeof record.phase === 'string' ? 'unknown-attempt-phase' : 'invalid-attempt-phase');
  requireValue(typeof record.historical === 'boolean', 'invalid-record');
  requireValue(typeof record.noProgress === 'boolean', 'invalid-record');
  const outputs = arrayValue(record.outputs, 'invalid-outputs');
  requireValue(outputs.length <= WORKFLOW_LIMITS.attemptOutputs, 'record-count');
  const outputIds = new Set<string>();
  for (const output of outputs) {
    referenceValue(output, 'artifact', owner);
    const outputId = (output as WorkflowReference).id;
    requireValue(!outputIds.has(outputId), 'duplicate-artifact');
    outputIds.add(outputId);
  }
  if (record.dispatch !== null) {
    const dispatch = objectValue(record.dispatch, 'invalid-dispatch');
    exactKeys(dispatch, ['destination', 'requestDigest', 'intentAt'], 'invalid-dispatch');
    validateDestination(dispatch.destination);
    digestValue(dispatch.requestDigest);
    isoValue(dispatch.intentAt);
  }
  const accounting = objectValue(record.accounting, 'invalid-accounting');
  for (const key of Object.keys(accounting)) {
    requireValue(['calls', 'localReads', 'knownSubtotalMicroUsd', 'unknownCalls', 'partialCalls'].includes(key),
      'unsupported-accounting');
  }
  exactKeys(accounting, ['calls', 'localReads', 'knownSubtotalMicroUsd', 'unknownCalls',
    'partialCalls'], 'invalid-accounting');
  const calls = integer(accounting.calls, 0, WORKFLOW_LIMITS.attemptCalls);
  integer(accounting.localReads, 0, WORKFLOW_LIMITS.attemptReads);
  integer(accounting.knownSubtotalMicroUsd, 0);
  const unknown = integer(accounting.unknownCalls, 0);
  const partial = integer(accounting.partialCalls, 0);
  requireValue(unknown + partial <= calls, 'invalid-accounting');
  const receipts = arrayValue(record.providerReceipts, 'invalid-receipts');
  requireValue(receipts.length <= calls, 'invalid-receipts');
  const receiptIds = new Set<string>();
  for (const receipt of receipts) validateProviderReceipt(receipt, receiptIds);
  if (record.phase === 'prepared') requireValue(record.dispatch === null, 'invalid-attempt-state');
  if (record.phase === 'dispatch-intent' || record.phase === 'receiving' ||
    record.phase === 'output-kept' || record.phase === 'completed') {
    requireValue(record.dispatch !== null, 'invalid-attempt-state');
  }
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

/** A bounded library-relative path: non-empty, forward slashes, no absolute or `..` segment. */
function relativePathValue(value: unknown, code: string): string {
  const path = stringValue(value, 1_024, 4_096, code);
  requireValue(path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').includes('..'), code);
  return path;
}

function validateEffectReceipt(value: unknown): void {
  const receipt = objectValue(value, 'invalid-receipt');
  const allowed = ['outcome', 'at', 'resultVersion', 'resultHash', 'savedAs'];
  for (const key of Object.keys(receipt)) {
    requireValue(allowed.includes(key), 'invalid-receipt');
  }
  requireValue(typeof receipt.outcome === 'string' &&
    ['confirmed', 'conflict', 'not-published', 'uncertain'].includes(receipt.outcome),
    typeof receipt.outcome === 'string' ? 'unknown-receipt-outcome' : 'invalid-receipt-outcome');
  isoValue(receipt.at);
  if (Object.hasOwn(receipt, 'resultVersion')) {
    integer(receipt.resultVersion, 1);
    digestValue(receipt.resultHash);
  } else requireValue(!Object.hasOwn(receipt, 'resultHash'), 'invalid-receipt');
  if (Object.hasOwn(receipt, 'savedAs')) relativePathValue(receipt.savedAs, 'invalid-receipt');
  if (receipt.outcome === 'confirmed') {
    requireValue(Object.hasOwn(receipt, 'resultVersion') && Object.hasOwn(receipt, 'resultHash'),
      'invalid-receipt');
  }
  if (receipt.outcome === 'conflict') {
    requireValue(Object.hasOwn(receipt, 'savedAs'), 'invalid-receipt');
  }
}

function validateEffect(record: Record<string, unknown>, owner: Owner): void {
  referenceValue(record.attempt, 'attempt', owner);
  referenceValue(record.candidate, 'artifact', owner);
  requireValue(typeof record.phase === 'string' && EFFECT_PHASES.has(record.phase),
    typeof record.phase === 'string' ? 'unknown-effect-phase' : 'invalid-effect-phase');
  const target = objectValue(record.target, 'invalid-target');
  exactKeys(target, ['kind', 'chapterId', 'path'], 'invalid-target');
  requireValue(target.kind === 'new-chapter' || target.kind === 'replace-chapter',
    typeof target.kind === 'string' ? 'unknown-target-kind' : 'invalid-target');
  idValue(target.chapterId);
  relativePathValue(target.path, 'invalid-target');
  if (record.intent !== null) {
    const intent = objectValue(record.intent, 'invalid-intent');
    exactKeys(intent, ['at', 'baseVersion', 'baseHash', 'intendedHash', 'intendedBytes', 'safety'],
      'invalid-intent');
    isoValue(intent.at);
    const baseVersion = integer(intent.baseVersion, 0);
    if (intent.baseHash !== null) digestValue(intent.baseHash);
    digestValue(intent.intendedHash);
    integer(intent.intendedBytes, 0, WORKFLOW_LIMITS.artifactBytes);
    if (intent.safety !== null) referenceValue(intent.safety, 'artifact', owner);
    if (target.kind === 'new-chapter') {
      requireValue(baseVersion === 0 && intent.baseHash === null && intent.safety === null,
        'invalid-intent');
    } else {
      requireValue(baseVersion >= 1 && intent.baseHash !== null && intent.safety !== null,
        'invalid-intent');
    }
  }
  if (record.receipt !== null) validateEffectReceipt(record.receipt);
  if (record.phase === 'prepared') {
    requireValue(record.intent === null && record.receipt === null, 'invalid-effect-state');
  } else if (record.phase === 'publish-intent') {
    requireValue(record.intent !== null && record.receipt === null, 'invalid-effect-state');
  } else {
    requireValue(record.receipt !== null &&
      (record.receipt as Record<string, unknown>).outcome === record.phase,
      'invalid-effect-state');
  }
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

function validateQuestion(record: Record<string, unknown>, owner: Owner): void {
  const keys = arrayValue(record.keys, 'invalid-record');
  requireValue(keys.length > 0 && keys.length <= WORKFLOW_LIMITS.impactKeysPerTask, 'record-count');
  const impactKeys = new Set<string>();
  for (const key of keys) {
    const impactKey = idValue(key);
    requireValue(!impactKeys.has(impactKey), 'duplicate-impact');
    impactKeys.add(impactKey);
  }
  const affected = arrayValue(record.affected, 'invalid-record');
  requireValue(affected.length <= WORKFLOW_LIMITS.tasksPerPlan, 'record-count');
  const affectedIds = new Set<string>();
  for (const affectedId of affected) {
    const taskId = idValue(affectedId);
    requireValue(!affectedIds.has(taskId), 'duplicate-task');
    affectedIds.add(taskId);
  }
  if (record.characterId !== null) idValue(record.characterId);
  const evidence = arrayValue(record.evidence, 'invalid-record');
  requireValue(evidence.length <= WORKFLOW_LIMITS.contextSources, 'record-count');
  for (const reference of evidence) {
    const item = objectValue(reference, 'invalid-reference');
    requireValue(item.kind === 'artifact' || item.kind === 'context', 'invalid-reference-kind');
    referenceValue(reference, item.kind as WorkflowKind, owner);
  }
  requireValue(typeof record.state === 'string' && QUESTION_STATES.has(record.state),
    typeof record.state === 'string' ? 'unknown-question-state' : 'invalid-question-state');
  if (Object.hasOwn(record, 'irreversibleChoice')) {
    requireValue(typeof record.irreversibleChoice === 'boolean', 'invalid-irreversible-choice');
  }
  const options = arrayValue(record.options, 'invalid-options');
  requireValue(options.length <= WORKFLOW_LIMITS.questionOptions, 'record-count');
  const optionIds = new Set<string>();
  for (const option of options) {
    const item = objectValue(option, 'invalid-option');
    exactKeys(item, ['id', 'label', 'consequence'], 'invalid-option');
    const optionId = idValue(item.id);
    requireValue(!optionIds.has(optionId), 'duplicate-option');
    optionIds.add(optionId);
    stringValue(item.label, 200, 800, 'invalid-option');
    stringValue(item.consequence, 2_000, 8_192, 'invalid-option');
  }
  if (record.answer !== null) {
    const answer = objectValue(record.answer, 'invalid-answer');
    exactKeys(answer, ['exactText', 'confirmedText', 'direction', 'answeredAt'], 'invalid-answer');
    stringValue(answer.exactText, 262_144, 262_144, 'invalid-text');
    stringValue(answer.confirmedText, 262_144, 262_144, 'invalid-text');
    referenceValue(answer.direction, 'direction', owner);
    isoValue(answer.answeredAt);
  }
  requireValue(record.state === 'answered' ? record.answer !== null : record.answer === null,
    'invalid-question-state');
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

function validateArtifact(record: Record<string, unknown>, owner: Owner): void {
  requireValue(record.mediaType === 'text/markdown' || record.mediaType === 'application/json',
    typeof record.mediaType === 'string' ? 'unknown-artifact-media-type' : 'invalid-artifact');
  integer(record.bytes, 0, WORKFLOW_LIMITS.artifactBytes);
  digestValue(record.hash);
  requireValue(typeof record.role === 'string' && ROLES.includes(record.role as Role),
    typeof record.role === 'string' ? 'unknown-role' : 'invalid-role');
  referenceValue(record.producedBy, 'attempt', owner);
  isoValue(record.createdAt);
}

function validateContext(record: Record<string, unknown>, owner: Owner): void {
  const sources = arrayValue(record.sources, 'invalid-context');
  requireValue(sources.length <= WORKFLOW_LIMITS.contextSources, 'record-count');
  for (const reference of sources) {
    const item = objectValue(reference, 'invalid-reference');
    requireValue(item.kind === 'brief' || item.kind === 'phase-plan' ||
      item.kind === 'direction' || item.kind === 'artifact', 'invalid-reference-kind');
    referenceValue(reference, item.kind as WorkflowKind, owner);
  }
  const chapters = arrayValue(record.chapters, 'invalid-context');
  requireValue(chapters.length <= WORKFLOW_LIMITS.contextSources, 'record-count');
  for (const chapter of chapters) {
    const item = objectValue(chapter, 'invalid-context');
    exactKeys(item, ['chapterId', 'version', 'hash'], 'invalid-context');
    idValue(item.chapterId);
    integer(item.version, 1);
    digestValue(item.hash);
  }
  requireValue(sources.length + chapters.length > 0, 'invalid-context');
  digestValue(record.envelopeDigest);
  integer(record.bytes, 0, WORKFLOW_LIMITS.contextEnvelopeBytes);
  isoValue(record.createdAt);
}

function validateReservation(record: Record<string, unknown>, owner: Owner): void {
  const request = objectValue(record.request, 'invalid-request');
  exactKeys(request, ['policyDigest', 'attempt', 'role', 'destination', 'requestDigest',
    'inputDigest', 'directionDigest', 'reviewDigest', 'scopeId', 'localRevision',
    'globalRevision', 'callIndex', 'localReads', 'outputTokens', 'outputBytes', 'maximum'],
  'invalid-request');
  digestValue(request.policyDigest);
  referenceValue(request.attempt, 'attempt', owner);
  requireValue(typeof request.role === 'string' && ROLES.includes(request.role as Role),
    typeof request.role === 'string' ? 'unknown-role' : 'invalid-role');
  const destination = objectValue(request.destination, 'invalid-destination');
  validateDestination(destination);
  digestValue(request.requestDigest);
  digestValue(request.inputDigest);
  digestValue(request.directionDigest);
  digestValue(request.reviewDigest);
  idValue(request.scopeId);
  integer(request.localRevision, 0, DEFAULT_LIMITS.localRevisions);
  integer(request.globalRevision, 0, DEFAULT_LIMITS.globalRevisions);
  integer(request.callIndex, 1, WORKFLOW_LIMITS.attemptCalls);
  integer(request.localReads, 0, WORKFLOW_LIMITS.attemptReads);
  integer(request.outputTokens, 1, OUTPUT_TOKENS[request.role as Role]);
  integer(request.outputBytes, 1, WORKFLOW_LIMITS.recordBytes);
  if (request.maximum !== null) {
    const maximum = objectValue(request.maximum, 'invalid-maximum');
    exactKeys(maximum, ['qualificationId', 'enforcement', 'hostQualified', 'tariffKnown',
      'connectionId', 'requestDigest', 'policyDigest', 'microUsd'], 'invalid-maximum');
    idValue(maximum.qualificationId);
    requireValue(maximum.enforcement === 'provider-all-charge', 'invalid-maximum');
    requireValue(maximum.hostQualified === true && maximum.tariffKnown === true, 'invalid-maximum');
    idValue(maximum.connectionId);
    digestValue(maximum.requestDigest);
    digestValue(maximum.policyDigest);
    requireValue(maximum.requestDigest === request.requestDigest, 'foreign-charge-maximum');
    requireValue(maximum.policyDigest === request.policyDigest, 'foreign-charge-maximum');
    requireValue(maximum.connectionId === destination.connectionId, 'foreign-charge-maximum');
    integer(maximum.microUsd, 1);
  }
  requireValue(typeof record.phase === 'string' && RESERVATION_PHASES.has(record.phase),
    'invalid-reservation-phase');
  if (record.receipt !== null) validateReservationReceipt(record.receipt);
  if (record.phase === 'reserved' || record.phase === 'dispatched' || record.phase === 'released') {
    requireValue(record.receipt === null, 'invalid-reservation-state');
  }
  if (record.phase === 'settled') requireValue(record.receipt !== null, 'invalid-reservation-state');
  isoValue(record.createdAt);
  isoValue(record.updatedAt);
}

function validateObservation(record: Record<string, unknown>, owner: Owner): void {
  integer(record.sequence, 1);
  referenceValue(record.reservation, 'reservation', owner);
  requireValue(typeof record.type === 'string' && OBSERVATION_KINDS.has(record.type),
    typeof record.type === 'string' ? 'unknown-observation' : 'invalid-observation');
  isoValue(record.at);
  if (record.facts !== null) {
    const facts = objectValue(record.facts, 'invalid-facts');
    exactKeys(facts, ['clock', 'gate', 'accountingDurable', 'otherHostActive',
      'otherAccountActive', 'accountLimit'], 'invalid-facts');
    const clock = objectValue(facts.clock, 'invalid-clock');
    exactKeys(clock, ['nowMs', 'activeMs'], 'invalid-clock');
    integer(clock.nowMs, 0);
    integer(clock.activeMs, 0);
    requireValue(facts.gate === 'open' || facts.gate === 'closed', 'invalid-facts');
    requireValue(typeof facts.accountingDurable === 'boolean', 'invalid-facts');
    integer(facts.otherHostActive, 0);
    integer(facts.otherAccountActive, 0);
    integer(facts.accountLimit, 1, 4);
  }
  if (record.receipt !== null) validateReservationReceipt(record.receipt);
  if (record.type === 'dispatch') {
    requireValue(record.facts !== null && record.receipt === null, 'invalid-observation-state');
  } else if (record.type === 'receipt') {
    requireValue(record.facts === null && record.receipt !== null, 'invalid-observation-state');
  } else {
    requireValue(record.facts === null && record.receipt === null, 'invalid-observation-state');
  }
}

function validateAccountingSummary(record: Record<string, unknown>): void {
  const summary = objectValue(record.summary, 'invalid-accounting');
  exactKeys(summary, ['knownSubtotalMicroUsd', 'unknownCalls', 'partialCalls', 'pendingCalls',
    'reservedMicroUsd', 'consumedCalls'], 'invalid-accounting');
  integer(summary.knownSubtotalMicroUsd, 0);
  const unknown = integer(summary.unknownCalls, 0);
  const partial = integer(summary.partialCalls, 0);
  integer(summary.pendingCalls, 0, WORKFLOW_LIMITS.materializedRequests);
  integer(summary.reservedMicroUsd, 0);
  const consumed = integer(summary.consumedCalls, 0, DEFAULT_LIMITS.calls);
  requireValue(unknown + partial <= consumed, 'invalid-accounting');
  const clock = objectValue(record.clock, 'invalid-clock');
  exactKeys(clock, ['nowMs', 'activeMs'], 'invalid-clock');
  integer(clock.nowMs, 0);
  integer(clock.activeMs, 0);
  requireValue(typeof record.enforcementViolated === 'boolean', 'invalid-record');
  isoValue(record.updatedAt);
}

interface RecordSpec {
  kind: WorkflowKind;
  checked: boolean;
  generation: 'required' | 'forbidden';
  revision: 'one' | 'positive';
  maxBytes: number;
  required: readonly string[];
  validate: (record: Record<string, unknown>, owner: Owner) => void;
}

const RECORDS: Readonly<Record<WorkflowKind, RecordSpec>> = {
  run: {
    kind: 'run', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.runBytes,
    required: ['mode', 'phasePlan', 'policy', 'direction', 'queue', 'materialized',
      'createdAt', 'updatedAt'],
    validate: validateRun,
  },
  brief: {
    kind: 'brief', checked: false, generation: 'forbidden', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['text', 'goalId', 'targetWords', 'createdAt'],
    validate: validateBrief,
  },
  policy: {
    kind: 'policy', checked: false, generation: 'required', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['policyDigest', 'startedAtMs', 'limits', 'routes', 'cost', 'createdAt'],
    validate: validatePolicy,
  },
  'phase-plan': {
    kind: 'phase-plan', checked: false, generation: 'required', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.phasePlanBytes,
    required: ['phase', 'previous', 'graph', 'createdAt'],
    validate: validatePhasePlan,
  },
  direction: {
    kind: 'direction', checked: false, generation: 'forbidden', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['exactText', 'origin', 'previous', 'question', 'createdAt'],
    validate: validateDirection,
  },
  task: {
    kind: 'task', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['plan', 'phase', 'definition', 'direction', 'currentAttempt', 'retryAllowed',
      'needsDirection', 'createdAt', 'updatedAt'],
    validate: validateTask,
  },
  command: {
    kind: 'command', checked: false, generation: 'required', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['sequence', 'expectedRevision', 'payloadDigest', 'action', 'recordedAt'],
    validate: validateCommand,
  },
  'journal-page': {
    kind: 'journal-page', checked: false, generation: 'forbidden', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['journal', 'pageSize', 'firstSequence', 'lastSequence', 'nextSequence', 'total',
      'entries', 'createdAt'],
    validate: validateJournalPage,
  },
  attempt: {
    kind: 'attempt', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['task', 'direction', 'context', 'inputDigest', 'revisionOf', 'phase',
      'historical', 'noProgress', 'outputs', 'dispatch', 'accounting', 'providerReceipts',
      'createdAt', 'updatedAt'],
    validate: validateAttempt,
  },
  effect: {
    kind: 'effect', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['attempt', 'candidate', 'phase', 'target', 'intent', 'receipt', 'createdAt',
      'updatedAt'],
    validate: validateEffect,
  },
  question: {
    kind: 'question', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['keys', 'affected', 'characterId', 'evidence', 'options', 'state', 'answer',
      'createdAt', 'updatedAt'],
    validate: validateQuestion,
  },
  artifact: {
    kind: 'artifact', checked: false, generation: 'forbidden', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['mediaType', 'bytes', 'hash', 'role', 'producedBy', 'createdAt'],
    validate: validateArtifact,
  },
  context: {
    kind: 'context', checked: false, generation: 'forbidden', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['sources', 'chapters', 'envelopeDigest', 'bytes', 'createdAt'],
    validate: validateContext,
  },
  reservation: {
    kind: 'reservation', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['request', 'phase', 'receipt', 'createdAt', 'updatedAt'],
    validate: validateReservation,
  },
  observation: {
    kind: 'observation', checked: false, generation: 'required', revision: 'one',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['sequence', 'reservation', 'type', 'at', 'facts', 'receipt'],
    validate: validateObservation,
  },
  accounting: {
    kind: 'accounting', checked: true, generation: 'required', revision: 'positive',
    maxBytes: WORKFLOW_LIMITS.recordBytes,
    required: ['summary', 'clock', 'enforcementViolated', 'updatedAt'],
    validate: validateAccountingSummary,
  },
};

function checkRecord(record: Record<string, unknown>, spec: RecordSpec, expectedKind: WorkflowKind,
  expectedOwner: Owner): void {
  const version = record.schemaVersion;
  requireValue(typeof version === 'number' && Number.isSafeInteger(version), 'invalid-record');
  requireValue(version === WORKFLOW_SCHEMA_VERSION, 'unsupported-schema');
  requireValue(typeof record.kind === 'string', 'invalid-kind');
  requireValue(record.kind === expectedKind, 'foreign-kind');
  validateOwner(expectedOwner);
  validateOwner(record.owner as Owner);
  requireValue(sameOwner(record.owner as Owner, expectedOwner), 'foreign-owner');
  const recordId = record.id;
  requireValue(typeof recordId === 'string' && recordId.startsWith(PREFIX[spec.kind]), 'invalid-id');
  id(recordId);
  integer(record.revision, 1);
  if (spec.revision === 'one') requireValue(record.revision === 1, 'invalid-revision');
  const required = new Set(spec.required);
  if (spec.checked) required.add('base');
  if (spec.generation === 'required') required.add('generation');
  for (const key of required) requireValue(Object.hasOwn(record, key), 'missing-field');
  checkBase(record, spec.checked, record.revision as number);
  if (spec.generation === 'required') integer(record.generation, 1);
  else requireValue(!Object.hasOwn(record, 'generation'), 'unexpected-generation');
  spec.validate(record, expectedOwner);
}

/** Parse exact schema-1 bytes, refusing raw-level losses before any semantic record exists. */
export function decodeWorkflowRecord<K extends WorkflowKind>(bytes: Uint8Array,
  options: WorkflowDecodeOptions<K>): Immutable<WorkflowRecord> {
  requireValue(bytes instanceof Uint8Array, 'invalid-bytes');
  const spec = RECORDS[options.kind];
  requireValue(spec, 'unknown-record-kind');
  const limit = Math.min(options.maxBytes ?? spec.maxBytes, spec.maxBytes);
  requireValue(Number.isSafeInteger(limit) && limit >= 0, 'invalid-limit');
  requireValue(bytes.byteLength <= limit, 'record-overflow');
  const record = objectValue(parseJsonBytes(bytes), 'invalid-record');
  checkRecord(record, spec, options.kind, options.owner);
  return freeze(record) as Immutable<WorkflowRecord>;
}

/** Deterministic compact encoding: keys sorted by UTF-16 order, no whitespace, no newline. */
export function encodeWorkflowRecord(record: WorkflowRecord, maxBytes?: number): Uint8Array {
  const copy = copyValue(record, Number.MAX_SAFE_INTEGER) as unknown as Record<string, unknown>;
  const kind = copy.kind;
  requireValue(typeof kind === 'string', 'invalid-kind');
  requireValue(Object.hasOwn(RECORDS, kind), 'unknown-record-kind');
  const spec = RECORDS[kind as WorkflowKind];
  requireValue(spec, 'unknown-record-kind');
  checkRecord(copy, spec, kind as WorkflowKind, copy.owner as Owner);
  const bytes = encoder.encode(canonicalWorkflowJson(copy));
  const limit = Math.min(maxBytes ?? spec.maxBytes, spec.maxBytes);
  requireValue(Number.isSafeInteger(limit) && limit >= 0, 'invalid-limit');
  requireValue(bytes.byteLength <= limit, 'record-overflow');
  return bytes;
}

export interface IrreversibleChoicePending {
  readonly irreversibleChoicePending: boolean;
  readonly openIrreversibleCount: number;
  readonly openIrreversibleQuestionIds: readonly string[];
}

/** Pure count of open questions explicitly classified irreversible. Absence is unclassified, not pending. */
export function readIrreversibleChoicePending(input: unknown, owner: Owner): Immutable<IrreversibleChoicePending> {
  validateOwner(owner);
  const openIds: string[] = [];
  const seen = new Set<string>();
  for (const item of questionInputs(input)) {
    const record = unwrapQuestion(item);
    if (Object.hasOwn(record, 'kind')) requireValue(record.kind === 'question', 'foreign-kind');
    if (Object.hasOwn(record, 'owner')) {
      const recordOwner = objectValue(record.owner, 'invalid-owner') as unknown as Owner;
      validateOwner(recordOwner);
      requireValue(sameOwner(recordOwner, owner), 'foreign-owner');
    }
    requireValue(typeof record.state === 'string' && QUESTION_STATES.has(record.state),
      typeof record.state === 'string' ? 'unknown-question-state' : 'invalid-question-state');
    if (Object.hasOwn(record, 'irreversibleChoice')) {
      requireValue(typeof record.irreversibleChoice === 'boolean', 'invalid-irreversible-choice');
    }
    const questionId = idValue(record.id);
    requireValue(!seen.has(questionId), 'duplicate-question');
    seen.add(questionId);
    if (record.state === 'open' && record.irreversibleChoice === true) openIds.push(questionId);
  }
  openIds.sort();
  return freeze({
    irreversibleChoicePending: openIds.length > 0,
    openIrreversibleCount: openIds.length,
    openIrreversibleQuestionIds: openIds,
  });
}

const QUESTION_INBOX_LIMIT = 10_000;

export interface QuestionInboxQuestion {
  readonly id: string;
  readonly state: 'open';
  readonly irreversibleChoice?: boolean;
}

export interface QuestionInbox {
  readonly questions: readonly QuestionInboxQuestion[];
}

/**
 * Pure projection of an already listed question set. Open questions only.
 * Not a store, an answer, or a cadence input. Absence of `irreversibleChoice`
 * stays omitted; it is not stored as false or null.
 */
export function projectQuestionInbox(input: unknown, owner: Owner): Immutable<QuestionInbox> {
  validateOwner(owner);
  const items = questionInputs(input);
  requireValue(items.length <= QUESTION_INBOX_LIMIT, 'question-inbox-too-large');
  if (!Array.isArray(input)) {
    const listing = input as Record<string, unknown>;
    if (Object.hasOwn(listing, 'total')) {
      requireValue(listing.total === items.length, 'partial-question-list');
    }
    if (Object.hasOwn(listing, 'offset')) {
      requireValue(listing.offset === 0, 'partial-question-list');
    }
  }
  const questions: QuestionInboxQuestion[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const record = unwrapQuestion(item);
    if (Object.hasOwn(record, 'kind')) requireValue(record.kind === 'question', 'foreign-kind');
    if (Object.hasOwn(record, 'owner')) {
      const recordOwner = objectValue(record.owner, 'invalid-owner') as unknown as Owner;
      validateOwner(recordOwner);
      requireValue(sameOwner(recordOwner, owner), 'foreign-owner');
    }
    requireValue(typeof record.state === 'string' && QUESTION_STATES.has(record.state),
      typeof record.state === 'string' ? 'unknown-question-state' : 'invalid-question-state');
    let choice: boolean | undefined;
    if (Object.hasOwn(record, 'irreversibleChoice')) {
      requireValue(typeof record.irreversibleChoice === 'boolean', 'invalid-irreversible-choice');
      choice = record.irreversibleChoice;
    }
    const questionId = idValue(record.id);
    requireValue(!seen.has(questionId), 'duplicate-question');
    seen.add(questionId);
    if (record.state !== 'open') continue;
    const projected: { id: string; state: 'open'; irreversibleChoice?: boolean } = {
      id: questionId,
      state: 'open',
    };
    if (choice !== undefined) projected.irreversibleChoice = choice;
    questions.push(projected);
  }
  questions.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return freeze({ questions });
}

function questionInputs(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  const listing = objectValue(input, 'invalid-questions');
  return arrayValue(listing.questions, 'invalid-questions');
}

function unwrapQuestion(item: unknown): Record<string, unknown> {
  const value = objectValue(item, 'invalid-question');
  if (!Object.hasOwn(value, 'record')) return value;
  // A question record may retain an unknown `record` object. Only a snapshot
  // wrapper — own `record`, and no question `kind` or `state` — unwraps.
  if (Object.hasOwn(value, 'kind') || Object.hasOwn(value, 'state')) return value;
  return objectValue(value.record, 'invalid-question');
}
