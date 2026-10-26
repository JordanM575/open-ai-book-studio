import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL("./check", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  publicDir: false,
  build: {
    outDir: "gallery-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./check/gallery.html", import.meta.url))
    }
  }
});
