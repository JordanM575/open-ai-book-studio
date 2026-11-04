/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeldSignal } from "../src/preload/held-signal";

/** The preload's hold for a refused second copy reported before the shell subscribes (002 FR-069). */
describe("createHeldSignal", () => {
  test("a signal with no listener waits for the first subscriber", () => {
    const signal = createHeldSignal();
    signal.emit();
    let heard = 0;
    signal.subscribe(() => {
      heard += 1;
    });
    expect(heard).toBe(1);
  });

  test("a held signal is heard once, however many times it was sent", () => {
    const signal = createHeldSignal();
    signal.emit();
    signal.emit();
    let first = 0;
    let second = 0;
    signal.subscribe(() => {
      first += 1;
    });
    signal.subscribe(() => {
      second += 1;
    });
    expect([first, second]).toEqual([1, 0]);
  });

  test("subscribers hear each later signal, and an unsubscribed one hears nothing more", () => {
    const signal = createHeldSignal();
    const heard: string[] = [];
    const stopA = signal.subscribe(() => heard.push("a"));
    signal.subscribe(() => heard.push("b"));
    signal.emit();
    stopA();
    signal.emit();
    expect(heard).toEqual(["a", "b", "b"]);
  });

  test("after everyone unsubscribes, the next signal is held again", () => {
    const signal = createHeldSignal();
    const stop = signal.subscribe(() => {});
    stop();
    signal.emit();
    let heard = 0;
    signal.subscribe(() => {
      heard += 1;
    });
    expect(heard).toBe(1);
  });
});
