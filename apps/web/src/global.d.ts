import type { StudioApi } from "@ai-book-studio/core/ipc";

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
