import { DEFAULT_LIMITS, OUTPUT_TOKENS, ROLES, sameReference, validateOwner, validateReference,
  type Owner, type Reference, type Role } from './contracts';
import { add, copyValue, digest, freeze, id, integer, requireValue, sameValue, text,
  type Immutable } from './value';

export interface Destination {
  connectionId: string;
  providerId: string;
  modelId: string;
  /** Host groups known aliases; unknown accounts use a conservative shared provider key. */
  accountKey: string;
}

export interface AdmissionPolicy {
  version: 1;
  owner: Owner;
  policyDigest: string;
  generation: number;
  startedAtMs: number;
  limits: AdmissionLimits;
  routes: { role: Role; destination: Destination }[];
  cost: { mode: 'bounded-operations' } | { mode: 'strict-money'; capMicroUsd: number };
}

export interface AdmissionLimits {
  concurrency: number;
  calls: number;
  activeMs: number;
  lifetimeMs: number;
  localRevisions: number;
  globalRevisions: number;
  callsPerAttempt: number;
  readsPerAttempt: number;
  outputBytes: number;
}

export interface ClockFacts { nowMs: number; activeMs: number }
export interface AdmissionFacts {
  clock: ClockFacts;
  /** Necessary facts from the sole host admission lock, not a grant descriptor. */
  gate: 'open' | 'closed';
  accountingDurable: boolean;
  otherHostActive: number;
  otherAccountActive: number;
  accountLimit: number;
}

export interface ChargeMaximum {
  qualificationId: string;
  enforcement: 'provider-all-charge';
  hostQualified: true;
  tariffKnown: true;
  connectionId: string;
  requestDigest: string;
  policyDigest: string;
  microUsd: number;
}

export interface ReservationRequest {
  id: string;
  generation: number;
  policyDigest: string;
  attempt: Reference<'attempt'>;
  role: Role;
  destination: Destination;
  requestDigest: string;
  inputDigest: string;
  directionDigest: string;
  reviewDigest: string;
  scopeId: string;
  localRevision: number;
  globalRevision: number;
  callIndex: number;
  localReads: number;
  outputTokens: number;
  outputBytes: number;
  maximum: ChargeMaximum | null;
}

export type Accounting = { kind: 'reported' | 'partial'; microUsd: number } | { kind: 'unknown' };
export interface Receipt {
  id: string;
  outcome: 'succeeded' | 'failed' | 'stopped';
  accounting: Accounting;
}
interface Reservation {
  request: ReservationRequest;
  phase: 'reserved' | 'dispatched' | 'uncertain' | 'settled' | 'released';
  receipt: Receipt | null;
}
interface ConnectionPark {
  connectionId: string;
  reason: 'rate-limit' | 'auth' | 'quota';
  eligibleAtMs: number | null;
}
interface LedgerData {
  policy: AdmissionPolicy;
  revision: number;
  clock: ClockFacts;
  reservations: Reservation[];
  parked: ConnectionPark[];
  enforcementViolated: boolean;
}
export type AdmissionLedger = Immutable<LedgerData>;

function destination(value: Destination): void {
  requireValue(value && typeof value === 'object', 'invalid-destination');
  id(value.connectionId); id(value.providerId); id(value.accountKey); text(value.modelId, 512, 2048);
  requireValue(value.modelId.length > 0, 'missing-model');
}

