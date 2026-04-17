import { spawn, type ChildProcess } from "node:child_process";

interface StartCloudflaredArgs {
  tunnelToken: string;
}

export function startCloudflared(
  args: StartCloudflaredArgs,
): ChildProcess | null {
  if (args.tunnelToken.length === 0) {
    console.log("No tunnel token configured, skipping tunnel");
    return null;
  }

  const child = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "run", "--token", args.tunnelToken],
    {
      stdio: "inherit",
    },
  );

  child.on("error", (error) => {
    console.error("Failed to start Cloudflare Tunnel", error);
  });
  child.on("exit", (code, signal) => {
    if (signal || code === 0) {
      return;
    }
    process.stderr.write(
      `[dev-env] Cloudflare Tunnel exited with code ${code ?? 1}; continuing without tunnel.\n`,
    );
  });
  return child;
}
