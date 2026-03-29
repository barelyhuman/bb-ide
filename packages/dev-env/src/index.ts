import { spawn } from "node:child_process";
import { devEnvConfig } from "@bb/config/dev-env";

const { DEV_CLOUDFLARED_TUNNEL_TOKEN: tunnelToken } = devEnvConfig;

if (tunnelToken.length === 0) {
  console.log("No tunnel token configured, skipping tunnel");
  process.exit(0);
}

const child = spawn(
  "cloudflared",
  ["tunnel", "--no-autoupdate", "run", "--token", tunnelToken],
  {
    stdio: "inherit",
  },
);

const terminateChild = (): void => {
  child.kill("SIGTERM");
};

process.on("SIGINT", terminateChild);
process.on("SIGTERM", terminateChild);

child.on("error", (error) => {
  console.error("Failed to start Cloudflare Tunnel", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.off("SIGINT", terminateChild);
  process.off("SIGTERM", terminateChild);

  if (signal) {
    process.exit(0);
    return;
  }

  process.exit(code ?? 0);
});
