import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildVars } from "../../scripts/build-vars.mjs";
import { licenseCollector } from "../../scripts/licenses.mjs";

const { version, commit } = buildVars();
// The bundle is everything the web build ships, so its license report is the bundle's packages (D-186).
const licenses = licenseCollector({ target: "web", builds: ["web"] });

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit)
  },
  plugins: [react(), tailwindcss(), licenses.plugin("web")],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 4174,
    strictPort: true
  }
});
