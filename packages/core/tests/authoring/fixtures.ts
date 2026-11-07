import { DEFAULT_LIMITS, ROLES, reduceRun, type AdmissionFacts, type AdmissionPolicy,
  type Command, type Graph, type GraphAction, type Reference, type ReferenceKind,
  type ReservationRequest, type RunSnapshot, type TaskDefinition } from '../../src/authoring';

export const hash = (n = 1) => n.toString(16).padStart(64, '0');
export const owner = { libraryRegistration: 'host_1', bookId: 'book_1', runId: 'run_1' };
export function ref<K extends ReferenceKind>(kind: K, id: string, revision = 0): Reference<K> {
  return { kind, owner: { ...owner }, id, revision, hash: hash(revision + 1) };
}
export function task(id: string, dependencies: string[] = [], keys = ['mara'], complete = true): TaskDefinition {
  return { ref: ref('task', id), role: 'drafter', completion: 'candidate',
    dependsOn: dependencies.map(id => ref('task', id)), impact: { complete, keys } };
}
export function graph(): Graph {
  return { version: 1, owner: { ...owner }, policyDigest: hash(), generation: 1,
    direction: ref('direction', 'direction_0'), tasks: [
      { ...task('a'), completion: 'adoption' }, task('b', ['a']), task('c', [], ['island']), task('u', [], [], false),
    ] };
}
export function command(state: RunSnapshot, action: GraphAction): Command {
  return { id: `command_${state.revision}`, expectedRevision: state.revision, generation: state.generation,
    payloadDigest: hash(), action };
}
export function step(state: RunSnapshot, action: GraphAction): RunSnapshot {
  return reduceRun(state, command(state, action));
}
export function prepare(state: RunSnapshot, taskId = 'a', attemptId = `attempt_${taskId}`): RunSnapshot {
  const direction = state.tasks.find(task => task.id === taskId)?.direction;
  if (!direction) throw new Error('missing fixture task');
  return step(state, { type: 'prepare', taskId, attempt: ref('attempt', attemptId),
    context: ref('context', `context_${attemptId}`), direction, inputDigest: hash() });
}
export function completed(state: RunSnapshot, taskId = 'a', attemptId = `attempt_${taskId}`): RunSnapshot {
  state = prepare(state, taskId, attemptId);
  state = step(state, { type: 'attempt', attemptId, event: 'dispatch-intent' });
  state = step(state, { type: 'attempt', attemptId, event: 'output-kept', outputs: [ref('artifact', `output_${attemptId}`)] });
  return step(state, { type: 'attempt', attemptId, event: 'completed' });
}

export const route = { connectionId: 'connection_1', providerId: 'provider_1', modelId: 'synthetic/model', accountKey: 'account_1' };
export function policy(strict = false): AdmissionPolicy {
  return { version: 1, owner: { ...owner }, policyDigest: hash(), generation: 1, startedAtMs: 100,
    limits: { ...DEFAULT_LIMITS }, routes: ROLES.map(role => ({ role, destination: { ...route } })),
    cost: strict ? { mode: 'strict-money', capMicroUsd: 100 } : { mode: 'bounded-operations' } };
}
export function facts(): AdmissionFacts {
  return { clock: { nowMs: 200, activeMs: 50 }, gate: 'open', accountingDurable: true,
    otherHostActive: 0, otherAccountActive: 0, accountLimit: 4 };
}
export function request(n = 1, maximum: number | null = null): ReservationRequest {
  return { id: `reservation_${n}`, generation: 1, policyDigest: hash(), attempt: ref('attempt', `attempt_${n}`), role: 'drafter', destination: { ...route },
    requestDigest: hash(n), inputDigest: hash(n), directionDigest: hash(), reviewDigest: hash(),
    scopeId: `chapter_${n}`, localRevision: 0, globalRevision: 0, callIndex: 1, localReads: 0,
    outputTokens: 4096, outputBytes: 262_144,
    maximum: maximum === null ? null : { qualificationId: 'fake_enforcing_adapter', enforcement: 'provider-all-charge',
      hostQualified: true, tariffKnown: true, connectionId: route.connectionId, requestDigest: hash(n),
      policyDigest: hash(), microUsd: maximum } };
}
