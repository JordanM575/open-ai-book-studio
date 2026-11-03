/// <reference types="bun" />
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";
import type { AmbientStatus } from "@ai-book-studio/core/agent/ambient";

/**
 * The minimal mode, end to end through its own component.
 *
 * This is the hands-free loop the whole ambient design exists for: speak, hear what was heard,
 * watch the agent work, hear that it is done. The pieces are tested on their own elsewhere; what
 * this file checks is that they are wired to each other — that a transcript reaches the agent, that
 * the agent's answer is spoken only when the turn came from the microphone, and that a keyboard is
 * never required.
 */

let testing!: typeof import("@testing-library/react/pure");
let AmbientPanel!: typeof import("@ai-book-studio/app/components/AmbientPanel").AmbientPanel;

/** The globals this file replaces, so the next file finds the ones this file found. */
const realGlobals = {
  MediaRecorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder,
  AudioContext: (globalThis as { AudioContext?: unknown }).AudioContext,
  SpeechSynthesisUtterance: (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
};

beforeAll(async () => {
  testing = await mountDom();
  ({ AmbientPanel } = await import("@ai-book-studio/app/components/AmbientPanel"));
});
afterAll(async () => {
  await unmountDom();
});



const BOOK = "book_amb000001";

const status: AmbientStatus = {
  book: { id: BOOK, title: "The Salt Road", stage: "drafting" },
  chapter: { id: "ch_amb00000001", title: "The Light", order: 1, wordCount: 5 },
  progress: { chapters: 1, words: 5, lastOrder: 1 },
  lastChange: null,
  lastSaid: null,
  working: false,
  actions: [
    { id: "read_aloud", label: "Read it aloud", spoken: "read it aloud", available: true },
    { id: "where_am_i", label: "Where am I", spoken: "where am I", available: true },
    { id: "keep_going", label: "Keep going", spoken: "keep going", available: true }
  ],
  say: "You're in Chapter One, The Light, of The Salt Road. 5 words so far."
};

/** A recorder the test can drive, because the microphone is not available here. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  readonly listeners = new Map<string, Array<(event: { data: Blob }) => void>>();

  constructor(readonly stream: unknown) {
    FakeRecorder.instances.push(this);
  }

  static isTypeSupported(): boolean {
    return true;
  }

  addEventListener(type: string, handler: (event: { data: Blob }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.emit();
  }

  /** Finish the recording with a chunk, the way the browser would. */
  emit(): void {
    for (const handler of this.listeners.get("dataavailable") ?? []) {
      handler({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    }
    for (const handler of this.listeners.get("stop") ?? []) handler({ data: new Blob() });
  }
}

class FakeAudioContext {
  async decodeAudioData(): Promise<unknown> {
    return {
      numberOfChannels: 1,
      length: 2,
      sampleRate: 16_000,
      getChannelData: () => new Float32Array([0.1, 0.2])
    };
  }
  async close(): Promise<void> {}
}

/**
 * What was said out loud.
 *
 * The panel asks the voice service first and falls back to the device's own voice. This test gives
 * it no service — the honest configuration for an author with no connection — and records the
 * utterances the device was asked to speak.
 */
let spoken: string[] = [];
let started: Array<{ bookId: string; mode: string; prompt: string }> = [];
let transcript = "carry on with the next scene";
let transcribeFails = false;
let listeners: Array<(event: { turnId: string; type: string; delta?: string; message?: string }) => void> = [];
let turnId = "turn_amb000001";
let voiceSpoken: string[] = [];
let speakersAvailable = false;
let startRefusal: string | null = null;
let speakFails = false;
/** When false, utterances stay open until a test ends them, which makes pausing observable. */
let utteranceAutoEnd = true;
let pendingEnds: Array<() => void> = [];
let synthesisPauseCalls = 0;
let synthesisResumeCalls = 0;
/** The voice the room had before a test replaced it with the fake service reply. */
let nativeAudio: unknown;
let audioOverridden = false;

/** The voice service's reply, recorded rather than played. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playedCount = 0;
  pausedCount = 0;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  async play(): Promise<void> {
    this.playedCount += 1;
  }

  pause(): void {
    this.pausedCount += 1;
  }

  /** Finish the audio, the way the element would. */
  end(): void {
    this.onended?.();
  }
}

function studio() {
  return {
    agent: {
      ambient: async () => ({ ok: true, data: status }),
      start: async (input: { bookId: string; mode: string; prompt: string }) => {
        started.push(input);
        if (startRefusal) return { ok: false, error: { code: "invalid", message: startRefusal } };
        return { ok: true, data: { turnId, threadId: "thread_amb000001", text: "", changed: 0 } };
      },
      stop: async () => ({ ok: true, data: null }),
      undoLast: async () => ({ ok: true, data: { restored: 0, skipped: 0 } }),
      onEvent: (handler: (event: unknown) => void) => {
        listeners.push(handler as never);
        return () => {
          listeners = listeners.filter((entry) => entry !== handler);
        };
      }
    },
    voice: {
      transcribe: async () => {
        if (transcribeFails) return { ok: false, error: { code: "invalid", message: "The key was rejected." } };
        return { ok: true, data: { text: transcript } };
      },
      // No speaking connection unless a test asks for one, which is what most authors have on day one.
      speakers: async () => ({ ok: true, data: { available: speakersAvailable, voices: speakersAvailable ? ["alloy"] : [] } }),
      speak: async (input: { text: string }) => {
        voiceSpoken.push(input.text);
        if (speakFails) return { ok: false, error: { code: "invalid", message: "The voice was rejected." } };
        return { ok: true, data: { dataUrl: "data:audio/mpeg;base64," } };
      }
    }
  };
}

beforeEach(() => {
  spoken = [];
  started = [];
  listeners = [];
  transcript = "carry on with the next scene";
  transcribeFails = false;
  voiceSpoken = [];
  speakersAvailable = false;
  startRefusal = null;
  speakFails = false;
  utteranceAutoEnd = true;
  pendingEnds = [];
  synthesisPauseCalls = 0;
  synthesisResumeCalls = 0;
  FakeAudio.instances = [];
  FakeRecorder.instances = [];
  (window as unknown as { studio: unknown }).studio = studio();
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
  // The device's own voice, recorded rather than played. It ends each utterance at once
  // unless a test holds the ending back, which is what makes pausing observable.
  (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class {
    lang = "en-US";
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speak: (utterance: { text: string; onend?: (() => void) | null }) => {
        spoken.push(utterance.text);
        if (utteranceAutoEnd) utterance.onend?.();
        else pendingEnds.push(() => utterance.onend?.());
      },
      cancel: () => {},
      pause: () => {
        synthesisPauseCalls += 1;
      },
      resume: () => {
        synthesisResumeCalls += 1;
      }
    },
    configurable: true
  });
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] })
    },
    configurable: true
  });
});

