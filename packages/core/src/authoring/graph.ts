import { sameReference, validateGraph, validateReference, type Graph, type Reference,
  type TaskDefinition } from './contracts';
import { advanceAttempt, advanceEffect, unsettledAttempt, unsettledEffect,
  type AttemptEvent, type AttemptPhase, type EffectEvent, type EffectPhase } from './lifecycle';
import { add, copySnapshot, copyValue, digest, freeze, id, integer, requireValue, sameValue, text,
  type Immutable } from './value';

interface Attempt {
  ref: Reference<'attempt'>;
  taskId: string;
  generation: number;
  direction: Reference<'direction'>;
  context: Reference<'context'>;
  inputDigest: string;
  revisionOf: Reference<'artifact'> | null;
  noProgress: boolean;
  phase: AttemptPhase;
  historical: boolean;
  outputs: Reference<'artifact'>[];
}

interface Effect {
  ref: Reference<'effect'>;
  attemptId: string;
  candidate: Reference<'artifact'>;
  generation: number;
  phase: EffectPhase;
  /** Host receipt identity/hash; intended-result observation is not proof of writer identity. */
  receipt: Reference<'effect'> | null;
}

interface Question {
  id: string;
  revision: number;
  keys: string[];
  affected: string[];
  state: 'open' | 'answered' | 'superseded' | 'withdrawn';
  answer: { exactText: string; confirmedText: string; direction: Reference<'direction'> } | null;
}

interface TaskControl {
  id: string;
  direction: Reference<'direction'>;
  /** Explicit retry/refresh is a new host command, never automatic on failure. */
  retryAllowed: boolean;
}

interface RunData {
  graph: Graph;
  revision: number;
  generation: number;
  mode: 'running' | 'paused' | 'cancelled' | 'revoked' | 'finished';
  direction: Reference<'direction'>;
  directionHistory: Reference<'direction'>[];
  tasks: TaskControl[];
  attempts: Attempt[];
  effects: Effect[];
  questions: Question[];
  commands: Command[];
}

export type RunSnapshot = Immutable<RunData>;
export type TaskStatus = 'ready' | 'blocked' | 'settling' | 'executing' | 'validating' |
  'ready-to-publish' | 'completed' | 'failed' | 'uncertain' | 'needs-direction';
export type RunStatus = 'active' | 'blocked' | 'final-review-ready' | 'pausing' | 'paused' |
  'cancelling' | 'cancelled' | 'revoking' | 'revoked' | 'finished';

export type GraphAction =
  | { type: 'pause' | 'cancel' | 'revoke' | 'resume' | 'recover' | 'finish' }
  | { type: 'question'; questionId: string; keys: string[] }
  | { type: 'close-question'; questionId: string; questionRevision: number; disposition: 'superseded' | 'withdrawn' }
  | { type: 'answer'; questionId: string; questionRevision: number; direction: Reference<'direction'>;
      exactText: string; confirmedText: string }
  | { type: 'direction'; keys: string[]; direction: Reference<'direction'>; exactText: string }
  | { type: 'retry'; taskId: string }
  | { type: 'prepare'; taskId: string; attempt: Reference<'attempt'>; context: Reference<'context'>;
      direction: Reference<'direction'>; inputDigest: string; revisionOf?: Reference<'artifact'> }
  | { type: 'attempt'; attemptId: string; event: AttemptEvent; outputs?: Reference<'artifact'>[] }
  | { type: 'prepare-effect'; effect: Reference<'effect'>; attemptId: string; candidate: Reference<'artifact'> }
  | { type: 'effect'; effectId: string; event: EffectEvent; receipt?: Reference<'effect'> };

export interface Command {
  id: string;
  payloadDigest: string;
  expectedRevision: number;
  generation: number;
  action: GraphAction;
}

/** Host supplies identities; this constructor neither creates nor accepts an execution grant. */
export function createRun(input: Graph): RunSnapshot {
  const graph = copyValue(validateGraph(input)) as Graph;
  return freeze({ graph, revision: 0, generation: graph.generation, mode: 'running',
    direction: graph.direction, directionHistory: [graph.direction], tasks: graph.tasks.map(task => ({ id: task.ref.id,
      direction: graph.direction, retryAllowed: true })), attempts: [], effects: [], questions: [], commands: [] });
}

function definition(state: RunSnapshot, taskId: string): Immutable<TaskDefinition> {
  const task = state.graph.tasks.find(task => task.ref.id === taskId);
  requireValue(task, 'missing-task');
  return task;
}

function currentAttempt(state: RunSnapshot, taskId: string): Immutable<Attempt> | undefined {
  return state.attempts.findLast(attempt => attempt.taskId === taskId && !attempt.historical &&
    (attempt.generation === state.generation || attempt.phase === 'completed'));
}

