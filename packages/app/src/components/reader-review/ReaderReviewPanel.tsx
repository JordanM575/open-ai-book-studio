import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { sourceCurrency } from "@ai-book-studio/core/review/envelope";
import type { Citation, ReaderRun } from "@ai-book-studio/core/review/findings";
import { Button } from "@ai-book-studio/ui/button";
import {
  acceptPreparation, acceptRun, failureCopy, refusalCopy,
  type PreparedReaderReview, type ReaderReviewProps
} from "./contracts";
import { ReviewDisclosure, reviewActionClass } from "./ReviewDisclosure";
import { navigationKey, navigationState, ReaderReviewResults } from "./ReaderReviewResults";

type Phase = "idle" | "preparing" | "ready" | "running" | "completed" | "failed" | "stopped";
type Operation = { controller: AbortController; requestId: string | null; revision: string; stop: ReaderReviewProps["onStop"] };
const stoppedCopy = "Review stopped · Incomplete. Stopping prevents later dispatch best-effort; text already sent cannot be recalled. Prepare a new request to try again.";

/** A leaf only: no IPC, provider, reader, storage or ordinary conversation access. */
export function ReaderReviewPanel(props: ReaderReviewProps) {
  // A→B→A creates a new lifetime, even if a host reuses book IDs. Closing also drops all volatile data.
  return props.open ? <ReaderReviewSession key={JSON.stringify([props.bookId, props.viewKey])} {...props} /> : null;
}

