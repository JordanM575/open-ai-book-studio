import { describe, expect, test } from 'bun:test';
import {
  canonicalWorkflowJson, createRun, decodeWorkflowRecord, encodeWorkflowRecord,
  WORKFLOW_LIMITS, type Graph, type Owner, type WorkflowKind, type WorkflowRecord,
  type WorkflowReference,
} from '../../src/authoring';
import { step } from './fixtures';

const owner: Owner = { libraryRegistration: 'host_1', bookId: 'book_1', runId: 'run_1' };
const hash = (n = 1) => n.toString(16).padStart(64, '0');
const at = '2026-11-07T00:00:00.000Z';
const base = { kind: 'absent' as const, revision: 0 as const };
const destination = {
  connectionId: 'connection_1', providerId: 'provider_1', modelId: 'synthetic/model',
  accountKey: 'account_1',
};

function ref<K extends WorkflowKind>(kind: K, id: string, revision = 1): WorkflowReference<K> {
  return { kind, owner: { ...owner }, id, revision, hash: hash(revision + 1) };
}

function runRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'run', owner: { ...owner }, id: 'run_1', revision: 1, base,
    generation: 1, mode: 'running', phasePlan: ref('phase-plan', 'plan_1'),
    policy: ref('policy', 'policy_1'), direction: ref('direction', 'direction_1'),
    queue: [], materialized: [], createdAt: at, updatedAt: at,
  };
}

function briefRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'brief', owner: { ...owner }, id: 'brief_1', revision: 1,
    text: 'A short synthetic brief.', goalId: 'goal_1', targetWords: 70_000, createdAt: at,
  };
}

function policyRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'policy', owner: { ...owner }, id: 'policy_1', revision: 1,
    generation: 1, policyDigest: hash(), startedAtMs: 100,
    limits: {
      concurrency: 3, calls: 600, activeMs: 43_200_000, lifetimeMs: 604_800_000,
      localRevisions: 2, globalRevisions: 1, callsPerAttempt: 4, readsPerAttempt: 8,
      outputBytes: 262_144,
    },
    routes: [
      'architect', 'character-planner', 'drafter', 'developmental-reviewer', 'line-reviewer',
      'revision-writer', 'canon-summarizer',
    ].map(role => ({ role, destination: { ...destination } })),
    cost: { mode: 'bounded-operations' }, createdAt: at,
  };
}

function graph(): Graph {
  return {
    version: 1, owner: { ...owner }, policyDigest: hash(), generation: 1,
    direction: ref('direction', 'direction_1'),
    tasks: [{
      ref: ref('task', 'task_1'), role: 'drafter', completion: 'candidate', dependsOn: [],
      impact: { complete: true, keys: ['mara'] },
    }],
  };
}

function planRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'phase-plan', owner: { ...owner }, id: 'plan_1', revision: 1,
    generation: 1, phase: 1, previous: null, graph: graph(), createdAt: at,
  };
}

function directionRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'direction', owner: { ...owner }, id: 'direction_1', revision: 1,
    exactText: 'Keep the ending quiet.', origin: 'onboarding', previous: null, question: null,
    createdAt: at,
  };
}

function taskRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'task', owner: { ...owner }, id: 'task_1', revision: 1, base,
    generation: 1, plan: ref('phase-plan', 'plan_1'), phase: 1,
    definition: {
      role: 'drafter', completion: 'candidate', dependsOn: [],
      impact: { complete: true, keys: ['mara'] },
    },
    direction: ref('direction', 'direction_1'), currentAttempt: null, retryAllowed: true,
    needsDirection: false, createdAt: at, updatedAt: at,
  };
}

function commandRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'command', owner: { ...owner }, id: 'command_1', revision: 1,
    generation: 1, sequence: 1, expectedRevision: 0, payloadDigest: hash(),
    action: { type: 'pause' }, recordedAt: at,
  };
}

function commandPage(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'journal-page', owner: { ...owner }, id: 'journal_1', revision: 1,
    journal: 'command', pageSize: 2, firstSequence: 1, lastSequence: 1, nextSequence: 2,
    total: 1, entries: [{ sequence: 1, ref: ref('command', 'command_1') }], createdAt: at,
  };
}

