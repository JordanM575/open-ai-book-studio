import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Mic, MicOff, Pause, Play, Volume2 } from "lucide-react";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";
import type { AgentEvent } from "@ai-book-studio/core/agent";
import { Button } from "@ai-book-studio/ui/button";
import { must } from "../lib/utils";
import { useSpeech } from "../hooks/use-speech";
import { useDictation } from "../hooks/use-dictation";

interface Props {
  bookId: string;
  /** The chapter the author is looking at, so "read it" means this one. */
  chapterTitle: string;
  /** The chapter's text, so it can be read aloud without another round trip. */
  chapterContent: string;
  /** The next chapter, when there is one. */
  onNextChapter: () => void;
  /** Something went wrong. */
  onNotice: (error: unknown) => void;
}

/**
 * The minimal mode.
 *
 * The chat panel is for talking to the agent. This is for the rest of the time: a strip that
 * knows where you are in the book, says it out loud when you ask, offers to read the prose, and
 * takes a sentence when you have something to say.
 *
 * It is deliberately small. The status is one line, the actions are the studio's own verbs, and
 * everything it says is also on the screen.
 *
 * The microphone is the hands-free path: press it, speak, and the sentence goes to the agent
 * without a keyboard. What was heard is shown before it is sent, so a misheard word is something
 * the author can see rather than something that quietly changed their book.
 */
