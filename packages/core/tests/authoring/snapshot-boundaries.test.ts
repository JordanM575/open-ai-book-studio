import { expect, test } from 'bun:test';
import { accountingSummary, advanceAdmissionGeneration, continueConnection, copyValue, createLedger,
  createRun, observeReservation, parkConnection, reduceRun, reserve, runStatus, validateGraph } from '../../src/authoring';
import { command, facts, graph, policy, request, route, step } from './fixtures';

function extension(depth = 63): unknown {
  let value: unknown = 'exact 👩🏽‍🚀 e\u0301\n';
  for (let i = 0; i < depth; i++) value = { child: value };
  return value;
}

test('depth64 graph extensions survive pause, recovery and repeated control transitions', () => {
  const input = { ...graph(), extension: extension() };
  const expected = JSON.stringify(input);
  const initial = createRun(input);
  expect(validateGraph(input)).toEqual(input);
  let state = initial;
  for (let i = 0; i < 4; i++) {
    state = step(state, { type: 'pause' });
    expect(runStatus(state)).toBe('paused');
    state = step(state, { type: 'recover' });
    state = step(state, { type: 'resume' });
    expect(runStatus(state)).toBe('active');
    expect(JSON.stringify(state.graph)).toBe(expected);
  }
  expect(initial.revision).toBe(0);
  expect(JSON.stringify(input)).toBe(expected);
  expect(Object.isFrozen(input)).toBe(false);
  expect(state.graph).not.toBe(initial.graph);
  expect(Object.isFrozen(Reflect.get(state.graph, 'extension'))).toBe(true);
  const overDepth = { ...input, extension: extension(64) };
  expect(() => createRun(overDepth)).toThrow('value-depth');
});

test('depth64 commands retain exact replay payloads through later resume and cancel', () => {
  const initial = createRun(graph());
  const input = { ...command(initial, { type: 'pause' }), extension: extension() };
  const expected = JSON.stringify(input);
  let state = reduceRun(initial, input);
  state = step(state, { type: 'resume' });
  expect(JSON.stringify(state.commands[0])).toBe(expected);
  expect(reduceRun(state, input)).toBe(state);
  state = step(state, { type: 'cancel' });
  expect(runStatus(state)).toBe('cancelled');
  expect(JSON.stringify(state.commands[0])).toBe(expected);
  expect(Object.isFrozen(input)).toBe(false);
  const overDepth = { ...input, extension: extension(64) };
  expect(() => reduceRun(initial, overDepth)).toThrow('value-depth');
});

test('depth64 policy survives reservations, connection park/Continue and generation advance', () => {
  const input = { ...policy(), extension: extension() };
  const initial = createLedger(input);
  let ledger = reserve(initial, request(), facts());
  ledger = observeReservation(ledger, request().id, { type: 'known-unsent' });
  ledger = parkConnection(ledger, { connectionId: route.connectionId, reason: 'auth', eligibleAtMs: null });
  ledger = continueConnection(ledger, route.connectionId, facts().clock);
  ledger = advanceAdmissionGeneration(ledger, 2);
  expect(ledger.policy).toEqual({ ...input, generation: 2 });
  expect(initial.policy.generation).toBe(1);
  expect(initial.reservations).toEqual([]);
  expect(ledger.parked).toEqual([]);
  expect(accountingSummary(ledger).consumedCalls).toBe(0);
  expect(Object.isFrozen(input)).toBe(false);
  const overDepth = { ...input, extension: extension(64) };
  expect(() => createLedger(overDepth)).toThrow('value-depth');
});

test('depth64 request survives both known-unsent release and dispatched late receipt', () => {
  const initial = createLedger(policy());
  const input = { ...request(), extension: extension() };
  const expected = JSON.stringify(input);
  const reserved = reserve(initial, input, facts());
  const released = observeReservation(reserved, input.id, { type: 'known-unsent' });
  expect(released.reservations[0]?.phase).toBe('released');
  expect(JSON.stringify(released.reservations[0]?.request)).toBe(expected);
  expect(reserve(released, input, facts())).toBe(released);
  let sent = observeReservation(reserved, input.id, { type: 'dispatch', facts: facts() });
  sent = advanceAdmissionGeneration(sent, 2);
  sent = observeReservation(sent, input.id, { type: 'receipt', receipt: {
    id: 'receipt_1', outcome: 'stopped', accounting: { kind: 'reported', microUsd: 17 },
  } });
  expect(sent.reservations[0]?.phase).toBe('settled');
  expect(JSON.stringify(sent.reservations[0]?.request)).toBe(expected);
  expect(accountingSummary(sent).knownSubtotalMicroUsd).toBe(17);
  expect(reserved.reservations[0]?.phase).toBe('reserved');
  expect(Object.isFrozen(input)).toBe(false);
  const overDepth = { ...input, extension: extension(64) };
  expect(() => reserve(initial, overDepth, facts())).toThrow('value-depth');
});

test('depth64 clock, park and receipt input remains usable when retained in ledger wrappers', () => {
  let ledger = createLedger(policy());
  const park = { connectionId: route.connectionId, reason: 'rate-limit' as const, eligibleAtMs: 200,
    extension: extension() };
  ledger = parkConnection(ledger, park);
  const clock = { ...facts().clock, extension: extension() };
  ledger = continueConnection(ledger, route.connectionId, clock);
  expect(ledger.clock).toEqual(clock);
  ledger = reserve(ledger, request(), facts());
  ledger = observeReservation(ledger, request().id, { type: 'dispatch', facts: facts() });
  const receipt = { type: 'receipt' as const, receipt: { id: 'receipt_2', outcome: 'failed' as const,
    accounting: { kind: 'partial' as const, microUsd: 3 }, extension: extension(62) } };
  expect(copyValue(receipt)).toEqual(receipt);
  ledger = observeReservation(ledger, request().id, receipt);
  ledger = advanceAdmissionGeneration(ledger, 2);
  expect(ledger.reservations[0]?.receipt).toEqual(receipt.receipt);
  expect(accountingSummary(ledger)).toMatchObject({ partialCalls: 1, knownSubtotalMicroUsd: 3 });
});

test('explicit connection Continue rejects clock accessors before any reads', () => {
  const ledger = parkConnection(createLedger(policy()), {
    connectionId: route.connectionId, reason: 'rate-limit', eligibleAtMs: 300,
  });
  for (const field of ['nowMs', 'activeMs']) {
    let reads = 0;
    const clock = Object.defineProperty({ nowMs: 300, activeMs: 50 }, field, {
      enumerable: true, get() { reads++; return 300; },
    });
    expect(() => continueConnection(ledger, route.connectionId, clock)).toThrow('non-data-property');
    expect(reads).toBe(0);
    expect(ledger.parked).toHaveLength(1);
  }
  expect(() => continueConnection(ledger, route.connectionId, { nowMs: 200, activeMs: 50 })).toThrow('retry-not-yet-eligible');
  expect(() => continueConnection(ledger, route.connectionId, { nowMs: 99, activeMs: 0 })).toThrow('clock-regression');
  const continued = continueConnection(ledger, route.connectionId, { nowMs: 300, activeMs: 50 });
  expect(continued.parked).toEqual([]);
  expect(continued.reservations).toEqual([]);
  expect(ledger.clock).toEqual({ nowMs: 100, activeMs: 0 });
});
