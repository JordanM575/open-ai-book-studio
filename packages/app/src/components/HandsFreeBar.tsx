import { Loader2, Mic, MicOff, Send, Square, Undo2, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@ai-book-studio/ui/button";
import type {
  HandsFreePhase,
  HandsFreePort,
  HandsFreeState,
  HandsFreeTurn,
  HandsFreeAdmission,
} from "../lib/hands-free";
import { useHandsFreeSession } from "../hooks/use-hands-free-session";

interface Props {
  bookId: string;
  chapterId: string | null;
  threadId: string | null;
  /** A trusted host adapter. This build ships none, so the bar reports that audio is not connected. */
  port?: HandsFreePort | undefined;
  onSendTurn: (turn: HandsFreeTurn, admission: HandsFreeAdmission) => Promise<{ ok: boolean; reason?: string }>;
  onNotice?: (error: unknown) => void;
  /** A turn is already running in this conversation. */
  disabled?: boolean;
}

/**
 * The explicit hands-free controls for the Discuss surface (017 T017).
 *
 * Everything here is a visible, keyboard-reachable action: start, the words as heard, correction,
 * one explicit confirm, stop. There is no microphone in this component and no automatic send: a
 * transcript only becomes a turn after the author presses Confirm and send.
 *
 * The words always go to the book, chapter and conversation that were on screen when the session
 * started. Changing any of them ends the session and keeps the unsent words visible as text.
 */
export function statusCopy(state: HandsFreeState, phase: HandsFreePhase): string {
  switch (phase) {
    case "unavailable":
      return state.availability.ready
        ? "Hands-free audio is unavailable right now."
        : state.availability.reason;
    case "idle":
      return "Ready when you are.";
    case "starting":
      return "Starting… Capture may be active while the host verifies the session.";
    case "recording":
      return "Listening. Nothing is sent until you confirm.";
    case "transcribing":
      return "Transcribing the words you just spoke…";
    case "correcting":
      return "Correct the words, then confirm to send.";
    case "confirming":
      return "Sending your turn to this conversation…";
    case "speaking":
      return "Reading the answer.";
    case "interrupted":
      return "Interrupted. Continue explicitly when you are ready.";
    case "held":
      return state.captureReason ?? "Held. Nothing is being recorded.";
    case "stopping":
      return "Stopping… Waiting for the host to confirm that capture closed.";
    case "stopped":
      if (state.stop.status === "stopped") return "Stopped.";
      return state.availability.ready && !state.session.token ? "Ready when you are." : "Not recording.";
    case "stop-unconfirmed":
      return state.stop.reason
        ? `Stop was not confirmed: ${state.stop.reason} This session cannot send.`
        : "Stop was not confirmed. This session cannot send.";
  }
}

export function HandsFreeBar({
  bookId,
  chapterId,
  threadId,
  port,
  onSendTurn,
  onNotice,
  disabled = false,
}: Props) {
  const statusId = useId();
  const { state, phase, start, stop, confirm, correct, discard, continueSession, acknowledge } =
    useHandsFreeSession({
      scope: { bookId, chapterId, threadId },
      ...(port ? { port } : {}),
      onSendTurn,
      ...(onNotice ? { onNotice } : {}),
    });

  const session = state.session;
  const draft = session.draft;
  const failure = session.failures.stt ?? session.failures.work ?? session.failures.tts;
  const showDraft = phase === "correcting";
  const canStart = state.availability.ready && !session.active && phase !== "stopping" &&
    phase !== "stop-unconfirmed" && state.send.status !== "sending" && !disabled && !failure;
  const canStop = (session.active || phase === "stop-unconfirmed") && phase !== "stopping";
  const canConfirm = phase === "correcting" && draft.trim().length > 0 && !disabled && !session.correctionPending;
  const canContinue =
    session.active && !failure &&
    (session.correctionPending || (!draft && (phase === "held" || phase === "interrupted")));
  const canDiscard = session.active && (state.editing || Boolean(draft));
  const failed = Boolean(failure) || state.send.status === "failed" || state.stop.status === "failed";

  return (
    <section
      className="mb-2 rounded-[var(--corner-md)] border border-[var(--glass-outline)] px-2.5 py-2"
      aria-label="Hands-free dictation"
      data-testid="hands-free"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-(length:--text-caption-size) font-medium text-muted-foreground">Hands-free</span>
        <span
          id={statusId}
          className={`min-w-0 flex-1 text-(length:--text-caption-size) ${failed ? "text-[var(--destructive-text)]" : "text-muted-foreground"}`}
          role={failed ? "alert" : "status"}
          aria-live="polite"
          data-testid="hands-free-status"
        >
          {statusCopy(state, phase)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {failure ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={acknowledge}
              disabled={disabled}
              data-testid="hands-free-acknowledge"
            >
              <X size={14} />
              Dismiss
            </Button>
          ) : null}
          {canContinue ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={continueSession}
              disabled={disabled}
              data-testid="hands-free-continue"
            >
              <Undo2 size={14} />
              Continue
            </Button>
          ) : null}
          {canDiscard ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={disabled || phase === "confirming"}
              aria-label="Discard the words"
              data-testid="hands-free-discard"
            >
              <X size={14} />
              Discard
            </Button>
          ) : null}
          {session.active || phase === "stop-unconfirmed" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={stop}
              disabled={!canStop}
              data-testid="hands-free-stop"
            >
              {phase === "stopping" ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={start}
              disabled={!canStart}
              aria-describedby={statusId}
              data-testid="hands-free-start"
            >
              {state.availability.ready ? <Mic size={14} /> : <MicOff size={14} />}
              Start
            </Button>
          )}
          {showDraft ? (
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={!canConfirm}
              data-testid="hands-free-confirm"
            >
              <Send size={14} />
              Confirm and send
            </Button>
          ) : null}
        </div>
      </div>

      {showDraft ? (
        <label className="mt-2 block">
          <span className="sr-only">Words to send</span>
          <textarea
            value={draft}
            onChange={(event) => correct(event.target.value)}
            disabled={disabled}
            rows={2}
            aria-describedby={statusId}
            data-testid="hands-free-draft"
            className="block w-full resize-y rounded-[var(--corner-sm)] border border-[var(--input)] bg-[var(--card)] p-2 text-foreground focus-visible:outline-2"
          />
        </label>
      ) : null}

      {state.preserved && !showDraft ? (
        <p className="mt-2 text-(length:--text-caption-size) text-muted-foreground" data-testid="hands-free-preserved">
          {state.send.dispatched && state.send.text === state.preserved ? "Retained words" : "Not sent"} · “{state.preserved}”
        </p>
      ) : null}

      {state.note && (phase !== "unavailable" || state.send.status === "sent" || state.send.status === "failed") ? (
        <p
          className={`mt-1 text-(length:--text-caption-size) ${failed ? "text-[var(--destructive-text)]" : "text-muted-foreground"}`}
          role={failed ? "alert" : "status"}
          data-testid="hands-free-note"
        >
          {state.note}
        </p>
      ) : null}

      <p className="mt-1 text-(length:--text-caption-size) text-muted-foreground">
        Voice turns use Discuss and stay in this conversation.
      </p>
    </section>
  );
}
