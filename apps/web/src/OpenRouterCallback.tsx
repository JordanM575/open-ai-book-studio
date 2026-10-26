import { useEffect, useState } from "react";
import { handleOpenRouterCallback } from "./runtime/openrouter";

/** The popup's landing page. It finishes the exchange, tells the opener and closes itself. */
export function OpenRouterCallback() {
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    void handleOpenRouterCallback()
      .then((connection) => {
        if (!connection) {
          setMessage("Nothing to finish. You can close this window.");
          return;
        }
        setMessage(`Connected ${connection.label}. You can close this window.`);
        if (window.opener) window.setTimeout(() => window.close(), 800);
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        setMessage(detail);
        const opener = window.opener as Window | null;
        const state = new URLSearchParams(window.location.search).get("state") ?? "";
        if (opener && !opener.closed) {
          opener.postMessage({ type: "openrouter-error", state, message: detail }, window.location.origin);
        }
      });
  }, []);

  return (
    <div className="window-wash flex min-h-full items-center justify-center p-6" data-testid="openrouter-callback">
      <div className="glass w-full max-w-[420px] rounded-[var(--corner-xl)] p-6">
        <h1 className="text-[var(--text-title-3-size)] font-semibold">OpenRouter</h1>
        <p className="mt-2 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
          {message}
        </p>
        {message.startsWith("Connected") ? null : (
          <a
            href="/"
            className="mt-4 inline-flex text-[var(--text-callout-size)] text-primary underline-offset-4 hover:underline"
          >
            Return to the studio
          </a>
        )}
      </div>
    </div>
  );
}