afterEach(() => {
  testing.cleanup();
  delete (window as { studio?: unknown }).studio;
  Object.assign(globalThis, realGlobals);
  // Only the test that replaced the room's voice puts it back; the other globals are restored
  // by value above, but the voice is saved at replacement time because it arrives after import.
  if (audioOverridden) {
    (globalThis as { Audio?: unknown }).Audio = nativeAudio;
    if ((window as { Audio?: unknown }).Audio === (FakeAudio as unknown))
      (window as { Audio?: unknown }).Audio = nativeAudio;
    audioOverridden = false;
  }
});

function render() {
  const onNotice = mock(() => {});
  const view = testing.render(
    React.createElement(AmbientPanel, {
      bookId: BOOK,
      chapterTitle: "The Light",
      chapterContent: "The storm came in low.",
      onNextChapter: () => {},
      onNotice
    })
  );
  return { view, onNotice };
}

describe("the status line", () => {
  test("says where the author is, in the studio's own words", async () => {
    const { view } = render();
    // The strip starts with a placeholder, because the status is a round trip.
    expect(view.getByTestId("ambient-line").textContent).toBe("Looking at your book…");
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("You're in Chapter One")
    );
  });

  test("offers the actions the status offers, and only the ones available", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    expect(view.getByTestId("ambient-action-read_aloud")).toBeDefined();
    expect(view.getByTestId("ambient-action-where_am_i")).toBeDefined();
  });
});

