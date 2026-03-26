import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEFAULTS } from "../../packages/config/src/defaults.js";

const appPort = Number.parseInt(process.env.BB_APP_PORT ?? String(DEFAULTS.appPort.dev), 10);
const serverPort = Number.parseInt(process.env.BB_SERVER_PORT ?? String(DEFAULTS.serverPort.dev), 10);
const serverHttpOrigin = `http://localhost:${serverPort}`;
const serverWsOrigin = `ws://localhost:${serverPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: appPort,
    proxy: {
      "/api": {
        target: serverHttpOrigin,
        changeOrigin: true,
      },
      "/ws": {
        target: serverWsOrigin,
        ws: true,
      },
    },
  },
});
