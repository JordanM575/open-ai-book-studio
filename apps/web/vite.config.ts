import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildVars } from "../../scripts/build-vars.mjs";
import { licenseCollector } from "../../scripts/licenses.mjs";
import { desktopOnlyModules } from "./src/desktop-only/modules.ts";

const { version, commit } = buildVars();
// The bundle is everything the web build ships, so its license report is the bundle's packages (D-186).
const licenses = licenseCollector({ target: "web", builds: ["web"] });

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(commit)
  },
  // Code the browser never runs leaves the build as a refusing stub (D-188).
  plugins: [desktopOnlyModules(), react(), tailwindcss(), licenses.plugin("web")],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 4174,
    strictPort: true
  }
});
