import { describe, expect, test } from 'bun:test';
import { AuthoringError, readCheckinWordTarget } from '../../src/authoring';

const bookId = 'book_1f4c8a2b9d3e5a71';

function goal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    bookId,
    goalId: 'goal_1',
    revision: 2,
    targetWords: 70_000,
    ...overrides,
  };
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AuthoringError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('check-in word target', () => {
  test('copies the saved goal id and positive target without counting prose', () => {
    const input = goal({
      content: 'one two three four',
      future: { label: '保留', note: 'selectedUtf16 is not a field here' },
    });
    const result = readCheckinWordTarget(input, bookId);
    expect(result).toEqual({ goalId: 'goal_1', targetWords: 70_000 });
    expect(result).not.toBe(input);
    expect(result.goalId).not.toBe(bookId);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(input.content).toBe('one two three four');
    expect(readCheckinWordTarget(goal({ targetWords: 1 }), bookId).targetWords).toBe(1);
    expect(readCheckinWordTarget(goal({ targetWords: Number.MAX_SAFE_INTEGER }), bookId).targetWords)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  test('does not freeze or mutate the caller, including an already frozen goal', () => {
    const input = Object.freeze(goal());
    const result = readCheckinWordTarget(input, bookId);
    expect(result).toEqual({ goalId: 'goal_1', targetWords: 70_000 });
    expect(Object.isFrozen(input)).toBe(true);
    expect(result).not.toBe(input);
  });

  test('does not invent a goal id from the book id', () => {
    const input = goal();
    delete input.goalId;
    expect(refusal(() => readCheckinWordTarget(input, bookId))).toBe('invalid-id');
    expect(refusal(() => readCheckinWordTarget(goal({ goalId: '' }), bookId))).toBe('invalid-id');
    expect(readCheckinWordTarget(goal({ goalId: 'goal_saved' }), bookId).goalId).toBe('goal_saved');
  });

  test('refuses a null target, another schema, and a different book', () => {
    expect(refusal(() => readCheckinWordTarget(goal({ targetWords: null }), bookId))).toBe('absent-word-target');
    const cleared = goal({ targetWords: null });
    delete cleared.goalId;
    expect(refusal(() => readCheckinWordTarget(cleared, bookId))).toBe('absent-word-target');
    for (const schemaVersion of [2, 0, '1', null, true]) {
      expect(refusal(() => readCheckinWordTarget(goal({ schemaVersion }), bookId))).toBe('unsupported-version');
    }
    const missingSchema = goal();
    delete missingSchema.schemaVersion;
    expect(refusal(() => readCheckinWordTarget(missingSchema, bookId))).toBe('unsupported-version');
    expect(refusal(() => readCheckinWordTarget(goal(), 'book_otherbook01'))).toBe('foreign-goal');
    expect(refusal(() => readCheckinWordTarget(goal({ bookId: 'book_otherbook01' }), bookId)))
      .toBe('foreign-goal');
    const missingBook = goal();
    delete missingBook.bookId;
    expect(refusal(() => readCheckinWordTarget(missingBook, bookId))).toBe('foreign-goal');
  });

  test('refuses campaign scalar and byte totals at any depth before reading the target', () => {
    expect(refusal(() => readCheckinWordTarget(goal({ selectedUtf16: 12 }), bookId)))
      .toBe('campaign-count-not-words');
    expect(refusal(() => readCheckinWordTarget(goal({ selectedUtf8: 12, targetWords: null }), bookId)))
      .toBe('campaign-count-not-words');
    expect(refusal(() => readCheckinWordTarget(goal({ nested: { selectedUtf16: 1 } }), bookId)))
      .toBe('campaign-count-not-words');
    expect(refusal(() => readCheckinWordTarget(goal({ list: [{ selectedUtf8: 1 }] }), bookId)))
      .toBe('campaign-count-not-words');
    expect(refusal(() => readCheckinWordTarget(
      goal({ schemaVersion: 2, wrapped: [[{ selectedUtf16: 4 }]] }), bookId,
    ))).toBe('campaign-count-not-words');
    expect(readCheckinWordTarget(goal({ selectedUtf16Count: 12, note: 'selectedUtf8' }), bookId))
      .toEqual({ goalId: 'goal_1', targetWords: 70_000 });
  });

  test('refuses a non-positive or non-integer target without coercing it', () => {
    for (const targetWords of [0, -1, 0.5, '100', true]) {
      expect(refusal(() => readCheckinWordTarget(goal({ targetWords }), bookId))).toBe('invalid-integer');
    }
    const missing = goal();
    delete missing.targetWords;
    expect(refusal(() => readCheckinWordTarget(missing, bookId))).toBe('invalid-integer');
    for (const targetWords of [Number.NaN, Number.POSITIVE_INFINITY, -0, Number.MAX_SAFE_INTEGER + 1]) {
      expect(refusal(() => readCheckinWordTarget(goal({ targetWords }), bookId))).toBe('lossy-number');
    }
  });

  test('refuses a non-goal value and does not run accessors', () => {
    expect(refusal(() => readCheckinWordTarget(null, bookId))).toBe('invalid-goal');
    expect(refusal(() => readCheckinWordTarget([], bookId))).toBe('invalid-goal');
    expect(refusal(() => readCheckinWordTarget('goal', bookId))).toBe('invalid-goal');
    expect(refusal(() => readCheckinWordTarget(goal(), ''))).toBe('invalid-id');
    let called = 0;
    const getter = Object.defineProperty(goal(), 'targetWords', {
      enumerable: true,
      get() { called += 1; return 10; },
    });
    expect(refusal(() => readCheckinWordTarget(getter, bookId))).toBe('non-data-property');
    expect(called).toBe(0);
  });
});
