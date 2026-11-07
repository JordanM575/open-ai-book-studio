import { expect, test } from 'bun:test';
import { accountingSummary, advanceAdmissionGeneration, continueConnection, createLedger, observeReservation, parkConnection, reserve,
  type Accounting, type AdmissionLedger, type ReservationRequest } from '../../src/authoring';
import { facts, hash, policy, request, route } from './fixtures';

function settle(ledger: AdmissionLedger, id = 'reservation_1', accounting: Accounting = { kind: 'unknown' }): AdmissionLedger {
  ledger = observeReservation(ledger, id, { type: 'dispatch', facts: facts() });
  return observeReservation(ledger, id, { type: 'receipt', receipt: { id: `receipt_${id}`, outcome: 'succeeded', accounting } });
}

test('three default concurrent reservations; fourth refuses without mutation, configured maximum is four', () => {
  let ledger = createLedger(policy());
  const initial = ledger;
  for (let i = 1; i <= 3; i++) ledger = reserve(ledger, request(i), facts());
  expect(accountingSummary(ledger).pendingCalls).toBe(3);
  expect(() => reserve(ledger, request(4), facts())).toThrow('host-concurrency');
  expect(initial.reservations).toHaveLength(0);
  const four = policy(); four.limits.concurrency = 4;
  let larger = createLedger(four);
  for (let i = 1; i <= 4; i++) larger = reserve(larger, request(i), facts());
  expect(() => reserve(larger, request(5), facts())).toThrow('host-concurrency');
  expect(() => createLedger({ ...four, limits: { ...four.limits, concurrency: 5 } })).toThrow('invalid-integer');
});

test('host/account capacity includes supplied other-run facts and shared aliases', () => {
  let ledger = createLedger(policy());
  expect(() => reserve(ledger, request(), { ...facts(), otherHostActive: 3 })).toThrow('host-concurrency');
  ledger = reserve(ledger, request(), { ...facts(), accountLimit: 1 });
  expect(() => reserve(ledger, request(2), { ...facts(), accountLimit: 1 })).toThrow('account-concurrency');
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: { ...facts(), otherAccountActive: 1, accountLimit: 1 } })).toThrow('account-concurrency');
  const aliases = policy();
  const second = aliases.routes.find(r => r.role === 'architect');
  if (!second) throw new Error('fixture');
  second.destination.connectionId = 'connection_alias';
  let shared = reserve(createLedger(aliases), request(), facts());
  const next = { ...request(2), role: 'architect' as const, destination: { ...route, connectionId: 'connection_alias' } };
  expect(() => reserve(shared, next, { ...facts(), accountLimit: 1 })).toThrow('account-concurrency');
  shared = reserve(shared, next, facts());
  expect(shared.reservations).toHaveLength(2);
});

test('reservation dedup is exact, immutable and cannot resurrect an unsent released ID', () => {
  const input = request();
  let ledger = reserve(createLedger(policy()), input, facts());
  expect(reserve(ledger, request(), facts())).toBe(ledger);
  input.outputTokens = 2;
  expect(ledger.reservations[0]?.request.outputTokens).toBe(4096);
  expect(() => reserve(ledger, input, facts())).toThrow('reservation-replay-mismatch');
  ledger = observeReservation(ledger, 'reservation_1', { type: 'known-unsent' });
  expect(reserve(ledger, request(), facts())).toBe(ledger);
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: facts() })).toThrow('already-dispatched');
  expect(accountingSummary(ledger).consumedCalls).toBe(0);
});

test('known unsent releases capacity; dispatched/uncertain never become free or automatically retryable', () => {
  let ledger = reserve(createLedger(policy(true)), request(1, 60), facts());
  ledger = observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: facts() });
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'known-unsent' })).toThrow('possibly-sent');
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: facts() })).toThrow('already-dispatched');
  ledger = observeReservation(ledger, 'reservation_1', { type: 'uncertain' });
  expect(accountingSummary(ledger)).toMatchObject({ reservedMicroUsd: 60, unknownCalls: 1, consumedCalls: 1 });
  expect(() => reserve(ledger, request(2, 1), facts())).toThrow('unresolved-charge');
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'known-unsent' })).toThrow('possibly-sent');
});

