import type { ComponentProps, KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "#components/input-group";
import { cn } from "#lib/utils";

/*
 * AI Elements Prompt Input (D-185), on shadcn/ui's Input Group: the composer. The field is solid,
 * like the manuscript, because the author reads what they type there.
 */
export function PromptInput({
  className,
  groupClassName,
  children,
  ...props
}: ComponentProps<"form"> & { groupClassName?: string }) {
  return (
    <form data-slot="prompt-input" className={cn("w-full", className)} {...props}>
      <InputGroup className={cn("bg-[var(--card)] dark:bg-[var(--card)]", groupClassName)}>{children}</InputGroup>
    </form>
  );
}

/** Submit the field's form on Enter; Shift Enter keeps the newline. Composition input is left alone. */
export function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  const form = event.currentTarget.form;
  if (!form) return;
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** The field keeps the height its rows give it, as the studio's composer always has; it scrolls past that. */
export function PromptInputTextarea({ className, onKeyDown, ...props }: ComponentProps<"textarea">) {
  return (
    <InputGroupTextarea
      className={cn(
        "field-sizing-fixed px-3 py-2 text-[var(--text-body-size)] leading-[var(--text-body-leading)] placeholder:text-muted-foreground",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) submitOnEnter(event);
      }}
      {...props}
    />
  );
}

/** The row under the field: per-turn options on one side, Send or Stop on the other. */
export function PromptInputFooter({ className, ...props }: ComponentProps<typeof InputGroupAddon>) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn("cursor-default justify-between gap-2 font-normal", className)}
      {...props}
    />
  );
}

export function PromptInputTools({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="prompt-input-tools" className={cn("flex min-w-0 items-center gap-2", className)} {...props} />;
}

export type PromptInputSubmitProps = Omit<ComponentProps<typeof InputGroupButton>, "type" | "size"> & {
  /** "streaming" turns the button into Stop, which calls onStop instead of submitting. */
  status?: "ready" | "streaming";
  onStop?: () => void;
};

export function PromptInputSubmit({
  status = "ready",
  onStop,
  onClick,
  className,
  children,
  ...props
}: PromptInputSubmitProps) {
  const streaming = status === "streaming";
  return (
    <InputGroupButton
      type={streaming ? "button" : "submit"}
      size="sm"
      variant={streaming ? "secondary" : "primary"}
      className={cn("shrink-0", className)}
      onClick={(event) => {
        onClick?.(event);
        if (streaming && !event.defaultPrevented) onStop?.();
      }}
      {...props}
    >
      {children ??
        (streaming ? (
          <>
            <Square size={13} />
            Stop
          </>
        ) : (
          <>
            <Send size={14} />
            Send
          </>
        ))}
    </InputGroupButton>
  );
}
