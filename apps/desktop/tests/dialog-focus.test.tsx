/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let ui!: typeof import("@ai-book-studio/ui/dialog");

beforeAll(async () => {
  testing = await mountDom();
  ui = await import("@ai-book-studio/ui/dialog");
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/*
 * The studio opens its dialogs from plain buttons, not from a DialogTrigger, so Radix has nothing to
 * hand focus back to. Closing a dialog must put the keyboard back on the control that opened it,
 * rather than dropping it on the page where the next Tab starts from the top.
 */
function Opener() {
  const [open, setOpen] = useState(false);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "Open the Story Bible"),
    React.createElement(
      ui.Dialog,
      { open, onOpenChange: setOpen },
      open ? React.createElement(ui.DialogContent, { title: "Story Bible" }, React.createElement("p", null, "Cast and memories.")) : null
    )
  );
}

/** The workspace's shape: the dialog stays mounted while closed, and only `open` changes. */
function MountedOpener() {
  const [open, setOpen] = useState(false);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("button", { type: "button" }, "Somewhere else"),
    React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "Open Settings"),
    React.createElement(
      ui.Dialog,
      { open, onOpenChange: setOpen },
      React.createElement(ui.DialogContent, { title: "Settings" }, React.createElement("p", null, "Appearance."))
    )
  );
}

describe("dialog focus", () => {
  test("a dialog that stays mounted while closed still returns focus to the button that opened it", async () => {
    const view = testing.within(document.body);
    testing.render(React.createElement(MountedOpener));
    // Focus was elsewhere when the dialog first rendered, so the opener must be read on opening.
    view.getByRole("button", { name: "Somewhere else" }).focus();
    const opener = view.getByRole("button", { name: "Open Settings" });
    opener.focus();
    testing.fireEvent.click(opener);
    await testing.waitFor(() => expect(view.getByRole("dialog")).toBeDefined());

    testing.fireEvent.click(view.getByRole("button", { name: "Close" }));
    await testing.waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await testing.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test("closing a dialog returns focus to the button that opened it", async () => {
    const view = testing.within(document.body);
    testing.render(React.createElement(Opener));
    const opener = view.getByRole("button", { name: "Open the Story Bible" });
    opener.focus();
    testing.fireEvent.click(opener);
    await testing.waitFor(() => expect(view.getByRole("dialog")).toBeDefined());

    testing.fireEvent.click(view.getByRole("button", { name: "Close" }));
    await testing.waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await testing.waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
