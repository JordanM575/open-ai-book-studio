import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ContinuationCheckinInput } from "@ai-book-studio/core/review/campaign-continuation-checkin";
import { Button } from "@ai-book-studio/ui/button";
import { readContinuationCheckin } from "../../lib/continuation-checkin";
import { reviewActionClass } from "../reader-review/ReviewDisclosure";
import { refusalInfo, refusalPresentation, type ContinuationCheckinReader } from "./contracts";
import { ContinuationCheckinResults } from "./ContinuationCheckinResults";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; checkin: ContinuationCheckinInput }
  | { kind: "refused"; testId: string; copy: string };

const idleCopy = "Enter a campaign identity to inspect its saved check-in counts. Nothing starts automatically.";
const loadingCopy = "Reading the saved continuation.";
const loadedCopy = "Saved check-in counts loaded · Stored record only.";

/**
 * The saved-continuation check-in for one book. Opening this panel reads
 * nothing: the author names a campaign and presses Load check-in, and only
 * the counted inputs from that checked record are shown. Refusals keep
 * their own plain state here; a partly present campaign is never shown as
 * a counted result.
 */
export function ContinuationCheckinPanel(props: {
  bookId: string;
  readCheckin?: ContinuationCheckinReader;
}) {
  // A→B→A creates a new lifetime, even if a host reuses book IDs.
  return <ContinuationCheckinSession key={props.bookId} {...props} />;
}

function ContinuationCheckinSession({ bookId, readCheckin = readContinuationCheckin }: {
  bookId: string;
  readCheckin?: ContinuationCheckinReader;
}) {
  const heading = useId();
  const status = useRef<HTMLParagraphElement>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const [campaignId, setCampaignId] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);

  const busy = state.kind === "loading";
  const trimmed = campaignId.trim();
  const canLoad = trimmed.length > 0 && !busy;

  async function load() {
    if (!canLoad) return;
    const ticket = ++generation.current;
    setState({ kind: "loading" });
    status.current?.focus();
    try {
      const checkin = await readCheckin({ bookId, campaignId: trimmed });
      if (!alive.current || generation.current !== ticket) return;
      setState({ kind: "loaded", checkin });
    } catch (error) {
      if (!alive.current || generation.current !== ticket) return;
      const presentation = refusalPresentation(refusalInfo(error));
      setState({ kind: "refused", testId: presentation.testId, copy: presentation.copy });
    }
  }

  const statusCopy = state.kind === "idle" ? idleCopy
    : state.kind === "loading" ? loadingCopy
    : state.kind === "loaded" ? loadedCopy
    : state.copy;
  const statusTestId = state.kind === "refused" ? state.testId : "continuation-checkin-status";

  return <section aria-labelledby={heading} data-testid="continuation-checkin-panel" className="glass mb-4 rounded-[var(--corner-lg)] p-4 text-(length:--text-body-size) space-y-4">
    <h2 id={heading} className="text-(length:--text-title-3-size) font-semibold">Continuation check-in</h2>
    <p className="text-muted-foreground">Saved continuation only · Counts copied from the checked campaign record.</p>
    <label className="block">Campaign identity
      <input data-testid="continuation-checkin-campaign-input" className="field mt-1 w-full" value={campaignId} disabled={busy}
        onChange={(event) => {
          setCampaignId(event.target.value);
          if (state.kind === "loaded" || state.kind === "refused") setState({ kind: "idle" });
        }} />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" data-testid="continuation-checkin-load" className={reviewActionClass} disabled={!canLoad} onClick={() => void load()}>
        {state.kind === "loaded" ? "Refresh check-in" : "Load check-in"}
      </Button>
    </div>
    <p ref={status} role="status" aria-live="polite" tabIndex={-1} data-testid={statusTestId}
      className="rounded-[var(--corner-md)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{statusCopy}</p>
    {state.kind === "loaded" ? <ContinuationCheckinResults checkin={state.checkin} /> : null}
  </section>;
}
