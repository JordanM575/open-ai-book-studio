import { useCallback, useState } from "react";

/**
 * Speaking.
 *
 * The desktop app is a Chromium renderer, so the browser's own speech synthesis is available with
 * no dependency and no voice service: the words come from the system's voices.
 *
 * Speaking is always an addition to the interface, never a replacement for it. Everything this
 * says is also on the screen, because someone who cannot hear, or who is in a room they do not
 * want to talk in, must still get the words.
 */
export function useSpeech(): {
  /** Whether this device can speak at all. */
  supported: boolean;
  /** True while the voice is talking. */
  speaking: boolean;
  /** Say something. Returns false when the device cannot. */
  speak: (text: string) => boolean;
  /** Stop talking. */
  cancel: () => void;
} {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = "en-US";
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return true;
    },
    []
  );

  return { supported, speaking, speak, cancel };
}
