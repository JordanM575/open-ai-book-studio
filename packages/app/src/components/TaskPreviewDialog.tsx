import { useEffect, useMemo, useState } from "react";
import type { ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type {
  CandidateStatus,
  PreviewEvaluation,
  ProviderCatalogue,
  RoutingBuild,
  TaskProfile
} from "@ai-book-studio/core/routing";
import {
  catalogueAgeLine,
  contextView,
  evaluateCandidates,
  taskProfileSchema,
  unitPriceViews
} from "@ai-book-studio/core/routing";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";

export interface TaskPreviewData {
  profiles: TaskProfile[];
  catalogues: ProviderCatalogue[];
  connections: ConnectionSummary[];
  build: RoutingBuild;
}

interface Props {
  open: boolean;
  data: TaskPreviewData;
  /** Injected clock so fixtures assert exact freshness copy. */
  now?: number;
  onClose: () => void;
  /** Open the existing model picker. The preview never preselects a model. */
  onOpenModelPicker: () => void;
}

const STATUS_LABEL: Record<CandidateStatus, string> = {
  eligible: "Suitable",
  excluded: "Not suitable",
  unknown: "Unknown",
  unavailable: "Unavailable"
};

type PreviewOutcome =
  | { kind: "no-catalogues" }
  | { kind: "malformed" }
  | { kind: "error" }
  | { kind: "no-candidates" }
  | { kind: "ready"; evaluation: PreviewEvaluation };

function inputProblem(data: TaskPreviewData): "no-catalogues" | "malformed" | null {
  if (!Array.isArray(data.catalogues) || !Array.isArray(data.connections)) return "malformed";
  if (data.catalogues.length === 0) return "no-catalogues";
  for (const entry of data.catalogues) {
    if (
      !entry ||
      typeof entry.provider !== "string" ||
      !entry.catalogue ||
      !Array.isArray(entry.catalogue.models)
    ) {
      return "malformed";
    }
  }
  return null;
}

/**
 * The advisory task preview. It reads only the local catalogue data it is given: opening it,
 * choosing a profile or closing it changes no book default, one-turn override, connection,
 * conversation, usage record or manuscript text. It never refreshes a catalogue, retries,
 * or chooses a model; the footer buttons are the author's existing manual flow.
 */
export function TaskPreviewDialog({ open, data, now, onClose, onOpenModelPicker }: Props) {
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setProfileId(null);
  }, [open]);

  const clock = now ?? Date.now();
  const profiles = Array.isArray(data.profiles) ? data.profiles : [];
  const profile = profiles.find((entry) => entry.id === profileId) ?? null;
  const outcome: PreviewOutcome | null = useMemo(() => {
    if (!profile) return null;
    const problem = inputProblem(data);
    if (problem) return { kind: problem };
    if (!taskProfileSchema.safeParse(profile).success) return { kind: "error" };
    try {
      const evaluation = evaluateCandidates({
        profile,
        catalogues: data.catalogues,
        connections: data.connections,
        build: data.build,
        now: clock
      });
      if (evaluation.candidates.length === 0) return { kind: "no-candidates" };
      return { kind: "ready", evaluation };
    } catch {
      return { kind: "error" };
    }
  }, [profile, data, clock]);

  const evaluation = outcome?.kind === "ready" ? outcome.evaluation : null;
  const eligible = evaluation?.candidates.filter((candidate) => candidate.status === "eligible") ?? [];
  const stale = evaluation?.candidates.some((candidate) => candidate.source.freshness === "stale") ?? false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Preview models"
        description="Choose a task to see which connected models match what the catalogues report. Looking never changes your model or sends a request."
        className="w-[calc(100vw-48px)] max-w-[600px]"
      >
        <div data-testid="task-preview" className="space-y-4">
          {profiles.length === 0 ? (
            <p className="text-(length:--text-subheadline-size) text-muted-foreground">
              No task profiles are available yet.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-(length:--text-caption-size) font-medium text-muted-foreground">Task</p>
              <div className="flex flex-wrap gap-2">
                {profiles.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setProfileId(entry.id)}
                    aria-pressed={entry.id === profileId}
                    className={`rounded-[var(--corner-md)] border px-3 py-2 text-left text-(length:--text-subheadline-size) transition-colors ${
                      entry.id === profileId
                        ? "border-[var(--ring)] bg-[var(--accent)]"
                        : "border-[var(--border)] hover:bg-[var(--accent)]"
                    }`}
                  >
                    <span className="block font-medium">{entry.name}</span>
                    <span className="block text-(length:--text-caption-size) text-muted-foreground">{entry.purpose}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {outcome?.kind === "no-catalogues" ? (
            <div className="space-y-1" data-testid="task-preview-no-catalogues">
              <p className="text-(length:--text-subheadline-size) font-medium">No catalogues to preview.</p>
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                Without catalogue data it is unknown which models match this task. Nothing here has
                changed your model. Choose in the model picker below to continue by hand, or close
                this preview.
              </p>
            </div>
          ) : null}

          {outcome?.kind === "malformed" ? (
            <div className="space-y-1" data-testid="task-preview-malformed">
              <p className="text-(length:--text-subheadline-size) font-medium">The catalogue data could not be read.</p>
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                It is unknown which models match this task, and whether the data on hand is current.
                Nothing here has changed your model. Choose in the model picker below to continue by
                hand, or close this preview.
              </p>
            </div>
          ) : null}

          {outcome?.kind === "error" ? (
            <div className="space-y-1" data-testid="task-preview-error">
              <p className="text-(length:--text-subheadline-size) font-medium">This task profile could not be read.</p>
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                It is unknown what this task needs, so no candidates were evaluated. Nothing here has
                changed your model. Choose another task, pick in the model picker below, or close
                this preview.
              </p>
            </div>
          ) : null}

          {outcome?.kind === "no-candidates" ? (
            <div className="space-y-1" data-testid="task-preview-no-candidates">
              <p className="text-(length:--text-subheadline-size) font-medium">No candidates to preview.</p>
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                The catalogues hold no models to evaluate, so it is unknown which models match this
                task. Nothing here has changed your model. Choose in the model picker below to
                continue by hand, or close this preview.
              </p>
            </div>
          ) : null}

          {profile && evaluation ? (
            <div className="space-y-2" data-testid="task-preview-candidates">
              {stale ? (
                <p className="rounded-[var(--corner-md)] border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-(length:--text-subheadline-size) text-muted-foreground" data-testid="task-preview-stale">
                  Some catalogue data may be out of date. It is unknown whether newer data would
                  change these matches.
                </p>
              ) : null}
              {eligible.length === 0 ? (
                <p className="text-(length:--text-subheadline-size) font-medium">No suitable candidate known.</p>
              ) : null}
              {evaluation.candidates.map((candidate) => {
                const prices = unitPriceViews({
                  id: candidate.modelId,
                  name: candidate.name,
                  contextLength: candidate.facts.contextLength,
                  supportsTools: candidate.facts.supportsTools,
                  supportsImages: candidate.facts.supportsImages,
                  inputPricePerMillion: candidate.facts.inputPricePerMillion,
                  outputPricePerMillion: candidate.facts.outputPricePerMillion,
                  cachedInputPricePerMillion: candidate.facts.cachedInputPricePerMillion
                });
                const context = contextView({ contextLength: candidate.facts.contextLength });
                return (
                  <div
                    key={`${candidate.provider} ${candidate.modelId}`}
                    className="rounded-[var(--corner-md)] border border-[var(--border)] px-3 py-2"
                  >
                    <p className="flex items-baseline justify-between gap-3 text-(length:--text-subheadline-size)">
                      <span className="min-w-0 truncate font-medium">{candidate.name}</span>
                      <span className="shrink-0 text-(length:--text-caption-size) text-muted-foreground">
                        {STATUS_LABEL[candidate.status]}
                      </span>
                    </p>
                    {candidate.reasons.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-(length:--text-caption-size) text-muted-foreground">
                        {candidate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-1 text-(length:--text-caption-size) text-muted-foreground">
                      {context.text}
                      {" · "}
                      {prices.map((price) => `${price.label}: ${price.text}`).join(" · ")}
                    </p>
                    <p className="mt-0.5 text-(length:--text-caption-size) text-muted-foreground">
                      {catalogueAgeLine(candidate.source, clock)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!profile && profiles.length > 0 ? (
            <p className="text-(length:--text-subheadline-size) text-muted-foreground">Choose a task to preview.</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onOpenModelPicker()} data-testid="task-preview-open-picker">
            Choose in the model picker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
