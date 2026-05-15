import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  publicDir: false,
  build: {
    outDir: "dist-widget",
    emptyOutDir: true,
    lib: {
      entry: "src/widget/codex-pet-widget.js",
      name: "CodexPet",
      formats: ["iife", "es"],
      fileName: (format) => format === "es" ? "codex-pet-widget.es.js" : "codex-pet-widget.js"
    }
  }
});