function blockedByQuestion(state: RunSnapshot, taskId: string): boolean {
  return state.questions.some(question => question.state === 'open' && question.affected.includes(taskId));
}

function ownStatus(state: RunSnapshot, taskId: string): TaskStatus {
  const task = definition(state, taskId);
  const attempts = state.attempts.filter(attempt => attempt.taskId === taskId);
  const effects = state.effects.filter(effect => attempts.some(attempt => attempt.ref.id === effect.attemptId));
  if (attempts.some(attempt => attempt.phase === 'uncertain') || effects.some(effect => effect.phase === 'uncertain'))
    return 'uncertain';
  if (attempts.some(attempt => attempt.historical && unsettledAttempt(attempt.phase)) ||
    effects.some(effect => unsettledEffect(effect.phase) && (effect.generation !== state.generation ||
      attempts.some(attempt => attempt.ref.id === effect.attemptId && attempt.historical)))) return 'settling';
  if (state.mode !== 'running' || blockedByQuestion(state, taskId)) return 'blocked';
  const attempt = currentAttempt(state, taskId);
  if (!attempt) return 'ready';
  if (attempt.phase === 'completed') {
    if (attempt.noProgress) return 'needs-direction';
    if (task.completion === 'candidate') return 'completed';
    const effect = effects.findLast(effect => effect.attemptId === attempt.ref.id);
    if (effect?.phase === 'confirmed') return 'completed';
    if (effect && unsettledEffect(effect.phase)) return 'settling';
    if (effect) return 'failed';
    return 'ready-to-publish';
  }
  if (attempt.phase === 'failed' || attempt.phase === 'stopped') {
    return state.tasks.find(task => task.id === taskId)?.retryAllowed ? 'ready' : 'failed';
  }
  return attempt.phase === 'output-kept' ? 'validating' : 'executing';
}

/** Stable graph-order projection; no queue, clock, callbacks or effects. */
export function taskStatuses(state: RunSnapshot): Readonly<Record<string, TaskStatus>> {
  const result: Record<string, TaskStatus> = Object.create(null);
  const visit = (task: Immutable<TaskDefinition>): TaskStatus => {
    const cached = result[task.ref.id];
    if (cached) return cached;
    const own = ownStatus(state, task.ref.id);
    const dependenciesDone = task.dependsOn.every(ref => visit(definition(state, ref.id)) === 'completed');
    result[task.ref.id] = dependenciesDone || own === 'settling' || own === 'uncertain' ? own : 'blocked';
    return result[task.ref.id] as TaskStatus;
  };
  for (const task of state.graph.tasks) visit(task);
  return Object.freeze(result);
}

export function runStatus(state: RunSnapshot): RunStatus {
  const unsettled = state.attempts.some(attempt => unsettledAttempt(attempt.phase)) ||
    state.effects.some(effect => unsettledEffect(effect.phase));
  if (state.mode === 'paused') return unsettled ? 'pausing' : 'paused';
  if (state.mode === 'cancelled') return unsettled ? 'cancelling' : 'cancelled';
  if (state.mode === 'revoked') return unsettled ? 'revoking' : 'revoked';
  if (state.mode === 'finished') return 'finished';
  const statuses = Object.values(taskStatuses(state));
  if (statuses.every(status => status === 'completed') && !state.questions.some(q => q.state === 'open'))
    return 'final-review-ready';
  return statuses.some(status => ['ready', 'executing', 'validating', 'ready-to-publish'].includes(status)) ?
    'active' : 'blocked';
}

/** Necessary graph condition only. NEVER authorizes a host send/write or certifies reviews/draft safety. */
export function publicationEligible(state: RunSnapshot, attemptId: string): boolean {
  const attempt = state.attempts.find(attempt => attempt.ref.id === attemptId);
  if (!attempt || attempt.historical || attempt.generation !== state.generation ||
    attempt.phase !== 'completed' || state.mode !== 'running') return false;
  const status = taskStatuses(state)[attempt.taskId];
  return status === 'ready-to-publish';
}

function affectedTasks(state: RunSnapshot, keys: readonly string[]): string[] {
  requireValue(Array.isArray(keys) && keys.length > 0, 'missing-impact');
  for (const key of keys) id(key);
  const affected = new Set(state.graph.tasks.filter(task => !task.impact.complete ||
    task.impact.keys.some(key => keys.includes(key))).map(task => task.ref.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.graph.tasks) {
      if (!affected.has(task.ref.id) && task.dependsOn.some(ref => affected.has(ref.id))) {
        affected.add(task.ref.id); changed = true;
      }
    }
  }
  return state.graph.tasks.filter(task => affected.has(task.ref.id)).map(task => task.ref.id);
}

