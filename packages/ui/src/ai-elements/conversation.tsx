import type { ComponentProps, ReactNode } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from "#components/message-scroller";
import { cn } from "#lib/utils";

/*
 * AI Elements Chat (D-185), on shadcn/ui's Message Scroller. The scroller follows a streaming reply
 * while the author stays at the end and keeps their place when they scroll up to reread.
 */
export function Conversation({ className, children, ...props }: ComponentProps<typeof MessageScroller>) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller data-slot="conversation" className={className} {...props}>
        {children}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function ConversationContent({
  className,
  viewportClassName,
  children,
  ...props
}: ComponentProps<typeof MessageScrollerContent> & { viewportClassName?: string }) {
  return (
    <MessageScrollerViewport className={viewportClassName}>
      <MessageScrollerContent className={cn("gap-4 px-4 py-4", className)} {...props}>
        {children}
      </MessageScrollerContent>
    </MessageScrollerViewport>
  );
}

/** One turn. Set scrollAnchor on the author's messages: a new one brings the end back into view. */
export function ConversationItem(props: ComponentProps<typeof MessageScrollerItem>) {
  return <MessageScrollerItem {...props} />;
}

/** Jumps to the newest turn. It scrolls smoothly unless the author has asked for reduced motion. */
export function ConversationScrollButton({ behavior, ...props }: ComponentProps<typeof MessageScrollerButton>) {
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  return <MessageScrollerButton behavior={behavior ?? (reduced ? "auto" : "smooth")} {...props} />;
}

export function ConversationEmptyState({
  className,
  title,
  description,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { title?: ReactNode; description?: ReactNode }) {
  return (
    <div data-slot="conversation-empty-state" className={cn("flex flex-col gap-3", className)} {...props}>
      {title ? <p className="text-(length:--text-headline-size) font-semibold">{title}</p> : null}
      {description ? (
        <p className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