function ReaderReviewSession(props: ReaderReviewProps) {
  const heading = useId();
  const [prepared, setPrepared] = useState<PreparedReaderReview | null>(null);
  const [runs, setRuns] = useState<readonly ReaderRun[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("Prepare the selected saved scope to inspect it. Nothing starts automatically.");
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [navigationRefusals, setNavigationRefusals] = useState<ReadonlyMap<string, "stale" | "unavailable">>(new Map());
  const status = useRef<HTMLParagraphElement>(null);
  const alive = useRef(false);
  const active = useRef<Operation | null>(null);
  const generation = useRef(0);
  const currentRevision = useRef(props.disclosureRevision);
  const seenRequests = useRef(new Set<string>());
  const startedRequests = useRef(new Set<string>());

  const retire = useCallback((): Promise<boolean> => {
    generation.current++;
    const operation = active.current;
    active.current = null;
    operation?.controller.abort();
    if (!operation?.requestId) return Promise.resolve(true);
    try {
      return Promise.resolve(operation.stop({ requestId: operation.requestId })).then(() => true, () => false);
    } catch { return Promise.resolve(false); }
  }, []);

  // Layout cleanup invalidates old callbacks before controls for a new disclosure become usable.
  useLayoutEffect(() => {
    alive.current = true;
    currentRevision.current = props.disclosureRevision;
    setPrepared(null);
    setPhase("idle");
    setNavigationBusy(false);
    setMessage(props.supported ? "Prepare a fresh disclosure and inspect it before starting." : "Reader review is unavailable on this host. No source preparation or provider request can start.");
    return () => {
      alive.current = false;
      void retire();
    };
  }, [props.disclosureRevision, props.supported, retire]);

  let sourceReady = false;
  try {
    sourceReady = prepared?.envelope.sources.every((source) => sourceCurrency(source, props.currentSources) === "current") === true;
  } catch { /* Malformed or unavailable current metadata never enables Start. */ }

  useLayoutEffect(() => {
    if (prepared && !sourceReady && phase === "ready") {
      setPrepared(null);
      setPhase("idle");
      setMessage(refusalCopy.changed);
    }
  }, [prepared, sourceReady, phase]);

  function begin(requestId: string | null = null): Operation {
    generation.current++;
    const operation = { controller: new AbortController(), requestId, revision: props.disclosureRevision, stop: props.onStop };
    active.current = operation;
    return operation;
  }
  function isCurrent(operation: Operation) {
    return alive.current && active.current === operation && operation.revision === currentRevision.current && !operation.controller.signal.aborted;
  }
  function focusStatus() { status.current?.focus(); }

  async function prepare() {
    if (!props.supported || active.current) return;
    const operation = begin();
    setPrepared(null);
    setPhase("preparing");
    setMessage("Preparing the selected saved scope · No provider request has started.");
    focusStatus();
    try {
      const result = await props.onPrepare({ bookId: props.bookId, signal: operation.controller.signal, previousRunId: runs.at(-1)?.runId ?? null });
      if (!isCurrent(operation)) return;
      if (result.kind === "blocked") {
        setPhase("idle");
        setMessage(refusalCopy[result.reason] ?? refusalCopy.unavailable);
      } else if (result.kind === "ready") {
        const value = acceptPreparation(result.prepared, props.bookId);
        if (seenRequests.current.has(value.envelope.requestId)) throw new Error("Reused request");
        seenRequests.current.add(value.envelope.requestId);
        setPrepared(value);
        setPhase("ready");
        setMessage("Disclosure ready · Inspect the exact scope, reader, destination and terms before Start.");
      } else throw new Error("Invalid preparation");
    } catch {
      if (!isCurrent(operation)) return;
      setPhase("failed");
      setMessage("The disclosure could not be validated. Check the selected saved scope and terms, then prepare again. No provider request started.");
    } finally {
      if (isCurrent(operation)) active.current = null;
    }
  }

  const environment = prepared?.envelope.environment;
  const consentReady = prepared?.envelope.books.every((book) => book.consentSatisfied) === true;
  const destinationReady = environment?.hostSupported === true && environment.connectionAvailable === true && environment.modelSupported === true;
  const canStart = props.supported && phase === "ready" && sourceReady && consentReady && destinationReady;

  async function start() {
    if (!canStart || !prepared || active.current || startedRequests.current.has(prepared.envelope.requestId)) return;
    const envelope = prepared.envelope;
    startedRequests.current.add(envelope.requestId);
    const operation = begin(envelope.requestId);
    setPhase("running");
    setMessage(`Review in progress · ${envelope.destination.provider} · ${envelope.destination.model}. Text already sent cannot be recalled.`);
    focusStatus();
    try {
      const outcome = await props.onStart({ envelope, signal: operation.controller.signal });
      if (!isCurrent(operation)) return;
      if (outcome.kind === "completed") {
        const run = await acceptRun(outcome.run, envelope);
        if (!isCurrent(operation)) return;
        setRuns((previous) => [...previous, run]);
        setPhase("completed");
        setMessage("Review completed · Subjective findings, with historical evidence. A rerun requires a new disclosure and Start.");
      } else if (outcome.kind === "blocked") {
        setPhase("idle");
        setMessage(refusalCopy[outcome.reason] ?? refusalCopy.unavailable);
      } else if (outcome.kind === "failed") {
        setPhase("failed");
        setMessage(failureCopy[outcome.reason] ?? failureCopy.provider);
      } else throw new Error("Invalid result");
    } catch {
      if (!isCurrent(operation)) return;
      setPhase("failed");
      setMessage("The request failed or its result could not be validated · Incomplete. Text already sent cannot be recalled. Prepare a new request to try again; it may incur cost.");
    } finally {
      if (isCurrent(operation)) {
        active.current = null;
        setPrepared(null);
      }
    }
  }

  function stop() {
    const wasRunning = active.current?.requestId !== null && active.current?.requestId !== undefined;
    const result = retire();
    const stoppedGeneration = generation.current;
    setPrepared(null);
    setPhase("stopped");
    setNavigationBusy(false);
    setMessage(wasRunning ? stoppedCopy : "Preparation cancelled · No provider request started. Prepare again when ready.");
    focusStatus();
    void result.then((confirmed) => {
      if (!confirmed && alive.current && generation.current === stoppedGeneration && !active.current) {
        setMessage("Stop could not be confirmed · Incomplete. Late results are ignored here, but the provider may still be processing text already sent. That text cannot be recalled.");
      }
    });
  }

  async function navigate(run: ReaderRun, citation: Citation) {
    const key = navigationKey(run, citation);
    if (active.current || navigationRefusals.has(key) || navigationState(run, citation, props.currentSources, props.editor) !== "ready") return;
    const operation = begin();
    setNavigationBusy(true);
    setMessage("Checking the current source and editor before showing the exact passage…");
    try {
      const result = await props.onNavigate({ run, citation, signal: operation.controller.signal });
      if (!isCurrent(operation)) return;
      if (result !== "selected") setNavigationRefusals((previous) => new Map(previous).set(key, result === "stale" ? "stale" : "unavailable"));
      setMessage(result === "selected" ? "The host confirmed the exact current passage was selected." : "The passage is stale or unavailable. Its historical quotation remains here; no replacement passage was selected.");
    } catch {
      if (isCurrent(operation)) setMessage("The passage could not be opened. Its historical quotation remains here. Try again after checking the source.");
    } finally {
      if (isCurrent(operation)) {
        active.current = null;
        setNavigationBusy(false);
      }
    }
  }

  const busy = phase === "preparing" || phase === "running";
  return <section aria-labelledby={heading} className="space-y-4 p-4 text-(length:--text-body-size) text-foreground">
    <h2 id={heading} className="text-(length:--text-title-3-size) font-semibold">Structured reader review</h2>
    <p className="text-muted-foreground">Suggestion-only · Saved selected sources · Volatile. Closing this view discards its snapshots, profiles and results.</p>
    <p ref={status} role="status" aria-live="polite" tabIndex={-1} className="rounded-[var(--corner-md)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{message}</p>
    {prepared ? <ReviewDisclosure prepared={prepared} /> : null}
    {phase === "ready" && !consentReady ? <p>{refusalCopy.consent}</p> : null}
    {phase === "ready" && !destinationReady ? <p>{refusalCopy.unavailable}</p> : null}
    <div className="flex flex-wrap gap-2">
      {phase === "ready" && prepared ? <Button variant="primary" className={reviewActionClass} disabled={!canStart || navigationBusy} onClick={() => void start()}>Start with {prepared.envelope.destination.provider}</Button> : null}
      {!busy ? <Button variant={phase === "ready" ? "secondary" : "primary"} className={reviewActionClass} disabled={!props.supported || navigationBusy} onClick={() => void prepare()}>
        {phase === "ready" ? "Refresh disclosure" : runs.length ? "Prepare rerun" : "Prepare review"}
      </Button> : <Button className={reviewActionClass} onClick={stop}>{phase === "running" ? "Stop review" : "Cancel preparation"}</Button>}
      <Button variant="ghost" className={reviewActionClass} onClick={() => { void retire(); setPrepared(null); setRuns([]); setNavigationRefusals(new Map()); setPhase("idle"); props.onClose(); }}>Close review</Button>
    </div>
    <ReaderReviewResults runs={runs} currentSources={props.currentSources} editor={props.editor} navigationBusy={busy || navigationBusy || !props.supported} navigationRefusals={navigationRefusals} onNavigate={(run, citation) => void navigate(run, citation)} />
  </section>;
}
