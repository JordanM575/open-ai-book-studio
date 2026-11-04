import type { ComponentProps } from "react";
import { Button } from "#components/button";
import { cn } from "#lib/utils";

/*
 * AI Elements Suggestion (D-185), on shadcn/ui's Button: a canned prompt the author can pick. The
 * row wraps rather than scrolling sideways, because the sideways row needs a gradient edge fade.
 */
export function Suggestions({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="suggestions" className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export function Suggestion({ suggestion, onClick, className, children, ...props }: SuggestionProps) {
  return (
    <Button
      data-slot="suggestion"
      variant="outline"
      size="sm"
      className={cn("shrink-0", className)}
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  );
}
