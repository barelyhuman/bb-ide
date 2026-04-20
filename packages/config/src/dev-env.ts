import { envsafe, port, str } from "envsafe";
import { DEFAULTS } from "./defaults.js";

export const devEnvConfig = envsafe({
  BB_DEV_APP_HOST: str({
    desc: "Development-only Vite bind host for apps/app. Set to 0.0.0.0 to test from phones or other LAN devices. Does not affect production server binding or generated URLs.",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
  BB_DEV_APP_PORT: port({
    desc: "Development-only Vite port for apps/app.",
    default: DEFAULTS.appPort.dev,
    devDefault: DEFAULTS.appPort.dev,
  }),
  BB_DEV_ENV_PORT: port({
    desc: "Development-only localhost port for the bb dev-env helper API.",
    default: DEFAULTS.devEnvPort,
    devDefault: DEFAULTS.devEnvPort,
  }),
  DEV_CLOUDFLARED_TUNNEL_TOKEN: str({
    desc: "Cloudflare Tunnel token for exposing the local dev server to E2B sandboxes",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
});
