import { copyValue, digest, freeze, id, integer, requireValue, text, type Immutable } from './value';

export interface Owner {
  readonly libraryRegistration: string;
  readonly bookId: string;
  readonly runId: string;
}

export type ReferenceKind = 'task' | 'direction' | 'context' | 'artifact' | 'effect' | 'attempt' | 'grant';
export interface Reference<K extends ReferenceKind = ReferenceKind> {
  readonly kind: K;
  readonly owner: Owner;
  readonly id: string;
  readonly revision: number;
  readonly hash: string;
}

export const ROLES = ['architect', 'character-planner', 'drafter', 'developmental-reviewer',
  'line-reviewer', 'revision-writer', 'canon-summarizer'] as const;
export type Role = typeof ROLES[number];
export const OUTPUT_TOKENS: Readonly<Record<Role, number>> = Object.freeze({
  architect: 8192, 'character-planner': 8192, drafter: 4096, 'developmental-reviewer': 4096,
  'line-reviewer': 4096, 'revision-writer': 8192, 'canon-summarizer': 2048,
});
export const DEFAULT_LIMITS = Object.freeze({
  concurrency: 3, calls: 600, activeMs: 12 * 60 * 60 * 1000, lifetimeMs: 7 * 24 * 60 * 60 * 1000,
  localRevisions: 2, globalRevisions: 1, callsPerAttempt: 4, readsPerAttempt: 8,
  outputBytes: 262_144,
});

export function validateOwner(owner: Owner): void {
  requireValue(owner && typeof owner === 'object', 'invalid-owner');
  id(owner.libraryRegistration); id(owner.bookId); id(owner.runId);
}

export function sameOwner(a: Owner, b: Owner): boolean {
  return a.libraryRegistration === b.libraryRegistration && a.bookId === b.bookId && a.runId === b.runId;
}

export function validateReference<K extends ReferenceKind>(ref: Reference<K>, kind: K, owner: Owner): void {
  requireValue(ref && ref.kind === kind, 'invalid-reference-kind');
  validateOwner(ref.owner);
  requireValue(sameOwner(ref.owner, owner), 'foreign-reference');
  id(ref.id); digest(ref.hash); integer(ref.revision);
}

export function sameReference(a: Reference, b: Reference): boolean {
  return a.kind === b.kind && a.id === b.id && a.hash === b.hash && a.revision === b.revision &&
    sameOwner(a.owner, b.owner);
}

export interface Brief {
  text: string;
  /** Existing 033 goal identity; this module never counts manuscript words. */
  goalId: string;
  targetWords: number;
}

export function prepareBrief(input: Brief): Immutable<Brief> {
  const brief = copyValue(input, 262_144);
  text(brief.text); id(brief.goalId); integer(brief.targetWords, 1);
  return freeze(brief);
}

export interface TaskDefinition {
  ref: Reference<'task'>;
  role: Role;
  completion: 'candidate' | 'adoption';
  dependsOn: Reference<'task'>[];
  /** Host-validated complete impact metadata, never a worker's independence assertion. */
  impact: { complete: boolean; keys: string[] };
}

export interface Graph {
  version: 1;
  owner: Owner;
  policyDigest: string;
  generation: number;
  direction: Reference<'direction'>;
  tasks: TaskDefinition[];
}

