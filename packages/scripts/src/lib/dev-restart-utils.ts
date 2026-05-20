import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfiguredDataDir } from "@bb/config/data-dir";
import { DEFAULTS } from "@bb/config/defaults";
import { resolveCurrentWorktreeDevInstanceConfig } from "./worktree-dev-instance.js";

interface TurboBuildCommand {
  args: string[];
  command: string;
}

const libDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(libDir, "..", "..");
const repoRoot = resolve(packageRoot, "..", "..");

export function createTurboBuildCommand(filters: string[]): TurboBuildCommand {
  const args = [
    "exec",
    "turbo",
    "run",
    "build",
    "--no-daemon",
    "--no-update-notifier",
    "--ui",
    "stream",
    "--output-logs",
    "errors-only",
  ];

  for (const filter of filters) {
    args.push("--filter", filter);
  }

  return {
    args,
    command: "pnpm",
  };
}

export function resolveDevDataDir(): string {
  if (process.env.BB_DATA_DIR === undefined) {
    return resolveCurrentWorktreeDevInstanceConfig(repoRoot).dataDir;
  }

  return resolveConfiguredDataDir({
    defaultDirName: DEFAULTS.dataDir.dev,
    env: process.env,
  });
}

export function resolveDevHostDaemonPort(): number {
  if (process.env.BB_HOST_DAEMON_PORT === undefined) {
    return resolveCurrentWorktreeDevInstanceConfig(repoRoot).ports
      .hostDaemonPort;
  }

  const port = Number.parseInt(process.env.BB_HOST_DAEMON_PORT, 10);
  if (
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65_535 ||
    String(port) !== process.env.BB_HOST_DAEMON_PORT
  ) {
    throw new Error("BB_HOST_DAEMON_PORT must be a valid port number");
  }
  return port;
}

export function resolveSupervisorPidPath(serviceName: string): string {
  return join(resolveDevDataDir(), "dev-supervisors", `${serviceName}.pid`);
}
