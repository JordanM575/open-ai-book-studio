/**
 * A signal from the main process that waits for the page to listen.
 *
 * The studio can report a refused second copy into a window it created a moment ago, while the page
 * is still starting and nothing has subscribed yet. With no listener the signal is held, once, and
 * the next subscriber hears it straight away; with listeners it reaches each of them.
 */
export interface HeldSignal {
  emit(): void;
  /** Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createHeldSignal(): HeldSignal {
  const listeners = new Set<() => void>();
  let held = false;
  return {
    emit() {
      if (listeners.size === 0) {
        held = true;
        return;
      }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      const entry = (): void => listener();
      listeners.add(entry);
      if (held) {
        held = false;
        entry();
      }
      return () => {
        listeners.delete(entry);
      };
    }
  };
}