test('strict-money parallel maxima hit exact cap and actual complete receipts release only unused maximum', () => {
  let ledger = createLedger(policy(true));
  ledger = reserve(ledger, request(1, 60), facts());
  ledger = reserve(ledger, request(2, 40), facts());
  expect(accountingSummary(ledger).reservedMicroUsd).toBe(100);
  expect(() => reserve(ledger, request(3, 1), facts())).toThrow('money-limit');
  ledger = settle(ledger, 'reservation_1', { kind: 'reported', microUsd: 20 });
  ledger = reserve(ledger, request(3, 40), facts());
  expect(accountingSummary(ledger)).toMatchObject({ knownSubtotalMicroUsd: 20, reservedMicroUsd: 80, consumedCalls: 3 });
});

test.each(['none', 'estimate', 'unknown-tariff', 'unqualified', 'foreign-request', 'foreign-policy'])('strict mode refuses %s maximum', kind => {
  const input = request(1, 10);
  if (kind === 'none') input.maximum = null;
  else if (input.maximum) {
    if (kind === 'estimate') Object.assign(input.maximum, { enforcement: 'local-token-estimate' });
    if (kind === 'unknown-tariff') Object.assign(input.maximum, { tariffKnown: false });
    if (kind === 'unqualified') Object.assign(input.maximum, { hostQualified: false });
    if (kind === 'foreign-request') input.maximum.requestDigest = hash(9);
    if (kind === 'foreign-policy') input.maximum.policyDigest = hash(9);
  }
  expect(() => reserve(createLedger(policy(true)), input, facts())).toThrow();
});

test.each(['unknown', 'partial'] as const)('%s accounting closes strict future admission while retaining maximum', kind => {
  let ledger = reserve(createLedger(policy(true)), request(1, 60), facts());
  ledger = settle(ledger, 'reservation_1', kind === 'unknown' ? { kind } : { kind, microUsd: 20 });
  expect(accountingSummary(ledger).reservedMicroUsd).toBe(60);
  expect(() => reserve(ledger, request(2, 1), facts())).toThrow('unresolved-charge');
});

test('bounded operations truthfully retain unknown/partial cost and permit unrelated work', () => {
  let ledger = reserve(createLedger(policy()), request(), facts());
  ledger = settle(ledger);
  ledger = reserve(ledger, request(2), facts());
  ledger = settle(ledger, 'reservation_2', { kind: 'partial', microUsd: 17 });
  ledger = reserve(ledger, request(3), facts());
  expect(accountingSummary(ledger)).toEqual({ knownSubtotalMicroUsd: 17, unknownCalls: 1, partialCalls: 1,
    pendingCalls: 1, reservedMicroUsd: 0, consumedCalls: 3 });
});

test('receipts are actual, stable and attributable; enforcement breaches retain charge and park future work', () => {
  let ledger = reserve(createLedger(policy(true)), request(1, 30), facts());
  const receipt = { id: 'receipt', outcome: 'succeeded' as const, accounting: { kind: 'reported' as const, microUsd: 35 } };
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'receipt', receipt })).toThrow('receipt-without-dispatch');
  ledger = observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: facts() });
  ledger = observeReservation(ledger, 'reservation_1', { type: 'receipt', receipt });
  expect(ledger.enforcementViolated).toBe(true);
  expect(accountingSummary(ledger).knownSubtotalMicroUsd).toBe(35);
  expect(observeReservation(ledger, 'reservation_1', { type: 'receipt', receipt })).toBe(ledger);
  expect(() => observeReservation(ledger, 'reservation_1', { type: 'receipt', receipt: { ...receipt, id: 'changed' } })).toThrow('receipt-replay-mismatch');
  expect(() => reserve(ledger, request(2, 1), facts())).toThrow('enforcement-violated');
});

test('safe micro-USD overflow refuses admission without changing the existing ledger', () => {
  const input = policy(true); input.cost = { mode: 'strict-money', capMicroUsd: Number.MAX_SAFE_INTEGER };
  const ledger = reserve(createLedger(input), request(1, Number.MAX_SAFE_INTEGER), facts());
  expect(() => reserve(ledger, request(2, 1), facts())).toThrow('invalid-integer');
  expect(ledger.reservations).toHaveLength(1);
  expect(() => reserve(createLedger(policy(true)), request(1, 0.5), facts())).toThrow('invalid-integer');
});

