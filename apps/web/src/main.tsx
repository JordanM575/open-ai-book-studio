import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "@ai-book-studio/app";
import { OpenRouterCallback } from "./OpenRouterCallback";
import { WebWelcome } from "./WebWelcome";
import { createBrowserStudioApi } from "./runtime/browser-api";
import { BrowserLibraries } from "./runtime/browser-libraries";
import "./styles.css";

const libraries = new BrowserLibraries();
window.studio = createBrowserStudioApi(libraries);

function Shell() {
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void libraries.restore().finally(() => {
      setRestored(true);
      setReady(libraries.service !== null);
    });
  }, []);

  if (!restored) {
    return (
      <div className="window-wash flex h-full items-center justify-center">
        <p className="text-(length:--text-subheadline-size) text-muted-foreground">Opening your library…</p>
      </div>
    );
  }
  if (!ready) return <WebWelcome libraries={libraries} onOpened={() => setReady(true)} />;
  return <App />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const isOpenRouterCallback = new URLSearchParams(window.location.search).get("openrouter") === "callback";
createRoot(root).render(
  isOpenRouterCallback ? (
    <OpenRouterCallback />
  ) : (
    <StrictMode>
      <Shell />
    </StrictMode>
  )
);
