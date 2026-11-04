import type { ComponentProps, ReactNode } from "react";
import { Button } from "#components/button";
import { Marker, MarkerContent, MarkerIcon } from "#components/marker";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import { cn } from "#lib/utils";

/*
 * AI Elements Checkpoint (D-185), on shadcn/ui's Marker and Button: a rule after a turn with the
 * action that restores the book to how it was before that turn.
 */
export function Checkpoint({ className, children, ...props }: ComponentProps<typeof Marker>) {
  return (
    <Marker data-slot="checkpoint" variant="separator" className={cn("text-xs", className)} {...props}>
      <MarkerContent className="inline-flex flex-wrap items-center justify-center gap-2">{children}</MarkerContent>
    </Marker>
  );
}

export function CheckpointIcon(props: ComponentProps<typeof MarkerIcon>) {
  return <MarkerIcon {...props} />;
}

export function CheckpointTrigger({
  tooltip,
  children,
  ...props
}: ComponentProps<typeof Button> & { tooltip?: ReactNode }) {
  const button = (
    <Button size="xs" variant="outline" {...props}>
      {children}
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
