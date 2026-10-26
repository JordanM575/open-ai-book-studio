import { connectionLabel, newConnectionId } from "@ai-book-studio/core/providers/credentials";
import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import {
  authorizeUrl,
  challengeFor,
  createPkce,
  OPENROUTER_KEY_EXCHANGE_URL,
  parseKeyResponse,
  PKCE_TIMEOUT_MS,
  readCallback,
  type PkceState
} from "@ai-book-studio/core/providers/openrouter";
import { ProviderError, type ConnectionSummary } from "@ai-book-studio/core/providers/types";
import { BrowserCredentialVault } from "../storage/credentials";

export const OPENROUTER_PKCE_KEY = "ai-book-studio.openrouter.pkce";
const POPUP_NAME = "ai-book-studio-openrouter";
const EXCHANGE_TIMEOUT_MS = 15_000;

interface ActivePopup {
  popup: Window;
  cancel: () => void;
}

let active: ActivePopup | null = null;

/**
 * Start OpenRouter sign-in in a same-origin popup.
 *
 * The popup inherits this tab's sessionStorage, so the PKCE verifier stays in the tab that started
 * the flow. The callback exchanges the single-use code, stores the key in the browser vault and
 * posts the connection summary back. No secret reaches the library, the parent page or a studio
 * server. A browser that blocks the popup gets a clear recovery message instead of a dead button.
 */
export async function startOpenRouterFlow(): Promise<ConnectionSummary> {
  if (active) {
    throw new ProviderError("invalid-request", "A sign-in is already waiting in this browser. Finish it or cancel it first.");
  }

  const pkce = await createPkce();
  const challenge = await challengeFor(pkce.verifier);
  sessionStorage.setItem(OPENROUTER_PKCE_KEY, JSON.stringify(pkce));

  const callbackUrl = new URL(window.location.href);
  callbackUrl.search = "?openrouter=callback";
  callbackUrl.hash = "";
  const authUrl = authorizeUrl({ callbackUrl: callbackUrl.toString(), challenge, state: pkce.state });
  const popup = window.open(authUrl, POPUP_NAME, "popup,width=520,height=720");
  if (!popup) {
    sessionStorage.removeItem(OPENROUTER_PKCE_KEY);
    throw new ProviderError(
      "unknown",
      "The browser blocked the sign-in window. Allow pop-ups for this site and try again."
    );
  }

  return new Promise<ConnectionSummary>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, connection?: ConnectionSummary): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(closedPoll);
      window.removeEventListener("message", onMessage);
      active = null;
      sessionStorage.removeItem(OPENROUTER_PKCE_KEY);
      if (error) reject(error);
      else if (connection) resolve(connection);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        state?: string;
        connection?: ConnectionSummary;
        message?: string;
      };
      if (!data || data.state !== pkce.state) return;
      if (data.type === "openrouter" && data.connection) {
        try {
          popup.close();
        } catch {
          // The popup may already be closing itself.
        }
        finish(null, data.connection);
      } else if (data.type === "openrouter-error") {
        finish(new ProviderError("auth", data.message || "OpenRouter sign-in failed."));
      }
    };

    const timer = setTimeout(() => {
      finish(new ProviderError("auth", "Sign-in timed out. Start again when you are ready."));
    }, PKCE_TIMEOUT_MS);
    const closedPoll = setInterval(() => {
      if (popup.closed) finish(new ProviderError("auth", "Sign-in cancelled."));
    }, 500);

    window.addEventListener("message", onMessage);
    active = {
      popup,
      cancel: () => {
        try {
          popup.close();
        } catch {
          // Closing is best effort; the rejection below is what matters.
        }
        finish(new ProviderError("auth", "Sign-in cancelled."));
      }
    };
  });
}

export function cancelOpenRouterFlow(): void {
  active?.cancel();
}

/**
 * Finish the popup's callback. Returns null when the page is not an OpenRouter callback. The popup
 * closes after posting to the opener; a full-page callback still shows a readable result.
 */
export async function handleOpenRouterCallback(): Promise<ConnectionSummary | null> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("openrouter") !== "callback") return null;

  const raw = sessionStorage.getItem(OPENROUTER_PKCE_KEY);
  if (!raw) {
    throw new ProviderError("auth", "The sign-in request was not found in this tab. Start again from Settings.");
  }
  let pkce: PkceState;
  try {
    pkce = JSON.parse(raw) as PkceState;
  } catch {
    throw new ProviderError("auth", "The sign-in request was damaged. Start again from Settings.");
  }

  const { code } = readCallback(window.location.href, pkce.state, Date.now(), pkce.createdAt);
  const key = await exchangeCode(code, pkce.verifier);
  const vault = new BrowserCredentialVault();
  const existing = (await vault.list()).filter((connection) => connection.provider === "openrouter");
  const connection: ConnectionSummary = {
    id: newConnectionId(),
    provider: "openrouter",
    label: connectionLabel("openrouter", existing.length),
    kind: "openrouter-oauth",
    createdAt: new Date().toISOString()
  };
  await vault.set({ ...connection, secret: key });

  sessionStorage.removeItem(OPENROUTER_PKCE_KEY);
  window.history.replaceState({}, "", window.location.pathname);
  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    opener.postMessage({ type: "openrouter", state: pkce.state, connection }, window.location.origin);
    window.setTimeout(() => window.close(), 50);
  }
  return connection;
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_KEY_EXCHANGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS)
    });
  } catch (error) {
    throw new ProviderError("offline", "Could not reach OpenRouter to finish sign-in. Check your connection and try again.", {
      provider: "openrouter",
      cause: error
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw normalizeProviderError({ provider: "openrouter", status: response.status, body });
  }
  return parseKeyResponse(await response.json().catch(() => null));
}
