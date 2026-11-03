import { useCallback, useEffect, useRef, useState } from "react";
import { recordedBlobToWav } from "../lib/audio";

export type DictationState = "idle" | "requesting" | "recording" | "transcribing";

export interface DictationOptions {
  onText: (text: string) => void;
  onError: (error: Error) => void;
  /** Meta accepts at most ten minutes. */
  maxMs?: number;
}

const MAX_DICTATION_MS = 10 * 60 * 1000;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/**
 * Microphone lifecycle for one dictation. It records, converts to the WAV Meta accepts and calls
 * the desktop transcription service. The hook never persists audio and stops every track on exit.
 */
export function useDictation({ onText, onError, maxMs = MAX_DICTATION_MS }: DictationOptions) {
  const [state, setState] = useState<DictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = null;
  }, []);

  const fail = useCallback(
    (message: string) => {
      if (!mounted.current) return;
      setState("idle");
      setElapsedMs(0);
      onError(new Error(message));
    },
    [onError]
  );

  const stop = useCallback(() => {
    const active = recorder.current;
    if (!active || active.state === "inactive") return;
    active.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    clearTimer();
    const active = recorder.current;
    if (active && active.state !== "inactive") active.stop();
    release();
    chunks.current = [];
    if (mounted.current) {
      setState("idle");
      setElapsedMs(0);
    }
  }, [clearTimer, release]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      fail("This build cannot record audio. Voice dictation needs the desktop app.");
      return;
    }
    setState("requesting");
    cancelled.current = false;
    chunks.current = [];
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in System Settings and try again."
          : "The microphone could not be opened. Check that it is connected and not in use."
      );
      return;
    }
    if (cancelled.current || !mounted.current) {
      media.getTracks().forEach((track) => {
        track.stop();
      });
      return;
    }
    stream.current = media;
    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    const active = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media);
    recorder.current = active;
    active.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    });
    active.addEventListener("stop", () => {
      clearTimer();
      release();
      recorder.current = null;
      const recorded = new Blob(chunks.current, { type: active.mimeType || "audio/webm" });
      chunks.current = [];
      if (cancelled.current) {
        cancelled.current = false;
        if (mounted.current) {
          setState("idle");
          setElapsedMs(0);
        }
        return;
      }
      if (recorded.size === 0) {
        fail("The recording was empty. Try again and speak after the microphone starts.");
        return;
      }
      void (async () => {
        if (mounted.current) setState("transcribing");
        try {
          if (!window.studio.voice) {
            throw new Error("Voice dictation is available in the desktop app.");
          }
          const wav = await recordedBlobToWav(recorded);
          const result = await window.studio.voice.transcribe({
            audio: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
          });
          if (!result.ok) throw new Error(result.error.message);
          if (!result.data.text) {
            fail("No speech was detected. Try again a little closer to the microphone.");
            return;
          }
          if (!mounted.current) return;
          setState("idle");
          setElapsedMs(0);
          onText(result.data.text);
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      })();
    });

    startedAt.current = Date.now();
    setElapsedMs(0);
    setState("recording");
    active.start(500);
    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      if (mounted.current) setElapsedMs(elapsed);
      if (elapsed >= maxMs) stop();
    }, 250);
  }, [clearTimer, fail, maxMs, onText, release, state, stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      clearTimer();
      const active = recorder.current;
      if (active && active.state !== "inactive") active.stop();
      release();
    };
  }, [clearTimer, release]);

  return { state, elapsedMs, start, stop, cancel };
}
