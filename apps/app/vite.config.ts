import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devEnvConfig } from "../../packages/config/src/dev-env.js";
import { serverPortConfig } from "../../packages/config/src/server-port.js";

const sharedConfig = {
  plugins: [react(), tailwindcss()],
  build: {
    // Skip compressed-size calculation to keep production app builds fast.
    reportCompressedSize: false,
  },
  optimizeDeps: {
    // The terminal imports xterm lazily when the panel mounts. Pre-optimize
    // these packages so opening the terminal does not discover new deps and
    // invalidate Vite's optimized-dependency hash mid-session.
    include: ["@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/xterm"],
  },
  resolve: {
    conditions: ["source"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};

export default defineConfig(({ command }) => {
  if (command !== "serve") {
    return sharedConfig;
  }

  const appPort = devEnvConfig.BB_DEV_APP_PORT;
  if (appPort === undefined) {
    throw new Error("BB_DEV_APP_PORT is required to run the app dev server");
  }
  const appHost =
    devEnvConfig.BB_DEV_APP_HOST === ""
      ? undefined
      : devEnvConfig.BB_DEV_APP_HOST;
  const serverPort = serverPortConfig.BB_SERVER_PORT;
  const serverHttpOrigin = `http://localhost:${serverPort}`;
  const serverWsOrigin = `ws://localhost:${serverPort}`;

  return {
    ...sharedConfig,
    define: {
      // In dev mode, connect the WebSocket directly to the server instead of
      // going through Vite's proxy. Vite's WS proxy (node-http-proxy) does not
      // handle reconnection when the upstream server restarts — it's a known
      // limitation (vitejs/vite#8117, chimurai/http-proxy-middleware#44).
      // In production the server serves the app directly so this isn't needed.
      __BB_DEV_WS_URL__: JSON.stringify(`${serverWsOrigin}/ws`),
    },
    server: {
      host: appHost,
      port: appPort,
      proxy: {
        "/api": {
          target: serverHttpOrigin,
          changeOrigin: true,
        },
      },
    },
  };
});