describe("the hands-free loop", () => {
  test("a spoken sentence reaches the agent, and what was heard is shown", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });

    await testing.waitFor(() => expect(started).toEqual([{ bookId: BOOK, mode: "edit", prompt: transcript }]));
    await testing.waitFor(() => expect(view.getByTestId("ambient-heard").textContent).toContain(transcript));
  });

  test("the microphone is a button, not a keyboard, and says whether it is live", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    const mic = view.getByTestId("ambient-mic");
    expect(mic.getAttribute("aria-label")).toBe("Speak to the agent");
    expect(mic.getAttribute("aria-pressed")).toBe("false");

    await testing.act(async () => {
      await testing.fireEvent.click(mic);
    });
    expect(view.getByTestId("ambient-mic").getAttribute("aria-pressed")).toBe("true");
    expect(view.getByTestId("ambient-dictation").textContent).toContain("Listening");
  });

  test("the answer to a spoken request is spoken back", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });
    await testing.waitFor(() => expect(started).toHaveLength(1));

    await testing.act(async () => {
      for (const listener of listeners) listener({ turnId, type: "text", delta: "The storm is quieter now." });
      for (const listener of listeners) listener({ turnId, type: "done" });
    });
    await testing.waitFor(() => expect(spoken).toEqual(["The storm is quieter now."]));
  });

  test("the answer is spoken as words, without its markup", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });
    await testing.waitFor(() => expect(started).toHaveLength(1));

    await testing.act(async () => {
      for (const listener of listeners) {
        listener({ turnId, type: "text", delta: "## Reply\n\n**The storm** is quieter, see [the chapter](x)." });
      }
      for (const listener of listeners) listener({ turnId, type: "done" });
    });
    await testing.waitFor(() => expect(spoken).toEqual(["Reply.\n\nThe storm is quieter, see the chapter."]));
  });

  test("the answer goes to the voice service once one is connected", async () => {
    // The status and the voice service both arrive after the first render. A handler that kept the
    // first render's voice would speak through the device although the service is there now.
    speakersAvailable = true;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });
    await testing.waitFor(() => expect(started).toHaveLength(1));

    await testing.act(async () => {
      for (const listener of listeners) listener({ turnId, type: "text", delta: "The storm is quieter now." });
      for (const listener of listeners) listener({ turnId, type: "done" });
    });
    await testing.waitFor(() => expect(voiceSpoken).toEqual(["The storm is quieter now."]));
    expect(spoken).toEqual([]);
  });

  test("a turn the agent refused to start is not spoken when a later turn finishes", async () => {
    // The microphone asked for a spoken answer, but no turn started. The next turn is a button press,
    // and its answer must stay on the screen.
    startRefusal = "The agent is not ready.";
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-note").textContent).toContain("The agent is not ready.")
    );

    startRefusal = null;
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-keep_going"));
    });
    await testing.waitFor(() => expect(started).toHaveLength(2));

    await testing.act(async () => {
      for (const listener of listeners) listener({ turnId, type: "text", delta: "Carrying on." });
      for (const listener of listeners) listener({ turnId, type: "done" });
    });
    await testing.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(spoken).toEqual([]);
    expect(voiceSpoken).toEqual([]);
  });

  test("a typed request is answered on the screen and not out loud", async () => {
    // Someone at a desk with a keyboard has not asked to be read to.
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.change(view.getByTestId("ambient-input"), { target: { value: "tighten the opening" } });
    });
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-send"));
    });
    await testing.waitFor(() => expect(started).toEqual([{ bookId: BOOK, mode: "edit", prompt: "tighten the opening" }]));

    await testing.act(async () => {
      for (const listener of listeners) listener({ turnId, type: "done" });
    });
    expect(spoken).toEqual([]);
  });

  test("a transcription that fails says why, and does not start a turn", async () => {
    transcribeFails = true;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-mic"));
    });
    await testing.act(async () => {
      FakeRecorder.instances.at(-1)?.stop();
    });

    await testing.waitFor(() => expect(view.getByTestId("ambient-note").textContent).toContain("The key was rejected."));
    // Nothing was asked, so nothing can have changed in the book.
    expect(started).toEqual([]);
  });
});