test('600 finite calls are the default, lower explicit call ceiling counts settled and uncertain requests', () => {
  expect(policy().limits.calls).toBe(600);
  const input = policy(); input.limits.calls = 2;
  let ledger = settle(reserve(createLedger(input), request(), facts()));
  ledger = settle(reserve(ledger, request(2), facts()), 'reservation_2');
  expect(() => reserve(ledger, request(3), facts())).toThrow('call-limit');
  expect(() => createLedger({ ...input, limits: { ...input.limits, calls: Number.POSITIVE_INFINITY } })).toThrow('lossy-number');
});

test('injected active and wall time reach exact ceilings, resist rollback and recheck before dispatch', () => {
  const p = policy();
  const ledger = createLedger(p);
  expect(() => reserve(ledger, request(), { ...facts(), clock: { nowMs: 100 + p.limits.activeMs, activeMs: p.limits.activeMs } })).toThrow('time-limit');
  expect(() => reserve(ledger, request(), { ...facts(), clock: { nowMs: 100 + p.limits.lifetimeMs, activeMs: 0 } })).toThrow('time-limit');
  const pending = reserve(ledger, request(), facts());
  expect(() => reserve(pending, request(2), { ...facts(), clock: { nowMs: 199, activeMs: 50 } })).toThrow('clock-regression');
  expect(() => reserve(pending, request(2), { ...facts(), clock: { nowMs: 201, activeMs: 49 } })).toThrow('clock-regression');
  expect(() => observeReservation(pending, 'reservation_1', { type: 'dispatch', facts: { ...facts(), clock: { nowMs: 100 + p.limits.lifetimeMs, activeMs: 50 } } })).toThrow('time-limit');
});

test('pause/revocation facts and missing accounting persistence close reservation and send gates', () => {
  const ledger = createLedger(policy());
  expect(() => reserve(ledger, request(), { ...facts(), gate: 'closed' })).toThrow('host-gate-closed');
  expect(() => reserve(ledger, request(), { ...facts(), accountingDurable: false })).toThrow('host-gate-closed');
  const pending = reserve(ledger, request(), facts());
  expect(() => observeReservation(pending, 'reservation_1', { type: 'dispatch', facts: { ...facts(), gate: 'closed' } })).toThrow('host-gate-closed');
});

test.each(['generation', 'policy', 'destination', 'owner', 'output-tokens', 'output-bytes', 'local-cycle', 'global-cycle'])('refuses invalid %s', kind => {
  const input = request();
  if (kind === 'generation') input.generation = 0;
  if (kind === 'policy') input.policyDigest = hash(99);
  if (kind === 'destination') input.destination.modelId = 'unselected/model';
  if (kind === 'owner') input.attempt = { ...input.attempt, owner: { ...input.attempt.owner, runId: 'other' } };
  if (kind === 'output-tokens') input.outputTokens++;
  if (kind === 'output-bytes') input.outputBytes++;
  if (kind === 'local-cycle') input.localRevision = 3;
  if (kind === 'global-cycle') input.globalRevision = 2;
  expect(() => reserve(createLedger(policy()), input, facts())).toThrow();
});

test('no-progress fingerprint cannot be evaded by new attempt IDs, scope IDs or another command', () => {
  let ledger = reserve(createLedger(policy()), request(), facts());
  ledger = settle(ledger);
  expect(() => reserve(ledger, { ...request(2), inputDigest: hash() }, facts())).toThrow('no-progress');
  expect(reserve(ledger, { ...request(2), directionDigest: hash(2) }, facts()).reservations).toHaveLength(2);
});

test('revision cycles require an ordinal, cannot be reused or rolled back, and exhaust after two', () => {
  let ledger = createLedger(policy());
  const revision = (n: number): ReservationRequest => ({ ...request(n), role: 'revision-writer', scopeId: 'chapter', localRevision: n });
  expect(() => reserve(ledger, { ...revision(1), localRevision: 0 }, facts())).toThrow('missing-revision-cycle');
  ledger = settle(reserve(ledger, revision(1), facts()));
  expect(() => reserve(ledger, { ...revision(2), localRevision: 1 }, facts())).toThrow('revision-cycle-reused');
  ledger = settle(reserve(ledger, revision(2), facts()), 'reservation_2');
  expect(() => reserve(ledger, revision(3), facts())).toThrow('invalid-integer');
  expect(() => reserve(ledger, { ...request(3), scopeId: 'chapter' }, facts())).toThrow('revision-regression');
});

