/**
 * The window's side of a flush before a close or quit.
 *
 * The main process asks; every handler the page registered (the open editor) saves its newest text;
 * then the request is answered. It is answered whatever the handlers do, and with none registered,
 * so a quit from the library view never waits out the main process's timeout.
 */
export interface FlushRequests {
  /** Returns an unsubscribe. */
  subscribe(handler: () => Promise<unknown>): () => void;
  /** Run every handler, then answer `requestId`. */
  handle(requestId: string): Promise<void>;
}

export function createFlushRequests(answer: (requestId: string) => void): FlushRequests {
  const handlers = new Set<() => Promise<unknown>>();
  return {
    subscribe(handler) {
      const entry = (): Promise<unknown> => handler();
      handlers.add(entry);
      return () => {
        handlers.delete(entry);
      };
    },
    async handle(requestId) {
      await Promise.allSettled([...handlers].map((handler) => Promise.resolve().then(handler)));
      answer(requestId);
    }
  };
}
