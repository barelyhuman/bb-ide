import { envsafe, str } from "envsafe";

export const devEnvConfig = envsafe({
  DEV_CLOUDFLARED_TUNNEL_TOKEN: str({
    desc: "Cloudflare Tunnel token for exposing the local dev server to E2B sandboxes",
    default: "",
    allowEmpty: true,
    devDefault: "",
  }),
});
