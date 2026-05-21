import { defineConfig } from "vite";
import { loadViteDevConfig } from "@bb/config/vite-dev";
import { sharedViteConfig } from "./vite.config.js";

const viteDevConfig = loadViteDevConfig();

export default defineConfig({
  ...sharedViteConfig,
  define: {
    // Connect directly to the server in dev because Vite's WS proxy does not
    // handle upstream server restarts reliably.
    __BB_DEV_WS_URL__: JSON.stringify(`${viteDevConfig.serverWsOrigin}/ws`),
  },
  server: {
    host: viteDevConfig.appHost,
    port: viteDevConfig.appPort,
    proxy: {
      "/api": {
        target: viteDevConfig.serverHttpOrigin,
        changeOrigin: true,
      },
    },
  },
});