export function createLedger(input: AdmissionPolicy): AdmissionLedger {
  const policy = copyValue(input);
  requireValue(policy.version === 1, 'unsupported-version');
  validateOwner(policy.owner); digest(policy.policyDigest); integer(policy.generation); integer(policy.startedAtMs);
  requireValue(policy.limits && typeof policy.limits === 'object', 'invalid-limits');
  // These initial agreement ceilings can only change through a separately reviewed policy version.
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof AdmissionLimits)[]) {
    integer(policy.limits[key], key === 'localRevisions' || key === 'globalRevisions' ? 0 : 1,
      key === 'concurrency' ? 4 : DEFAULT_LIMITS[key]);
  }
  add(policy.startedAtMs, policy.limits.lifetimeMs);
  requireValue(Array.isArray(policy.routes) && policy.routes.length > 0, 'missing-routes');
  const roles = new Set<Role>();
  for (const route of policy.routes) {
    requireValue(ROLES.includes(route.role) && !roles.has(route.role), 'invalid-route');
    roles.add(route.role); destination(route.destination);
  }
  requireValue(policy.cost?.mode === 'bounded-operations' || policy.cost?.mode === 'strict-money', 'invalid-cost-mode');
  if (policy.cost.mode === 'strict-money') integer(policy.cost.capMicroUsd, 1);
  return freeze({ policy, revision: 0, clock: { nowMs: policy.startedAtMs, activeMs: 0 },
    reservations: [], parked: [], enforcementViolated: false });
}

function clockAllowed(ledger: AdmissionLedger, clock: ClockFacts): void {
  integer(clock.nowMs); integer(clock.activeMs);
  requireValue(clock.nowMs >= ledger.clock.nowMs && clock.activeMs >= ledger.clock.activeMs, 'clock-regression');
  requireValue(clock.activeMs <= clock.nowMs - ledger.policy.startedAtMs, 'impossible-active-time');
}

/** All totals are safe integer micro-USD. Unknown is never substituted with zero reported cost. */
export function accountingSummary(ledger: AdmissionLedger): Readonly<{
  knownSubtotalMicroUsd: number; unknownCalls: number; partialCalls: number;
  pendingCalls: number; reservedMicroUsd: number; consumedCalls: number;
}> {
  let knownSubtotalMicroUsd = 0;
  let unknownCalls = 0;
  let partialCalls = 0;
  let pendingCalls = 0;
  let reservedMicroUsd = 0;
  let consumedCalls = 0;
  for (const entry of ledger.reservations) {
    if (entry.phase === 'released') continue;
    consumedCalls = add(consumedCalls, 1);
    const accounting = entry.receipt?.accounting;
    if (accounting && accounting.kind !== 'unknown') knownSubtotalMicroUsd = add(knownSubtotalMicroUsd, accounting.microUsd);
    if (accounting?.kind === 'unknown' || entry.phase === 'uncertain') unknownCalls++;
    if (accounting?.kind === 'partial') partialCalls++;
    if (entry.phase === 'reserved' || entry.phase === 'dispatched') pendingCalls++;
    if (accounting?.kind !== 'reported') {
      if (entry.request.maximum) reservedMicroUsd = add(reservedMicroUsd, entry.request.maximum.microUsd);
    }
  }
  return Object.freeze({ knownSubtotalMicroUsd, unknownCalls, partialCalls, pendingCalls, reservedMicroUsd, consumedCalls });
}

function progressEqual(a: Immutable<ReservationRequest>, b: ReservationRequest): boolean {
  return a.inputDigest === b.inputDigest && a.directionDigest === b.directionDigest &&
    a.reviewDigest === b.reviewDigest && a.role === b.role;
}