function invalidate(state: RunData, taskIds: readonly string[], direction?: Reference<'direction'>): void {
  for (const attempt of state.attempts) if (taskIds.includes(attempt.taskId)) attempt.historical = true;
  for (const task of state.tasks) if (taskIds.includes(task.id)) {
    if (direction) task.direction = direction;
    task.retryAllowed = true;
  }
}

function updateDirection(state: RunData, direction: Reference<'direction'>, affected: string[]): void {
  validateReference(direction, 'direction', state.graph.owner);
  requireValue(direction.revision === add(state.direction.revision, 1) && direction.id !== state.direction.id,
    'stale-direction');
  requireValue(!state.directionHistory.some(ref => ref.id === direction.id), 'duplicate-direction');
  state.direction = direction;
  state.directionHistory.push(direction);
  invalidate(state, affected, direction);
}

/** Pure checked command consumption. Equal replay returns the current snapshot, not an old one. */
export function reduceRun(snapshot: RunSnapshot, input: Command): RunSnapshot {
  const command = copyValue(input, 262_144);
  id(command.id); digest(command.payloadDigest); integer(command.expectedRevision); integer(command.generation);
  const previous = snapshot.commands.find(item => item.id === command.id);
  if (previous) {
    requireValue(sameValue(previous, command), 'command-replay-mismatch');
    return snapshot;
  }
  requireValue(command.expectedRevision === snapshot.revision, 'stale-revision');
  requireValue(command.generation === snapshot.generation, 'stale-generation');
  const nextRevision = add(snapshot.revision, 1);
  // Snapshots are locally constructed values, not deserialized records. T018 owns rehydration.
  const state = copySnapshot(snapshot) as RunData;
  const action = command.action;
  const terminal = state.mode === 'cancelled' || state.mode === 'revoked' || state.mode === 'finished';
  requireValue(!terminal || action.type === 'attempt' || action.type === 'effect' || action.type === 'recover',
    'terminal-run');
  switch (action.type) {
    case 'pause': case 'cancel': case 'revoke': case 'recover': {
      const statuses = taskStatuses({ ...state, mode: 'running' });
      state.generation = add(state.generation, 1);
      if (!terminal) state.mode = action.type === 'cancel' ? 'cancelled' : action.type === 'revoke' ? 'revoked' : 'paused';
      // Verified completed dependencies survive pause/restart; unfinished attempts lose ownership.
      invalidate(state, state.tasks.filter(task => statuses[task.id] !== 'completed').map(task => task.id));
      if (action.type === 'recover') {
        for (const attempt of state.attempts) attempt.phase = advanceAttempt(attempt.phase, 'recover');
        for (const effect of state.effects) effect.phase = advanceEffect(effect.phase, 'recover');
      }
      break;
    }
    case 'resume':
      requireValue(state.mode === 'paused' &&
        !state.attempts.some(attempt => unsettledAttempt(attempt.phase) && attempt.phase !== 'uncertain') &&
        !state.effects.some(effect => unsettledEffect(effect.phase) && effect.phase !== 'uncertain'), 'unsettled-resume');
      // An explicit host Continue may run independent work after recovery. Uncertain branches
      // remain blocked; this neither reconciles them nor permits replay of their intents.
      state.mode = 'running';
      break;
    case 'finish':
      requireValue(runStatus(state) === 'final-review-ready', 'unfinished-run');
      state.mode = 'finished';
      break;
    case 'question': {
      requireValue(state.mode === 'running', 'run-not-active');
      id(action.questionId);
      requireValue(!state.questions.some(q => q.id === action.questionId), 'duplicate-question');
      const affected = affectedTasks(state, action.keys);
      state.questions.push({ id: action.questionId, revision: 0, keys: action.keys, affected, state: 'open', answer: null });
      invalidate(state, affected);
      break;
    }
    case 'answer': case 'close-question': {
      requireValue(state.mode === 'running', 'run-not-active');
      const question = state.questions.find(q => q.id === action.questionId);
      requireValue(question?.state === 'open' && question.revision === integer(action.questionRevision), 'stale-question');
      if (action.type === 'answer') {
        text(action.exactText, 262_144, 262_144); text(action.confirmedText, 262_144, 262_144);
        updateDirection(state, action.direction, question.affected);
        question.answer = { exactText: action.exactText, confirmedText: action.confirmedText, direction: action.direction };
        question.state = 'answered';
      } else {
        requireValue(action.disposition === 'withdrawn' || action.disposition === 'superseded', 'invalid-question-state');
        question.state = action.disposition;
      }
      question.revision = add(question.revision, 1);
      break;
    }
    case 'direction':
      requireValue(state.mode === 'running', 'run-not-active');
      text(action.exactText, 262_144, 262_144);
      updateDirection(state, action.direction, affectedTasks(state, action.keys));
      break;
    case 'retry': {
      requireValue(state.mode === 'running' && taskStatuses(state)[action.taskId] === 'failed', 'retry-not-eligible');
      const task = state.tasks.find(task => task.id === action.taskId);
      requireValue(task, 'missing-task');
      // Publication reconciliation is separate; never turn a failed effect into another automatic write.
      const attempt = currentAttempt(state, action.taskId);
      requireValue(attempt && (attempt.phase === 'failed' || attempt.phase === 'stopped'), 'effect-needs-reconciliation');
      task.retryAllowed = true;
      break;
    }
    case 'prepare': {
      requireValue(taskStatuses(state)[action.taskId] === 'ready', 'task-not-ready');
      validateReference(action.attempt, 'attempt', state.graph.owner);
      validateReference(action.context, 'context', state.graph.owner);
      validateReference(action.direction, 'direction', state.graph.owner);
      digest(action.inputDigest);
      requireValue(!state.attempts.some(a => a.ref.id === action.attempt.id), 'duplicate-attempt');
      const task = state.tasks.find(task => task.id === action.taskId);
      requireValue(task && sameReference(task.direction, action.direction), 'stale-direction');
      if (definition(state, action.taskId).role === 'revision-writer') {
        requireValue(action.revisionOf, 'missing-revision-base');
        validateReference(action.revisionOf, 'artifact', state.graph.owner);
      } else requireValue(action.revisionOf === undefined, 'unexpected-revision-base');
      state.attempts.push({ ref: action.attempt, taskId: action.taskId, generation: state.generation,
        direction: action.direction, context: action.context, inputDigest: action.inputDigest,
        revisionOf: action.revisionOf ?? null, noProgress: false, phase: 'prepared', historical: false, outputs: [] });
      task.retryAllowed = false;
      break;
    }
    case 'attempt': {
      const attempt = state.attempts.find(a => a.ref.id === action.attemptId);
      requireValue(attempt, 'missing-attempt');
      if (action.event === 'dispatch-intent') requireValue(state.mode === 'running' && !attempt.historical &&
        attempt.generation === state.generation && !blockedByQuestion(state, attempt.taskId), 'dispatch-gate-closed');
      if (action.event === 'output-kept') {
        requireValue(action.outputs && action.outputs.length > 0, 'missing-output');
        const seen = new Set<string>();
        for (const ref of action.outputs) {
          validateReference(ref, 'artifact', state.graph.owner);
          requireValue(!seen.has(ref.id) && !state.attempts.some(a => a.outputs.some(r => r.id === ref.id)), 'duplicate-artifact');
          seen.add(ref.id);
        }
        attempt.outputs = action.outputs;
        attempt.noProgress = attempt.revisionOf !== null && action.outputs.some(ref => ref.hash === attempt.revisionOf?.hash);
      } else requireValue(action.outputs === undefined, 'unexpected-output');
      attempt.phase = advanceAttempt(attempt.phase, action.event);
      break;
    }
    case 'prepare-effect': {
      requireValue(publicationEligible(state, action.attemptId), 'publication-gate-closed');
      validateReference(action.effect, 'effect', state.graph.owner);
      validateReference(action.candidate, 'artifact', state.graph.owner);
      requireValue(!state.effects.some(effect => effect.ref.id === action.effect.id), 'duplicate-effect');
      requireValue(state.attempts.find(a => a.ref.id === action.attemptId)?.outputs.some(ref => sameReference(ref, action.candidate)),
        'foreign-candidate');
      state.effects.push({ ref: action.effect, attemptId: action.attemptId, candidate: action.candidate,
        generation: state.generation, phase: 'prepared', receipt: null });
      break;
    }
    case 'effect': {
      const effect = state.effects.find(effect => effect.ref.id === action.effectId);
      requireValue(effect, 'missing-effect');
      if (action.event === 'publish-intent') {
        const attempt = state.attempts.find(a => a.ref.id === effect.attemptId);
        requireValue(state.mode === 'running' && effect.generation === state.generation && attempt &&
          !attempt.historical && !blockedByQuestion(state, attempt.taskId), 'publication-gate-closed');
      }
      if (action.event === 'confirmed') {
        requireValue(action.receipt, 'missing-effect-receipt');
        validateReference(action.receipt, 'effect', state.graph.owner);
        requireValue(action.receipt.id === effect.ref.id && action.receipt.revision > effect.ref.revision, 'foreign-effect-receipt');
        effect.receipt = action.receipt;
      } else requireValue(action.receipt === undefined, 'unexpected-receipt');
      effect.phase = advanceEffect(effect.phase, action.event);
      break;
    }
    default: requireValue(false, 'unknown-command');
  }
  state.revision = nextRevision;
  state.commands.push(command);
  return freeze(state);
}