function receiptPage(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'journal-page', owner: { ...owner }, id: 'journal_2', revision: 1,
    journal: 'receipt', pageSize: 2, firstSequence: 1, lastSequence: 1, nextSequence: 2,
    total: 1, entries: [{ sequence: 1, ref: ref('effect', 'effect_1') }], createdAt: at,
  };
}

function attemptRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'attempt', owner: { ...owner }, id: 'attempt_1', revision: 1, base,
    generation: 1, task: ref('task', 'task_1'), direction: ref('direction', 'direction_1'),
    context: ref('context', 'context_1'), inputDigest: hash(), revisionOf: null,
    phase: 'prepared', historical: false, noProgress: false, outputs: [], dispatch: null,
    accounting: { calls: 0, localReads: 0, knownSubtotalMicroUsd: 0, unknownCalls: 0,
      partialCalls: 0 },
    providerReceipts: [], createdAt: at, updatedAt: at,
  };
}

function effectRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'effect', owner: { ...owner }, id: 'effect_1', revision: 1, base,
    generation: 1, attempt: ref('attempt', 'attempt_1'), candidate: ref('artifact', 'artifact_1'),
    phase: 'prepared',
    target: { kind: 'new-chapter', chapterId: 'chapter_1', path: 'chapters/0001-mara.md' },
    intent: null, receipt: null, createdAt: at, updatedAt: at,
  };
}

function questionRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'question', owner: { ...owner }, id: 'question_1', revision: 1, base,
    generation: 1, keys: ['mara'], affected: ['task_1'], characterId: null, evidence: [],
    options: [], state: 'open', answer: null, createdAt: at, updatedAt: at,
  };
}

function artifactRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'artifact', owner: { ...owner }, id: 'artifact_1', revision: 1,
    mediaType: 'text/markdown', bytes: 12, hash: hash(), role: 'drafter',
    producedBy: ref('attempt', 'attempt_1'), createdAt: at,
  };
}

function contextRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'context', owner: { ...owner }, id: 'context_1', revision: 1,
    sources: [ref('brief', 'brief_1')], chapters: [], envelopeDigest: hash(), bytes: 64,
    createdAt: at,
  };
}

function reservationRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'reservation', owner: { ...owner }, id: 'reservation_1', revision: 1,
    base, generation: 1,
    request: {
      policyDigest: hash(), attempt: ref('attempt', 'attempt_1'), role: 'drafter',
      destination: { ...destination }, requestDigest: hash(2), inputDigest: hash(3),
      directionDigest: hash(4), reviewDigest: hash(5), scopeId: 'chapter_1', localRevision: 0,
      globalRevision: 0, callIndex: 1, localReads: 0, outputTokens: 4_096,
      outputBytes: 262_144, maximum: null,
    },
    phase: 'reserved', receipt: null, createdAt: at, updatedAt: at,
  };
}

function observationRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'observation', owner: { ...owner }, id: 'observation_1', revision: 1,
    generation: 1, sequence: 1, reservation: ref('reservation', 'reservation_1'),
    type: 'dispatch', at,
    facts: {
      clock: { nowMs: 200, activeMs: 50 }, gate: 'open', accountingDurable: true,
      otherHostActive: 0, otherAccountActive: 0, accountLimit: 4,
    },
    receipt: null,
  };
}

function accountingRecord(): WorkflowRecord {
  return {
    schemaVersion: 1, kind: 'accounting', owner: { ...owner }, id: 'accounting_1', revision: 1,
    base, generation: 1,
    summary: {
      knownSubtotalMicroUsd: 0, unknownCalls: 0, partialCalls: 0, pendingCalls: 0,
      reservedMicroUsd: 0, consumedCalls: 0,
    },
    clock: { nowMs: 200, activeMs: 50 }, enforcementViolated: false, updatedAt: at,
  };
}

const records: WorkflowRecord[] = [
  runRecord(), briefRecord(), policyRecord(), planRecord(), directionRecord(), taskRecord(),
  commandRecord(), commandPage(), receiptPage(), attemptRecord(), effectRecord(), questionRecord(),
  artifactRecord(), contextRecord(), reservationRecord(), observationRecord(), accountingRecord(),
];