function checkRequest(ledger: AdmissionLedger, request: ReservationRequest): void {
  id(request.id); id(request.scopeId);
  integer(request.generation); digest(request.policyDigest);
  requireValue(request.generation === ledger.policy.generation && request.policyDigest === ledger.policy.policyDigest,
    'stale-admission-policy');
  validateReference(request.attempt, 'attempt', ledger.policy.owner);
  for (const value of [request.requestDigest, request.inputDigest, request.directionDigest, request.reviewDigest]) digest(value);
  requireValue(ROLES.includes(request.role), 'unknown-role');
  destination(request.destination);
  const route = ledger.policy.routes.find(route => route.role === request.role);
  requireValue(route && sameValue(route.destination, request.destination), 'unpinned-destination');
  integer(request.outputTokens, 1, OUTPUT_TOKENS[request.role]);
  integer(request.outputBytes, 1, ledger.policy.limits.outputBytes);
  integer(request.callIndex, 1, ledger.policy.limits.callsPerAttempt);
  integer(request.localReads, 0, ledger.policy.limits.readsPerAttempt);
  integer(request.localRevision, 0, ledger.policy.limits.localRevisions);
  integer(request.globalRevision, 0, ledger.policy.limits.globalRevisions);
  const prior = ledger.reservations.filter(entry => entry.phase !== 'released');
  const attemptCalls = prior.filter(entry => entry.request.attempt.id === request.attempt.id);
  requireValue(attemptCalls.every(entry => sameReference(entry.request.attempt, request.attempt)), 'attempt-reference-mismatch');
  requireValue(request.callIndex === attemptCalls.length + 1, 'call-sequence');
  requireValue(attemptCalls.every(entry => entry.phase === 'settled'), 'unsettled-continuation');
  requireValue(attemptCalls.every(entry => entry.receipt?.outcome === 'succeeded'), 'failed-attempt-no-continuation');
  requireValue(attemptCalls.every(entry => progressEqual(entry.request, request) &&
    entry.request.generation === request.generation &&
    sameValue(entry.request.destination, request.destination) && entry.request.scopeId === request.scopeId &&
    entry.request.localRevision === request.localRevision && entry.request.globalRevision === request.globalRevision),
    'changed-attempt-input');
  let reads = request.localReads;
  for (const entry of attemptCalls) reads = add(reads, entry.request.localReads);
  requireValue(reads <= ledger.policy.limits.readsPerAttempt, 'read-limit');
  requireValue(!prior.some(entry => entry.request.attempt.id !== request.attempt.id && progressEqual(entry.request, request)),
    'no-progress');
  requireValue(!prior.some(entry => entry.request.requestDigest === request.requestDigest), 'repeated-request');
  const scope = prior.filter(entry => entry.request.scopeId === request.scopeId);
  requireValue(scope.every(entry => entry.request.localRevision <= request.localRevision &&
    entry.request.globalRevision <= request.globalRevision), 'revision-regression');
  if (request.role === 'revision-writer') {
    requireValue(request.localRevision > 0 || request.globalRevision > 0, 'missing-revision-cycle');
    requireValue(!scope.some(entry => entry.request.role === 'revision-writer' &&
      entry.request.attempt.id !== request.attempt.id && entry.request.localRevision === request.localRevision &&
      entry.request.globalRevision === request.globalRevision), 'revision-cycle-reused');
  }
  if (ledger.policy.cost.mode === 'strict-money') {
    const maximum = request.maximum;
    requireValue(maximum && maximum.hostQualified === true && maximum.enforcement === 'provider-all-charge' &&
      maximum.tariffKnown === true, 'unqualified-charge-maximum');
    id(maximum.qualificationId); integer(maximum.microUsd);
    requireValue(maximum.connectionId === request.destination.connectionId && maximum.requestDigest === request.requestDigest &&
      maximum.policyDigest === ledger.policy.policyDigest, 'foreign-charge-maximum');
  } else requireValue(request.maximum === null, 'bounded-mode-maximum');
}

function checkGates(ledger: AdmissionLedger, facts: AdmissionFacts): void {
  clockAllowed(ledger, facts.clock);
  requireValue(facts.gate === 'open' && facts.accountingDurable === true, 'host-gate-closed');
  requireValue(facts.clock.nowMs < add(ledger.policy.startedAtMs, ledger.policy.limits.lifetimeMs) &&
    facts.clock.activeMs < ledger.policy.limits.activeMs, 'time-limit');
  requireValue(!ledger.enforcementViolated, 'enforcement-violated');
  integer(facts.otherHostActive); integer(facts.otherAccountActive); integer(facts.accountLimit, 1, 4);
}

function finishMutation(state: LedgerData): AdmissionLedger {
  state.revision = add(state.revision, 1);
  accountingSummary(state); // Reject integer overflow before returning any changed snapshot.
  return freeze(state);
}

