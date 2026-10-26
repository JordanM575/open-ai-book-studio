import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "ai-book-studio.theme";

function apply(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset["theme"] = dark ? "dark" : "light";
}

export function useTheme(): { choice: ThemeChoice; set: (choice: ThemeChoice) => void; cycle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (): void => apply("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [choice]);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const cycle = useCallback(() => {
    setChoice((current) => {
      const next: ThemeChoice = current === "system" ? "light" : current === "light" ? "dark" : "system";
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { choice, set, cycle };
}