function bytesOf(record: WorkflowRecord): Uint8Array {
  return encodeWorkflowRecord(record);
}

function decode(bytes: Uint8Array, kind: WorkflowKind): WorkflowRecord {
  return decodeWorkflowRecord(bytes, { kind, owner }) as WorkflowRecord;
}

function asText(record: WorkflowRecord): string {
  return new TextDecoder().decode(bytesOf(record));
}

function withField(record: WorkflowRecord, field: string, value: unknown): WorkflowRecord {
  return { ...record, [field]: value } as WorkflowRecord;
}

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
}

describe('workflow raw codec round-trips', () => {
  test('all schema-1 record kinds decode and re-encode to identical canonical bytes', () => {
    for (const record of records) {
      const bytes = bytesOf(record);
      const decoded = decode(bytes, record.kind);
      expect(decoded).toEqual(record);
      expect([...encodeWorkflowRecord(decoded)]).toEqual([...bytes]);
      expect(Object.isFrozen(decoded)).toBe(true);
    }
  });

  test('canonical encoding sorts keys, ignores insertion order and has no whitespace', () => {
    const first = runRecord();
    const second = Object.fromEntries(Object.entries(first).reverse()) as WorkflowRecord;
    const canonical = canonicalWorkflowJson(first);
    expect(canonical.startsWith('{"base"')).toBe(true);
    expect(canonical).not.toContain('\n');
    expect(canonical).not.toContain(': ');
    expect([...encodeWorkflowRecord(first)]).toEqual([...encodeWorkflowRecord(second)]);
  });

  test('supported unknown plain fields survive at record and nested depth', () => {
    const raw = asText(runRecord()).replace('"queue":[]',
      '"queue":[],"future":{"__proto__":{"flag":true},"values":[null,false,0.5,1e-7],"text":"保留"}');
    const decoded = decode(new TextEncoder().encode(raw), 'run');
    const future = decoded.future as Record<string, unknown>;
    expect(Object.hasOwn(future, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(future)).toBe(Object.prototype);
    expect(future).toEqual(JSON.parse(raw).future);
    expect([...encodeWorkflowRecord(decoded)]).toEqual([...encodeWorkflowRecord(decoded)]);
    const again = decode(encodeWorkflowRecord(decoded), 'run');
    expect(again.future).toEqual(future);
  });

  test('known and unknown accounting receipts round-trip including unknown cost', () => {
    const record = withField(withField(attemptRecord(), 'accounting', {
      calls: 1, localReads: 2, knownSubtotalMicroUsd: 0, unknownCalls: 1, partialCalls: 0,
    }), 'providerReceipts', [{
      id: 'receipt_1', reservationId: 'reservation_1', outcome: 'succeeded',
      accounting: { kind: 'unknown' },
    }]);
    const decoded = decode(bytesOf(record), 'attempt');
    expect(decoded.providerReceipts).toEqual(record.providerReceipts);
  });

  test('publication intent and confirmed receipt remain separate fields', () => {
    const record = withField(withField(withField(withField(effectRecord(), 'phase', 'confirmed'),
      'target', { kind: 'replace-chapter', chapterId: 'chapter_1',
        path: 'chapters/0001-mara.md' }), 'intent', {
      at, baseVersion: 3, baseHash: hash(9), intendedHash: hash(10), intendedBytes: 1_024,
      safety: ref('artifact', 'artifact_2'),
    }), 'receipt', { outcome: 'confirmed', at, resultVersion: 4, resultHash: hash(10) });
    const decoded = decode(bytesOf(record), 'effect');
    expect(decoded.intent).toEqual(record.intent);
    expect(decoded.receipt).toEqual(record.receipt);
  });
});

describe('raw refusals before semantic values', () => {
  test('duplicate keys are refused though ordinary JSON.parse keeps the last value', () => {
    const duplicate = '{"schemaVersion":1,"schemaVersion":2,"future":{"a":1,"a":2}}';
    expect((JSON.parse(duplicate) as { schemaVersion: number }).schemaVersion).toBe(2);
    expect(() => decode(new TextEncoder().encode(duplicate), 'run')).toThrow('duplicate-key');
    const nested = asText(runRecord()).replace('"queue":[]', '"queue":[],"future":{"a":1,"a":2}');
    expect((JSON.parse(nested) as { future: { a: number } }).future.a).toBe(2);
    expect(() => decode(new TextEncoder().encode(nested), 'run')).toThrow('duplicate-key');
  });

  test('invalid UTF-8, a BOM and lone surrogate escapes are refused', () => {
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    expect(() => decode(invalidUtf8, 'run')).toThrow('invalid-utf8');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{}')]);
    expect(() => decode(bom, 'run')).toThrow('byte-order-mark');
    const surrogate = asText(runRecord()).replace('"queue":[]', '"queue":[],"future":"\\ud800"');
    expect(() => decode(new TextEncoder().encode(surrogate), 'run')).toThrow('invalid-unicode');
  });

  test.each([
    '9007199254740993', '1e400', '-1e400', '1e-400', '1.0000000000000001', '-0', '-0.00e99',
    '1e21',
  ])('refuses lossy numeric lexeme %s though JSON.parse accepts a rounded value', token => {
    expect(() => JSON.parse(token)).not.toThrow();
    const raw = asText(runRecord()).replace('"queue":[]', `"queue":[],"future":[${token}]`);
    expect(() => decode(new TextEncoder().encode(raw), 'run')).toThrow('lossy-number');
  });

  test('unsupported schema versions, foreign kinds, prefixes and invalid dates are refused', () => {
    const future = asText(runRecord()).replace('"schemaVersion":1', '"schemaVersion":2');
    expect(() => decode(new TextEncoder().encode(future), 'run')).toThrow('unsupported-schema');
    expect(() => decode(bytesOf(runRecord()), 'task')).toThrow('foreign-kind');
    expect(() => decode(bytesOf(withField(runRecord(), 'id', 'task_1')), 'run'))
      .toThrow('invalid-id');
    expect(() => decode(bytesOf(withField(runRecord(), 'id', 'run_1')), 'task'))
      .toThrow('foreign-kind');
    const badDate = asText(runRecord()).replace(at, '2026-02-31T00:00:00.000Z');
    expect(() => decode(new TextEncoder().encode(badDate), 'run')).toThrow('invalid-timestamp');
  });

  test('foreign owner and foreign reference owners are refused', () => {
    const foreignRecord = withField(runRecord(), 'owner', { ...owner, runId: 'run_2' });
    const foreignBytes = new TextEncoder().encode(canonicalWorkflowJson(foreignRecord));
    expect(() => decode(foreignBytes, 'run')).toThrow('foreign-owner');
    const foreignReference = withField(runRecord(), 'phasePlan', {
      ...ref('phase-plan', 'plan_1'), owner: { ...owner, runId: 'run_2' },
    });
    const referenceBytes = new TextEncoder().encode(canonicalWorkflowJson(foreignReference));
    expect(() => decode(referenceBytes, 'run')).toThrow('foreign-reference');
  });

  test('stale bases, immutable bases and direction links are refused', () => {
    expect(() => encodeWorkflowRecord(withField(taskRecord(), 'revision', 2)))
      .toThrow('stale-base');
    expect(() => encodeWorkflowRecord(withField(taskRecord(), 'base', {
      kind: 'sha256', value: hash(), revision: 0,
    }))).toThrow('stale-base');
    expect(() => encodeWorkflowRecord(withField(policyRecord(), 'base', base)))
      .toThrow('unexpected-base');
    expect(() => encodeWorkflowRecord(withField(planRecord(), 'base', base)))
      .toThrow('unexpected-base');
    expect(() => encodeWorkflowRecord(withField(directionRecord(), 'revision', 2)))
      .toThrow('stale-direction-link');
    const stale = withField(directionRecord(), 'previous', ref('direction', 'direction_0', 2));
    expect(() => encodeWorkflowRecord(withField(stale, 'revision', 2)))
      .toThrow('stale-direction-link');
    const sameId = withField(withField(directionRecord(), 'revision', 2), 'previous',
      ref('direction', 'direction_1', 1));
    expect(() => encodeWorkflowRecord(sameId)).toThrow('duplicate-direction');
  });

  test('attempt and reservation phase/state consistency is structural', () => {
    expect(() => encodeWorkflowRecord(withField(attemptRecord(), 'phase', 'dispatch-intent')))
      .toThrow('invalid-attempt-state');
    expect(() => encodeWorkflowRecord(withField(reservationRecord(), 'receipt', {
      id: 'receipt_1', outcome: 'succeeded', accounting: { kind: 'reported', microUsd: 1 },
    }))).toThrow('invalid-reservation-state');
  });

  test('depth 64 is admitted and the next wrapper is refused', () => {
    const accepted = withField(runRecord(), 'deep', nested(63));
    const decoded = decode(bytesOf(accepted), 'run');
    expect(decoded.deep).toEqual(nested(63));
    const refused = withField(runRecord(), 'deep', nested(64));
    expect(() => encodeWorkflowRecord(refused)).toThrow('value-depth');
  });

  test('per-record byte bounds and a lower decode bound are enforced', () => {
    const padding = withField(taskRecord(), 'padding', 'x'.repeat(WORKFLOW_LIMITS.recordBytes));
    expect(() => encodeWorkflowRecord(padding)).toThrow('record-overflow');
    const valid = bytesOf(runRecord());
    expect(() => decodeWorkflowRecord(valid, { kind: 'run', owner, maxBytes: 10 }))
      .toThrow('record-overflow');
  });

  test('queue and materialized request counts are bounded', () => {
    const manyTasks = Array.from({ length: 65 }, (_, index) =>
      ref('task', `task_${index + 1}`));
    expect(() => encodeWorkflowRecord(withField(runRecord(), 'queue', manyTasks)))
      .toThrow('record-count');
    const manyReservations = Array.from({ length: 5 }, (_, index) =>
      ref('reservation', `reservation_${index + 1}`));
    expect(() => encodeWorkflowRecord(withField(runRecord(), 'materialized', manyReservations)))
      .toThrow('record-count');
  });
});

describe('command and receipt pagination metadata', () => {
  test('command and receipt pages round-trip with contiguous sequence metadata', () => {
    for (const page of [commandPage(), receiptPage()]) {
      const decoded = decode(bytesOf(page), 'journal-page');
      expect(decoded.nextSequence).toBe(2);
      expect(decoded.entries).toEqual(page.entries);
    }
  });

  test('gaps, wrong next sequence and wrong reference kinds are refused', () => {
    expect(() => encodeWorkflowRecord(withField(commandPage(), 'nextSequence', 3)))
      .toThrow('invalid-journal');
    expect(() => encodeWorkflowRecord(withField(commandPage(), 'entries', [
      { sequence: 2, ref: ref('command', 'command_1') },
    ]))).toThrow('invalid-journal');
    expect(() => encodeWorkflowRecord(withField(commandPage(), 'journal', 'receipt')))
      .toThrow('invalid-reference-kind');
    expect(() => encodeWorkflowRecord(withField(receiptPage(), 'journal', 'command')))
      .toThrow('invalid-reference-kind');
  });
});

describe('accepted leaf aggregate depth', () => {
  test('a decoded graph at the leaf boundary survives pause/recovery transitions', () => {
    const plan = withField(planRecord(), 'graph', { ...graph(), extension: nested(62) });
    const decoded = decode(bytesOf(plan), 'phase-plan');
    const decodedGraph = decoded.graph as Graph;
    let state = createRun(decodedGraph);
    state = step(state, { type: 'pause' });
    state = step(state, { type: 'recover' });
    state = step(state, { type: 'resume' });
    expect(JSON.stringify(state.graph)).toBe(JSON.stringify(decodedGraph));
    const tooDeep = withField(planRecord(), 'graph', { ...graph(), extension: nested(63) });
    expect(() => encodeWorkflowRecord(tooDeep)).toThrow('value-depth');
  });
});
