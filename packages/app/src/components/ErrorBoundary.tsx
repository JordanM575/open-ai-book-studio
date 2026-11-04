import { Component, type ReactNode } from "react";
import { Button } from "@ai-book-studio/ui/button";

interface Props {
  children?: ReactNode;
  /** Overridden in tests; the studio reloads the window by default. */
  onReload?: () => void;
}

interface State {
  failed: boolean;
}

/**
 * The last resort for a rendering crash. A view that throws would otherwise leave the author
 * staring at a blank window; this keeps a plain screen with one way back. It catches render
 * failures only — event handlers and async work report through their own paths — and it never
 * touches the library: reloading starts fresh from what was last saved.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        data-testid="error-screen"
        className="window-wash flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-(length:--text-title-2-size) leading-[var(--text-title-2-leading)] font-semibold tracking-[-0.2px]">
          Something went wrong
        </p>
        <p className="max-w-md text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
          The studio ran into a problem showing this screen. Reloading starts fresh from what was
          last saved.
        </p>
        <Button
          data-testid="error-reload"
          type="button"
          onClick={() => (this.props.onReload ?? (() => window.location.reload()))()}
        >
          Reload studio
        </Button>
      </div>
    );
  }
}
