import { useEffect, useState } from "react";
import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { Button } from "@ai-book-studio/ui/button";
import { useDictation } from "../hooks/use-dictation";

interface Props {
  onText: (text: string) => void;
  onError: (error: Error) => void;
  disabled?: boolean;
}

type Availability = "checking" | "ready" | "unavailable";

function elapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The microphone is only enabled when a Meta connection exists and the build can call the desktop
 * transcription service. The web build reports no connections and gets the honest refusal.
 */
export function VoiceButton({ onText, onError, disabled = false }: Props) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [reason, setReason] = useState("Checking voice access…");
  const { state, elapsedMs, start, stop } = useDictation({ onText, onError });

  useEffect(() => {
    let live = true;
    const voice = window.studio.voice;
    if (!voice) {
      setAvailability("unavailable");
      setReason("Voice dictation is available in the desktop app.");
      return () => {
        live = false;
      };
    }
    void voice
      .connections()
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setAvailability("unavailable");
          setReason(result.error.message);
          return;
        }
        if (result.data.length === 0) {
          setAvailability("unavailable");
          setReason("Connect Meta in Settings to dictate with Muse Voice Transcribe.");
          return;
        }
        setAvailability("ready");
        setReason("Dictate with Muse Voice Transcribe");
      })
      .catch((error: unknown) => {
        if (!live) return;
        setAvailability("unavailable");
        setReason(error instanceof Error ? error.message : "Voice dictation is not available.");
      });
    return () => {
      live = false;
    };
  }, []);

  const busy = state === "requesting" || state === "transcribing";
  const recording = state === "recording";
  const unavailable = availability !== "ready" || disabled;

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant={recording ? "danger" : "outline"}
        size="icon"
        className="size-11"
        aria-label={recording ? "Stop dictation" : "Start dictation"}
        aria-pressed={recording}
        title={unavailable ? reason : recording ? "Stop and transcribe" : "Start dictation"}
        disabled={unavailable || busy}
        onClick={() => {
          if (recording) stop();
          else void start();
        }}
      >
        {busy ? <Loader2 size={17} className="animate-spin" /> : recording ? <Square size={15} /> : unavailable ? <MicOff size={17} /> : <Mic size={17} />}
      </Button>
      {recording ? (
        <span className="tabular text-[var(--text-caption-size)] text-muted-foreground" role="status">
          {elapsed(elapsedMs)}
        </span>
      ) : state === "transcribing" ? (
        <span className="text-[var(--text-caption-size)] text-muted-foreground" role="status">
          Transcribing…
        </span>
      ) : null}
    </span>
  );
}
