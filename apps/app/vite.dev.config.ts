import { defineConfig } from "vite";
import { devEnvConfig } from "../../packages/config/src/dev-env.js";
import { serverPortConfig } from "../../packages/config/src/server-port.js";
import { sharedViteConfig } from "./vite.config.js";

const appPort = devEnvConfig.BB_DEV_APP_PORT;
if (appPort === undefined) {
  throw new Error("BB_DEV_APP_PORT is required to run the app dev server");
}

const appHost =
  devEnvConfig.BB_DEV_APP_HOST === "" ? undefined : devEnvConfig.BB_DEV_APP_HOST;
const serverHttpOrigin = `http://localhost:${serverPortConfig.BB_SERVER_PORT}`;
const serverWsOrigin = `ws://localhost:${serverPortConfig.BB_SERVER_PORT}`;

export default defineConfig({
  ...sharedViteConfig,
  define: {
    // Connect directly to the server in dev because Vite's WS proxy does not
    // handle upstream server restarts reliably.
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
});
