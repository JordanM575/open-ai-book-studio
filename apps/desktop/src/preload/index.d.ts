import type { StudioApi } from "@ai-book-studio/core/ipc";

declare global {
  interface Window {
    studio: StudioApi;
  }
}

// biome-ignore lint/complexity/noUselessEmptyExport: the empty export keeps this a module so `declare global` augments instead of erroring
export {};
