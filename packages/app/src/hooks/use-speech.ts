import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceSpeakers } from "@ai-book-studio/core/ipc";
import { toSpeechText } from "@ai-book-studio/core/speech-text";

/**
 * Speaking.
 *
 * There are two voices, and the better one wins:
 *
 * 1. **A voice service.** If a connection can speak — OpenAI's text-to-speech today — the words
 *    go there and come back as audio. It is the same voice on every surface, it can be told how
 *    to read, and it does not depend on which system voices this machine happens to have.
 * 2. **The device's own voice.** When no voice service is connected, the browser's speech
 *    synthesis reads it. It costs nothing, needs no key, and sounds like the operating system.
 *
 * Either way, what it says is also on the screen. Someone who cannot hear, or who is in a room
 * they do not want to talk in, must still get the words.
 */
export type VoiceSource = "tts" | "device" | "none";

export interface Speech {
  /** Whether this machine can speak at all. */
  supported: boolean;
  /** Which voice is in use. */
  using: VoiceSource;
  /** True while the voice is talking. Stays true while paused. */
  speaking: boolean;
  /** True while the voice is held mid-utterance and can go on. */
  paused: boolean;
  /** True when the last utterance fell back to the device because the service failed. */
  fellBack: boolean;
  /** The voices the service offers, when there is one. */
  voices: string[];
  /** Say something. Resolves false when nothing could be said. */
  speak: (text: string, options?: { voice?: string }) => Promise<boolean>;
  /** Hold the current utterance. Does nothing when nothing is being said. */
  pause: () => void;
  /** Go on after a pause. Does nothing when nothing is held. */
  resume: () => void;
  /** Stop talking. */
  cancel: () => void;
}

export function useSpeech(): Speech {
  const [speakers, setSpeakers] = useState<VoiceSpeakers | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Which voice is saying the current utterance, so pause and resume hold the right one. */
  const source = useRef<"tts" | "device" | null>(null);
  const token = useRef(0);

  const deviceSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  useEffect(() => {
    let live = true;
    void window.studio.voice
      .speakers()
      .then((result) => {
        if (live && result.ok) setSpeakers(result.data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const using: VoiceSource = speakers?.available ? "tts" : deviceSupported ? "device" : "none";

  const stopAudio = useCallback(() => {
    const element = audio.current;
    audio.current = null;
    if (element) {
      element.pause();
      element.src = "";
    }
  }, []);

  const cancel = useCallback(() => {
    token.current += 1;
    source.current = null;
    stopAudio();
    if (deviceSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    setFellBack(false);
  }, [deviceSupported, stopAudio]);

  const speakWithDevice = useCallback(
    (text: string): boolean => {
      if (!deviceSupported) return false;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onend = () => {
        if (source.current === "device") source.current = null;
        setSpeaking(false);
        setPaused(false);
      };
      utterance.onerror = () => {
        if (source.current === "device") source.current = null;
        setSpeaking(false);
        setPaused(false);
      };
      source.current = "device";
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [deviceSupported]
  );

  const pause = useCallback(() => {
    if (!speaking || paused) return;
    if (source.current === "device") {
      if (deviceSupported) window.speechSynthesis.pause();
    } else {
      audio.current?.pause();
    }
    setPaused(true);
  }, [deviceSupported, paused, speaking]);

  const resume = useCallback(() => {
    if (!paused) return;
    if (source.current === "device") {
      if (deviceSupported) window.speechSynthesis.resume();
      setPaused(false);
      return;
    }
    const element = audio.current;
    if (!element) {
      setPaused(false);
      setSpeaking(false);
      return;
    }
    void element.play().then(
      () => setPaused(false),
      () => {
        if (audio.current === element) audio.current = null;
        if (source.current === "tts") source.current = null;
        setPaused(false);
        setSpeaking(false);
      }
    );
  }, [deviceSupported, paused]);

  const speak = useCallback(
    async (text: string, options: { voice?: string } = {}): Promise<boolean> => {
      // Speech reads every symbol it is given, so the markup goes first and the words are what is spoken.
      const trimmed = toSpeechText(text);
      if (!trimmed) return false;
      cancel();
      const mine = token.current;

      // The device's voice is better than silence, and the panel says which one spoke.
      const fallBackToDevice = (): boolean => {
        if (mine !== token.current) return false;
        const said = speakWithDevice(trimmed);
        if (said) setFellBack(true);
        return said;
      };

      if (speakers?.available) {
        try {
          const result = await window.studio.voice.speak({
            text: trimmed,
            ...(options.voice ? { voice: options.voice } : {})
          });
          // A newer request arrived while this one was being spoken; drop this one.
          if (mine !== token.current) return false;
          if (result.ok) {
            const element = new Audio(result.data.dataUrl);
            audio.current = element;
            element.onended = () => {
              if (audio.current === element) audio.current = null;
              if (source.current === "tts") source.current = null;
              setSpeaking(false);
              setPaused(false);
            };
            element.onerror = () => {
              if (audio.current === element) audio.current = null;
              if (source.current === "tts") source.current = null;
              setSpeaking(false);
              setPaused(false);
              fallBackToDevice();
            };
            source.current = "tts";
            setSpeaking(true);
            try {
              await element.play();
            } catch {
              if (audio.current === element) audio.current = null;
              if (mine !== token.current) return false;
              setSpeaking(false);
              return fallBackToDevice();
            }
            return true;
          }
          // The service refused. The device's voice is better than silence.
          return fallBackToDevice();
        } catch {
          return fallBackToDevice();
        }
      }

      return speakWithDevice(trimmed);
    },
    [cancel, speakers, speakWithDevice]
  );

  // Leaving the screen must not leave a voice talking.
  useEffect(() => () => {
    stopAudio();
    if (deviceSupported) window.speechSynthesis.cancel();
  }, [deviceSupported, stopAudio]);

  return {
    supported: using !== "none",
    using,
    speaking,
    paused,
    fellBack,
    voices: speakers?.voices ?? [],
    speak,
    pause,
    resume,
    cancel
  };
}
