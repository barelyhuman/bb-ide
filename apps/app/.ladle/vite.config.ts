import path from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Ladle bundles Vite 6 (rollup) and provides its own React plugin via
// @vitejs/plugin-react-swc. The app's main vite.config.ts uses
// @vitejs/plugin-react@6, which only works inside rolldown-vite — loading it
// here crashes Ladle's transform pipeline with "Missing field `moduleType`".
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    conditions: ["source"],
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
});
