import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CHECKIN_CADENCE_POLICY,
  CHECKIN_CADENCE_LIMITS,
  evaluateCheckinCadence,
  validateCheckinCadencePolicy,
  type CheckinCadencePolicy,
  type CheckinCadenceProgress,
} from '../../src/authoring';

function progress(overrides: Partial<CheckinCadenceProgress> = {}): CheckinCadenceProgress {
  return {
    adoptedChaptersSinceCheckin: 0,
    savedWordsSinceCheckin: 0,
    firstAdoptedChapterOccurred: false,
    irreversibleChoicePending: false,
    ...overrides,
  };
}

describe('check-in cadence policy validation', () => {
  test('default policy shape validates and matches ADR 0019 defaults', () => {
    const validated = validateCheckinCadencePolicy(DEFAULT_CHECKIN_CADENCE_POLICY);
    expect(validated).toEqual({
      version: 1,
      adoptedChapterInterval: 3,
      savedWordInterval: 10_000,
      afterFirstChapter: true,
      onIrreversibleChoice: true,
    });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validated).not.toBe(DEFAULT_CHECKIN_CADENCE_POLICY);
  });

  test('edited values within bounds validate', () => {
    const edited: CheckinCadencePolicy = {
      version: 1,
      adoptedChapterInterval: 5,
      savedWordInterval: 5_000,
      afterFirstChapter: false,
      onIrreversibleChoice: false,
    };
    expect(validateCheckinCadencePolicy(edited)).toEqual(edited);
    // boundary minima
    expect(validateCheckinCadencePolicy({
      version: 1, adoptedChapterInterval: CHECKIN_CADENCE_LIMITS.minAdoptedChapterInterval,
      savedWordInterval: CHECKIN_CADENCE_LIMITS.minSavedWordInterval,
      afterFirstChapter: true, onIrreversibleChoice: true,
    }).adoptedChapterInterval).toBe(CHECKIN_CADENCE_LIMITS.minAdoptedChapterInterval);
    // boundary maxima
    expect(validateCheckinCadencePolicy({
      version: 1, adoptedChapterInterval: CHECKIN_CADENCE_LIMITS.maxAdoptedChapterInterval,
      savedWordInterval: CHECKIN_CADENCE_LIMITS.maxSavedWordInterval,
      afterFirstChapter: true, onIrreversibleChoice: true,
    }).savedWordInterval).toBe(CHECKIN_CADENCE_LIMITS.maxSavedWordInterval);
  });

  test('out-of-bounds values refuse', () => {
    const base = { ...DEFAULT_CHECKIN_CADENCE_POLICY };
    expect(() => validateCheckinCadencePolicy({ ...base, adoptedChapterInterval: 0 })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({ ...base, adoptedChapterInterval: -1 })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({
      ...base, adoptedChapterInterval: CHECKIN_CADENCE_LIMITS.maxAdoptedChapterInterval + 1,
    })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({ ...base, savedWordInterval: 0 })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({ ...base, savedWordInterval: -100 })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({
      ...base, savedWordInterval: CHECKIN_CADENCE_LIMITS.maxSavedWordInterval + 1,
    })).toThrow('invalid-integer');
  });

  test('unknown version refuses with unsupported-version and is never coerced', () => {
    expect(() => validateCheckinCadencePolicy({
      ...DEFAULT_CHECKIN_CADENCE_POLICY, version: 2,
    } as unknown as CheckinCadencePolicy)).toThrow('unsupported-version');
    expect(() => validateCheckinCadencePolicy({
      ...DEFAULT_CHECKIN_CADENCE_POLICY, version: 0,
    } as unknown as CheckinCadencePolicy)).toThrow('unsupported-version');
    expect(() => validateCheckinCadencePolicy({
      adoptedChapterInterval: 3, savedWordInterval: 10_000,
      afterFirstChapter: true, onIrreversibleChoice: true,
    } as unknown as CheckinCadencePolicy)).toThrow('unsupported-version');
  });

  test('malformed shapes refuse without coercion or silent defaults', () => {
    const base = { ...DEFAULT_CHECKIN_CADENCE_POLICY };
    // missing fields must not be defaulted
    expect(() => validateCheckinCadencePolicy({ version: 1 } as unknown as CheckinCadencePolicy)).toThrow();
    expect(() => validateCheckinCadencePolicy({
      version: 1, adoptedChapterInterval: 3, savedWordInterval: 10_000, afterFirstChapter: true,
    } as unknown as CheckinCadencePolicy)).toThrow();
    // string numbers are not coerced
    expect(() => validateCheckinCadencePolicy({
      ...base, adoptedChapterInterval: '3',
    } as unknown as CheckinCadencePolicy)).toThrow();
    expect(() => validateCheckinCadencePolicy({
      ...base, savedWordInterval: '10000',
    } as unknown as CheckinCadencePolicy)).toThrow();
    // fractional, -0, unsafe, non-finite
    expect(() => validateCheckinCadencePolicy({ ...base, adoptedChapterInterval: 1.5 })).toThrow('invalid-integer');
    expect(() => validateCheckinCadencePolicy({ ...base, savedWordInterval: -0 })).toThrow();
    expect(() => validateCheckinCadencePolicy({ ...base, adoptedChapterInterval: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => validateCheckinCadencePolicy({ ...base, savedWordInterval: Number.NaN })).toThrow();
    // booleans must be booleans
    expect(() => validateCheckinCadencePolicy({
      ...base, afterFirstChapter: 'true',
    } as unknown as CheckinCadencePolicy)).toThrow();
    expect(() => validateCheckinCadencePolicy({
      ...base, onIrreversibleChoice: 1,
    } as unknown as CheckinCadencePolicy)).toThrow();
    // null / array / non-object
    expect(() => validateCheckinCadencePolicy(null as unknown as CheckinCadencePolicy)).toThrow();
    expect(() => validateCheckinCadencePolicy([] as unknown as CheckinCadencePolicy)).toThrow();
    expect(() => validateCheckinCadencePolicy('policy' as unknown as CheckinCadencePolicy)).toThrow();
  });

  test('validated policy does not alias or mutate caller input', () => {
    const input: CheckinCadencePolicy = {
      version: 1, adoptedChapterInterval: 2, savedWordInterval: 2_000,
      afterFirstChapter: true, onIrreversibleChoice: true,
    };
    const validated = validateCheckinCadencePolicy(input);
    input.adoptedChapterInterval = 99;
    expect(validated.adoptedChapterInterval).toBe(2);
    expect(Object.isFrozen(input)).toBe(false);
  });
});

describe('check-in cadence due evaluation', () => {
  test('due at first adopted chapter', () => {
    const result = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 1, firstAdoptedChapterOccurred: true,
    }));
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('first-adopted-chapter');
  });

  test('not due before first adopted chapter absent irreversible choice', () => {
    const result = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 0, savedWordsSinceCheckin: 0,
      firstAdoptedChapterOccurred: false, irreversibleChoicePending: false,
    }));
    expect(result).toEqual({ due: false, reasons: [] });
    // one chapter but first flag not set and below interval thresholds is not due
    const below = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 1, savedWordsSinceCheckin: 100,
      firstAdoptedChapterOccurred: false,
    }));
    expect(below.due).toBe(false);
  });

  test('due at chapter threshold', () => {
    const result = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 3,
    }));
    expect(result.due).toBe(true);
    expect(result.reasons).toEqual(['adopted-chapter-interval']);
    const above = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 4,
    }));
    expect(above.due).toBe(true);
    expect(above.reasons).toContain('adopted-chapter-interval');
  });

  test('due at word threshold', () => {
    const result = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      savedWordsSinceCheckin: 10_000,
    }));
    expect(result.due).toBe(true);
    expect(result.reasons).toEqual(['saved-word-interval']);
  });

  test('due on irreversible choice regardless of counts', () => {
    const zero = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      irreversibleChoicePending: true,
    }));
    expect(zero.due).toBe(true);
    expect(zero.reasons).toEqual(['irreversible-choice']);
    const below = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 1, savedWordsSinceCheckin: 10, irreversibleChoicePending: true,
    }));
    expect(below.due).toBe(true);
    expect(below.reasons).toContain('irreversible-choice');
  });

  test('exact-threshold boundary is due; one below is not (whichever-occurs-first)', () => {
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 3,
    })).due).toBe(true);
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 2,
    })).due).toBe(false);
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      savedWordsSinceCheckin: 10_000,
    })).due).toBe(true);
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      savedWordsSinceCheckin: 9_999,
    })).due).toBe(false);
    // whichever first: chapter reached while words not
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 3, savedWordsSinceCheckin: 0,
    })).reasons).toEqual(['adopted-chapter-interval']);
    // words reached while chapters not
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 0, savedWordsSinceCheckin: 10_000,
    })).reasons).toEqual(['saved-word-interval']);
  });

  test('custom edited thresholds govern exact boundaries', () => {
    const policy: CheckinCadencePolicy = {
      version: 1, adoptedChapterInterval: 2, savedWordInterval: 500,
      afterFirstChapter: true, onIrreversibleChoice: true,
    };
    expect(evaluateCheckinCadence(policy, progress({ adoptedChaptersSinceCheckin: 2 })).due).toBe(true);
    expect(evaluateCheckinCadence(policy, progress({ adoptedChaptersSinceCheckin: 1 })).due).toBe(false);
    expect(evaluateCheckinCadence(policy, progress({ savedWordsSinceCheckin: 500 })).due).toBe(true);
    expect(evaluateCheckinCadence(policy, progress({ savedWordsSinceCheckin: 499 })).due).toBe(false);
  });

  test('multiple simultaneous triggers report all reasons', () => {
    const result = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 3,
      savedWordsSinceCheckin: 10_000,
      firstAdoptedChapterOccurred: true,
      irreversibleChoicePending: true,
    }));
    expect(result.due).toBe(true);
    expect(result.reasons).toEqual([
      'first-adopted-chapter', 'adopted-chapter-interval', 'saved-word-interval', 'irreversible-choice',
    ]);
    const two = evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 5, savedWordsSinceCheckin: 20_000,
    }));
    expect(two.reasons).toEqual(['adopted-chapter-interval', 'saved-word-interval']);
  });

  test('disabled first / irreversible triggers do not fire', () => {
    const policy: CheckinCadencePolicy = {
      version: 1, adoptedChapterInterval: 3, savedWordInterval: 10_000,
      afterFirstChapter: false, onIrreversibleChoice: false,
    };
    expect(evaluateCheckinCadence(policy, progress({
      adoptedChaptersSinceCheckin: 1, firstAdoptedChapterOccurred: true,
    })).due).toBe(false);
    expect(evaluateCheckinCadence(policy, progress({
      irreversibleChoicePending: true,
    })).due).toBe(false);
    // intervals still fire when disabled
    expect(evaluateCheckinCadence(policy, progress({
      adoptedChaptersSinceCheckin: 3, firstAdoptedChapterOccurred: true, irreversibleChoicePending: true,
    })).reasons).toEqual(['adopted-chapter-interval']);
  });

  test('zero progress is not due; negative / fractional / -0 progress refuses per integer conventions', () => {
    expect(evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress()).due).toBe(false);
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: -1,
    }))).toThrow('invalid-integer');
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      savedWordsSinceCheckin: -1,
    }))).toThrow('invalid-integer');
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: 1.5,
    }))).toThrow('invalid-integer');
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      savedWordsSinceCheckin: -0,
    }))).toThrow();
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, progress({
      adoptedChaptersSinceCheckin: Number.MAX_SAFE_INTEGER + 1,
    }))).toThrow();
    // non-boolean flags refuse, not coerced
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, {
      adoptedChaptersSinceCheckin: 0, savedWordsSinceCheckin: 0,
      firstAdoptedChapterOccurred: 'yes', irreversibleChoicePending: false,
    } as unknown as CheckinCadenceProgress)).toThrow();
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, {
      adoptedChaptersSinceCheckin: 0, savedWordsSinceCheckin: 0,
      firstAdoptedChapterOccurred: false, irreversibleChoicePending: 1,
    } as unknown as CheckinCadenceProgress)).toThrow();
  });

  test('evaluator validates the policy and does not mutate inputs; result is frozen', () => {
    const policyInput: CheckinCadencePolicy = { ...DEFAULT_CHECKIN_CADENCE_POLICY };
    const progressInput = progress({ adoptedChaptersSinceCheckin: 3 });
    const result = evaluateCheckinCadence(policyInput, progressInput);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(policyInput).toEqual(DEFAULT_CHECKIN_CADENCE_POLICY);
    expect(progressInput.adoptedChaptersSinceCheckin).toBe(3);
    expect(() => evaluateCheckinCadence({
      ...DEFAULT_CHECKIN_CADENCE_POLICY, version: 2,
    } as unknown as CheckinCadencePolicy, progress())).toThrow('unsupported-version');
    expect(() => evaluateCheckinCadence(DEFAULT_CHECKIN_CADENCE_POLICY, null as unknown as CheckinCadenceProgress)).toThrow();
  });
});