export function validateGraph(input: Graph): Immutable<Graph> {
  const graph = copyValue(input);
  requireValue(graph.version === 1, 'unsupported-version');
  validateOwner(graph.owner); digest(graph.policyDigest); integer(graph.generation);
  validateReference(graph.direction, 'direction', graph.owner);
  requireValue(Array.isArray(graph.tasks) && graph.tasks.length > 0 && graph.tasks.length <= 1024,
    'task-count');
  const tasks = new Map<string, TaskDefinition>();
  for (const task of graph.tasks) {
    copyValue(task, 262_144);
    validateReference(task.ref, 'task', graph.owner);
    requireValue(!tasks.has(task.ref.id), 'duplicate-task');
    requireValue(ROLES.includes(task.role), 'unknown-role');
    requireValue(task.completion === 'candidate' || task.completion === 'adoption', 'unknown-completion');
    requireValue(Array.isArray(task.dependsOn) && Array.isArray(task.impact?.keys) &&
      typeof task.impact.complete === 'boolean', 'invalid-dependencies');
    for (const key of task.impact.keys) id(key);
    requireValue(new Set(task.impact.keys).size === task.impact.keys.length, 'duplicate-impact');
    tasks.set(task.ref.id, task);
  }
  for (const task of graph.tasks) {
    const seen = new Set<string>();
    for (const dependency of task.dependsOn) {
      validateReference(dependency, 'task', graph.owner);
      requireValue(!seen.has(dependency.id), 'duplicate-dependency');
      seen.add(dependency.id);
      const target = tasks.get(dependency.id);
      requireValue(target && sameReference(target.ref, dependency), 'missing-or-stale-dependency');
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (task: TaskDefinition) => {
    requireValue(!active.has(task.ref.id), 'dependency-cycle');
    if (visited.has(task.ref.id)) return;
    active.add(task.ref.id);
    for (const ref of task.dependsOn) {
      const dependency = tasks.get(ref.id);
      if (dependency) visit(dependency);
    }
    active.delete(task.ref.id);
    visited.add(task.ref.id);
  };
  for (const task of graph.tasks) visit(task);
  return freeze(graph);
}

export const CHECKIN_CADENCE_LIMITS = Object.freeze({
  minAdoptedChapterInterval: 1,
  maxAdoptedChapterInterval: 1024,
  minSavedWordInterval: 1,
  maxSavedWordInterval: 1_000_000,
});
export const CADENCE_LIMITS = CHECKIN_CADENCE_LIMITS;

export interface CheckinCadencePolicy {
  version: 1;
  adoptedChapterInterval: number;
  savedWordInterval: number;
  afterFirstChapter: boolean;
  onIrreversibleChoice: boolean;
}
export type CadencePolicy = CheckinCadencePolicy;

export const DEFAULT_CHECKIN_CADENCE_POLICY: Immutable<CheckinCadencePolicy> = Object.freeze({
  version: 1 as const, adoptedChapterInterval: 3, savedWordInterval: 10_000,
  afterFirstChapter: true, onIrreversibleChoice: true,
});
export const DEFAULT_CADENCE_POLICY = DEFAULT_CHECKIN_CADENCE_POLICY;

export function validateCheckinCadencePolicy(input: CheckinCadencePolicy): Immutable<CheckinCadencePolicy> {
  const policy = copyValue(input);
  requireValue(policy !== null && typeof policy === 'object' && !Array.isArray(policy),
    'invalid-cadence-policy');
  requireValue(policy.version === 1, 'unsupported-version');
  integer(policy.adoptedChapterInterval,
    CHECKIN_CADENCE_LIMITS.minAdoptedChapterInterval, CHECKIN_CADENCE_LIMITS.maxAdoptedChapterInterval);
  integer(policy.savedWordInterval,
    CHECKIN_CADENCE_LIMITS.minSavedWordInterval, CHECKIN_CADENCE_LIMITS.maxSavedWordInterval);
  requireValue(typeof policy.afterFirstChapter === 'boolean', 'invalid-cadence-policy');
  requireValue(typeof policy.onIrreversibleChoice === 'boolean', 'invalid-cadence-policy');
  return freeze(policy);
}
export const validateCadencePolicy: typeof validateCheckinCadencePolicy = validateCheckinCadencePolicy;

export interface CheckinCadenceProgress {
  adoptedChaptersSinceCheckin: number;
  savedWordsSinceCheckin: number;
  firstAdoptedChapterOccurred: boolean;
  irreversibleChoicePending: boolean;
}
export type CadenceProgress = CheckinCadenceProgress;

export function validateCheckinCadenceProgress(input: CheckinCadenceProgress): Immutable<CheckinCadenceProgress> {
  const progress = copyValue(input);
  requireValue(progress !== null && typeof progress === 'object' && !Array.isArray(progress),
    'invalid-cadence-progress');
  integer(progress.adoptedChaptersSinceCheckin);
  integer(progress.savedWordsSinceCheckin);
  requireValue(typeof progress.firstAdoptedChapterOccurred === 'boolean', 'invalid-cadence-progress');
  requireValue(typeof progress.irreversibleChoicePending === 'boolean', 'invalid-cadence-progress');
  return freeze(progress);
}
export const validateCadenceProgress: typeof validateCheckinCadenceProgress = validateCheckinCadenceProgress;

export type CheckinCadenceReason = 'first-adopted-chapter' | 'adopted-chapter-interval' |
  'saved-word-interval' | 'irreversible-choice';
export type CadenceReason = CheckinCadenceReason;

export interface CheckinCadenceEvaluation {
  due: boolean;
  reasons: CheckinCadenceReason[];
}
export type CadenceEvaluation = CheckinCadenceEvaluation;

/** Pure due check over caller-counted progress; counts nothing and reads no prose. */
export function evaluateCheckinCadence(
  inputPolicy: CheckinCadencePolicy, inputProgress: CheckinCadenceProgress): Immutable<CheckinCadenceEvaluation> {
  const policy = validateCheckinCadencePolicy(inputPolicy);
  const progress = validateCheckinCadenceProgress(inputProgress);
  const reasons: CheckinCadenceReason[] = [];
  if (policy.afterFirstChapter && progress.firstAdoptedChapterOccurred) reasons.push('first-adopted-chapter');
  if (progress.adoptedChaptersSinceCheckin >= policy.adoptedChapterInterval) {
    reasons.push('adopted-chapter-interval');
  }
  if (progress.savedWordsSinceCheckin >= policy.savedWordInterval) reasons.push('saved-word-interval');
  if (policy.onIrreversibleChoice && progress.irreversibleChoicePending) reasons.push('irreversible-choice');
  return freeze({ due: reasons.length > 0, reasons });
}
export const evaluateCadence: typeof evaluateCheckinCadence = evaluateCheckinCadence;
