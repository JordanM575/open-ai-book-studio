import { createContext, useContext, useState, type ComponentProps } from "react";
import { Brain } from "lucide-react";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from "#components/trace";
import { cn } from "#lib/utils";

/*
 * AI Elements Reasoning (D-185), on shadcn/ui's Trace: the model's thinking as a line that opens
 * while it streams and closes when it finishes, unless the author has chosen otherwise. The writing
 * agent does not show reasoning today; this is here for the surfaces that will.
 */
const ReasoningState = createContext({ streaming: false });

export function Reasoning({
  streaming = false,
  ...props
}: Omit<ComponentProps<typeof TraceCollapsible>, "open" | "onOpenChange"> & { streaming?: boolean }) {
  const [open, setOpen] = useState<boolean>();
  return (
    <ReasoningState.Provider value={{ streaming }}>
      <TraceCollapsible data-slot="reasoning" open={open ?? streaming} onOpenChange={setOpen} {...props} />
    </ReasoningState.Provider>
  );
}

export function ReasoningTrigger({ children, ...props }: ComponentProps<typeof TraceCollapsibleTrigger>) {
  const { streaming } = useContext(ReasoningState);
  return (
    <TraceCollapsibleTrigger {...props}>
      <TraceLine status={streaming ? "running" : undefined}>
        <TraceIcon>
          <Brain size={14} />
        </TraceIcon>
        <TraceTitle>{children ?? (streaming ? "Thinking" : "Thought")}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}

export function ReasoningContent({ className, ...props }: ComponentProps<typeof TraceCollapsibleContent>) {
  return <TraceCollapsibleContent className={cn("whitespace-pre-wrap", className)} {...props} />;
}
