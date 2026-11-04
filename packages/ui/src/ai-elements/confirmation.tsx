import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Button } from "#components/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "#components/item";
import { cn } from "#lib/utils";

/*
 * AI Elements Confirmation (D-185), on shadcn/ui's Item and Button: the gate a destructive tool
 * waits behind until the author allows or denies it.
 */
export type ConfirmationState = "pending" | "approved" | "denied" | "expired";

const ConfirmationContext = createContext<ConfirmationState>("pending");

export function Confirmation({
  state,
  className,
  children,
  ...props
}: ComponentProps<typeof Item> & { state: ConfirmationState }) {
  return (
    <ConfirmationContext.Provider value={state}>
      <Item
        data-slot="confirmation"
        data-state={state}
        variant="outline"
        size="sm"
        className={cn("gap-x-3 gap-y-2 bg-[var(--secondary)]", className)}
        {...props}
      >
        {children}
      </Item>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationTitle({
  className,
  description,
  children,
  ...props
}: ComponentProps<typeof ItemContent> & { description?: ReactNode }) {
  return (
    <ItemContent className={cn("min-w-40", className)} {...props}>
      <ItemTitle>{children}</ItemTitle>
      {description ? <ItemDescription>{description}</ItemDescription> : null}
    </ItemContent>
  );
}

function Only({ when, children }: { when: ConfirmationState; children?: ReactNode }) {
  return useContext(ConfirmationContext) === when ? children : null;
}

/** Shown only while the tool waits for an answer. */
export function ConfirmationRequest({ children }: { children?: ReactNode }) {
  return <Only when="pending">{children}</Only>;
}

export function ConfirmationAccepted({ children }: { children?: ReactNode }) {
  return <Only when="approved">{children}</Only>;
}

export function ConfirmationRejected({ children }: { children?: ReactNode }) {
  return <Only when="denied">{children}</Only>;
}

export function ConfirmationExpired({ children }: { children?: ReactNode }) {
  return <Only when="expired">{children}</Only>;
}

export function ConfirmationActions({ className, ...props }: ComponentProps<typeof ItemActions>) {
  return <ItemActions className={cn("flex-wrap", className)} {...props} />;
}

export function ConfirmationAction(props: ComponentProps<typeof Button>) {
  return <Button size="sm" {...props} />;
}
