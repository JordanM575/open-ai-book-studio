import { expect, test } from 'bun:test';
import { copyValue, prepareBrief, validateGraph } from '../../src/authoring';
import { add, text } from '../../src/authoring/value';
import { graph } from './fixtures';

test('exact Unicode brief, whitespace, nested extensions and goal survive without a word counter', () => {
  const input = { text: `  👩🏽‍🚀 e\u0301\n${'story '.repeat(150)}`, goalId: 'goal_1', targetWords: 70_000,
    futureDisplay: { label: '保留', values: [null, false, 4, 0.5, 1e-100] } };
  const result = prepareBrief(input);
  expect(result).toEqual(input);
  expect(result).not.toBe(input);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(input)).toBe(false);
  expect(prepareBrief({ ...input, text: 'brief' }).text).toBe('brief');
});

test('brief exact boundary accepts 20k units and refuses the next unit without clipping', () => {
  const brief = { text: 'x'.repeat(20_000), goalId: 'goal_1', targetWords: 1 };
  expect(prepareBrief(brief).text).toBe(brief.text);
  expect(() => prepareBrief({ ...brief, text: `${brief.text}x` })).toThrow('invalid-text');
  expect(() => prepareBrief({ ...brief, targetWords: 0 })).toThrow('invalid-integer');
});

test.each([undefined, NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1, 1n,
  Symbol('bad'), () => 1, new Date(), new Map(), '\ud800', '\udc00'])('refuses lossy data %#', value => {
  expect(() => copyValue({ value })).toThrow();
});

test('refuses cycles, sparse arrays, symbols and non-enumerable fields without executing accessors', () => {
  const cycle: { next?: unknown } = {};
  cycle.next = cycle;
  expect(() => copyValue(cycle)).toThrow('cyclic-value');
  expect(() => copyValue(Array(3))).toThrow('sparse-or-extended-array');
  expect(() => copyValue(Object.assign([1], { extra: 2 }))).toThrow('sparse-or-extended-array');
  expect(() => copyValue({ [Symbol('key')]: 1 })).toThrow('symbol-property');
  expect(() => copyValue(Object.defineProperty({}, 'hidden', { value: 1 }))).toThrow('non-data-property');
  let called = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { called++; return 1; } });
  expect(() => copyValue(getter)).toThrow('non-data-property');
  expect(called).toBe(0);
});

test('shared acyclic data is independently copied, proto keys remain data', () => {
  const shared = { x: 'kept' };
  const result = copyValue({ a: shared, b: shared });
  expect(result.a).not.toBe(result.b);
  const proto = JSON.parse('{"__proto__":{"flag":true},"constructor":"data"}') as object;
  const copy = copyValue(proto);
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  expect(Object.hasOwn(copy, '__proto__')).toBe(true);
  expect(copy).toEqual(proto);
});

test('counts UTF-8 and JSON escaping exactly; enforces depth and safe arithmetic', () => {
  const value = { x: '\n"\\🚀' };
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  expect(copyValue(value, bytes)).toEqual(value);
  expect(() => copyValue(value, bytes - 1)).toThrow('value-overflow');
  expect(() => text('🚀', 2, 3)).toThrow('text-overflow');
  let nested: unknown = null;
  for (let i = 0; i < 65; i++) nested = { child: nested };
  expect(() => copyValue(nested)).toThrow('value-depth');
  expect(() => add(Number.MAX_SAFE_INTEGER, 1)).toThrow('invalid-integer');
});

test('future graph versions, unsafe generations and path-like IDs refuse', () => {
  expect(() => validateGraph({ ...graph(), version: 2 } as unknown as ReturnType<typeof graph>)).toThrow('unsupported-version');
  expect(() => validateGraph({ ...graph(), generation: Number.MAX_SAFE_INTEGER + 1 })).toThrow('lossy-number');
  expect(() => validateGraph({ ...graph(), generation: 0.5 })).toThrow('invalid-integer');
  const input = graph();
  input.owner = { ...input.owner, runId: '../run' };
  expect(() => validateGraph(input)).toThrow('invalid-id');
});