/** Call under the host's single admission lock and persist before transport; this does neither. */
export function reserve(ledger: AdmissionLedger, input: ReservationRequest, inputFacts: AdmissionFacts): AdmissionLedger {
  const request = copyValue(input, 262_144);
  const facts = copyValue(inputFacts, 262_144);
  const existing = ledger.reservations.find(entry => entry.request.id === request.id);
  if (existing) {
    requireValue(sameValue(existing.request, request), 'reservation-replay-mismatch');
    return ledger; // Replay is never another dispatch authorization, including a released ID.
  }
  checkRequest(ledger, request); checkGates(ledger, facts);
  requireValue(!ledger.parked.some(park => park.connectionId === request.destination.connectionId), 'connection-parked');
  const summary = accountingSummary(ledger);
  requireValue(summary.consumedCalls < ledger.policy.limits.calls, 'call-limit');
  const active = ledger.reservations.filter(entry => entry.phase === 'reserved' || entry.phase === 'dispatched' || entry.phase === 'uncertain');
  requireValue(add(active.length, facts.otherHostActive) < ledger.policy.limits.concurrency, 'host-concurrency');
  requireValue(add(active.filter(entry => entry.request.destination.accountKey === request.destination.accountKey).length,
    facts.otherAccountActive) < facts.accountLimit, 'account-concurrency');
  if (ledger.policy.cost.mode === 'strict-money') {
    requireValue(summary.unknownCalls === 0 && summary.partialCalls === 0, 'unresolved-charge');
    requireValue(add(add(summary.knownSubtotalMicroUsd, summary.reservedMicroUsd), request.maximum?.microUsd ?? 0) <=
      ledger.policy.cost.capMicroUsd, 'money-limit');
  }
  const state = copyValue(ledger, Number.MAX_SAFE_INTEGER) as LedgerData;
  state.clock = facts.clock;
  state.reservations.push({ request, phase: 'reserved', receipt: null });
  return finishMutation(state);
}

export type ReservationEvent = { type: 'dispatch'; facts: AdmissionFacts } | { type: 'known-unsent' } |
  { type: 'uncertain' } | { type: 'receipt'; receipt: Receipt };

/** Intent, uncertainty and actual receipts are distinct. Timeout/abort never means known unsent. */
export function observeReservation(ledger: AdmissionLedger, reservationId: string, input: ReservationEvent): AdmissionLedger {
  const event = copyValue(input, 262_144);
  const state = copyValue(ledger, Number.MAX_SAFE_INTEGER) as LedgerData;
  const entry = state.reservations.find(entry => entry.request.id === reservationId);
  requireValue(entry, 'missing-reservation');
  switch (event.type) {
    case 'dispatch':
      requireValue(entry.phase === 'reserved', 'already-dispatched');
      requireValue(entry.request.generation === ledger.policy.generation, 'stale-admission-policy');
      checkGates(ledger, event.facts);
      requireValue(!ledger.parked.some(park => park.connectionId === entry.request.destination.connectionId), 'connection-parked');
      // Recheck externally reduced capacity immediately before crossing the send boundary.
      requireValue(add(ledger.reservations.filter(r => r.phase === 'reserved' || r.phase === 'dispatched' || r.phase === 'uncertain').length,
        event.facts.otherHostActive) <= ledger.policy.limits.concurrency, 'host-concurrency');
      requireValue(add(ledger.reservations.filter(r => r.request.destination.accountKey === entry.request.destination.accountKey &&
        (r.phase === 'reserved' || r.phase === 'dispatched' || r.phase === 'uncertain')).length,
      event.facts.otherAccountActive) <= event.facts.accountLimit, 'account-concurrency');
      if (ledger.policy.cost.mode === 'strict-money') {
        const summary = accountingSummary(ledger);
        requireValue(summary.unknownCalls === 0 && summary.partialCalls === 0, 'unresolved-charge');
      }
      entry.phase = 'dispatched'; state.clock = event.facts.clock;
      break;
    case 'known-unsent':
      requireValue(entry.phase === 'reserved', 'possibly-sent');
      entry.phase = 'released';
      break;
    case 'uncertain':
      requireValue(entry.phase === 'dispatched', 'not-dispatched');
      entry.phase = 'uncertain';
      break;
    case 'receipt': {
      id(event.receipt.id);
      requireValue(['succeeded', 'failed', 'stopped'].includes(event.receipt.outcome), 'invalid-receipt-outcome');
      requireValue(event.receipt.accounting?.kind === 'reported' || event.receipt.accounting?.kind === 'partial' ||
        event.receipt.accounting?.kind === 'unknown', 'invalid-accounting');
      if (event.receipt.accounting.kind !== 'unknown') integer(event.receipt.accounting.microUsd);
      if (entry.receipt) {
        requireValue(sameValue(entry.receipt, event.receipt), 'receipt-replay-mismatch');
        return ledger;
      }
      requireValue(entry.phase === 'dispatched' || entry.phase === 'uncertain', 'receipt-without-dispatch');
      requireValue(!state.reservations.some(r => r.receipt?.id === event.receipt.id), 'duplicate-receipt');
      entry.receipt = event.receipt; entry.phase = 'settled';
      if (entry.request.maximum && event.receipt.accounting.kind !== 'unknown' &&
        event.receipt.accounting.microUsd > entry.request.maximum.microUsd) state.enforcementViolated = true;
      break;
    }
    default: requireValue(false, 'unknown-reservation-event');
  }
  return finishMutation(state);
}