test('continuations are individually reserved, sequential, max four calls/eight reads, with immutable inputs', () => {
  let ledger = createLedger(policy());
  const continuation = (i: number): ReservationRequest => ({ ...request(), id: `reservation_${i}`,
    requestDigest: hash(i), callIndex: i, localReads: 2 });
  ledger = reserve(ledger, continuation(1), facts());
  expect(() => reserve(ledger, continuation(2), facts())).toThrow('unsettled-continuation');
  ledger = settle(ledger);
  expect(() => reserve(ledger, { ...continuation(2), requestDigest: hash() }, facts())).toThrow('repeated-request');
  expect(() => reserve(ledger, { ...continuation(2), inputDigest: hash(2) }, facts())).toThrow('changed-attempt-input');
  for (let i = 2; i <= 4; i++) ledger = settle(reserve(ledger, continuation(i), facts()), `reservation_${i}`);
  expect(accountingSummary(ledger).consumedCalls).toBe(4);
  expect(() => reserve(ledger, continuation(5), facts())).toThrow('invalid-integer');
  let reads = reserve(createLedger(policy()), { ...continuation(1), localReads: 8 }, facts());
  reads = settle(reads);
  expect(() => reserve(reads, continuation(2), facts())).toThrow('read-limit');
});

test('429 is earliest eligibility only; auth/quota parks cannot be downgraded by a later rate-limit event', () => {
  let ledger = parkConnection(createLedger(policy()), { connectionId: route.connectionId, reason: 'rate-limit', eligibleAtMs: 500 });
  const eligible = { ...facts(), clock: { nowMs: 501, activeMs: 50 } };
  expect(() => reserve(ledger, request(), eligible)).toThrow('connection-parked');
  expect(() => continueConnection(ledger, route.connectionId, facts().clock)).toThrow('retry-not-yet-eligible');
  ledger = continueConnection(ledger, route.connectionId, eligible.clock);
  expect(ledger.reservations).toHaveLength(0);
  ledger = reserve(ledger, request(), eligible);
  for (const reason of ['auth', 'quota'] as const) {
    let parked = parkConnection(ledger, { connectionId: route.connectionId, reason, eligibleAtMs: null });
    parked = parkConnection(parked, { connectionId: route.connectionId, reason: 'rate-limit', eligibleAtMs: 600 });
    expect(parked.parked[0]?.reason).toBe(reason);
    expect(() => observeReservation(parked, 'reservation_1', { type: 'dispatch', facts: eligible })).toThrow('connection-parked');
  }
});

test.each(['failed', 'stopped'] as const)('%s receipt retains actual charge and cannot be disguised as a continuation', outcome => {
  let ledger = reserve(createLedger(policy()), request(), facts());
  ledger = observeReservation(ledger, 'reservation_1', { type: 'dispatch', facts: facts() });
  ledger = observeReservation(ledger, 'reservation_1', { type: 'receipt', receipt: {
    id: 'failed_receipt', outcome, accounting: { kind: 'reported', microUsd: 11 },
  } });
  expect(accountingSummary(ledger).knownSubtotalMicroUsd).toBe(11);
  expect(() => reserve(ledger, { ...request(), id: 'continuation', callIndex: 2 }, facts())).toThrow('failed-attempt-no-continuation');
  expect(() => reserve(ledger, { ...request(2), inputDigest: hash() }, facts())).toThrow('no-progress');
});

test('pause/recovery generation changes preserve finite history and refuse old reserved sends/continuations', () => {
  const input = policy(); input.limits.calls = 2;
  let ledger = settle(reserve(createLedger(input), request(), facts()));
  ledger = reserve(ledger, request(2), facts());
  ledger = advanceAdmissionGeneration(ledger, 2);
  expect(() => advanceAdmissionGeneration(ledger, 1)).toThrow('stale-generation');
  expect(() => observeReservation(ledger, 'reservation_2', { type: 'dispatch', facts: facts() })).toThrow('stale-admission-policy');
  ledger = observeReservation(ledger, 'reservation_2', { type: 'known-unsent' });
  expect(accountingSummary(ledger).consumedCalls).toBe(1);
  expect(() => reserve(ledger, { ...request(), id: 'old_continuation', callIndex: 2, generation: 2 }, facts())).toThrow('changed-attempt-input');
  ledger = reserve(ledger, { ...request(3), generation: 2 }, facts());
  expect(() => reserve(ledger, { ...request(4), generation: 2 }, facts())).toThrow('call-limit');
  expect(ledger.clock.activeMs).toBe(50);
});
