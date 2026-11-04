/** How a launch shows itself, read once from its environment. `index.ts` documents each flag. */
export interface LaunchMode {
  /** `STUDIO_TEST=1`: the run has its own throwaway profile. */
  isTest: boolean;
  /** The window opens off-screen and is never shown. */
  headless: boolean;
}

/**
 * A run is hidden with `STUDIO_TEST=1`, or with `STUDIO_HEADLESS=1`, unless it is a visible test
 * run: `STUDIO_TEST=1` with `STUDIO_VISIBLE=1` is on screen like the app, whatever else is set.
 * The window and the background notifier both read this, so a window nobody can see never posts a
 * notification either.
 */
export function launchMode(env: Readonly<Record<string, string | undefined>>): LaunchMode {
  const isTest = env.STUDIO_TEST === "1";
  const visibleTest = isTest && env.STUDIO_VISIBLE === "1";
  return { isTest, headless: !visibleTest && (isTest || env.STUDIO_HEADLESS === "1") };
}
