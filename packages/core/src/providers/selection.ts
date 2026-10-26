import type { ModelInfo, ProviderId } from "./types";

export interface ModelChoice {
  provider: ProviderId;
  connectionId: string;
  modelId: string;
}

export interface ModelCandidate extends ModelChoice {
  label: string;
  usable: boolean;
  reason: string | null;
}

export type SelectionSource = "turn" | "book" | "first" | "none";

export interface ChoiceResult {
  choice: ModelCandidate | null;
  source: SelectionSource;
  /** Why the preferred choice was not used, in words the author can act on. */
  reason: string | null;
}

/**
 * Pick the model for a turn. A choice made for this turn wins, then the book's saved choice, then the
 * first usable candidate. A preferred choice that cannot run the agent is explained rather than
 * silently replaced, so the model picker can show the same reason.
 */
export function chooseModel(input: {
  turn?: Partial<ModelChoice> | null;
  book?: Partial<ModelChoice> | null;
  candidates: ModelCandidate[];
}): ChoiceResult {
  const usable = input.candidates.filter((candidate) => candidate.usable);
  let reason: string | null = null;

  for (const [source, preferred] of [
    ["turn", input.turn],
    ["book", input.book]
  ] as const) {
    if (!preferred || !hasTarget(preferred)) continue;
    const match = usable.find((candidate) => matches(candidate, preferred));
    if (match) return { choice: match, source, reason };
    const named = input.candidates.find((candidate) => matches(candidate, preferred));
    reason = named?.reason ?? "The chosen model is no longer available.";
  }

  const first = usable[0] ?? null;
  return { choice: first, source: first ? "first" : "none", reason: reason ?? (first ? null : "No connected model can run the writing agent yet.") };
}

export function candidateFrom(choice: ModelChoice, model: ModelInfo | null, label: string): ModelCandidate {
  const usable = model !== null && model.supportsTools === true && model.contextLength !== null;
  return {
    ...choice,
    label,
    usable,
    reason: usable
      ? null
      : model === null
        ? "This model is no longer in the provider's list."
        : model.supportsTools !== true
          ? "This model cannot use tools, which the writing agent needs."
          : "This provider does not report the model's context size."
  };
}

function hasTarget(choice: Partial<ModelChoice>): boolean {
  return Boolean(choice.provider ?? choice.connectionId ?? choice.modelId);
}

function matches(candidate: ModelCandidate, choice: Partial<ModelChoice>): boolean {
  if (choice.provider && candidate.provider !== choice.provider) return false;
  if (choice.connectionId && candidate.connectionId !== choice.connectionId) return false;
  if (choice.modelId && candidate.modelId !== choice.modelId) return false;
  return true;
}