export function AmbientPanel({
  bookId,
  chapterTitle,
  chapterContent,
  onNextChapter,
  onNotice
}: Props) {
  const [status, setStatus] = useState<AmbientStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [voice, setVoice] = useState<string>("");
  const turnRef = useRef<string | null>(null);
  /** Whether the turn that just finished was spoken to, so its answer is spoken back. */
  const spokenRef = useRef(false);
  /** The answer so far. It is in state for the screen, and here for the handler that speaks it. */
  const replyRef = useRef("");
  /*
   * The chosen voice, for the event handler.
   *
   * The handler is reinstalled when the speaking function or the refresh changes, not on every voice
   * change, so a ref is how it reads the voice the author picks later.
   */
  const voiceRef = useRef("");
  voiceRef.current = voice;
  const speech = useSpeech();
  const [heard, setHeard] = useState<string | null>(null);

  /*
   * The microphone.
   *
   * A transcript is put on screen and sent in the same breath, because the point of holding a
   * button and speaking is not to then press another one. It is shown first, and the reply is
   * spoken back, so the loop closes: speak, hear what was heard, hear the answer.
   */
  const dictation = useDictation({
    onText: (text) => {
      setHeard(text);
      setInput("");
      void ask(text, { spoken: true });
    },
    onError: (error) => {
      setNote(error.message);
    }
  });

  const refresh = useCallback(async () => {
    try {
      setStatus(await must(window.studio.agent.ambient(bookId)));
    } catch (error) {
      onNotice(error);
    }
  }, [bookId, onNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The agent's own voice, heard as it happens. It is reinstalled when the speaking function changes,
  // so the answer is spoken through the voice service once that has loaded.
  useEffect(() => {
    const unsubscribe = window.studio.agent.onEvent((event: AgentEvent) => {
      if (event.turnId !== turnRef.current) return;
      if (event.type === "text") {
        replyRef.current += event.delta;
        setReply(replyRef.current);
      } else if (event.type === "done") {
        setRunning(false);
        setStatus((current) => (current ? { ...current, working: false } : current));
        void refresh();
        /*
         * In the hands-free loop the answer is spoken as well as shown, because the author is not
         * looking at the screen — that is what makes it hands-free. The text stays on screen for
         * anyone who cannot hear it, which is why this is additive rather than a replacement.
         */
        if (spokenRef.current) {
          spokenRef.current = false;
          const chosen = voiceRef.current;
          void speech.speak(replyRef.current.trim() || "Done.", chosen ? { voice: chosen } : {});
        }
      } else if (event.type === "error") {
        setRunning(false);
        setNote(event.message);
      }
    });
    return unsubscribe;
  }, [refresh, speech.speak]);

  const ask = useCallback(
    async (prompt: string, options: { spoken?: boolean } = {}) => {
      if (running) return;
      setRunning(true);
      replyRef.current = "";
      setReply("");
      setNote("");
      try {
        const started = await window.studio.agent.start({ bookId, prompt, mode: "edit" });
        if (!started.ok) {
          throw Object.assign(new Error(started.error.message), { code: started.error.code });
        }
        turnRef.current = started.data.turnId;
        // Only a turn that actually started can be spoken back, so the flag is set once it has.
        spokenRef.current = options.spoken === true;
        setStatus((current) => (current ? { ...current, working: true } : current));
      } catch (error) {
        setRunning(false);
        setNote(error instanceof Error ? error.message : String(error));
        onNotice(error);
      }
    },
    [bookId, running, onNotice]
  );

  const readAloud = useCallback(() => {
    const text = chapterContent.trim();
    if (!text) {
      setNote("There is nothing to read in this chapter yet.");
      return;
    }
    setNote("");
    void speech.speak(`${chapterTitle}. ${text}`, voice ? { voice } : {});
  }, [chapterContent, chapterTitle, speech, voice]);

  const whereAmI = useCallback(() => {
    if (!status) return;
    setNote("");
    void speech.speak(status.say, voice ? { voice } : {});
  }, [status, speech, voice]);

  const undo = useCallback(async () => {
    try {
      const result = await must(window.studio.agent.undoLast(bookId));
      const restored = `Restored ${result.restored} chapter${result.restored === 1 ? "" : "s"}`;
      // A skipped chapter changed after the turn and was left alone, so it is never "nothing".
      setNote(
        result.skipped > 0
          ? `${restored}, but skipped ${result.skipped}. Review the remaining changes.`
          : result.restored > 0
            ? `${restored}.`
            : "There was nothing to restore."
      );
      await refresh();
    } catch (error) {
      onNotice(error);
    }
  }, [bookId, onNotice, refresh]);

  const stop = useCallback(async () => {
    const turnId = turnRef.current;
    if (!turnId) return;
    try {
      await window.studio.agent.stop(turnId);
      setRunning(false);
      setNote("Stopped.");
    } catch (error) {
      onNotice(error);
    }
  }, [onNotice]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void ask(text);
  }, [ask, input]);

  const actions = status?.actions ?? [];
  const dictating = dictation.state === "recording";

  return (
    <section
      className="glass mx-3 mb-2 rounded-[var(--corner-xl)] px-4 py-3"
      aria-label="The writing agent, in brief"
      data-testid="ambient-panel"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground"
            data-testid="ambient-line"
          >
            {status?.say ?? "Looking at your book…"}
          </p>
          {reply ? (
            <p
              className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)]"
              data-testid="ambient-reply"
            >
              {reply}
            </p>
          ) : null}
          {heard ? (
            <p
              className="mt-1 text-[var(--text-caption-size)] text-muted-foreground"
              data-testid="ambient-heard"
            >
              Heard: “{heard}”
            </p>
          ) : null}
          {note ? (
            <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground" data-testid="ambient-note">
              {note}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {speech.speaking || speech.paused ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (speech.paused) speech.resume();
                else speech.pause();
              }}
              aria-label={speech.paused ? "Resume reading" : "Pause reading"}
              title={speech.paused ? "Resume reading" : "Pause reading"}
              data-testid="ambient-pause"
            >
              {speech.paused ? <Play size={16} /> : <Pause size={16} />}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={whereAmI}
            disabled={!status}
            aria-label="Say where you are"
            title="Say where you are"
            data-testid="ambient-where"
          >
            <Volume2 size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((open) => !open)}
            aria-label={expanded ? "Hide the agent's actions" : "Show the agent's actions"}
            title={expanded ? "Hide the agent's actions" : "Show the agent's actions"}
            data-testid="ambient-toggle"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant={action.id === "read_aloud" ? "primary" : "secondary"}
                size="sm"
                disabled={!action.available || (action.id === "stop" ? !running : running)}
                title={action.available ? action.spoken : action.why}
                data-testid={`ambient-action-${action.id}`}
                onClick={() => {
                  if (action.id === "read_aloud") readAloud();
                  else if (action.id === "where_am_i") whereAmI();
                  else if (action.id === "next_chapter") onNextChapter();
                  else if (action.id === "undo") void undo();
                  else if (action.id === "stop") void stop();
                  else if (action.id === "keep_going") void ask("Carry on with the next scene, in the author's voice.");
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant={dictating ? "primary" : "secondary"}
              size="icon"
              onClick={() => {
                if (dictating) {
                  dictation.stop();
                } else {
                  setHeard(null);
                  void dictation.start();
                }
              }}
              // Disabled mid-transcription so a second press cannot start a second recording, and
              // never while the agent is writing, because the answer would arrive mid-sentence.
              disabled={dictation.state === "transcribing" || dictation.state === "requesting" || running}
              aria-label={dictating ? "Stop and send what you said" : "Speak to the agent"}
              aria-pressed={dictating}
              title={
                dictation.state === "requesting"
                  ? "Waiting for the microphone…"
                  : dictation.state === "transcribing"
                    ? "Turning what you said into text…"
                    : dictating
                      ? "Stop and send"
                      : "Speak to the agent"
              }
              data-testid="ambient-mic"
            >
              {dictating ? <MicOff size={14} /> : <Mic size={14} />}
            </Button>
            <input
              className="min-w-0 flex-1 rounded-[var(--corner-md)] border border-border bg-[var(--secondary)] px-3 py-2 text-[var(--text-subheadline-size)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              placeholder={speech.supported ? "Say what you want, or type it" : "Type what you want"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  send();
                }
              }}
              aria-label="Tell the agent"
              data-testid="ambient-input"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={send}
              disabled={running || !input.trim()}
              data-testid="ambient-send"
            >
              <Mic size={14} />
              Tell it
            </Button>
          </div>
          {dictation.state !== "idle" ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground" data-testid="ambient-dictation">
              {dictation.state === "requesting"
                ? "Waiting for the microphone…"
                : dictation.state === "transcribing"
                  ? "Turning what you said into text…"
                  : `Listening… ${(dictation.elapsedMs / 1000).toFixed(1)}s`}
            </p>
          ) : null}
          {speech.using === "tts" && speech.voices.length > 0 ? (
            <label className="mt-3 flex items-center gap-2 text-[var(--text-caption-size)] text-muted-foreground">
              <span>Voice</span>
              <select
                className="rounded-[var(--corner-md)] border border-border bg-[var(--secondary)] px-2 py-1 text-[var(--text-caption-size)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                data-testid="ambient-voice"
              >
                <option value="">The studio&apos;s default</option>
                {speech.voices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {speech.fellBack ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground" data-testid="ambient-fallback">
              The studio&apos;s voice failed, so this computer&apos;s own voice read it instead.
            </p>
          ) : null}
          {speech.using === "device" ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground">
              Speaking with this computer&apos;s own voice. Connect a voice service in Settings for
              the studio&apos;s voice instead.
            </p>
          ) : null}
          {!speech.supported ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground">
              This device cannot speak, so the agent shows its status instead of saying it.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
