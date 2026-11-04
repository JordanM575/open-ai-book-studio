/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import React from "react";
import { mountDom, unmountDom } from "./support/dom";

/**
 * The shadcn/ui and AI Elements parts the writing agent's chat is built from (D-185), rendered on
 * their own: what the author sees in each state, and what each control does when it is used.
 */

let testing!: typeof import("@testing-library/react/pure");
let tool!: typeof import("@ai-book-studio/ui/ai-elements/tool");
let checkpoint!: typeof import("@ai-book-studio/ui/ai-elements/checkpoint");
let confirmation!: typeof import("@ai-book-studio/ui/ai-elements/confirmation");
let context!: typeof import("@ai-book-studio/ui/ai-elements/context");
let prompt!: typeof import("@ai-book-studio/ui/ai-elements/prompt-input");
let conversation!: typeof import("@ai-book-studio/ui/ai-elements/conversation");
let scroller!: typeof import("@ai-book-studio/ui/components/message-scroller");
let Badge!: typeof import("@ai-book-studio/ui/components/badge").Badge;
let select!: typeof import("@ai-book-studio/ui/components/native-select");
let Switch!: typeof import("@ai-book-studio/ui/components/switch").Switch;

beforeAll(async () => {
  testing = await mountDom();
  tool = await import("@ai-book-studio/ui/ai-elements/tool");
  checkpoint = await import("@ai-book-studio/ui/ai-elements/checkpoint");
  confirmation = await import("@ai-book-studio/ui/ai-elements/confirmation");
  context = await import("@ai-book-studio/ui/ai-elements/context");
  prompt = await import("@ai-book-studio/ui/ai-elements/prompt-input");
  conversation = await import("@ai-book-studio/ui/ai-elements/conversation");
  scroller = await import("@ai-book-studio/ui/components/message-scroller");
  ({ Badge } = await import("@ai-book-studio/ui/components/badge"));
  select = await import("@ai-book-studio/ui/components/native-select");
  ({ Switch } = await import("@ai-book-studio/ui/components/switch"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

function traceLine(element: HTMLElement): Element | null {
  return element.closest('[data-slot="trace-line"]');
}

describe("tool lines", () => {
  test("a tool reads as one line while it runs, once it is done, and when it fails", () => {
    const { Tools, ToolLine } = tool;
    const view = testing.render(
      React.createElement(
        Tools,
        null,
        React.createElement(ToolLine, { title: "Read a chapter", status: "running" }),
        React.createElement(ToolLine, {
          title: "Counted the words",
          status: "done",
          icon: React.createElement("span", { "data-testid": "tool-dot" })
        }),
        React.createElement(ToolLine, { title: "Edited a chapter", status: "error" })
      )
    );
    expect(traceLine(view.getByText("Read a chapter"))?.getAttribute("data-status")).toBe("running");
    expect(traceLine(view.getByText("Counted the words"))?.hasAttribute("data-status")).toBe(false);
    expect(traceLine(view.getByText("Edited a chapter"))?.getAttribute("data-status")).toBe("error");
    // The dot only decorates; the words carry the state.
    expect(view.getByTestId("tool-dot").parentElement?.getAttribute("aria-hidden")).toBe("true");
    // A line with nothing to open is not a control.
    expect(view.queryByRole("button")).toBeNull();
  });

  test("a tool with detail opens in place to show it, and closes again", async () => {
    const { Tools, Tool, ToolHeader, ToolContent, ToolOutput } = tool;
    const view = testing.render(
      React.createElement(
        Tools,
        null,
        React.createElement(
          Tool,
          null,
          React.createElement(ToolHeader, { title: "Edited a chapter", status: "done" }),
          React.createElement(ToolContent, null, React.createElement(ToolOutput, null, 'Input:\n{ "find": "rain" }'))
        ),
        React.createElement(
          Tool,
          null,
          React.createElement(ToolHeader, { title: "Searched the book", status: "error" }),
          React.createElement(ToolContent, null, React.createElement(ToolOutput, null, "The tool failed."))
        )
      )
    );
    const edited = view.getByRole("button", { name: "Edited a chapter" });
    expect(edited.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByText(/"find": "rain"/)).toBeNull();

    await testing.act(async () => {
      testing.fireEvent.click(edited);
    });
    expect(edited.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText(/"find": "rain"/)).toBeDefined();

    await testing.act(async () => {
      testing.fireEvent.click(edited);
    });
    expect(edited.getAttribute("aria-expanded")).toBe("false");

    // A failed tool still opens, and its line reads as an error.
    const failed = view.getByRole("button", { name: "Searched the book" });
    expect(failed.querySelector('[data-status="error"]')).not.toBeNull();
    await testing.act(async () => {
      testing.fireEvent.click(failed);
    });
    expect(view.getByText("The tool failed.")).toBeDefined();
  });
});

describe("turn controls", () => {
  test("the checkpoint undoes its turn and names the action on focus when it has a hint", async () => {
    const { Checkpoint, CheckpointIcon, CheckpointTrigger } = checkpoint;
    const onUndo = mock(() => {});
    const view = testing.render(
      React.createElement(
        Checkpoint,
        null,
        React.createElement(CheckpointIcon, null, React.createElement("svg", { "data-testid": "checkpoint-icon" })),
        React.createElement(
          CheckpointTrigger,
          { onClick: onUndo, tooltip: "Restores the chapters this turn changed" },
          "Undo this turn"
        )
      )
    );
    expect(view.getByTestId("checkpoint-icon").parentElement?.getAttribute("aria-hidden")).toBe("true");
    const undo = view.getByRole("button", { name: "Undo this turn" });
    await testing.act(async () => {
      undo.focus();
    });
    const hint = await testing.waitFor(() => testing.within(document.body).getByRole("tooltip"));
    expect(hint.textContent).toBe("Restores the chapters this turn changed");
    testing.fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  test("a confirmation offers Allow and Deny only while it waits", () => {
    const { Confirmation, ConfirmationTitle, ConfirmationRequest, ConfirmationActions, ConfirmationAction } = confirmation;
    const allow = mock(() => {});
    const gate = (state: "pending" | "approved") =>
      React.createElement(
        Confirmation,
        { state },
        React.createElement(
          ConfirmationTitle,
          { description: state === "pending" ? "The agent will wait for your answer before changing anything." : "Allowed" },
          "Replace a chapter's text?"
        ),
        React.createElement(
          ConfirmationRequest,
          null,
          React.createElement(
            ConfirmationActions,
            null,
            React.createElement(ConfirmationAction, { onClick: allow }, "Allow"),
            React.createElement(ConfirmationAction, { variant: "outline" }, "Deny")
          )
        )
      );
    const view = testing.render(gate("pending"));
    const card = () => view.getByText("Replace a chapter's text?").closest('[data-slot="confirmation"]');
    expect(card()?.getAttribute("data-state")).toBe("pending");
    expect(view.getByText("The agent will wait for your answer before changing anything.")).toBeDefined();
    testing.fireEvent.click(view.getByRole("button", { name: "Allow" }));
    expect(allow).toHaveBeenCalledTimes(1);

    view.rerender(gate("approved"));
    expect(card()?.getAttribute("data-state")).toBe("approved");
    expect(view.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(view.queryByRole("button", { name: "Deny" })).toBeNull();
    expect(view.getByText("Replace a chapter's text?")).toBeDefined();
    expect(view.getByText("Allowed")).toBeDefined();
  });
});

describe("context card", () => {
  function card(maxTokens?: number) {
    const { Context, ContextTrigger, ContextContent, ContextContentHeader, ContextContentBody, ContextContentFooter } = context;
    return testing.render(
      React.createElement(
        Context,
        { usedTokens: 250, maxTokens },
        React.createElement(ContextTrigger, null),
        React.createElement(
          ContextContent,
          null,
          React.createElement(ContextContentHeader, null),
          React.createElement(ContextContentBody, null, "Chapters ~200"),
          React.createElement(ContextContentFooter, null, "Estimated from characters.")
        )
      )
    );
  }

  test("names the share of the window and opens and closes on a tap", async () => {
    const view = card(1000);
    const trigger = view.getByRole("button", { name: "25% context" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await testing.act(async () => {
      testing.fireEvent.pointerDown(trigger, { pointerType: "touch" });
      testing.fireEvent.click(trigger);
    });
    const body = testing.within(document.body);
    const share = await testing.waitFor(() => body.getByRole("progressbar", { name: "Context used" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(share.getAttribute("aria-valuenow")).toBe("25");
    expect(body.getByText("250 / 1,000")).toBeDefined();
    expect(body.getByText("Chapters ~200")).toBeDefined();
    expect(body.getByText("Estimated from characters.")).toBeDefined();

    await testing.act(async () => {
      testing.fireEvent.pointerDown(trigger, { pointerType: "touch" });
      testing.fireEvent.click(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("a mouse click keeps the card its hover opened", async () => {
    const view = card(1000);
    const trigger = view.getByRole("button", { name: "25% context" });
    for (let click = 0; click < 2; click += 1) {
      await testing.act(async () => {
        testing.fireEvent.pointerDown(trigger, { pointerType: "mouse" });
        testing.fireEvent.click(trigger);
      });
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    }
  });

  test("without the model's window it counts tokens and draws no bar", async () => {
    const view = card();
    const trigger = view.getByRole("button", { name: "Context" });
    await testing.act(async () => {
      testing.fireEvent.click(trigger);
    });
    const body = testing.within(document.body);
    await testing.waitFor(() => expect(body.getByText("250")).toBeDefined());
    expect(body.queryByRole("progressbar")).toBeNull();
  });
});

describe("prompt input", () => {
  function composer(
    field: Partial<React.ComponentProps<"textarea">> = {},
    submit: Partial<import("@ai-book-studio/ui/ai-elements/prompt-input").PromptInputSubmitProps> = {}
  ) {
    const { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputTools, PromptInputSubmit } = prompt;
    const onSubmit = mock((event: React.FormEvent) => event.preventDefault());
    const view = testing.render(
      React.createElement(
        PromptInput,
        { onSubmit },
        React.createElement(PromptInputTextarea, { "aria-label": "Message the writing agent", ...field }),
        React.createElement(
          PromptInputFooter,
          null,
          React.createElement(PromptInputTools, null, "Model: book default"),
          React.createElement(PromptInputSubmit, submit)
        )
      )
    );
    const input = view.getByRole("textbox", { name: "Message the writing agent" }) as HTMLTextAreaElement;
    return { view, input, onSubmit };
  }

  test("Enter sends; Shift Enter and a keyboard still composing do not", () => {
    const { input, onSubmit } = composer();
    testing.fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    testing.fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    testing.fireEvent.keyDown(input, { key: "a" });
    expect(onSubmit).not.toHaveBeenCalled();
    testing.fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("Enter still sends where the form has no requestSubmit", () => {
    const { input, onSubmit } = composer();
    Object.defineProperty(input.form, "requestSubmit", { configurable: true, value: undefined });
    testing.fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("the field's own key handler can keep Enter from sending", () => {
    const { input, onSubmit } = composer({ onKeyDown: (event) => event.preventDefault() });
    testing.fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Enter in a field outside a form has nothing to send and does nothing", () => {
    const view = testing.render(React.createElement(prompt.PromptInputTextarea, { "aria-label": "Loose field" }));
    const input = view.getByRole("textbox", { name: "Loose field" });
    testing.fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  test("Send submits, and a click on the footer puts the cursor back in the field", () => {
    const { view, input, onSubmit } = composer();
    const send = view.getByRole("button", { name: "Send" });
    expect(send.getAttribute("type")).toBe("submit");
    testing.fireEvent.click(view.getByText("Model: book default"));
    expect(document.activeElement).toBe(input);
    testing.fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("while a reply streams the button is Stop, and it stops rather than sends", () => {
    const onStop = mock(() => {});
    const { view, onSubmit } = composer({}, { status: "streaming", onStop });
    const stop = view.getByRole("button", { name: "Stop" });
    expect(stop.getAttribute("type")).toBe("button");
    testing.fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a click handler of the caller's own can keep Stop from stopping", () => {
    const onStop = mock(() => {});
    const { view } = composer({}, { status: "streaming", onStop, onClick: (event) => event.preventDefault() });
    testing.fireEvent.click(view.getByRole("button", { name: "Stop" }));
    expect(onStop).not.toHaveBeenCalled();
  });
});

/** A ResizeObserver the test drives: happy-dom lays nothing out, so nothing would ever resize. */
class TestResizeObserver {
  static last: TestResizeObserver | null = null;
  constructor(private readonly callback: () => void) {
    TestResizeObserver.last = this;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  resize(): void {
    this.callback();
  }
}

/** Gives the viewport a size and a scroll position that clamps, as a browser's does. */
function layout(element: HTMLElement, size: { scrollHeight: number; clientHeight: number }) {
  let top = 0;
  const calls: ScrollToOptions[] = [];
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => size.scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => size.clientHeight });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, size.scrollHeight - size.clientHeight));
    }
  });
  Object.defineProperty(element, "scrollTo", {
    configurable: true,
    value: (options: ScrollToOptions) => {
      calls.push(options);
      element.scrollTop = options.top ?? 0;
    }
  });
  return { size, calls };
}

/** Shows the message of an error its children throw while rendering. */
class ErrorMessage extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  override render() {
    return this.state.message ?? this.props.children;
  }
}

describe("conversation", () => {
  // Read once the DOM is registered: happy-dom provides the ResizeObserver these tests swap out.
  let realObserver: typeof ResizeObserver;
  beforeEach(() => {
    realObserver = globalThis.ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = realObserver;
  });

  function transcript(turns: string[]) {
    const { Conversation, ConversationContent, ConversationItem, ConversationScrollButton } = conversation;
    return React.createElement(
      Conversation,
      null,
      React.createElement(
        ConversationContent,
        null,
        turns.map((turn, index) =>
          React.createElement(ConversationItem, { key: turn, messageId: `m${index}`, scrollAnchor: index % 2 === 0 }, turn)
        )
      ),
      React.createElement(ConversationScrollButton, null)
    );
  }

  test("an empty conversation says what the agent can do", () => {
    const view = testing.render(
      React.createElement(
        conversation.ConversationEmptyState,
        { title: "Start a conversation", description: "Ask for a scene or a tighter paragraph." },
        React.createElement("button", { type: "button" }, "Draft the next scene")
      )
    );
    expect(view.getByText("Start a conversation")).toBeDefined();
    expect(view.getByText("Ask for a scene or a tighter paragraph.")).toBeDefined();
    expect(view.getByRole("button", { name: "Draft the next scene" })).toBeDefined();
  });

  test("follows a reply at the end, keeps the author's place above it, and offers the way back", async () => {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const view = testing.render(transcript(["Write the storm.", "The storm broke."]));
    const viewport = view.getByRole("region", { name: "Messages" });
    expect(viewport.tabIndex).toBe(0);
    expect(view.getByRole("log").getAttribute("aria-relevant")).toBe("additions");
    const jump = view.container.querySelector('[data-slot="message-scroller-button"]') as HTMLElement;
    expect(jump.getAttribute("data-active")).toBe("false");
    expect(jump.hasAttribute("inert")).toBe(true);
    expect(jump.textContent).toBe("Scroll to end");

    const { size, calls } = layout(viewport, { scrollHeight: 1000, clientHeight: 400 });
    const scroll = async (top?: number) => {
      await testing.act(async () => {
        if (top !== undefined) viewport.scrollTop = top;
        testing.fireEvent.scroll(viewport);
      });
    };
    const grow = async (scrollHeight: number) => {
      size.scrollHeight = scrollHeight;
      await testing.act(async () => {
        TestResizeObserver.last?.resize();
      });
    };

    // The reply grows while the author is at the end, so the end stays in view.
    await grow(1000);
    expect(viewport.scrollTop).toBe(600);
    await scroll();
    expect(jump.getAttribute("data-active")).toBe("false");

    // The author scrolls up to reread; more reply arrives and their place holds.
    await scroll(200);
    expect(jump.getAttribute("data-active")).toBe("true");
    expect(jump.hasAttribute("inert")).toBe(false);
    await grow(1600);
    expect(viewport.scrollTop).toBe(200);

    // Scrolling down without reaching the end keeps their choice.
    await scroll(400);
    await grow(1700);
    expect(viewport.scrollTop).toBe(400);

    // The button returns to the end, and the reply is followed again.
    await testing.act(async () => {
      testing.fireEvent.click(jump);
    });
    expect(calls.at(-1)).toEqual({ top: 1700, behavior: "smooth" });
    expect(viewport.scrollTop).toBe(1300);
    await scroll();
    expect(jump.getAttribute("data-active")).toBe("false");
    await grow(1800);
    expect(viewport.scrollTop).toBe(1400);

    // A new message from the author brings the end back, wherever they had scrolled.
    await scroll(100);
    view.rerender(transcript(["Write the storm.", "The storm broke.", "Now the harbour."]));
    await grow(2000);
    expect(viewport.scrollTop).toBe(1600);
  });

  test("returns to the end without smooth scrolling when motion is reduced", async () => {
    const matchMedia = spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList
    );
    try {
      const view = testing.render(transcript(["Write the storm."]));
      const viewport = view.getByRole("region", { name: "Messages" });
      const { calls } = layout(viewport, { scrollHeight: 900, clientHeight: 300 });
      await testing.act(async () => {
        viewport.scrollTop = 0;
        testing.fireEvent.scroll(viewport);
      });
      const jump = view.container.querySelector('[data-slot="message-scroller-button"]') as HTMLElement;
      await testing.act(async () => {
        testing.fireEvent.click(jump);
      });
      expect(calls.at(-1)).toEqual({ top: 900, behavior: "auto" });
    } finally {
      matchMedia.mockRestore();
    }
  });

  test("a caller's click handler can keep the button from scrolling", async () => {
    const { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerButton } =
      scroller;
    const view = testing.render(
      React.createElement(
        MessageScrollerProvider,
        null,
        React.createElement(
          MessageScroller,
          null,
          React.createElement(MessageScrollerViewport, null, React.createElement(MessageScrollerContent, null, "Turn")),
          React.createElement(MessageScrollerButton, { onClick: (event) => event.preventDefault() }, "Latest")
        )
      )
    );
    const viewport = view.getByRole("region", { name: "Messages" });
    const { calls } = layout(viewport, { scrollHeight: 900, clientHeight: 300 });
    await testing.act(async () => {
      testing.fireEvent.scroll(viewport);
    });
    await testing.act(async () => {
      testing.fireEvent.click(view.getByRole("button", { name: "Latest" }));
    });
    expect(calls).toHaveLength(0);
  });

  test("works where the platform has no ResizeObserver", () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    const view = testing.render(transcript(["Write the storm."]));
    expect(view.getByText("Write the storm.")).toBeDefined();
  });

  test("a scroller part outside its provider says what is missing", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = testing.render(
        React.createElement(ErrorMessage, null, React.createElement(scroller.MessageScrollerItem, null))
      );
      expect(view.getByText("Message Scroller parts must sit inside MessageScrollerProvider")).toBeDefined();
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("form controls", () => {
  test("a badge is a quiet chip, and can dress a link", () => {
    const view = testing.render(
      React.createElement(
        "div",
        null,
        React.createElement(Badge, null, "Browser access"),
        React.createElement(Badge, { asChild: true }, React.createElement("a", { href: "#licenses" }, "Licenses"))
      )
    );
    const chip = view.getByText("Browser access");
    expect(chip.getAttribute("data-slot")).toBe("badge");
    expect(chip.getAttribute("data-variant")).toBe("muted");
    expect(view.getByRole("link", { name: "Licenses" }).getAttribute("data-slot")).toBe("badge");
  });

  test("a native select stays the platform's select and reports the choice", () => {
    const { NativeSelect, NativeSelectOption } = select;
    const onChange = mock((event: React.ChangeEvent<HTMLSelectElement>) => event.target.value);
    const view = testing.render(
      React.createElement(
        NativeSelect,
        { "aria-label": "Body font", value: "Georgia", onChange, size: "sm" },
        React.createElement(NativeSelectOption, { value: "Georgia" }, "Georgia"),
        React.createElement(NativeSelectOption, { value: "Garamond" }, "Garamond")
      )
    );
    const field = view.getByRole("combobox", { name: "Body font" }) as HTMLSelectElement;
    expect(field.tagName).toBe("SELECT");
    expect(field.getAttribute("data-size")).toBe("sm");
    expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual(["Georgia", "Garamond"]);
    testing.fireEvent.change(field, { target: { value: "Garamond" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]?.value).toBe("Garamond");
  });

  test("a switch turns a tool off and says so", () => {
    const onCheckedChange = mock((_checked: boolean) => {});
    const view = testing.render(
      React.createElement(Switch, { "aria-label": "Read chapters", defaultChecked: true, onCheckedChange })
    );
    const control = view.getByRole("switch", { name: "Read chapters" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    testing.fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  test("a disabled switch stays where it is", () => {
    const onCheckedChange = mock((_checked: boolean) => {});
    const view = testing.render(
      React.createElement(Switch, { "aria-label": "Search the book", disabled: true, onCheckedChange })
    );
    const control = view.getByRole("switch", { name: "Search the book" });
    testing.fireEvent.click(control);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
