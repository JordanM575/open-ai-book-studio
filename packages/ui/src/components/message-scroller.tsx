import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject
} from "react";
import { cn } from "#lib/utils";

import { Button } from "#components/button";
import { ArrowDownIcon } from "lucide-react";

/*
 * shadcn/ui's Message Scroller on Liquid Glass (D-185). The parts, slots and classes are shadcn/ui's;
 * the scrolling underneath is the studio's own, because @shadcn/react's primitive is 19 kB and would
 * take the web bundle past SC-009. It does what the chat needs: it follows a reply while the author is
 * at the end, keeps their place when they scroll up to reread, returns to the end when they send, and
 * offers a button back to the end. It keeps the studio's thin scrollbar and no gradient fade.
 */

/** How close to the end, in pixels, still counts as being at the end. */
const END_SLACK = 8;

interface Scroller {
  autoScroll: boolean;
  viewport: RefObject<HTMLElement | null>;
  content: RefObject<HTMLDivElement | null>;
  /** Whether new content should keep the end in view: true until the author scrolls away from it. */
  following: { current: boolean };
  atEnd: boolean;
  setAtEnd: (atEnd: boolean) => void;
}

const ScrollerContext = createContext<Scroller | null>(null);

function useScroller(): Scroller {
  const scroller = useContext(ScrollerContext);
  if (!scroller) throw new Error("Message Scroller parts must sit inside MessageScrollerProvider");
  return scroller;
}

function isAtEnd(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= END_SLACK;
}

function MessageScrollerProvider({ autoScroll = false, children }: { autoScroll?: boolean; children?: ReactNode }) {
  const viewport = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const value = useMemo(() => ({ autoScroll, viewport, content, following, atEnd, setAtEnd }), [autoScroll, atEnd]);
  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>;
}

function MessageScroller({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({ className, onScroll, ...props }: ComponentProps<"section">) {
  const { autoScroll, viewport, content, following, setAtEnd } = useScroller();
  const lastTop = useRef(0);
  // Here rather than in the content part: the viewport's layout effect runs once both elements are attached.
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const settle = (): void => {
      if (autoScroll && following.current) view.scrollTop = view.scrollHeight;
      setAtEnd(isAtEnd(view));
    };
    settle();
    if (typeof ResizeObserver === "undefined") return;
    // A streaming reply grows the content; a resized window or composer changes the viewport.
    const observer = new ResizeObserver(settle);
    observer.observe(view);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [autoScroll, viewport, content, following, setAtEnd]);
  return (
    <section
      ref={viewport}
      aria-label="Messages"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the transcript scrolls on its own, so it takes focus for the keyboard to scroll it
      tabIndex={0}
      data-slot="message-scroller-viewport"
      className={cn(
        "thin-scroll size-full min-h-0 min-w-0 scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content",
        className
      )}
      onScroll={(event) => {
        const element = event.currentTarget;
        const end = isAtEnd(element);
        // Moving up and away from the end is the author reading back; moving down keeps the choice.
        if (end) following.current = true;
        else if (element.scrollTop < lastTop.current) following.current = false;
        lastTop.current = element.scrollTop;
        setAtEnd(end);
        onScroll?.(event);
      }}
      {...props}
    />
  );
}

function MessageScrollerContent({ className, ...props }: ComponentProps<"div">) {
  const { content } = useScroller();
  return (
    <div
      ref={content}
      role="log"
      aria-relevant="additions"
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-6", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  messageId,
  scrollAnchor = false,
  ...props
}: ComponentProps<"div"> & { messageId?: string; scrollAnchor?: boolean }) {
  const { following } = useScroller();
  // A new message from the author brings the end back into view, wherever they had scrolled.
  useLayoutEffect(() => {
    if (scrollAnchor) following.current = true;
  }, [scrollAnchor, following]);
  return (
    <div
      data-slot="message-scroller-item"
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? "true" : "false"}
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  className,
  children,
  behavior = "smooth",
  variant = "secondary",
  size = "icon-sm",
  onClick,
  ...props
}: ComponentProps<typeof Button> & { behavior?: ScrollBehavior }) {
  const { viewport, following, atEnd } = useScroller();
  return (
    <Button
      data-slot="message-scroller-button"
      data-active={atEnd ? "false" : "true"}
      inert={atEnd}
      tabIndex={atEnd ? -1 : undefined}
      variant={variant}
      size={size}
      className={cn(
        "absolute bottom-4 inset-s-1/2 -translate-x-1/2 rounded-full shadow-[var(--elevation-2)] transition-[translate,scale,opacity] duration-[var(--duration-normal)] data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-[var(--duration-slow)] data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] rtl:translate-x-1/2",
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        following.current = true;
        const view = viewport.current;
        view?.scrollTo({ top: view.scrollHeight, behavior });
      }}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon size={15} />
          <span className="sr-only">Scroll to end</span>
        </>
      )}
    </Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton
};