export function parkConnection(ledger: AdmissionLedger, input: ConnectionPark): AdmissionLedger {
  const park = copyValue(input, 262_144);
  id(park.connectionId);
  requireValue(ledger.policy.routes.some(route => route.destination.connectionId === park.connectionId), 'unknown-connection');
  requireValue(['rate-limit', 'auth', 'quota'].includes(park.reason), 'invalid-connection-failure');
  if (park.reason === 'rate-limit') integer(park.eligibleAtMs);
  else requireValue(park.eligibleAtMs === null, 'invalid-retry-time');
  const state = copyValue(ledger, Number.MAX_SAFE_INTEGER) as LedgerData;
  const prior = state.parked.find(p => p.connectionId === park.connectionId);
  // A later 429 must never clear a connection-wide auth/quota fault or shorten the wait.
  if (prior && (prior.reason !== 'rate-limit' || (park.reason === 'rate-limit' &&
    (prior.eligibleAtMs ?? 0) >= (park.eligibleAtMs ?? 0)))) return ledger;
  state.parked = state.parked.filter(p => p.connectionId !== park.connectionId);
  state.parked.push(park);
  return finishMutation(state);
}

/** Explicit host Continue after connection repair; eligibility alone never creates work. */
export function continueConnection(ledger: AdmissionLedger, connectionId: string, clock: ClockFacts): AdmissionLedger {
  clockAllowed(ledger, clock);
  const park = ledger.parked.find(p => p.connectionId === connectionId);
  requireValue(park, 'connection-not-parked');
  requireValue(park.eligibleAtMs === null || clock.nowMs >= park.eligibleAtMs, 'retry-not-yet-eligible');
  const state = copyValue(ledger, Number.MAX_SAFE_INTEGER) as LedgerData;
  state.parked = state.parked.filter(p => p.connectionId !== connectionId);
  state.clock = copyValue(clock);
  return finishMutation(state);
}

/** Mirror a host/run generation change without resetting calls, money, no-progress or clock history.
 * This closes old reserved sends; it does not reopen a host gate or mint permission to resume.
 */
export function advanceAdmissionGeneration(ledger: AdmissionLedger, generation: number): AdmissionLedger {
  integer(generation);
  requireValue(generation > ledger.policy.generation, 'stale-generation');
  const state = copyValue(ledger, Number.MAX_SAFE_INTEGER) as LedgerData;
  state.policy.generation = generation;
  return finishMutation(state);
}
