import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import type { AgentOutcome } from "../src/main/agent/runtime";
import { mockElectron } from "./support/mock-electron";

/*
 * The notifier against the shared Electron mock. The mock never shows a notification, so the
 * desktop path is seen as the notifier asking whether it may post one; a hidden run must not even
 * ask. Both spies are restored after every test, because the mocked module is shared by every file.
 */
mockElectron(tmpdir());

const electron = await import("electron");
const { BackgroundNotifier } = await import("../src/main/background");

const finished: AgentOutcome = {
  kind: "done",
  turnId: "turn_1",
  bookId: "book_1",
  bookTitle: "The Salt Road",
  threadId: "thread_1",
  background: false,
  text: "The chapter is ready.",
  changed: 1
};

let logged: ReturnType<typeof spyOn<Console, "log">>;
let asked: ReturnType<typeof spyOn<typeof electron.Notification, "isSupported">>;

beforeEach(() => {
  logged = spyOn(console, "log").mockImplementation(() => {});
  asked = spyOn(electron.Notification, "isSupported");
});

afterEach(() => {
  logged.mockRestore();
  asked.mockRestore();
});

describe("background notifier", () => {
  test("a hidden run logs what it would have posted and never asks the desktop", () => {
    new BackgroundNotifier(() => null, () => {}, true).handle(finished);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      '[notification] would post {"title":"The Salt Road — ready","body":"The chapter is ready."}'
    );
    expect(asked).not.toHaveBeenCalled();
  });

  test("a visible run goes to the desktop and logs nothing", () => {
    new BackgroundNotifier(() => null, () => {}, false).handle(finished);

    expect(asked).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
  });

  test("a stopped turn stays silent either way", () => {
    for (const headless of [true, false]) {
      new BackgroundNotifier(() => null, () => {}, headless).handle({ ...finished, kind: "stopped" });
    }

    expect(logged).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
  });
});
