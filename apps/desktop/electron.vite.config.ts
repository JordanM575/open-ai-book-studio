import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildVars } from "../../scripts/build-vars.mjs";

// The shared package ships TypeScript source, so it must be bundled rather than externalised.
// Externalising it would make Electron `require` a `.ts` file at runtime.
const externalize = externalizeDepsPlugin({
  exclude: ["@ai-book-studio/core", "@ai-book-studio/ui", "@ai-book-studio/app"]
});
const { version, commit } = buildVars();
const buildDefine = {
  __BUILD_VERSION__: JSON.stringify(version),
  __BUILD_COMMIT__: JSON.stringify(commit)
};

export default defineConfig({
  main: {
    define: buildDefine,
    plugins: [externalize],
    resolve: {
      alias: {
        "@main": resolve("src/main")
      }
    },
    // Electron's main process stays CommonJS: the `electron` package is CJS, and named imports
    // such as `BrowserWindow` are not available from an ES module in Node.
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  preload: {
    define: buildDefine,
    plugins: [externalize],
    // Sandboxed preload scripts are loaded as CommonJS, so do not emit an ESM `.mjs` file even
    // though the package itself is `"type": "module"`.
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    define: buildDefine,
    plugins: [react(), tailwindcss()]
  }
});
