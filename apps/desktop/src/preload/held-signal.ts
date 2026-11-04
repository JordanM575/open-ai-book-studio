/**
 * A signal from the main process that waits for the page to listen.
 *
 * The studio can report a refused second copy, or the conversation a reopened window should show,
 * into a window it created a moment ago, while the page is still starting and nothing has
 * subscribed yet. With no listener the newest signal is held, once, and the next subscriber hears
 * it straight away; with listeners it reaches each of them.
 */
export interface HeldSignal<T = void> {
  emit(value: T): void;
  /** Returns an unsubscribe. */
  subscribe(listener: (value: T) => void): () => void;
}

export function createHeldSignal<T = void>(): HeldSignal<T> {
  const listeners = new Set<(value: T) => void>();
  let held: { value: T } | null = null;
  return {
    emit(value) {
      if (listeners.size === 0) {
        held = { value };
        return;
      }
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      const entry = (value: T): void => listener(value);
      listeners.add(entry);
      if (held) {
        const { value } = held;
        held = null;
        entry(value);
      }
      return () => {
        listeners.delete(entry);
      };
    }
  };
}