describe("reading the prose", () => {
  test("offers to read the chapter, and reads it when asked", async () => {
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() => expect(spoken[0] ?? "").toContain("The Light. The storm came in low."));
  });

  test("a refused voice service falls back to the device voice and says so", async () => {
    speakersAvailable = true;
    speakFails = true;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    // Wait for the voice listing so the read goes through the service first, not straight
    // to the device.
    await testing.waitFor(() => expect(view.getByTestId("ambient-voice")).toBeDefined());
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() => expect(spoken).toEqual(["The Light. The storm came in low."]));
    expect(voiceSpoken).toEqual(["The Light. The storm came in low."]);
    expect(view.getByTestId("ambient-fallback").textContent).toContain("studio's voice failed");
  });

  test("says where you are out loud, from the same status the line shows", async () => {
    const { view } = render();
    // The button is off until the status has arrived, which is what stops it saying nothing.
    await testing.waitFor(
      () => expect(view.getByTestId("ambient-where").hasAttribute("disabled")).toBe(false),
      { timeout: 3000 }
    );
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-where"));
    });
    await testing.waitFor(() => expect(spoken[0] ?? "").toContain("You're in Chapter One"));
  });

  test("holds the chapter being read and goes on when asked", async () => {
    // The utterance stays open so the panel has something to hold.
    utteranceAutoEnd = false;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() => expect(view.getByTestId("ambient-pause")).toBeDefined());
    expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Pause reading");

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-pause"));
    });
    expect(synthesisPauseCalls).toBe(1);
    expect(synthesisResumeCalls).toBe(0);
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Resume reading")
    );

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-pause"));
    });
    expect(synthesisResumeCalls).toBe(1);
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Pause reading")
    );

    await testing.act(async () => {
      for (const end of pendingEnds) end();
    });
    await testing.waitFor(() => expect(view.queryByTestId("ambient-pause")).toBeNull());
  });

  test("a fresh read starts unpaused after a held one", async () => {
    utteranceAutoEnd = false;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() => expect(view.getByTestId("ambient-pause")).toBeDefined());
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-pause"));
    });
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Resume reading")
    );

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Pause reading")
    );
    expect(synthesisPauseCalls).toBe(1);
  });

  test("holds and goes on with the voice service's reply the same way", async () => {
    speakersAvailable = true;
    nativeAudio = (globalThis as { Audio?: unknown }).Audio;
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    (window as { Audio?: unknown }).Audio = FakeAudio;
    audioOverridden = true;
    const { view } = render();
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-line").textContent).toContain("Chapter One")
    );
    await testing.fireEvent.click(view.getByTestId("ambient-toggle"));
    // Wait for the voice listing so the read goes through the service, not the device.
    await testing.waitFor(() => expect(view.getByTestId("ambient-voice")).toBeDefined());
    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-action-read_aloud"));
    });
    await testing.waitFor(() => expect(FakeAudio.instances.length).toBe(1));
    const reply = FakeAudio.instances[0] as FakeAudio;
    expect(reply.playedCount).toBe(1);
    await testing.waitFor(() => expect(view.getByTestId("ambient-pause")).toBeDefined());

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-pause"));
    });
    expect(reply.pausedCount).toBe(1);
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Resume reading")
    );

    await testing.act(async () => {
      await testing.fireEvent.click(view.getByTestId("ambient-pause"));
    });
    await testing.waitFor(() => expect(reply.playedCount).toBe(2));
    await testing.waitFor(() =>
      expect(view.getByTestId("ambient-pause").getAttribute("aria-label")).toBe("Pause reading")
    );

    await testing.act(async () => {
      reply.end();
    });
    await testing.waitFor(() => expect(view.queryByTestId("ambient-pause")).toBeNull());
  });
});
