import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";

/*
 * The DOM a component test file runs in: registered in `beforeAll`, closed in `afterAll`.
 *
 * `bun test` runs every file in one process, and happy-dom replaces hundreds of globals while it is
 * registered: fetch, streams, timers. So each file registers its own window and closes it again, which
 * puts the globals back for every other file. React is the catch. It captures `queueMicrotask` and
 * `setTimeout` the first time it loads, so if those were happy-dom's, a closed window strands every
 * update React has scheduled. Node's timers are installed before React loads, so those are what it keeps.
 *
 * The testing library is the `/pure` entry because the main entry registers its own hooks when it loads,
 * and bun refuses to register a hook from inside one. It is loaded here, after the DOM exists.
 */
let owned = false;

export async function mountDom(): Promise<typeof import("@testing-library/react/pure")> {
  if (typeof document === "undefined") {
    GlobalRegistrator.register({ url: "http://localhost" });
    owned = true;
  }
  // After any registration, because registering replaces these. It runs whether or not this file
  // registered the window, so React never captures another file's window timers.
  Object.assign(globalThis, {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask: (task: () => void) => void Promise.resolve().then(task)
  });
  return import("@testing-library/react/pure");
}

export async function unmountDom(): Promise<void> {
  if (!owned) return;
  owned = false;
  // React can still hold work it scheduled outside act(), such as the render after a late state update
  // in a file's last test. That work reads `window.event` when it runs, so it runs here, while the
  // window still exists, rather than inside whichever file comes next.
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await GlobalRegistrator.unregister();
}
