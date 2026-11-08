import { describe, expect, test } from "bun:test";
import { ExitCoordinator } from "../src/main/exit-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("a quit that a window can still refuse", () => {
  test("the first quit asks and is held; the answer decides", async () => {
    const coordinator = new ExitCoordinator((run) => { run(); });
    const decision = deferred<"stay" | "leave">();
    let asked = 0;
    let quits = 0;
    const begin = () => coordinator.begin(() => { asked += 1; return decision.promise; }, () => { quits += 1; });

    expect(begin()).toBe(false);
    expect(begin()).toBe(false);
    await Promise.resolve();
    expect(asked).toBe(1);
    expect(quits).toBe(0);

    decision.resolve("stay");
    await decision.promise;
    await Promise.resolve();
    expect(coordinator.quitting).toBe(false);
    expect(quits).toBe(0);

    // Keeping the studio open does not latch anything: the next quit asks again.
    expect(begin()).toBe(false);
    expect(asked).toBe(2);
  });

  test("leave grants the quit, and a re-entered before-quit is allowed through", async () => {
    const coordinator = new ExitCoordinator((run) => { run(); });
    let quits = 0;
    expect(coordinator.begin(async () => "leave", () => { quits += 1; })).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coordinator.quitting).toBe(true);
    expect(quits).toBe(1);
    expect(coordinator.begin(async () => { throw new Error("must not ask again"); }, () => { quits += 1; })).toBe(true);
    expect(quits).toBe(1);
  });

  test("a refused unload clears the intent while nothing has been stopped", async () => {
    const coordinator = new ExitCoordinator((run) => { run(); });
    let asked = 0;
    coordinator.begin(async () => "leave", () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coordinator.quitting).toBe(true);

    coordinator.unloadPrevented();
    expect(coordinator.quitting).toBe(false);
    expect(coordinator.backendStopped).toBe(false);

    expect(coordinator.begin(async () => { asked += 1; return "stay"; }, () => {})).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toBe(1);
  });

  test("services stop only after every window has unloaded, and only once", async () => {
    const coordinator = new ExitCoordinator((run) => { run(); });
    let stops = 0;
    let quits = 0;
    const stop = deferred<void>();

    expect(coordinator.finish(() => { stops += 1; return stop.promise; }, () => { quits += 1; })).toBe(false);
    // Services are already stopping, so a re-entered will-quit is not blocked a second time.
    expect(coordinator.finish(() => { stops += 1; return Promise.resolve(); }, () => { quits += 1; })).toBe(true);
    expect(stops).toBe(1);
    expect(quits).toBe(0);
    expect(coordinator.backendStopped).toBe(true);

    stop.resolve();
    await stop.promise;
    await Promise.resolve();
    expect(quits).toBe(1);
    expect(coordinator.finish(() => { stops += 1; return Promise.resolve(); }, () => { quits += 1; })).toBe(true);
    expect(stops).toBe(1);
  });

  test("the re-quit is deferred so Electron does not drop it", async () => {
    const deferred: Array<() => void> = [];
    const coordinator = new ExitCoordinator((run) => { deferred.push(run); });
    let quits = 0;
    let stops = 0;
    expect(coordinator.finish(async () => { stops += 1; }, () => { quits += 1; })).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The service stopped, but no quit may be requested inside the will-quit turn.
    expect(stops).toBe(1);
    expect(quits).toBe(0);
    expect(deferred).toHaveLength(1);
    deferred[0]?.();
    expect(quits).toBe(1);
  });

  test("a failing service stop still lets the quit finish", async () => {
    const coordinator = new ExitCoordinator((run) => { run(); });
    let quits = 0;
    expect(coordinator.finish(async () => { throw new Error("backend is gone"); }, () => { quits += 1; })).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(quits).toBe(1);
    expect(coordinator.finish(async () => {}, () => { quits += 1; })).toBe(true);
  });
});
