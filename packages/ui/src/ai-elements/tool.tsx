import type { ComponentProps, ReactNode } from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from "#components/trace";
import { cn } from "#lib/utils";

/*
 * AI Elements Tool (D-185), on shadcn/ui's Trace. A tool is a plain line while it runs or when it has
 * nothing to show, and a disclosure once there is detail to open. The detail is plain text, so it
 * sits in a scrolling block rather than shadcn's Code Block, which would bring a syntax highlighter.
 */
export type ToolStatus = "running" | "done" | "error";

/** The steps of one turn, in order. */
export function Tools({ className, ...props }: ComponentProps<typeof Trace>) {
  return <Trace data-slot="tools" className={cn("gap-1", className)} {...props} />;
}

export function Tool(props: ComponentProps<typeof TraceCollapsible>) {
  return <TraceCollapsible data-slot="tool" {...props} />;
}

export interface ToolLineProps {
  title: ReactNode;
  status: ToolStatus;
  icon?: ReactNode;
  className?: string;
}

/** The tool's status line on its own; wrap it in ToolHeader when it has detail to open. */
export function ToolLine({ title, status, icon, className }: ToolLineProps) {
  return (
    <TraceLine status={status === "done" ? undefined : status} className={className}>
      {icon ? <TraceIcon>{icon}</TraceIcon> : null}
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );
}

export function ToolHeader({
  title,
  status,
  icon,
  className,
  ...props
}: ToolLineProps & Omit<ComponentProps<typeof TraceCollapsibleTrigger>, "title" | "children">) {
  return (
    <TraceCollapsibleTrigger className={className} {...props}>
      <ToolLine title={title} status={status} icon={icon} />
    </TraceCollapsibleTrigger>
  );
}

export function ToolContent(props: ComponentProps<typeof TraceCollapsibleContent>) {
  return <TraceCollapsibleContent {...props} />;
}

/** Raw input and output, closed until the author opens the tool. */
export function ToolOutput({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      data-slot="tool-output"
      className={cn(
        "thin-scroll max-h-48 overflow-auto rounded-[var(--corner-md)] bg-[var(--background)] p-2 font-mono text-[11px] leading-[1.45] break-words whitespace-pre-wrap text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
