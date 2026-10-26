import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildVars } from "../../scripts/build-vars.mjs";

const { version, commit } = buildVars();

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit)
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 4174,
    strictPort: true
  }
});
