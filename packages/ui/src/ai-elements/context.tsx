import { createContext, useContext, useRef, useState, type ComponentProps } from "react";
import { Button } from "#components/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "#components/hover-card";
import { Progress } from "#components/progress";
import { cn } from "#lib/utils";

/*
 * AI Elements Context (D-185), on shadcn/ui's Hover Card and Progress: how much of the model's
 * window a turn used. A touch screen has no hover, so a tap opens and closes the card as well.
 */
interface ContextValue {
  usedTokens: number;
  maxTokens: number | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ContextState = createContext<ContextValue>({
  usedTokens: 0,
  maxTokens: undefined,
  open: false,
  setOpen: () => {}
});

/** The share of the window in whole percent, or undefined when the window size is unknown. */
export function contextPercent(usedTokens: number, maxTokens: number | undefined): number | undefined {
  if (!maxTokens || maxTokens <= 0) return undefined;
  return Math.min(100, Math.round((usedTokens / maxTokens) * 100));
}

export type ContextProps = Omit<ComponentProps<typeof HoverCard>, "open" | "onOpenChange"> & {
  usedTokens: number;
  maxTokens?: number | undefined;
};

export function Context({ usedTokens, maxTokens, openDelay = 200, closeDelay = 150, ...props }: ContextProps) {
  const [open, setOpen] = useState(false);
  return (
    <ContextState.Provider value={{ usedTokens, maxTokens, open, setOpen }}>
      <HoverCard open={open} onOpenChange={setOpen} openDelay={openDelay} closeDelay={closeDelay} {...props} />
    </ContextState.Provider>
  );
}

export function ContextTrigger({ children, onClick, onPointerDown, ...props }: ComponentProps<typeof Button>) {
  const { usedTokens, maxTokens, open, setOpen } = useContext(ContextState);
  const pointer = useRef("");
  const percent = contextPercent(usedTokens, maxTokens);
  return (
    <HoverCardTrigger asChild>
      <Button
        variant="ghost"
        size="xs"
        aria-expanded={open}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
          onPointerDown?.(event);
        }}
        onClick={(event) => {
          onClick?.(event);
          // A mouse already opened the card on hover; a tap, a pen or the keyboard toggles it.
          setOpen(pointer.current === "mouse" ? true : !open);
          pointer.current = "";
        }}
        {...props}
      >
        {children ?? (percent === undefined ? "Context" : `${percent}% context`)}
      </Button>
    </HoverCardTrigger>
  );
}

export function ContextContent({ className, ...props }: ComponentProps<typeof HoverCardContent>) {
  return <HoverCardContent className={cn("flex w-64 flex-col gap-3", className)} {...props} />;
}

export function ContextContentHeader({ className, children, ...props }: ComponentProps<"div">) {
  const { usedTokens, maxTokens } = useContext(ContextState);
  const percent = contextPercent(usedTokens, maxTokens);
  return (
    <div data-slot="context-header" className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{children ?? "Context"}</span>
        <span className="text-muted-foreground tabular-nums">
          {maxTokens ? `${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()}` : usedTokens.toLocaleString()}
        </span>
      </div>
      {percent === undefined ? null : <Progress value={percent} aria-label="Context used" />}
    </div>
  );
}

export function ContextContentBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="context-body" className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function ContextContentFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="context-footer"
      className={cn("border-t border-border pt-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
