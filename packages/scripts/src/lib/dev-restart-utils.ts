import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  resolveCurrentDevInstanceConfig,
  resolvePortFromEnv,
  resolveRuntimeDataDir,
} from "@bb/config/runtime";

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
  return resolveRuntimeDataDir({
    env: process.env,
    homeDir: homedir(),
    mode: "dev",
    repoRoot,
  });
}

export function resolveDevHostDaemonPort(): number {
  return resolvePortFromEnv({
    defaultPort: resolveCurrentDevInstanceConfig(repoRoot).ports.hostDaemonPort,
    env: process.env,
    name: "BB_HOST_DAEMON_PORT",
  });
}

export function resolveSupervisorPidPath(serviceName: string): string {
  return join(resolveDevDataDir(), "dev-supervisors", `${serviceName}.pid`);
}
