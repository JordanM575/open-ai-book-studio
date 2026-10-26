import type { BrowserAccess, ProviderDescription, ProviderId } from "./types";

/**
 * One table for every provider the studio knows. Adding a provider is a change here plus its tests;
 * the interface, the web capability gate and the content security policy all read from this table.
 */
export const PROVIDERS: Record<ProviderId, ProviderDescription> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    hosts: ["https://openrouter.ai", "https://openrouter.ai/api"],
    authKinds: ["oauth", "api-key"],
    browserAccess: "yes",
    docsUrl: "https://openrouter.ai/docs",
    note: "One connection reaches models from many companies. Billed by OpenRouter to your own account."
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    hosts: ["https://api.openai.com"],
    authKinds: ["api-key"],
    // OpenAI's API does not answer browser preflights; this stays desktop-only.
    browserAccess: "no",
    docsUrl: "https://platform.openai.com/docs",
    note: "Use an API key from your OpenAI account. The ChatGPT plan is a separate connection."
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    hosts: ["https://api.anthropic.com"],
    authKinds: ["api-key"],
    browserAccess: "opt-in-header",
    docsUrl: "https://docs.anthropic.com",
    note: "The browser build can call Anthropic only with its direct-browser header, which exposes the key to that tab."
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    hosts: ["https://generativelanguage.googleapis.com"],
    authKinds: ["api-key"],
    browserAccess: "unknown",
    docsUrl: "https://ai.google.dev/docs",
    note: "Browser access has not been verified. Desktop only until a browser-access test passes."
  },
  meta: {
    id: "meta",
    name: "Meta",
    hosts: [],
    authKinds: ["api-key"],
    browserAccess: "unknown",
    docsUrl: "https://dev.meta.ai",
    note: "Meta's hosted endpoint has changed before. Enter the current base URL from Meta's developer console."
  }
};

export const PROVIDER_LIST: ProviderDescription[] = Object.values(PROVIDERS);

export function providerById(id: ProviderId): ProviderDescription {
  return PROVIDERS[id];
}

/** The only hosts the desktop build is allowed to contact for model access. */
export function providerHosts(): string[] {
  return [...new Set(PROVIDER_LIST.flatMap((provider) => provider.hosts))];
}

export function browserAvailable(access: BrowserAccess): boolean {
  return access === "yes";
}

export function browserAvailabilityCopy(access: BrowserAccess): string {
  switch (access) {
    case "yes":
      return "Works in the browser";
    case "no":
      return "Desktop app only";
    case "opt-in-header":
      return "Browser use sends your key from this tab";
    case "unknown":
      return "Not verified in browsers";
  }
}
