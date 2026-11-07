import { requireValue } from './value';

export type AttemptPhase = 'prepared' | 'dispatch-intent' | 'receiving' | 'output-kept' |
  'completed' | 'failed' | 'stopped' | 'uncertain';
export type AttemptEvent = 'dispatch-intent' | 'receiving' | 'output-kept' | 'completed' |
  'failed' | 'stopped' | 'uncertain' | 'recover';

/** Events after dispatch are supplied only from host observations, never worker claims. */
export function advanceAttempt(phase: AttemptPhase, event: AttemptEvent): AttemptPhase {
  if (event === 'recover') {
    if (phase === 'prepared') return 'stopped';
    if (phase === 'dispatch-intent' || phase === 'receiving') return 'uncertain';
    return phase;
  }
  const allowed: Record<Exclude<AttemptEvent, 'recover'>, readonly AttemptPhase[]> = {
    'dispatch-intent': ['prepared'],
    receiving: ['dispatch-intent'],
    'output-kept': ['dispatch-intent', 'receiving', 'uncertain'],
    completed: ['output-kept'],
    failed: ['prepared', 'dispatch-intent', 'receiving', 'output-kept', 'uncertain'],
    stopped: ['prepared', 'dispatch-intent', 'receiving', 'output-kept', 'uncertain'],
    uncertain: ['dispatch-intent', 'receiving'],
  };
  requireValue(allowed[event]?.includes(phase), 'impossible-attempt-transition');
  return event;
}

export function unsettledAttempt(phase: AttemptPhase): boolean {
  return phase !== 'completed' && phase !== 'failed' && phase !== 'stopped';
}

export type EffectPhase = 'prepared' | 'publish-intent' | 'confirmed' | 'conflict' |
  'not-published' | 'uncertain';
export type EffectEvent = Exclude<EffectPhase, 'prepared'> | 'recover';

/** A confirmed event means an actual host receipt. This function cannot verify any write. */
export function advanceEffect(phase: EffectPhase, event: EffectEvent): EffectPhase {
  if (event === 'recover') {
    return phase === 'prepared' ? 'not-published' : phase === 'publish-intent' ? 'uncertain' : phase;
  }
  if (event === 'publish-intent') requireValue(phase === 'prepared', 'impossible-effect-transition');
  else if (event === 'not-published') {
    requireValue(phase === 'prepared' || phase === 'publish-intent' || phase === 'uncertain',
      'impossible-effect-transition');
  } else requireValue(phase === 'publish-intent' || phase === 'uncertain', 'impossible-effect-transition');
  return event;
}

export function unsettledEffect(phase: EffectPhase): boolean {
  return phase === 'prepared' || phase === 'publish-intent' || phase === 'uncertain';
}
